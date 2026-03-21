from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from readcast.core.config import Config
from readcast.core.llm import complete, is_available, llm_status


def test_llm_config_defaults(base_dir) -> None:
    config = Config.load(base_dir)
    assert config.llm.provider == "local"
    assert config.llm.local_model == "mlx-community/Qwen3.5-4B-MLX-4bit"
    assert config.llm.local_server_url == "http://127.0.0.1:8090"
    assert config.llm.auto_start is True
    assert config.llm.startup_timeout_sec == 120
    saved = config.config_path.read_text(encoding="utf-8")
    assert "[llm]" in saved
    assert 'provider = "local"' in saved


def test_llm_config_set_value(base_dir) -> None:
    config = Config.load(base_dir)
    config.set_value("llm.provider", "openai")
    config.set_value("llm.auto_start", "false")
    reloaded = Config.load(base_dir)
    assert reloaded.llm.provider == "openai"
    assert reloaded.llm.auto_start is False


def test_llm_config_roundtrip_toml(base_dir) -> None:
    config = Config.load(base_dir)
    config.llm.provider = "anthropic"
    config.llm.api_key = "sk-test-123"
    config.save()
    reloaded = Config.load(base_dir)
    assert reloaded.llm.provider == "anthropic"
    assert reloaded.llm.api_key == "sk-test-123"


@patch("localknowledge.llm.httpx.get")
def test_is_available_returns_true_on_200(mock_get, base_dir) -> None:
    config = Config.load(base_dir)
    mock_get.return_value = MagicMock(status_code=200)
    assert is_available(config) is True


@patch("localknowledge.llm.httpx.get", side_effect=Exception("connection refused"))
def test_is_available_returns_false_on_error(mock_get, base_dir) -> None:
    config = Config.load(base_dir)
    assert is_available(config) is False


@patch("localknowledge.llm.httpx.post")
def test_complete_returns_content(mock_post, base_dir) -> None:
    config = Config.load(base_dir)
    mock_post.return_value = MagicMock(
        status_code=200,
        json=lambda: {"choices": [{"message": {"content": "Hello!"}}]},
        raise_for_status=lambda: None,
    )
    result = complete([{"role": "user", "content": "Say hello"}], config)
    assert result == "Hello!"
    call_kwargs = mock_post.call_args
    assert "v1/chat/completions" in call_kwargs.args[0]


@patch("localknowledge.llm.is_available", return_value=False)
def test_llm_status_stopped(mock_avail, base_dir) -> None:
    config = Config.load(base_dir)
    status = llm_status(config)
    assert status["available"] is False
    assert status["provider"] == "local"
    assert status["status"] == "stopped"


@patch("localknowledge.llm.is_available", return_value=True)
def test_llm_status_cloud_available(mock_avail, base_dir) -> None:
    config = Config.load(base_dir)
    config.llm.provider = "openai"
    config.llm.api_key = "sk-test"
    status = llm_status(config)
    assert status["available"] is True
    assert status["provider"] == "openai"
    assert status["status"] == "available"


def test_api_llm_status_endpoint(base_dir) -> None:
    from readcast.api.app import create_app
    app = create_app(base_dir)
    with TestClient(app) as client:
        mock_status = {"available": False, "provider": "local", "model": "test", "status": "stopped"}
        with patch("readcast.api.app.get_llm_status", return_value=mock_status):
            response = client.get("/api/llm/status")
            assert response.status_code == 200
            assert response.json()["provider"] == "local"


def test_api_llm_complete_endpoint(base_dir) -> None:
    from readcast.api.app import create_app
    app = create_app(base_dir)
    with TestClient(app) as client:
        with patch("readcast.api.app.ensure_llm_running"):
            with patch("readcast.api.app.llm_complete", return_value="Test response"):
                response = client.post("/api/llm/complete", json={
                    "messages": [{"role": "user", "content": "hello"}],
                })
                assert response.status_code == 200
                assert response.json()["content"] == "Test response"


def test_api_plugin_run_endpoint(base_dir) -> None:
    from readcast.api.app import create_app
    app = create_app(base_dir)
    with TestClient(app) as client:
        with patch("readcast.api.app.ensure_llm_running"):
            with patch("readcast.api.app.llm_complete", return_value="Email briefing text"):
                response = client.post("/api/plugins/run", json={
                    "plugin_name": "gmail",
                    "scraped_data": [
                        {"sender": "Alice", "subject": "Meeting tomorrow", "unread": True},
                    ],
                })
                assert response.status_code == 200
                data = response.json()
                assert data["analysis"] == "Email briefing text"
                assert data["article_id"] is not None
