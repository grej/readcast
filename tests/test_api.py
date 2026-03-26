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
        bundle = client.get("/static/app.js")

        assert index.status_code == 200
        assert "text/html" in index.headers["content-type"]
        assert "app.js" in index.text
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


def test_api_delete_removes_article_and_audio(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        service = client.app.state.service
        article = service.add_text("Delete title\n\nBody.").article
        article_dir = service.store.get_article_dir(article.id)
        audio_path = article_dir / "audio.mp3"
        audio_path.write_bytes(_wav_bytes())
        service.store.update_audio_metadata(
            article.id,
            duration_sec=0.2,
            voice="af_sky",
            model="kokoro-82m",
            speed=1.0,
        )
        service.store.create_output_symlink(service.get_article(article.id), audio_path)

        response = client.delete(f"/api/articles/{article.id}")

        assert response.status_code == 204
        assert service.get_article(article.id) is None
        assert not article_dir.exists()


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


def test_api_preferences_round_trip_and_drive_new_articles(monkeypatch, base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        monkeypatch.setattr("readcast.api.app.ensure_server_running", lambda config: {"model": "kokoro-82m"})
        monkeypatch.setattr(
            "readcast.api.app.ReadcastService.available_voices",
            lambda self: [{"name": "af_sky"}, {"name": "af_heart"}],
        )

        initial = client.get("/api/preferences")
        assert initial.status_code == 200
        assert initial.json()["preferences"]["default_voice"] == "af_sky"
        assert initial.json()["preferences"]["playback_rate"] == 1.0

        updated = client.put("/api/preferences", json={"default_voice": "af_heart"})
        assert updated.status_code == 200
        assert updated.json()["preferences"]["default_voice"] == "af_heart"

        playback = client.put("/api/preferences", json={"playback_rate": 1.5})
        assert playback.status_code == 200
        assert playback.json()["preferences"]["playback_rate"] == 1.5

        created = client.post("/api/articles", json={"input": "Saved voice title\n\nBody.", "process": False})
        assert created.status_code == 201
        assert created.json()["article"]["voice"] == "af_heart"


def test_api_preview_does_not_create_article(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        preview = client.post("/api/preview", json={"input": "Preview title\n\nParagraph body."})

        assert preview.status_code == 200
        payload = preview.json()["preview"]
        assert payload["article"]["title"] == "Preview title"
        assert payload["chunks"][0]["chunk_type"] == "title"
        listed = client.get("/api/articles")
        assert listed.json()["articles"] == []


def test_api_feed_includes_audio_items_only(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        service = client.app.state.service
        included = service.add_text("Feed title\n\nFeed body.").article
        service.add_text("No audio title\n\nBody.")
        audio_path = service.store.get_article_dir(included.id) / "audio.mp3"
        audio_path.write_bytes(_wav_bytes())
        service.store.update_audio_metadata(included.id, duration_sec=0.2, voice="af_sky", model="kokoro-82m", speed=1.0)

        response = client.get("/feed.xml")

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/rss+xml")
        assert "Feed title" in response.text
        assert "No audio title" not in response.text
        assert f"/api/articles/{included.id}/audio" in response.text


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


def test_api_status_reports_ready_details(monkeypatch, base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        monkeypatch.setattr(
            "readcast.api.app.ReadcastService.daemon_status",
            lambda self: {"model": "kokoro-82m", "models_loaded": ["kokoro-82m"]},
        )

        response = client.get("/api/status")

        assert response.status_code == 200
        payload = response.json()["kokoro_edge"]
        assert payload["connected"] is True
        assert payload["ready"] is True
        assert payload["state"] == "ready"


def test_api_cancel_queued_article(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        article = client.post("/api/articles", json={"input": "Cancel me\n\nBody.", "process": True}).json()["article"]
        assert article["status"] == "queued"

        response = client.post(f"/api/articles/{article['id']}/cancel")

        assert response.status_code == 200
        assert response.json()["article"]["status"] == "added"


def test_api_cancel_non_queued_article_returns_400(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        article = client.post("/api/articles", json={"input": "Not queued\n\nBody.", "process": False}).json()["article"]

        response = client.post(f"/api/articles/{article['id']}/cancel")

        assert response.status_code == 400


def test_api_cancel_missing_article_returns_404(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        response = client.post("/api/articles/nonexistent/cancel")
        assert response.status_code == 404


def test_api_remove_audio_deletes_audio_and_resets(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        service = client.app.state.service
        article = service.add_text("Audio removal\n\nBody.").article
        article_dir = service.store.get_article_dir(article.id)
        audio_path = article_dir / "audio.mp3"
        audio_path.write_bytes(_wav_bytes())
        service.store.update_audio_metadata(article.id, duration_sec=0.5, voice="af_sky", model="kokoro-82m", speed=1.0)

        response = client.delete(f"/api/articles/{article.id}/audio")

        assert response.status_code == 200
        updated = response.json()["article"]
        assert updated["status"] == "added"
        assert updated["has_audio"] is False
        assert not audio_path.exists()


def test_api_remove_audio_missing_article_returns_404(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        response = client.delete("/api/articles/nonexistent/audio")
        assert response.status_code == 404


def test_api_update_metadata_fields(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        article = client.post("/api/articles", json={"input": "Edit me\n\nBody text.", "process": False}).json()["article"]

        response = client.put(f"/api/articles/{article['id']}", json={
            "title": "New Title",
            "author": "New Author",
            "tags": ["tag1", "tag2"],
        })

        assert response.status_code == 200
        updated = response.json()["article"]
        assert updated["title"] == "New Title"
        assert updated["author"] == "New Author"
        assert updated["tags"] == ["tag1", "tag2"]


def test_api_update_text_and_get_text(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        article = client.post("/api/articles", json={"input": "Original title\n\nOriginal body.", "process": False}).json()["article"]

        client.put(f"/api/articles/{article['id']}/text", json={"text": "Updated title\n\nUpdated body."})

        text_resp = client.get(f"/api/articles/{article['id']}/text")
        assert text_resp.status_code == 200
        assert "Updated" in text_resp.json()["text"]


def test_api_lists_crud(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        # Create
        resp = client.post("/api/lists", json={"name": "Study", "type": "collection", "icon": "🧠"})
        assert resp.status_code == 201
        lst = resp.json()["list"]
        assert lst["name"] == "Study"
        assert lst["type"] == "collection"
        assert lst["color"] == "#a855f7"  # auto-assigned for collection

        # List
        resp = client.get("/api/lists")
        assert resp.status_code == 200
        assert len(resp.json()["lists"]) == 1

        # Update
        resp = client.put(f"/api/lists/{lst['id']}", json={"name": "Study Physics"})
        assert resp.status_code == 200
        assert resp.json()["list"]["name"] == "Study Physics"

        # Delete
        resp = client.delete(f"/api/lists/{lst['id']}")
        assert resp.status_code == 204
        assert len(client.get("/api/lists").json()["lists"]) == 0


def test_api_list_items_crud(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        # Create list + article
        lst = client.post("/api/lists", json={"name": "Reading", "type": "collection"}).json()["list"]
        article = client.post("/api/articles", json={"input": "List item\n\nBody text.", "process": False}).json()["article"]

        # Add item
        resp = client.post(f"/api/lists/{lst['id']}/items", json={"doc_id": article["id"]})
        assert resp.status_code == 201
        assert resp.json()["item"]["doc_id"] == article["id"]

        # List items
        resp = client.get(f"/api/lists/{lst['id']}/items")
        assert resp.status_code == 200
        assert len(resp.json()["items"]) == 1
        assert "article" in resp.json()["items"][0]

        # Update item (mark done)
        resp = client.put(f"/api/lists/{lst['id']}/items/{article['id']}", json={"done": True})
        assert resp.status_code == 200
        assert resp.json()["item"]["done"] == 1

        # Remove item
        resp = client.delete(f"/api/lists/{lst['id']}/items/{article['id']}")
        assert resp.status_code == 204


def test_api_list_item_duplicate_rejected(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        lst = client.post("/api/lists", json={"name": "Uniq", "type": "collection"}).json()["list"]
        article = client.post("/api/articles", json={"input": "Dup test\n\nBody.", "process": False}).json()["article"]
        client.post(f"/api/lists/{lst['id']}/items", json={"doc_id": article["id"]})

        resp = client.post(f"/api/lists/{lst['id']}/items", json={"doc_id": article["id"]})
        assert resp.status_code == 409


def test_api_article_includes_renditions_and_memberships(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        article = client.post("/api/articles", json={"input": "Rend test\n\nBody.", "process": False}).json()["article"]

        assert "renditions" in article
        assert "list_memberships" in article
        assert article["renditions"]["audio"] is None
        assert article["list_memberships"] == []


def test_api_renditions_endpoint(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        article = client.post("/api/articles", json={"input": "Rend doc\n\nBody.", "process": False}).json()["article"]

        resp = client.get(f"/api/docs/{article['id']}/renditions")
        assert resp.status_code == 200
        rend = resp.json()["renditions"]
        assert rend["audio"] is None
        assert rend["summary"] is None


def test_api_search_returns_matching_articles(base_dir) -> None:
    app = create_app(base_dir)
    with TestClient(app) as client:
        client.post("/api/articles", json={"input": "Quantum computing breakthrough\n\nNew research in quantum entanglement.", "process": False})
        client.post("/api/articles", json={"input": "Cooking pasta\n\nBoil water and add salt.", "process": False})

        response = client.get("/api/articles?q=quantum")

        assert response.status_code == 200
        articles = response.json()["articles"]
        assert len(articles) >= 1
        assert any("quantum" in a["title"].lower() or "quantum" in str(a.get("description", "")).lower() for a in articles)
