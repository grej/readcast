from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
import wave

from click.testing import CliRunner

from readcast.cli.main import cli


def _wav_bytes(duration: float = 0.1) -> bytes:
    buffer = BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(24000)
        handle.writeframes(b"\x00\x00" * int(24000 * duration))
    return buffer.getvalue()


def _write_audio(article_dir: Path) -> Path:
    audio_path = article_dir / "audio.mp3"
    audio_path.write_bytes(_wav_bytes())
    return audio_path


def test_cli_end_to_end_with_fixture(monkeypatch, tmp_path: Path, fixture_dir: Path) -> None:
    runner = CliRunner()
    base_dir = tmp_path / ".readcast"
    fixture_path = fixture_dir / "brave_reader_article.html"
    synth_calls: list[list[object]] = []

    monkeypatch.setattr("readcast.services.ensure_server_running", lambda config: {"model": "kokoro-82m"})

    def fake_synthesize(segments, article_dir, config, progress=None):
        synth_calls.append(segments)
        return _write_audio(article_dir)

    monkeypatch.setattr("readcast.services.synthesize", fake_synthesize)
    monkeypatch.setattr("readcast.services.audio_duration", lambda path: 1.23)

    result_add = runner.invoke(cli, ["--base-dir", str(base_dir), "add", str(fixture_path)])
    assert result_add.exit_code == 0, result_add.output

    result_process = runner.invoke(cli, ["--base-dir", str(base_dir), "process"])
    assert result_process.exit_code == 0, result_process.output

    result_list = runner.invoke(cli, ["--base-dir", str(base_dir), "list", "--status", "done", "--format", "json"])
    assert result_list.exit_code == 0, result_list.output
    listed = json.loads(result_list.output)
    assert len(listed) == 1
    assert listed[0]["title"] == "Why the US is facing strategic defeat"
    assert listed[0]["status"] == "done"
    article_id = listed[0]["id"]

    result_search = runner.invoke(cli, ["--base-dir", str(base_dir), "search", "THAAD"])
    assert result_search.exit_code == 0, result_search.output
    assert article_id in result_search.output
    assert synth_calls


def test_cli_end_to_end_with_plain_text(monkeypatch, tmp_path: Path) -> None:
    runner = CliRunner()
    base_dir = tmp_path / ".readcast"
    text_path = tmp_path / "field-notes.txt"
    text_path.write_text(
        "The first paragraph covers air power.\n\nThe second paragraph covers THAAD batteries.",
        encoding="utf-8",
    )
    monkeypatch.setattr("readcast.services.ensure_server_running", lambda config: {"model": "kokoro-82m"})
    monkeypatch.setattr("readcast.services.synthesize", lambda segments, article_dir, config, progress=None: _write_audio(article_dir))
    monkeypatch.setattr("readcast.services.audio_duration", lambda path: 2.34)

    result = runner.invoke(
        cli,
        [
            "--base-dir",
            str(base_dir),
            "add",
            "--voice",
            "af_heart",
            "--process",
            str(text_path),
        ],
    )
    assert result.exit_code == 0, result.output

    result_list = runner.invoke(cli, ["--base-dir", str(base_dir), "list", "--status", "done", "--format", "json"])
    assert result_list.exit_code == 0, result_list.output
    listed = json.loads(result_list.output)
    assert len(listed) == 1
    assert listed[0]["title"] == "Field Notes"
    assert listed[0]["voice"] == "af_heart"


def test_cli_help_shows_server_and_web_commands() -> None:
    runner = CliRunner()

    result = runner.invoke(cli, ["--help"])

    assert result.exit_code == 0
    assert "server" in result.output
    assert "web" in result.output


def test_cli_server_commands(monkeypatch, tmp_path: Path) -> None:
    runner = CliRunner()
    base_dir = tmp_path / ".readcast"

    monkeypatch.setattr("readcast.cli.main.start_server", lambda config: {"model": "kokoro-82m"})
    monkeypatch.setattr(
        "readcast.cli.main.fetch_server_status",
        lambda config: {"version": "0.1.0", "model": "kokoro-82m", "voices_available": ["af_sky"], "uptime_seconds": 10},
    )
    monkeypatch.setattr("readcast.cli.main.stop_server", lambda config: True)

    start_result = runner.invoke(cli, ["--base-dir", str(base_dir), "server", "start"])
    assert start_result.exit_code == 0, start_result.output
    assert "running" in start_result.output

    status_result = runner.invoke(cli, ["--base-dir", str(base_dir), "server", "status"])
    assert status_result.exit_code == 0, status_result.output
    assert "kokoro-edge v0.1.0" in status_result.output

    stop_result = runner.invoke(cli, ["--base-dir", str(base_dir), "server", "stop"])
    assert stop_result.exit_code == 0, stop_result.output
    assert "stopped" in stop_result.output
