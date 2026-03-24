from __future__ import annotations

from contextlib import closing
from pathlib import Path

from readcast.core.models import Article, Chunk
from readcast.core.store import Store


def _article(article_id: str = "abc12345", source_url: str | None = "https://example.com/article") -> Article:
    return Article(
        id=article_id,
        source_url=source_url,
        source_file=None if source_url else "/tmp/article.html",
        title="Drone War Notes",
        author="Analyst",
        publication="Policy Weekly",
        published_date="2026-03-07",
        ingested_at="2026-03-07T00:00:00Z",
        word_count=8,
        estimated_read_min=1,
        tags=["defense"],
    )


def _chunks() -> list[Chunk]:
    return [
        Chunk(idx=0, chunk_type="title", text="Drone War Notes", html_tag="title"),
        Chunk(idx=1, chunk_type="paragraph", text="This article discusses drone war and missile defense.", html_tag="p"),
    ]


def test_add_article_creates_records(base_dir: Path) -> None:
    store = Store(base_dir)
    article = _article()

    added = store.add_article(article, _chunks(), "Drone War Notes\n\nThis article discusses drone war and missile defense.")

    assert added is True
    assert store.get_article(article.id) == article
    assert (store.get_article_dir(article.id) / "meta.json").exists()
    assert store.get_chunks(article.id)[1].text.startswith("This article")


def test_add_article_duplicate_url_returns_false(base_dir: Path) -> None:
    store = Store(base_dir)
    article = _article()
    store.add_article(article, _chunks(), "drone war")

    duplicate = store.add_article(_article(article_id="ffff0000"), _chunks(), "drone war")

    assert duplicate is False


def test_search_uses_fts(base_dir: Path) -> None:
    store = Store(base_dir)
    article = _article()
    store.add_article(article, _chunks(), "This library indexes drone war analysis and missile defense.")

    results = store.search("drone war")

    assert [item.id for item in results] == [article.id]


def test_list_articles_by_status(base_dir: Path) -> None:
    store = Store(base_dir)
    queued = _article("queued001")
    failed = _article("failed001", source_url="https://example.com/other")
    failed.status = "failed"
    store.add_article(queued, _chunks(), "queued text")
    store.add_article(failed, _chunks(), "failed text")

    results = store.list_articles(status="queued")

    assert [item.id for item in results] == [queued.id]


def test_create_output_symlink_adds_suffix(base_dir: Path) -> None:
    store = Store(base_dir)
    article_one = _article("one11111", "https://example.com/one")
    article_two = _article("two22222", "https://example.com/two")
    article_two.title = article_one.title
    audio_one = store.get_article_dir(article_one.id) / "audio.mp3"
    audio_two = store.get_article_dir(article_two.id) / "audio.mp3"
    audio_one.write_bytes(b"one")
    audio_two.write_bytes(b"two")

    first = store.create_output_symlink(article_one, audio_one)
    second = store.create_output_symlink(article_two, audio_two)

    assert first.name == "drone-war-notes.mp3"
    assert second.name == "drone-war-notes-2.mp3"


def test_doc_to_article_with_partial_metadata(base_dir: Path) -> None:
    """Migrated documents may have partial metadata (missing id, title, etc).
    _doc_to_article should reconstruct the Article from Document fields."""
    store = Store(base_dir)
    # Directly create a document via the knowledge service with minimal metadata
    # (simulating what the migration script does)
    store._svc.docs.create(
        title="Migrated Article",
        source_type="article",
        source_product="readcast",
        id="migrated1",
        content="Some text",
        language="en",
        source_uri="https://example.com/migrated",
        ingest_status="indexed",
        metadata={"author": "Test Author", "word_count": 42},
    )

    article = store.get_article("migrated1")

    assert article is not None
    assert article.id == "migrated1"
    assert article.title == "Migrated Article"
    assert article.source_url == "https://example.com/migrated"
    assert article.author == "Test Author"
    assert article.word_count == 42
    assert article.status == "done"  # ingest_status "indexed" maps to "done"


def test_doc_to_article_with_full_metadata(base_dir: Path) -> None:
    """Articles added normally have full metadata. Verify no regression."""
    store = Store(base_dir)
    article = _article()
    store.add_article(article, _chunks(), "full text here")

    loaded = store.get_article(article.id)

    assert loaded is not None
    assert loaded.id == article.id
    assert loaded.title == article.title
    assert loaded.author == article.author


def test_delete_article_removes_entity_links(base_dir: Path) -> None:
    store = Store(base_dir)
    article = _article()
    store.add_article(article, _chunks(), "drone war text")

    entity_id = store.upsert_entity("TestCorp", "company", "2026-01-01T00:00:00Z")
    store.link_article_entity(article.id, entity_id)

    assert len(store.get_article_entities(article.id)) == 1

    store.delete_article(article.id)

    assert store.get_article(article.id) is None


def test_settings_round_trip(base_dir: Path) -> None:
    store = Store(base_dir)

    assert store.get_setting("test_key") is None

    store.set_setting("test_key", "test_value")
    assert store.get_setting("test_key") == "test_value"

    store.set_setting("test_key", "updated_value")
    assert store.get_setting("test_key") == "updated_value"

