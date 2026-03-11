from __future__ import annotations

from dataclasses import replace
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
from typing import Optional, Protocol
from urllib.parse import urlparse
import wave

import httpx
from mutagen import File as MutagenFile
from mutagen.id3 import COMM, TALB, TCON, TDRC, TIT2, TPE1, ID3
from mutagen.mp4 import MP4

from .config import Config
from .models import Article, TTSSegment


SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+")
CLAUSE_BOUNDARY = re.compile(r"(?<=[,;:])\s+")


class ProgressCallback(Protocol):
    def on_status(self, article_id: str, stage: str, message: str) -> None: ...
    def on_progress(self, article_id: str, current: int, total: int) -> None: ...
    def on_error(self, article_id: str, error: str) -> None: ...
    def on_complete(self, article_id: str, audio_path: str) -> None: ...


class SynthesisError(RuntimeError):
    pass


class ServerError(RuntimeError):
    pass


def synthesize(
    segments: list[TTSSegment],
    article_dir: Path,
    config: Config,
    progress: Optional[ProgressCallback] = None,
) -> Path:
    article_id = article_dir.name
    article = _load_article(article_dir)
    runtime_config = _apply_article_overrides(config, article)
    voices = fetch_available_voices(runtime_config)
    _validate_voice_selection(voices, runtime_config.tts.voice)

    segments_dir = article_dir / "segments"
    if segments_dir.exists():
        shutil.rmtree(segments_dir)
    segments_dir.mkdir(parents=True, exist_ok=True)

    if progress:
        progress.on_status(article_id, "synthesizing", "Generating audio segments")

    for position, segment in enumerate(segments, start=1):
        path = _synthesize_segment(article_id, segment, segments_dir, runtime_config)
        segment.wav_path = str(path)
        segment.duration_sec = _wav_duration(path)
        if progress:
            progress.on_progress(article_id, position, len(segments))

    concat_list = _build_concat_list(segments, segments_dir)
    output_path = article_dir / f"audio.{runtime_config.tts.audio_format}"
    _run_ffmpeg_concat(concat_list, output_path, runtime_config.tts.audio_format)
    _apply_metadata(output_path, article)

    if progress:
        progress.on_complete(article_id, str(output_path))
    return output_path


def with_voice_override(config: Config, voice: str) -> Config:
    return replace(config, tts=replace(config.tts, voice=voice))


def with_runtime_overrides(config: Config, voice: Optional[str] = None, speed: Optional[float] = None) -> Config:
    tts = config.tts
    if voice is not None:
        tts = replace(tts, voice=voice)
    if speed is not None:
        tts = replace(tts, speed=speed)
    if tts is config.tts:
        return config
    return replace(config, tts=tts)


def resolve_kokoro_edge_binary(config: Config) -> Path:
    env_override = _env_path("READCAST_KOKORO_EDGE_BIN")
    configured = Path(config.kokoro_edge.binary).expanduser() if config.kokoro_edge.binary else None
    if configured and configured.exists():
        configured_path = configured
    else:
        configured_path = _which_path(config.kokoro_edge.binary) if config.kokoro_edge.binary else None

    candidates = [
        env_override,
        configured_path,
        _which_path("kokoro-edge"),
        Path(__file__).resolve().parents[3] / "kokoro-mlx" / ".build-xcode" / "stage" / "bin" / "kokoro-edge",
    ]
    for candidate in candidates:
        if candidate and candidate.exists():
            return candidate
    raise ServerError(
        "Could not find kokoro-edge. Install it, put it on PATH, or set READCAST_KOKORO_EDGE_BIN."
    )


def fetch_server_status(config: Config) -> dict[str, object]:
    url = f"{_server_base_url(config)}/v1/status"
    try:
        response = httpx.get(url, timeout=2.0)
    except httpx.HTTPError as exc:
        raise ServerError(f"kokoro-edge is not reachable at {url}: {exc}") from exc
    if response.status_code != 200:
        raise ServerError(f"kokoro-edge status check failed: {_error_message(response)}")
    return response.json()


