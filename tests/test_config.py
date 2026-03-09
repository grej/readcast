from __future__ import annotations

from readcast.core.config import Config


def test_config_created_with_defaults(base_dir) -> None:
    config = Config.load(base_dir)
    assert config.config_path.exists()
    assert config.tts.model == "kokoro-82m"
    assert config.tts.voice == "af_sky"
    assert config.tts.language == "en-us"
    assert config.tts.max_chunk_chars == 12000
    assert config.kokoro_edge.server_url == "http://127.0.0.1:7777"
    assert config.kokoro_edge.auto_start is True
    assert config.web.host == "127.0.0.1"
    assert config.web.port == 8765
    assert config.web.open_browser is True
    saved = config.config_path.read_text(encoding="utf-8")
    assert "[kokoro_edge]" in saved
    assert "[web]" in saved
    assert "server_url = \"http://127.0.0.1:7777\"" in saved


def test_config_set_value(base_dir) -> None:
    config = Config.load(base_dir)
    config.set_value("tts.voice", "af_heart")
    config.set_value("kokoro_edge.auto_start", "false")
    config.set_value("web.port", "9999")
    reloaded = Config.load(base_dir)
    assert reloaded.tts.voice == "af_heart"
    assert reloaded.kokoro_edge.auto_start is False
    assert reloaded.web.port == 9999
