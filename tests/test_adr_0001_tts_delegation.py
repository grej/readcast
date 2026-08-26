"""Readcast contracts for consuming the shared ADR-0001 TTS boundary."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
import shutil
import wave

from readcast.core.config import Config
from readcast.core.models import TTSSegment
from readcast.core.synthesizer import SynthesisError, synthesize
from readcast.services import ReadcastService


def _wav_bytes(duration: float = 0.05) -> bytes:
    buffer = BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(24000)
        handle.writeframes(b"\x00\x00" * int(24000 * duration))
    return buffer.getvalue()


class FakeTTSClient:
    def __init__(self) -> None:
        self.status_calls = 0
        self.voice_calls = 0
        self.speech_calls: list[dict[str, object]] = []

    def server_status(self) -> dict[str, object]:
        self.status_calls += 1
        return {"model": "kokoro-82m", "models_loaded": ["kokoro-82m"]}

    def fetch_voices(self) -> list[dict[str, object]]:
        self.voice_calls += 1
        return [{"name": "af_sky"}, {"name": "af_heart"}]

    def synthesize_text(self, text: str, **kwargs: object) -> bytes:
        self.speech_calls.append({"text": text, **kwargs})
        return _wav_bytes()


class FakeTTSRuntime:
    def __init__(self) -> None:
        self.ensure_calls = 0
        self.start_calls = 0
        self.stop_calls = 0

    def ensure_running(self) -> dict[str, object]:
        self.ensure_calls += 1
        return {"model": "kokoro-82m", "models_loaded": ["kokoro-82m"]}

    def start(self) -> dict[str, object]:
        self.start_calls += 1
        return {"model": "kokoro-82m", "models_loaded": ["kokoro-82m"]}

    def stop(self) -> bool:
        self.stop_calls += 1
        return True


def test_synthesizer_retries_and_recursively_splits_through_injected_client(monkeypatch, base_dir: Path) -> None:
    config = Config.load(base_dir)
    article_dir = base_dir / "articles" / "contract"
    article_dir.mkdir(parents=True)
    segments = [
        TTSSegment(
            idx=0,
            text="First paragraph.\n\nSecond paragraph.",
            source_chunk_idx=0,
            source_chunk_end_idx=1,
        )
    ]
    client = FakeTTSClient()
    original_text = segments[0].text
    original_synthesize_text = client.synthesize_text

    def fail_only_combined(text: str, **kwargs: object) -> bytes:
        if text == original_text:
            client.speech_calls.append({"text": text, **kwargs})
            raise SynthesisError("daemon rejected combined input")
        return original_synthesize_text(text, **kwargs)

    client.synthesize_text = fail_only_combined  # type: ignore[method-assign]
    monkeypatch.setattr(
        "readcast.core.synthesizer._run_ffmpeg_concat",
        lambda _list_path, output_path, _audio_format: output_path.write_bytes(b"fake-audio"),
    )
    monkeypatch.setattr(
        "readcast.core.synthesizer._concat_wav_files",
        lambda paths, output_path: shutil.copyfile(paths[0], output_path),
    )

    output = synthesize(segments, article_dir, config, tts_client=client)

    assert output.exists()
    assert [call["text"] for call in client.speech_calls].count(original_text) == 2
    assert "First paragraph." in [call["text"] for call in client.speech_calls]
    assert "Second paragraph." in [call["text"] for call in client.speech_calls]
    assert all("url" not in call for call in client.speech_calls)


def test_service_processes_a_three_segment_article_with_injected_runtime_and_client(monkeypatch, base_dir: Path) -> None:
    config = Config.load(base_dir)
    config.tts.max_chunk_chars = 13
    client = FakeTTSClient()
    runtime = FakeTTSRuntime()
    service = ReadcastService(config, tts_client=client, tts_runtime=runtime)
    added = service.add_text("Title\n\nAlpha.\n\nBravo.\n\nCharlie.")
    passed_clients: list[object] = []

    def fake_synthesize(segments, article_dir, config, progress=None, *, tts_client):
        passed_clients.append(tts_client)
        assert len(segments) == 3
        output = article_dir / "audio.mp3"
        output.write_bytes(b"fake-audio")
        return output

    monkeypatch.setattr("readcast.services.synthesize", fake_synthesize)
    monkeypatch.setattr("readcast.services.audio_duration", lambda _path: 0.15)

    result = service.process_articles([added.article])[0]

    assert result.success is True
    assert runtime.ensure_calls == 1
    assert passed_clients == [client]
    assert service.get_article(added.article.id).status == "done"


def test_service_status_and_voice_inventory_delegate_to_client(base_dir: Path) -> None:
    config = Config.load(base_dir)
    client = FakeTTSClient()
    service = ReadcastService(config, tts_client=client, tts_runtime=FakeTTSRuntime())

    assert service.daemon_status()["model"] == "kokoro-82m"
    assert service.available_voices() == [{"name": "af_sky"}, {"name": "af_heart"}]
    assert client.status_calls == 1
    assert client.voice_calls == 1


def test_service_server_lifecycle_delegates_to_runtime(base_dir: Path) -> None:
    config = Config.load(base_dir)
    runtime = FakeTTSRuntime()
    service = ReadcastService(config, tts_client=FakeTTSClient(), tts_runtime=runtime)

    assert service.start_server()["model"] == "kokoro-82m"
    assert service.stop_server() is True
    assert runtime.start_calls == 1
    assert runtime.stop_calls == 1


def test_readcast_config_drops_known_legacy_kokoro_runtime_settings_on_save(base_dir: Path) -> None:
    base_dir.mkdir(parents=True)
    (base_dir / "config.toml").write_text(
        """[tts]
model = "kokoro-82m"
voice = "af_heart"
speed = 1.25
language = "en-us"
max_chunk_chars = 800
audio_format = "mp3"

[kokoro_edge]
server_url = "http://127.0.0.1:7777"
binary = "kokoro-edge"
auto_start = true
startup_timeout_sec = 30
""",
        encoding="utf-8",
    )

    config = Config.load(base_dir)
    config.save()
    saved = (base_dir / "config.toml").read_text(encoding="utf-8")

    assert config.tts.voice == "af_heart"
    assert config.tts.speed == 1.25
    assert "[kokoro_edge]" not in saved
    assert "127.0.0.1:7777" not in saved