def ensure_server_running(config: Config) -> dict[str, object]:
    try:
        return fetch_server_status(config)
    except ServerError:
        if not config.kokoro_edge.auto_start:
            raise
    return start_server(config)


def start_server(config: Config) -> dict[str, object]:
    try:
        return fetch_server_status(config)
    except ServerError:
        pass

    binary = resolve_kokoro_edge_binary(config)
    host, port = _server_host_port(config)
    result = subprocess.run(
        [str(binary), "serve", "-d", "--host", host, "--port", str(port)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        details = result.stderr.strip() or result.stdout.strip() or "unknown error"
        raise ServerError(f"Failed to start kokoro-edge: {details}")

    deadline = time.monotonic() + config.kokoro_edge.startup_timeout_sec
    last_error: Optional[ServerError] = None
    while time.monotonic() < deadline:
        try:
            return fetch_server_status(config)
        except ServerError as exc:
            last_error = exc
            time.sleep(0.5)
    if last_error is not None:
        raise ServerError(
            f"kokoro-edge did not become ready within {config.kokoro_edge.startup_timeout_sec}s: {last_error}"
        ) from last_error
    raise ServerError(f"kokoro-edge did not become ready within {config.kokoro_edge.startup_timeout_sec}s")


def stop_server(config: Config) -> bool:
    try:
        fetch_server_status(config)
    except ServerError:
        return False

    binary = resolve_kokoro_edge_binary(config)
    result = subprocess.run([str(binary), "stop"], capture_output=True, text=True)
    if result.returncode != 0:
        details = result.stderr.strip() or result.stdout.strip() or "unknown error"
        raise ServerError(f"Failed to stop kokoro-edge: {details}")

    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        try:
            fetch_server_status(config)
        except ServerError:
            return True
        time.sleep(0.25)
    raise ServerError("kokoro-edge stop command returned successfully, but the daemon is still running.")


def fetch_voices(config: Config) -> list[dict[str, object]]:
    url = f"{_server_base_url(config)}/v1/voices"
    try:
        response = httpx.get(url, timeout=5.0)
    except httpx.HTTPError as exc:
        raise SynthesisError(f"Failed to fetch kokoro-edge voices: {exc}") from exc
    if response.status_code != 200:
        raise SynthesisError(f"Failed to fetch kokoro-edge voices: {_error_message(response)}")
    payload = response.json()
    return [voice for voice in payload.get("voices", []) if isinstance(voice, dict) and "name" in voice]


def fetch_available_voices(config: Config) -> list[str]:
    return [str(voice["name"]) for voice in fetch_voices(config)]


def _apply_article_overrides(config: Config, article: Optional[Article]) -> Config:
    if not article:
        return config
    return with_runtime_overrides(config, voice=article.voice, speed=article.speed)


def _validate_voice_selection(voices: list[str], voice: str) -> None:
    if not voices:
        return
    supported_lookup = {speaker.lower() for speaker in voices}
    if voice.lower() not in supported_lookup:
        raise SynthesisError(
            f"Voice '{voice}' is not supported by the selected model. "
            f"Available speakers: {', '.join(voices)}"
        )


def _synthesize_segment(
    article_id: str,
    segment: TTSSegment,
    segments_dir: Path,
    config: Config,
) -> Path:
    prefix = f"seg_{segment.idx:03d}"
    return _synthesize_text_group(
        article_id=article_id,
        segment_idx=segment.idx,
        text=segment.text,
        source_chunk_idx=segment.source_chunk_idx,
        source_chunk_end_idx=segment.source_chunk_end_idx or segment.source_chunk_idx,
        prefix=prefix,
        segments_dir=segments_dir,
        config=config,
    )


def _synthesize_text_group(
    article_id: str,
    segment_idx: int,
    text: str,
    source_chunk_idx: int,
    source_chunk_end_idx: int,
    prefix: str,
    segments_dir: Path,
    config: Config,
) -> Path:
    path = segments_dir / f"{prefix}.wav"
    last_error: Optional[SynthesisError] = None
    for _ in range(2):
        try:
            wav_bytes = _request_speech(text, config)
            path.write_bytes(wav_bytes)
            return path
        except SynthesisError as exc:
            last_error = exc

    split_groups, joiner = _split_failed_text_group(text)
    if len(split_groups) > 1:
        midpoint = len(split_groups) // 2
        left_text = _join_split_groups(split_groups[:midpoint], joiner)
        right_text = _join_split_groups(split_groups[midpoint:], joiner)
        if left_text and right_text and left_text != text and right_text != text:
            left = _synthesize_text_group(
                article_id=article_id,
                segment_idx=segment_idx,
                text=left_text,
                source_chunk_idx=source_chunk_idx,
                source_chunk_end_idx=source_chunk_end_idx,
                prefix=f"{prefix}_a",
                segments_dir=segments_dir,
                config=config,
            )
            right = _synthesize_text_group(
                article_id=article_id,
                segment_idx=segment_idx,
                text=right_text,
                source_chunk_idx=source_chunk_idx,
                source_chunk_end_idx=source_chunk_end_idx,
                prefix=f"{prefix}_b",
                segments_dir=segments_dir,
                config=config,
            )
            _concat_wav_files([left, right], path)
            return path

    assert last_error is not None
    raise SynthesisError(
        f"Failed to synthesize segment {segment_idx} for article {article_id}: {last_error} "
        f"(input: {_snippet(text)})"
    ) from last_error


def _request_speech(text: str, config: Config) -> bytes:
    url = f"{_server_base_url(config)}/v1/audio/speech"
    payload = {
        "model": config.tts.model,
        "input": text,
        "voice": config.tts.voice,
        "speed": config.tts.speed,
        "response_format": "wav",
        "language": config.tts.language,
    }
    try:
        response = httpx.post(url, json=payload, timeout=120.0)
    except httpx.HTTPError as exc:
        raise SynthesisError(f"kokoro-edge request failed: {exc}") from exc
    if response.status_code != 200:
        raise SynthesisError(_error_message(response))
    return response.content


def _build_concat_list(segments: list[TTSSegment], segments_dir: Path) -> Path:
    concat_entries = [f"file '{Path(segment.wav_path).as_posix()}'" for segment in segments]
    list_path = segments_dir / "list.txt"
    list_path.write_text("\n".join(concat_entries) + "\n", encoding="utf-8")
    return list_path


def _concat_wav_files(paths: list[Path], output_path: Path) -> None:
    list_path = output_path.with_suffix(".concat.txt")
    list_path.write_text("\n".join(f"file '{path.as_posix()}'" for path in paths) + "\n", encoding="utf-8")
    command = [
        "ffmpeg",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(list_path),
        "-c:a",
        "pcm_s16le",
        "-ar",
        "24000",
        "-ac",
        "1",
        "-y",
        str(output_path),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise SynthesisError(f"ffmpeg failed to concatenate WAV parts: {result.stderr.strip()}")


def _run_ffmpeg_concat(list_path: Path, output_path: Path, audio_format: str) -> None:
    command = [
        "ffmpeg",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(list_path),
        "-y",
    ]
    if audio_format == "m4a":
        command.extend(["-c:a", "aac", "-b:a", "128k"])
    else:
        command.extend(["-c:a", "libmp3lame", "-q:a", "2"])
    command.append(str(output_path))
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise SynthesisError(f"ffmpeg failed to concatenate audio: {result.stderr.strip()}")


def _apply_metadata(audio_path: Path, article: Optional[Article]) -> None:
    if not article:
        return

    if audio_path.suffix.lower() == ".m4a":
        tags = MP4(audio_path)
        tags["\xa9nam"] = [article.title]
        if article.author:
            tags["\xa9ART"] = [article.author]
        if article.publication:
            tags["\xa9alb"] = [article.publication]
        if article.published_date:
            tags["\xa9day"] = [article.published_date]
        tags["\xa9gen"] = ["Podcast"]
        comment = article.source_url or article.source_file or ""
        if comment:
            tags["\xa9cmt"] = [comment]
        tags.save()
        return

    tag_file = ID3()
    tag_file.add(TIT2(encoding=3, text=article.title))
    if article.author:
        tag_file.add(TPE1(encoding=3, text=article.author))
    if article.publication:
        tag_file.add(TALB(encoding=3, text=article.publication))
    if article.published_date:
        tag_file.add(TDRC(encoding=3, text=article.published_date))
    tag_file.add(TCON(encoding=3, text="Podcast"))
    comment = article.source_url or article.source_file or ""
    if comment:
        tag_file.add(COMM(encoding=3, lang="eng", desc="source", text=comment))
    tag_file.save(audio_path)


def audio_duration(audio_path: Path) -> float:
    audio = MutagenFile(audio_path)
    if audio is None or audio.info is None:
        return 0.0
    return float(audio.info.length)


def _wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as handle:
        return handle.getnframes() / float(handle.getframerate())


def _load_article(article_dir: Path) -> Optional[Article]:
    meta_path = article_dir / "meta.json"
    if not meta_path.exists():
        return None
    return Article.from_dict(json.loads(meta_path.read_text(encoding="utf-8")))


def _server_base_url(config: Config) -> str:
    return config.kokoro_edge.server_url.rstrip("/")


def _server_host_port(config: Config) -> tuple[str, int]:
    parsed = urlparse(_server_base_url(config))
    return parsed.hostname or "127.0.0.1", parsed.port or 7777


def _error_message(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        text = response.text.strip()
        return text or f"HTTP {response.status_code}"
    message = payload.get("message") if isinstance(payload, dict) else None
    if isinstance(message, str) and message.strip():
        return message.strip()
    return f"HTTP {response.status_code}"


def _snippet(text: str, limit: int = 100) -> str:
    return " ".join(text.split())[:limit]


def _split_failed_text_group(text: str) -> tuple[list[str], str]:
    for splitter in (
        _split_paragraphs,
        _split_with_regex(SENTENCE_BOUNDARY, " "),
        _split_with_regex(CLAUSE_BOUNDARY, " "),
        _split_words,
    ):
        groups, joiner = splitter(text)
        if len(groups) > 1:
            return groups, joiner
    return [text], " "


def _split_paragraphs(text: str) -> tuple[list[str], str]:
    groups = [part.strip() for part in text.split("\n\n") if part.strip()]
    return (groups, "\n\n") if len(groups) > 1 else ([text], "\n\n")


def _split_with_regex(pattern: re.Pattern[str], joiner: str):
    def splitter(text: str) -> tuple[list[str], str]:
        groups = [part.strip() for part in pattern.split(" ".join(text.split())) if part.strip()]
        return (groups, joiner) if len(groups) > 1 else ([text], joiner)

    return splitter


def _split_words(text: str) -> tuple[list[str], str]:
    words = text.split()
    if len(words) > 1:
        midpoint = max(1, len(words) // 2)
        return [" ".join(words[:midpoint]), " ".join(words[midpoint:])], " "
    if len(text) > 1:
        midpoint = max(1, len(text) // 2)
        return [text[:midpoint].strip(), text[midpoint:].strip()], ""
    return [text], ""


def _join_split_groups(groups: list[str], joiner: str) -> str:
    if not groups:
        return ""
    return joiner.join(group for group in groups if group.strip()).strip()


def _env_path(name: str) -> Optional[Path]:
    value = os.environ.get(name)
    if not value:
        return None
    path = Path(value).expanduser()
    return path if path.exists() else None


def _which_path(binary_name: Optional[str]) -> Optional[Path]:
    if not binary_name:
        return None
    resolved = shutil.which(binary_name)
    return Path(resolved) if resolved else None
