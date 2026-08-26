"""CLI/API observability contracts for the shared UDS TTS runtime."""

from __future__ import annotations

from click.testing import CliRunner
from fastapi.testclient import TestClient

from readcast.api.app import create_app
from readcast.cli.main import cli
from readcast.core.synthesizer import ServerError
from readcast.services import ReadcastService


SOCKET_ENDPOINT = "unix:/tmp/readcast-contract/kokoro-edge.sock"


def test_cli_server_lifecycle_delegates_to_readcast_service(monkeypatch, tmp_path) -> None:
    calls: list[str] = []

    monkeypatch.setattr(
        ReadcastService,
        "start_server",
        lambda _self: calls.append("start") or {"model": "kokoro-82m", "endpoint": SOCKET_ENDPOINT},
    )
    monkeypatch.setattr(
        ReadcastService,
        "daemon_status",
        lambda _self: calls.append("status") or {
            "version": "0.2.0",
            "model": "kokoro-82m",
            "voices_available": ["af_sky"],
            "uptime_seconds": 10,
            "endpoint": SOCKET_ENDPOINT,
        },
    )
    monkeypatch.setattr(ReadcastService, "stop_server", lambda _self: calls.append("stop") or True)
    runner = CliRunner()

    start = runner.invoke(cli, ["--base-dir", str(tmp_path), "server", "start"])
    status = runner.invoke(cli, ["--base-dir", str(tmp_path), "server", "status"])
    stop = runner.invoke(cli, ["--base-dir", str(tmp_path), "server", "stop"])

    assert start.exit_code == 0, start.output
    assert status.exit_code == 0, status.output
    assert stop.exit_code == 0, stop.output
    assert calls == ["start", "status", "stop"]
    assert SOCKET_ENDPOINT in start.output
    assert SOCKET_ENDPOINT in status.output
    assert "127.0.0.1:7777" not in start.output + status.output


def test_api_status_reports_uds_endpoint_and_actionable_socket_failure(monkeypatch, base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        monkeypatch.setattr(
            ReadcastService,
            "daemon_status",
            lambda _self: {
                "version": "0.2.0",
                "model": "kokoro-82m",
                "models_loaded": ["kokoro-82m"],
                "endpoint": SOCKET_ENDPOINT,
            },
        )
        ready = client.get("/api/status")

        assert ready.status_code == 200
        payload = ready.json()["kokoro_edge"]
        assert payload["ready"] is True
        assert payload["endpoint"] == SOCKET_ENDPOINT
        assert "127.0.0.1:7777" not in str(payload)

        def unavailable(_self):
            raise ServerError(f"UDS endpoint unavailable: {SOCKET_ENDPOINT}")

        monkeypatch.setattr(ReadcastService, "daemon_status", unavailable)
        unavailable_response = client.get("/api/status")
        error_payload = unavailable_response.json()["kokoro_edge"]

        assert unavailable_response.status_code == 200
        assert error_payload["ready"] is False
        assert SOCKET_ENDPOINT in error_payload["error"]
