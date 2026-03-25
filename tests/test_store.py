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


# -- Lists -----------------------------------------------------------------

def test_create_and_get_list(base_dir: Path) -> None:
    store = Store(base_dir)
    lst = store.create_list("Study Psychology", "collection", icon="🧠", color="#a855f7")

    assert lst["name"] == "Study Psychology"
    assert lst["type"] == "collection"
    assert lst["icon"] == "🧠"
    assert lst["item_count"] == 0

    fetched = store.get_list(lst["id"])
    assert fetched["name"] == "Study Psychology"


def test_list_lists_ordered(base_dir: Path) -> None:
    store = Store(base_dir)
    store.create_list("First", "collection")
    store.create_list("Second", "todo")
    store.create_list("Third", "playlist")

    lists = store.list_lists()
    assert [l["name"] for l in lists] == ["First", "Second", "Third"]


def test_update_list(base_dir: Path) -> None:
    store = Store(base_dir)
    lst = store.create_list("Old Name", "collection")

    updated = store.update_list(lst["id"], name="New Name", icon="📚")

    assert updated["name"] == "New Name"
    assert updated["icon"] == "📚"


def test_delete_list_cascades_items(base_dir: Path) -> None:
    store = Store(base_dir)
    article = _article()
    store.add_article(article, _chunks(), "text")
    lst = store.create_list("To Delete", "collection")
    store.add_list_item(lst["id"], article.id)

    store.delete_list(lst["id"])

    assert store.get_list(lst["id"]) is None
    assert store.get_list_item(lst["id"], article.id) is None


def test_reorder_lists(base_dir: Path) -> None:
    store = Store(base_dir)
    a = store.create_list("A", "collection")
    b = store.create_list("B", "collection")
    c = store.create_list("C", "collection")

    store.reorder_lists([c["id"], a["id"], b["id"]])

    lists = store.list_lists()
    assert [l["name"] for l in lists] == ["C", "A", "B"]


# -- List items ------------------------------------------------------------

def test_add_and_get_list_items(base_dir: Path) -> None:
    store = Store(base_dir)
    a1 = _article("item0001")
    a2 = _article("item0002", source_url="https://example.com/two")
    store.add_article(a1, _chunks(), "text one")
    store.add_article(a2, _chunks(), "text two")
    lst = store.create_list("Reading", "collection")

    store.add_list_item(lst["id"], a1.id)
    store.add_list_item(lst["id"], a2.id)

    items = store.get_list_items(lst["id"])
    assert len(items) == 2
    assert items[0]["doc_id"] == a1.id
    assert items[1]["doc_id"] == a2.id
    assert "article" in items[0]

    assert store.get_list(lst["id"])["item_count"] == 2


def test_remove_list_item(base_dir: Path) -> None:
    store = Store(base_dir)
    article = _article()
    store.add_article(article, _chunks(), "text")
    lst = store.create_list("Temp", "collection")
    store.add_list_item(lst["id"], article.id)

    assert store.remove_list_item(lst["id"], article.id) is True
    assert store.get_list_items(lst["id"]) == []


def test_update_list_item_done(base_dir: Path) -> None:
    store = Store(base_dir)
    article = _article()
    store.add_article(article, _chunks(), "text")
    lst = store.create_list("Tasks", "todo")
    store.add_list_item(lst["id"], article.id, due="2026-04-01")

    updated = store.update_list_item(lst["id"], article.id, done=True)

    assert updated["done"] == 1
    assert updated["done_at"] is not None


def test_reorder_list_items(base_dir: Path) -> None:
    store = Store(base_dir)
    a1 = _article("reord001")
    a2 = _article("reord002", source_url="https://example.com/r2")
    store.add_article(a1, _chunks(), "t1")
    store.add_article(a2, _chunks(), "t2")
    lst = store.create_list("Playlist", "playlist")
    store.add_list_item(lst["id"], a1.id)
    store.add_list_item(lst["id"], a2.id)

    store.reorder_list_items(lst["id"], [a2.id, a1.id])

    items = store.get_list_items(lst["id"])
    assert items[0]["doc_id"] == a2.id
    assert items[1]["doc_id"] == a1.id


def test_doc_list_memberships(base_dir: Path) -> None:
    store = Store(base_dir)
    article = _article()
    store.add_article(article, _chunks(), "text")
    l1 = store.create_list("Study", "collection", icon="🧠")
    l2 = store.create_list("Commute", "playlist", icon="🎧")
    store.add_list_item(l1["id"], article.id)
    store.add_list_item(l2["id"], article.id)

    memberships = store.get_doc_list_memberships(article.id)

    assert len(memberships) == 2
    names = {m["name"] for m in memberships}
    assert names == {"Study", "Commute"}


def test_duplicate_list_item_rejected(base_dir: Path) -> None:
    store = Store(base_dir)
    article = _article()
    store.add_article(article, _chunks(), "text")
    lst = store.create_list("Unique", "collection")
    store.add_list_item(lst["id"], article.id)

    import sqlite3
    import pytest
    with pytest.raises((sqlite3.IntegrityError, Exception)):
        store.add_list_item(lst["id"], article.id)


# -- Renditions ------------------------------------------------------------

def test_renditions_from_old_format(base_dir: Path) -> None:
    store = Store(base_dir)
    article = _article()
    store.add_article(article, _chunks(), "text")
    store.update_audio_metadata(article.id, 120.5, "af_sky", "kokoro-82m", 1.0)

    renditions = store.get_renditions(article.id)

    assert renditions["audio"] is not None
    assert renditions["audio"]["state"] == "ready"
    assert renditions["audio"]["duration"] == 120.5
    assert renditions["summary"] is None
    assert renditions["audio_summary"] is None


def test_set_and_clear_rendition(base_dir: Path) -> None:
    store = Store(base_dir)
    article = _article()
    store.add_article(article, _chunks(), "text")

    store.set_rendition(article.id, "summary", {"text": "A short summary.", "generated_at": "2026-03-24T00:00:00Z"})

    renditions = store.get_renditions(article.id)
    assert renditions["summary"]["text"] == "A short summary."

    store.clear_rendition(article.id, "summary")
    renditions = store.get_renditions(article.id)
    assert renditions["summary"] is None

