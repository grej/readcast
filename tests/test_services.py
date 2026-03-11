from __future__ import annotations

from io import BytesIO
from pathlib import Path
import wave

from readcast.core.models import Article, Chunk
from readcast.core.config import Config
from readcast.services import ReadcastService


def _wav_bytes(duration: float = 0.1) -> bytes:
    buffer = BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(24000)
        handle.writeframes(b"\x00\x00" * int(24000 * duration))
    return buffer.getvalue()


def test_add_text_dedupes_within_window(base_dir) -> None:
    service = ReadcastService(Config.load(base_dir))

    first = service.add_text("A strong title\n\nThis is body text.")
    second = service.add_text("A strong title\n\nThis is body text.")

    assert first.created is True
    assert second.created is False
    assert second.article.id == first.article.id


def test_add_text_duplicate_window_expires(base_dir) -> None:
    service = ReadcastService(Config.load(base_dir))

    first = service.add_text("A strong title\n\nThis is body text.")
    second = service.add_text("A strong title\n\nThis is body text.", duplicate_window_sec=0)

    assert second.created is True
    assert second.article.id != first.article.id


def test_reprocess_updates_existing_article(base_dir) -> None:
    service = ReadcastService(Config.load(base_dir))
    added = service.add_text("Title line\n\nParagraph one.\n\nParagraph two.")

    updated = service.reprocess_article(added.article.id, voice="af_heart", speed=1.1)

    assert updated.id == added.article.id
    assert updated.voice == "af_heart"
    assert updated.speed == 1.1
    assert updated.status == "queued"


def test_add_text_uses_saved_default_voice(base_dir) -> None:
    service = ReadcastService(Config.load(base_dir))
    service.store.set_setting(service.DEFAULT_VOICE_SETTING_KEY, "af_heart")

    added = service.add_text("Title line\n\nParagraph one.")

    assert added.article.voice == "af_heart"


def test_playback_rate_round_trip(base_dir) -> None:
    service = ReadcastService(Config.load(base_dir))

    assert service.playback_rate() == 1.0
    assert service.set_playback_rate(1.5) == 1.5
    assert service.playback_rate() == 1.5


def test_preview_input_does_not_store_article(base_dir) -> None:
    service = ReadcastService(Config.load(base_dir))

    preview = service.preview_input("Preview title\n\nParagraph one.\n\nParagraph two.")

    assert preview.article.title == "Preview title"
    assert preview.chunks[0].chunk_type == "title"
    assert service.list_articles() == []


def test_preview_input_for_url_uses_extractor(monkeypatch, base_dir) -> None:
    service = ReadcastService(Config.load(base_dir))

    def fake_extract(source, config):
        return (
            Article(
                id="preview01",
                source_url=source,
                source_file=None,
                title="Fetched title",
                author=None,
                publication="Example",
                published_date=None,
                ingested_at="2026-03-10T00:00:00+00:00",
                word_count=3,
                estimated_read_min=1,
            ),
            [
                Chunk(idx=0, chunk_type="title", text="Fetched title", html_tag="title"),
                Chunk(idx=1, chunk_type="paragraph", text="Fetched body text.", html_tag="p"),
            ],
        )

    monkeypatch.setattr("readcast.services.extract", fake_extract)

    preview = service.preview_input("https://example.com/article")

    assert preview.article.source_url == "https://example.com/article"
    assert preview.full_text.startswith("Fetched title")


def test_process_article_removes_segments_after_success(monkeypatch, base_dir) -> None:
    service = ReadcastService(Config.load(base_dir))
    added = service.add_text("Cleanup title\n\nParagraph one.\n\nParagraph two.")
    article_dir = service.store.get_article_dir(added.article.id)

    monkeypatch.setattr("readcast.services.ensure_server_running", lambda config: {"model": "kokoro-82m"})

    def fake_synthesize(segments, article_dir: Path, config, progress=None):
        segments_dir = article_dir / "segments"
        segments_dir.mkdir(parents=True, exist_ok=True)
        (segments_dir / "seg_000.wav").write_bytes(_wav_bytes())
        (segments_dir / "list.txt").write_text("file 'seg_000.wav'\n", encoding="utf-8")
        audio_path = article_dir / "audio.mp3"
        audio_path.write_bytes(_wav_bytes())
        return audio_path

    monkeypatch.setattr("readcast.services.synthesize", fake_synthesize)
    monkeypatch.setattr("readcast.services.audio_duration", lambda path: 1.25)

    result = service.process_articles([added.article])[0]

    assert result.success is True
    assert (article_dir / "audio.mp3").exists()
    assert result.link_path is not None and result.link_path.exists()
    assert not (article_dir / "segments").exists()


def test_process_article_keeps_segments_on_failure(monkeypatch, base_dir) -> None:
    service = ReadcastService(Config.load(base_dir))
    added = service.add_text("Failure title\n\nParagraph one.\n\nParagraph two.")
    article_dir = service.store.get_article_dir(added.article.id)

    monkeypatch.setattr("readcast.services.ensure_server_running", lambda config: {"model": "kokoro-82m"})

    def fake_synthesize(segments, article_dir: Path, config, progress=None):
        segments_dir = article_dir / "segments"
        segments_dir.mkdir(parents=True, exist_ok=True)
        (segments_dir / "seg_000.wav").write_bytes(_wav_bytes())
        raise RuntimeError("boom")

    monkeypatch.setattr("readcast.services.synthesize", fake_synthesize)

    result = service.process_articles([added.article])[0]
    latest = service.get_article(added.article.id)

    assert result.success is False
    assert latest is not None and latest.status == "failed"
    assert (article_dir / "segments").exists()
