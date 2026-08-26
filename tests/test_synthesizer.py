from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
from typing import Callable
import wave

from mutagen import File as MutagenFile
import pytest

from readcast.core.config import Config
from readcast.core.models import Article, TTSSegment
from readcast.core.synthesizer import SynthesisError, synthesize


FAILING_PASSAGE_PART_1 = (
    "At the end of January, the US department of justice released its biggest drop yet of documents "
    "related to Jeffrey Epstein, the convicted paedophile and erstwhile friend of Trump who died in prison."
)
FAILING_PASSAGE_PART_2 = (
    "Lurid headlines based on the documents followed, about foreign women allegedly buried on Epstein's "
    "New Mexico ranch, about Epstein's purchase of 330 gallons of sulphuric acid, and a woman who claimed "
    "Trump raped her when she was aged 13. The Wall Street Journal reported the government took 47,635 files "
    "offline \"for further review\"."
)
FAILING_PASSAGE_COMBINED = f"{FAILING_PASSAGE_PART_1} {FAILING_PASSAGE_PART_2}"


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


class FakeTTSClient:
    def __init__(
        self,
        *,
        voices: list[dict[str, object]] | None = None,
        handler: Callable[[str, dict[str, object]], bytes] | None = None,
    ) -> None:
        self.voices = voices or [{"name": "af_sky"}, {"name": "af_heart"}]
        self.handler = handler
        self.voice_calls = 0
        self.speech_calls: list[dict[str, object]] = []

    def fetch_voices(self) -> list[dict[str, object]]:
        self.voice_calls += 1
        return self.voices

    def synthesize_text(self, text: str, **kwargs: object) -> bytes:
        payload = {"input": text, **kwargs}
        self.speech_calls.append(payload)
        if self.handler is not None:
            return self.handler(text, payload)
        return _wav_bytes()


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
    client = FakeTTSClient()

    audio_path = synthesize(segments, article_dir, config, progress=recorder, tts_client=client)

    assert audio_path.exists()
    assert recorder.progress_calls == [(1, 3), (2, 3), (3, 3)]
    assert recorder.completed is True
    assert client.voice_calls == 1
    assert len(client.speech_calls) == 3
    assert all(call["model"] == "kokoro-82m" for call in client.speech_calls)
    assert all(call["voice"] == config.tts.voice for call in client.speech_calls)
    assert all(call["language"] == config.tts.language for call in client.speech_calls)
    assert all(call["response_format"] == "wav" for call in client.speech_calls)
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

    client = FakeTTSClient(voices=[{"name": "af_sky"}])

    with pytest.raises(SynthesisError) as excinfo:
        synthesize(segments, article_dir, config, tts_client=client)

    assert "Voice 'invalid_voice' is not supported" in str(excinfo.value)


def test_synthesize_retries_once_and_surfaces_input_snippet(monkeypatch, base_dir: Path) -> None:
    config = Config.load(base_dir)
    article_dir = base_dir / "articles" / "art12345"
    article_dir.mkdir(parents=True)
    (article_dir / "meta.json").write_text(json.dumps(_article().to_dict()), encoding="utf-8")
    text = "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu."
    segments = [TTSSegment(idx=0, text=text, source_chunk_idx=0)]
    def fail(_text: str, _payload: dict[str, object]) -> bytes:
        raise SynthesisError("daemon exploded")

    client = FakeTTSClient(handler=fail)

    with pytest.raises(SynthesisError) as excinfo:
        synthesize(segments, article_dir, config, tts_client=client)

    assert len(client.speech_calls) > 2
    assert client.speech_calls[0]["input"] == text
    assert client.speech_calls[1]["input"] == text
    assert "daemon exploded" in str(excinfo.value)
    assert "segment 0" in str(excinfo.value)
    assert "(input:" in str(excinfo.value)


def test_synthesize_does_not_write_json_error_body_as_wav(monkeypatch, base_dir: Path) -> None:
    config = Config.load(base_dir)
    article_dir = base_dir / "articles" / "art12345"
    article_dir.mkdir(parents=True)
    (article_dir / "meta.json").write_text(json.dumps(_article().to_dict()), encoding="utf-8")
    segments = [TTSSegment(idx=0, text="Alpha.", source_chunk_idx=0)]

    def fail(_text: str, _payload: dict[str, object]) -> bytes:
        raise SynthesisError("Unknown voice")

    with pytest.raises(SynthesisError):
        synthesize(segments, article_dir, config, tts_client=FakeTTSClient(handler=fail))

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
    def fail_group(text: str, _payload: dict[str, object]) -> bytes:
        if text == "Title\n\nFirst paragraph.\n\nSecond paragraph.":
            raise SynthesisError("too big")
        return _wav_bytes()

    client = FakeTTSClient(handler=fail_group)

    audio_path = synthesize(segments, article_dir, config, tts_client=client)
    attempts = [str(call["input"]) for call in client.speech_calls]

    assert audio_path.exists()
    assert attempts.count("Title\n\nFirst paragraph.\n\nSecond paragraph.") == 2
    assert "Title" in attempts
    assert "First paragraph.\n\nSecond paragraph." in attempts


def test_synthesize_falls_back_to_sentence_splitting_when_single_paragraph_fails(monkeypatch, base_dir: Path) -> None:
    config = Config.load(base_dir)
    article_dir = base_dir / "articles" / "art12345"
    article_dir.mkdir(parents=True)
    (article_dir / "meta.json").write_text(json.dumps(_article().to_dict()), encoding="utf-8")
    segments = [TTSSegment(idx=0, text=FAILING_PASSAGE_COMBINED, source_chunk_idx=0, source_chunk_end_idx=0)]
    def fail_group(text: str, _payload: dict[str, object]) -> bytes:
        if text == FAILING_PASSAGE_COMBINED:
            raise SynthesisError("The operation couldn't be completed. (KokoroSwift.KokoroTTS.KokoroTTSError error 0.)")
        return _wav_bytes()

    client = FakeTTSClient(handler=fail_group)

    audio_path = synthesize(segments, article_dir, config, tts_client=client)
    attempts = [str(call["input"]) for call in client.speech_calls]

    assert audio_path.exists()
    assert attempts.count(FAILING_PASSAGE_COMBINED) == 2
    assert FAILING_PASSAGE_PART_1 in attempts
    assert FAILING_PASSAGE_PART_2 in attempts
