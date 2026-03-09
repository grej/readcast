from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
import wave

import httpx
from mutagen import File as MutagenFile
import pytest

from readcast.core.config import Config
from readcast.core.models import Article, TTSSegment
from readcast.core.synthesizer import SynthesisError, synthesize


def _wav_bytes(duration: float = 0.15) -> bytes:
    buffer = BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(24000)
        frame_count = int(24000 * duration)
        handle.writeframes(b"\x00\x00" * frame_count)
    return buffer.getvalue()


class Recorder:
    def __init__(self) -> None:
        self.progress_calls: list[tuple[int, int]] = []
        self.completed = False

    def on_status(self, article_id: str, stage: str, message: str) -> None:
        return None

    def on_progress(self, article_id: str, current: int, total: int) -> None:
        self.progress_calls.append((current, total))

    def on_error(self, article_id: str, error: str) -> None:
        return None

    def on_complete(self, article_id: str, audio_path: str) -> None:
        self.completed = True


def _article(article_id: str = "art12345") -> Article:
    return Article(
        id=article_id,
        source_url="https://example.com/article",
        source_file=None,
        title="Synth Test",
        author="Policy Tensor",
        publication="Policy Tensor",
        published_date="2026-03-07",
        ingested_at="2026-03-07T00:00:00Z",
        word_count=10,
        estimated_read_min=1,
    )


def _json_response(status_code: int, payload: dict[str, object]) -> httpx.Response:
    return httpx.Response(status_code, json=payload)


def _wav_response() -> httpx.Response:
    return httpx.Response(200, content=_wav_bytes())


def test_synthesize_creates_audio_and_tags(monkeypatch, base_dir: Path) -> None:
    config = Config.load(base_dir)
    article_dir = base_dir / "articles" / "art12345"
    article_dir.mkdir(parents=True)
    (article_dir / "meta.json").write_text(json.dumps(_article().to_dict()), encoding="utf-8")
    segments = [
        TTSSegment(idx=0, text="Alpha.", source_chunk_idx=0, source_chunk_end_idx=1),
        TTSSegment(idx=1, text="Bravo.", source_chunk_idx=2, source_chunk_end_idx=3),
        TTSSegment(idx=2, text="Charlie.", source_chunk_idx=4, source_chunk_end_idx=4),
    ]
    recorder = Recorder()
    post_calls: list[dict[str, object]] = []
    get_calls: list[str] = []

    def fake_get(url: str, timeout: float) -> httpx.Response:
        get_calls.append(url)
        if url.endswith("/v1/voices"):
            return _json_response(200, {"voices": [{"name": "af_sky"}, {"name": "af_heart"}]})
        raise AssertionError(f"Unexpected GET {url}")

    def fake_post(url: str, json: dict[str, object], timeout: float) -> httpx.Response:
        post_calls.append({"url": url, "json": json, "timeout": timeout})
        return _wav_response()

    monkeypatch.setattr("readcast.core.synthesizer.httpx.get", fake_get)
    monkeypatch.setattr("readcast.core.synthesizer.httpx.post", fake_post)

    audio_path = synthesize(segments, article_dir, config, progress=recorder)

    assert audio_path.exists()
    assert recorder.progress_calls == [(1, 3), (2, 3), (3, 3)]
    assert recorder.completed is True
    assert get_calls == ["http://127.0.0.1:7777/v1/voices"]
    assert len(post_calls) == 3
    assert all(call["json"]["model"] == "kokoro-82m" for call in post_calls)
    assert all(call["json"]["voice"] == config.tts.voice for call in post_calls)
    assert all(call["json"]["language"] == config.tts.language for call in post_calls)
    assert all(call["json"]["response_format"] == "wav" for call in post_calls)
    tags = MutagenFile(audio_path, easy=True)
    assert tags is not None
    assert tags["title"] == ["Synth Test"]
    assert tags["artist"] == ["Policy Tensor"]


