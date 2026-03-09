from __future__ import annotations

from io import BytesIO
import wave

from fastapi.testclient import TestClient

from readcast.api.app import create_app


def _wav_bytes(duration: float = 0.2) -> bytes:
    buffer = BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(24000)
        handle.writeframes(b"\x00\x00" * int(24000 * duration))
    return buffer.getvalue()


def test_api_add_and_list_text_articles(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        response = client.post("/api/articles", json={"input": "Title line\n\nParagraph one.", "process": False})
        assert response.status_code == 201
        payload = response.json()
        assert payload["created"] is True
        assert payload["article"]["title"] == "Title line"

        listed = client.get("/api/articles")
        assert listed.status_code == 200
        assert listed.json()["articles"][0]["title"] == "Title line"


def test_api_serves_frontend_shell_and_bundle(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        index = client.get("/")
        bundle = client.get("/static/bundle.js")

        assert index.status_code == 200
        assert "text/html" in index.headers["content-type"]
        assert "bundle.js" in index.text
        assert bundle.status_code == 200
        assert bundle.text


def test_api_dedupes_text_for_short_window(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        first = client.post("/api/articles", json={"input": "Repeat title\n\nBody text.", "process": False}).json()
        second = client.post("/api/articles", json={"input": "Repeat title\n\nBody text.", "process": False}).json()

        assert first["created"] is True
        assert second["created"] is False
        assert second["article"]["id"] == first["article"]["id"]


def test_api_reprocess_updates_same_article_and_kicks_worker(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        article = client.post("/api/articles", json={"input": "Retitle\n\nBody.", "process": False}).json()["article"]
        kicks: list[bool] = []
        client.app.state.worker.kick = lambda: kicks.append(True)

        response = client.post(f"/api/articles/{article['id']}/reprocess", json={"voice": "af_heart", "speed": 1.2})
        assert response.status_code == 200
        updated = response.json()["article"]
        assert updated["id"] == article["id"]
        assert updated["voice"] == "af_heart"
        assert kicks == [True]


def test_api_status_and_voices(monkeypatch, base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        monkeypatch.setattr("readcast.api.app.ReadcastService.daemon_status", lambda self: {"model": "kokoro-82m"})
        monkeypatch.setattr("readcast.api.app.ensure_server_running", lambda config: {"model": "kokoro-82m"})
        monkeypatch.setattr(
            "readcast.api.app.ReadcastService.available_voices",
            lambda self: [{"name": "af_sky"}, {"name": "af_heart"}],
        )

        status = client.get("/api/status")
        assert status.status_code == 200
        assert status.json()["kokoro_edge"]["connected"] is True

        voices = client.get("/api/voices")
        assert voices.status_code == 200
        assert [voice["name"] for voice in voices.json()["voices"]] == ["af_sky", "af_heart"]


def test_api_audio_endpoint_supports_range_requests(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        service = client.app.state.service
        article = service.add_text("Audio title\n\nAudio body.").article
        audio_path = service.store.get_article_dir(article.id) / "audio.mp3"
        audio_path.write_bytes(_wav_bytes())
        service.store.update_audio_metadata(article.id, duration_sec=0.2, voice="af_sky", model="kokoro-82m", speed=1.0)

        response = client.get(
            f"/api/articles/{article.id}/audio",
            headers={"Range": "bytes=0-31"},
        )

        assert response.status_code in {200, 206}
        assert response.headers["content-type"].startswith("audio/")
        assert response.content
