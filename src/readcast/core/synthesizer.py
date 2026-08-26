from __future__ import annotations

from dataclasses import replace
import json
from pathlib import Path
import re
import shutil
import subprocess
from typing import Any, Optional, Protocol
import wave

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
    """Actionable errors from the shared TTS runtime boundary."""


def synthesize(
    segments: list[TTSSegment],
    article_dir: Path,
    config: Config,
    progress: Optional[ProgressCallback] = None,
    *,
    tts_client: Any = None,
) -> Path:
    article_id = article_dir.name
    article = _load_article(article_dir)
    runtime_config = _apply_article_overrides(config, article)
    client = tts_client or _load_default_tts_client()
    voices = fetch_available_voices(client)
    _validate_voice_selection(voices, runtime_config.tts.voice)

    segments_dir = article_dir / "segments"
    if segments_dir.exists():
        shutil.rmtree(segments_dir)
    segments_dir.mkdir(parents=True, exist_ok=True)

    if progress:
        progress.on_status(article_id, "synthesizing", "Generating audio segments")

    for position, segment in enumerate(segments, start=1):
        path = _synthesize_segment(article_id, segment, segments_dir, runtime_config, client)
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


def _load_default_tts_client() -> Any:
    from .tts import load_shared_tts_client

    return load_shared_tts_client()


def fetch_available_voices(tts_client: Any) -> list[str]:
    try:
        voices = tts_client.fetch_voices()
    except Exception as exc:
        raise SynthesisError(f"Failed to fetch kokoro-edge voices: {exc}") from exc
    return [str(voice["name"]) for voice in voices if isinstance(voice, dict) and "name" in voice]


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
    tts_client: Any,
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
        tts_client=tts_client,
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
    tts_client: Any,
) -> Path:
    path = segments_dir / f"{prefix}.wav"
    last_error: Optional[SynthesisError] = None
    for _ in range(2):
        try:
            wav_bytes = _request_speech(text, config, tts_client)
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
                tts_client=tts_client,
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
                tts_client=tts_client,
            )
            _concat_wav_files([left, right], path)
            return path

    assert last_error is not None
    raise SynthesisError(
        f"Failed to synthesize segment {segment_idx} for article {article_id}: {last_error} "
        f"(input: {_snippet(text)})"
    ) from last_error


def _request_speech(text: str, config: Config, tts_client: Any) -> bytes:
    try:
        return tts_client.synthesize_text(
            text,
            model=config.tts.model,
            voice=config.tts.voice,
            speed=config.tts.speed,
            language=config.tts.language,
            response_format="wav",
        )
    except Exception as exc:
        raise SynthesisError(f"kokoro-edge request failed: {exc}") from exc


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