def test_synthesize_rejects_invalid_voice_from_server_inventory(monkeypatch, base_dir: Path) -> None:
    config = Config.load(base_dir)
    config.tts.voice = "invalid_voice"
    article_dir = base_dir / "articles" / "art12345"
    article_dir.mkdir(parents=True)
    (article_dir / "meta.json").write_text(json.dumps(_article().to_dict()), encoding="utf-8")
    segments = [TTSSegment(idx=0, text="Alpha.", source_chunk_idx=0)]

    monkeypatch.setattr(
        "readcast.core.synthesizer.httpx.get",
        lambda url, timeout: _json_response(200, {"voices": [{"name": "af_sky"}]}),
    )

    with pytest.raises(SynthesisError) as excinfo:
        synthesize(segments, article_dir, config)

    assert "Voice 'invalid_voice' is not supported" in str(excinfo.value)


def test_synthesize_retries_once_and_surfaces_input_snippet(monkeypatch, base_dir: Path) -> None:
    config = Config.load(base_dir)
    article_dir = base_dir / "articles" / "art12345"
    article_dir.mkdir(parents=True)
    (article_dir / "meta.json").write_text(json.dumps(_article().to_dict()), encoding="utf-8")
    text = "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu."
    segments = [TTSSegment(idx=0, text=text, source_chunk_idx=0)]
    attempts: list[dict[str, object]] = []

    monkeypatch.setattr(
        "readcast.core.synthesizer.httpx.get",
        lambda url, timeout: _json_response(200, {"voices": [{"name": "af_sky"}]}),
    )

    def fake_post(url: str, json: dict[str, object], timeout: float) -> httpx.Response:
        attempts.append(json)
        return _json_response(500, {"message": "daemon exploded"})

    monkeypatch.setattr("readcast.core.synthesizer.httpx.post", fake_post)

    with pytest.raises(SynthesisError) as excinfo:
        synthesize(segments, article_dir, config)

    assert len(attempts) == 2
    assert "daemon exploded" in str(excinfo.value)
    assert "segment 0" in str(excinfo.value)
    assert "Alpha beta gamma" in str(excinfo.value)


def test_synthesize_does_not_write_json_error_body_as_wav(monkeypatch, base_dir: Path) -> None:
    config = Config.load(base_dir)
    article_dir = base_dir / "articles" / "art12345"
    article_dir.mkdir(parents=True)
    (article_dir / "meta.json").write_text(json.dumps(_article().to_dict()), encoding="utf-8")
    segments = [TTSSegment(idx=0, text="Alpha.", source_chunk_idx=0)]

    monkeypatch.setattr(
        "readcast.core.synthesizer.httpx.get",
        lambda url, timeout: _json_response(200, {"voices": [{"name": "af_sky"}]}),
    )
    monkeypatch.setattr(
        "readcast.core.synthesizer.httpx.post",
        lambda url, json, timeout: _json_response(400, {"message": "Unknown voice"}),
    )

    with pytest.raises(SynthesisError):
        synthesize(segments, article_dir, config)

    assert not any((article_dir / "segments").glob("*.wav"))


def test_synthesize_splits_failed_grouped_request_into_smaller_parts(monkeypatch, base_dir: Path) -> None:
    config = Config.load(base_dir)
    article_dir = base_dir / "articles" / "art12345"
    article_dir.mkdir(parents=True)
    (article_dir / "meta.json").write_text(json.dumps(_article().to_dict()), encoding="utf-8")
    segments = [
        TTSSegment(
            idx=0,
            text="Title\n\nFirst paragraph.\n\nSecond paragraph.",
            source_chunk_idx=0,
            source_chunk_end_idx=2,
        )
    ]
    attempts: list[str] = []

    monkeypatch.setattr(
        "readcast.core.synthesizer.httpx.get",
        lambda url, timeout: _json_response(200, {"voices": [{"name": "af_sky"}]}),
    )

    def fake_post(url: str, json: dict[str, object], timeout: float) -> httpx.Response:
        attempts.append(str(json["input"]))
        if json["input"] == "Title\n\nFirst paragraph.\n\nSecond paragraph.":
            return _json_response(500, {"message": "too big"})
        return _wav_response()

    monkeypatch.setattr("readcast.core.synthesizer.httpx.post", fake_post)

    audio_path = synthesize(segments, article_dir, config)

    assert audio_path.exists()
    assert attempts.count("Title\n\nFirst paragraph.\n\nSecond paragraph.") == 2
    assert "Title" in attempts
    assert "First paragraph.\n\nSecond paragraph." in attempts
