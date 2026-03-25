from __future__ import annotations

from contextlib import closing
from datetime import UTC, datetime
import json
import logging
from pathlib import Path
import shutil
import sqlite3
from typing import Optional

from localknowledge.models import Document
from localknowledge.service import KnowledgeService

from .models import Article, Chunk, slugify


log = logging.getLogger(__name__)


READCAST_EXTRA_SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS concepts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    concept_type TEXT,
    bloom_level TEXT,
    prerequisite_of INTEGER REFERENCES concepts(id)
);

CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_referenced_at TEXT NOT NULL,
    reference_count INTEGER DEFAULT 1,
    UNIQUE(name, entity_type)
);

CREATE TABLE IF NOT EXISTS relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_entity_id INTEGER REFERENCES entities(id),
    target_entity_id INTEGER REFERENCES entities(id),
    relationship_type TEXT NOT NULL,
    source_article_id TEXT REFERENCES documents(id),
    extracted_at TEXT NOT NULL,
    confidence REAL DEFAULT 1.0,
    exercise_generated INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS article_entities (
    article_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
    PRIMARY KEY (article_id, entity_id)
);

CREATE TABLE IF NOT EXISTS agent_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_name TEXT NOT NULL,
    action TEXT NOT NULL,
    target_id TEXT,
    payload TEXT,
    created_at TEXT NOT NULL,
    reviewed_by_user INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '📋',
    color TEXT NOT NULL DEFAULT '#6b7084',
    bg TEXT NOT NULL DEFAULT 'rgba(107,112,132,0.12)',
    type TEXT NOT NULL CHECK(type IN ('collection','todo','playlist')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS list_items (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    doc_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    due DATE,
    done BOOLEAN NOT NULL DEFAULT 0,
    ai_suggested_due BOOLEAN NOT NULL DEFAULT 0,
    done_at TIMESTAMP,
    use_summary BOOLEAN NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(list_id, doc_id)
);

CREATE INDEX IF NOT EXISTS idx_list_items_list ON list_items(list_id, position);
CREATE INDEX IF NOT EXISTS idx_list_items_doc ON list_items(doc_id);
"""

_STATUS_TO_INGEST = {
    "queued": "raw",
    "synthesizing": "processed",
    "done": "indexed",
    "error": "error",
    "failed": "error",
}

_INGEST_TO_STATUS = {v: k for k, v in _STATUS_TO_INGEST.items() if k != "failed"}


class Store:
    def __init__(self, base_dir: Path = Path("~/.readcast").expanduser()):
        self.base_dir = base_dir.expanduser()
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.articles_dir = self.base_dir / "articles"
        self.output_dir = self.base_dir / "output"
        self.feed_dir = self.base_dir / "feed"
        for directory in (self.articles_dir, self.output_dir, self.feed_dir):
            directory.mkdir(parents=True, exist_ok=True)

        # Shared knowledge DB: use ~/.localknowledge for production,
        # co-locate in base_dir for tests (non-default base_dir)
        default_base = Path("~/.readcast").expanduser()
        if self.base_dir == default_base:
            self._svc = KnowledgeService()  # ~/.localknowledge
        else:
            self._svc = KnowledgeService(base_dir=self.base_dir)  # test isolation

        self._initialize_readcast_tables()

    def _connect(self) -> sqlite3.Connection:
        return self._svc.db.connect()

    def _initialize_readcast_tables(self) -> None:
        with closing(self._connect()) as conn:
            conn.executescript(READCAST_EXTRA_SCHEMA)

    # -- Article CRUD ----------------------------------------------------------

    def add_article(self, article: Article, chunks: list[Chunk], full_text: str) -> bool:
        article_dir = self.get_article_dir(article.id)

        if article.source_url:
            with closing(self._connect()) as conn:
                existing = conn.execute(
                    "SELECT id FROM documents WHERE source_uri = ? AND deleted_at IS NULL",
                    (article.source_url,),
                ).fetchone()
                if existing:
                    return False

        try:
            self._svc.docs.create(
                title=article.title,
                source_type="article",
                source_product="readcast",
                id=article.id,
                content=full_text,
                language=article.language,
                source_uri=article.source_url,
                canonical_uri=article.canonical_url,
                ingest_status=_STATUS_TO_INGEST.get(article.status, "raw"),
                metadata=article.to_dict(),
            )
        except Exception:
            return False

        # Auto-embed (best-effort, don't block article creation)
        try:
            self._svc.embed_document(article.id)
        except Exception:
            pass

        self._write_json(article_dir / "meta.json", article.to_dict())
        self._write_text(article_dir / "source.txt", full_text)
        self._write_json(article_dir / "chunks.json", [chunk.to_dict() for chunk in chunks])
        return True

    def get_article(self, article_id: str) -> Optional[Article]:
        doc = self._svc.docs.get(article_id)
        return self._doc_to_article(doc) if doc else None

    def list_articles(self, status: Optional[str] = None, limit: int = 50) -> list[Article]:
        fetch_limit = limit * 5 if status else limit
        docs = self._svc.docs.list(source_product="readcast", limit=fetch_limit)
        articles = [self._doc_to_article(d) for d in docs]
        if status:
            articles = [a for a in articles if a.status == status]
        return articles[:limit]

    def update_status(self, article_id: str, status: str, error_message: Optional[str] = None) -> None:
        doc = self._svc.docs.get(article_id, include_deleted=True)
        if not doc:
            return
        meta = doc.metadata or {}
        meta["status"] = status
        meta["error_message"] = error_message
        doc.ingest_status = _STATUS_TO_INGEST.get(status, "raw")
        doc.metadata = meta
        self._svc.docs.update(doc)

    def update_audio_metadata(self, article_id: str, duration_sec: float, voice: str, model: str, speed: float) -> None:
        doc = self._svc.docs.get(article_id, include_deleted=True)
        if not doc:
            return
        meta = doc.metadata or {}
        meta["audio_duration_sec"] = duration_sec
        meta["voice"] = voice
        meta["tts_model"] = model
        meta["speed"] = speed
        meta["status"] = "done"
        meta["error_message"] = None
        doc.ingest_status = "indexed"
        doc.metadata = meta
        self._svc.docs.update(doc)

    def get_setting(self, key: str) -> Optional[str]:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        if row is None:
            return None
        return str(row["value"])

    def set_setting(self, key: str, value: str) -> None:
        with closing(self._connect()) as conn:
            conn.execute(
                """
                INSERT INTO settings(key, value)
                VALUES(?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (key, value),
            )
            conn.commit()

    def search(self, query: str, limit: int = 20) -> list[Article]:
        try:
            results = self._svc.search(query, limit=limit * 3)
        except Exception:
            results = self._svc.search(query, mode="fts", limit=limit * 3)
        return [
            self._doc_to_article(r.document)
            for r in results
            if r.document.source_product == "readcast"
        ][:limit]

    def get_queued(self) -> list[Article]:
        docs = self._svc.docs.list(source_product="readcast", limit=1000)
        articles = [self._doc_to_article(d) for d in docs]
        queued = [a for a in articles if a.status == "queued"]
        queued.sort(key=lambda a: a.ingested_at)
        return queued

    def get_chunks(self, article_id: str) -> list[Chunk]:
        path = self.get_article_dir(article_id) / "chunks.json"
        if not path.exists():
            return []
        data = json.loads(path.read_text(encoding="utf-8"))
        return [Chunk.from_dict(item) for item in data]

    def get_article_dir(self, article_id: str) -> Path:
        path = self.articles_dir / article_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def get_full_text(self, article_id: str) -> Optional[str]:
        path = self.get_article_dir(article_id) / "source.txt"
        if not path.exists():
            return None
        return path.read_text(encoding="utf-8")

    def update_full_text(self, article_id: str, full_text: str, chunks: list[Chunk]) -> None:
        article_dir = self.get_article_dir(article_id)
        self._write_text(article_dir / "source.txt", full_text)
        self._write_json(article_dir / "chunks.json", [chunk.to_dict() for chunk in chunks])

        doc = self._svc.docs.get(article_id, include_deleted=True)
        if doc:
            doc.content = full_text
            self._svc.docs.update(doc)

    def create_output_symlink(self, article: Article, audio_path: Path) -> Path:
        slug = slugify(article.title) or article.id
        extension = audio_path.suffix
        candidate = self.output_dir / f"{slug}{extension}"
        counter = 2
        while candidate.exists() or candidate.is_symlink():
            if candidate.is_symlink() and candidate.resolve() == audio_path.resolve():
                return candidate
            candidate = self.output_dir / f"{slug}-{counter}{extension}"
            counter += 1

        if candidate.exists() or candidate.is_symlink():
            candidate.unlink()
        try:
            candidate.symlink_to(audio_path)
        except OSError:
            shutil.copy2(audio_path, candidate)
        return candidate

    def delete_article(self, article_id: str) -> bool:
        article = self.get_article(article_id)
        if article is None:
            return False

        self._svc.docs.delete(article_id, hard=True)

        article_dir = self.articles_dir / article_id
        if article_dir.exists():
            shutil.rmtree(article_dir)

        for path in self.output_dir.iterdir():
            if path.is_symlink():
                try:
                    if path.resolve().parent == article_dir:
                        path.unlink()
                except OSError:
                    pass
        return True

    def update_article(self, article: Article) -> None:
        doc = self._svc.docs.get(article.id, include_deleted=True)
        if not doc:
            return
        doc.title = article.title
        doc.language = article.language
        doc.source_uri = article.source_url
        doc.canonical_uri = article.canonical_url
        doc.ingest_status = _STATUS_TO_INGEST.get(article.status, "raw")
        doc.metadata = article.to_dict()
        self._svc.docs.update(doc)
        self._write_json(self.get_article_dir(article.id) / "meta.json", article.to_dict())

    # -- Listen tracking -------------------------------------------------------

    def record_listen(self, article_id: str, complete: bool = False) -> None:
        doc = self._svc.docs.get(article_id, include_deleted=True)
        if not doc:
            return
        now = datetime.now(UTC).isoformat()
        meta = doc.metadata or {}
        meta["listened_at"] = now
        meta["listen_count"] = meta.get("listen_count", 0) + 1
        if complete:
            meta["listened_complete"] = 1
        doc.metadata = meta
        self._svc.docs.update(doc)

    # -- Entity / relationship storage -----------------------------------------

    def upsert_entity(self, name: str, entity_type: str, seen_at: str) -> int:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT id FROM entities WHERE name = ? AND entity_type = ?",
                (name, entity_type),
            ).fetchone()
            if row:
                conn.execute(
                    "UPDATE entities SET last_referenced_at = ?, reference_count = reference_count + 1 WHERE id = ?",
                    (seen_at, row["id"]),
                )
                conn.commit()
                return row["id"]
            cursor = conn.execute(
                "INSERT INTO entities (name, entity_type, first_seen_at, last_referenced_at) VALUES (?, ?, ?, ?)",
                (name, entity_type, seen_at, seen_at),
            )
            conn.commit()
            return cursor.lastrowid

    def link_article_entity(self, article_id: str, entity_id: int) -> None:
        with closing(self._connect()) as conn:
            conn.execute(
                "INSERT OR IGNORE INTO article_entities (article_id, entity_id) VALUES (?, ?)",
                (article_id, entity_id),
            )
            conn.commit()

    def add_relationship(
        self, source_entity_id: int, target_entity_id: int,
        relationship_type: str, source_article_id: str, extracted_at: str,
        confidence: float = 1.0,
    ) -> int:
        with closing(self._connect()) as conn:
            cursor = conn.execute(
                """
                INSERT INTO relationships
                    (source_entity_id, target_entity_id, relationship_type, source_article_id, extracted_at, confidence)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (source_entity_id, target_entity_id, relationship_type, source_article_id, extracted_at, confidence),
            )
            conn.commit()
            return cursor.lastrowid

    def list_entities(self, limit: int = 200) -> list[dict]:
        with closing(self._connect()) as conn:
            rows = conn.execute(
                """
                SELECT e.*, COUNT(ae.article_id) as article_count
                FROM entities e
                LEFT JOIN article_entities ae ON ae.entity_id = e.id
                GROUP BY e.id
                ORDER BY e.reference_count DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_entity_articles(self, entity_id: int) -> list[Article]:
        with closing(self._connect()) as conn:
            rows = conn.execute(
                """
                SELECT d.* FROM documents d
                JOIN article_entities ae ON ae.article_id = d.id
                WHERE ae.entity_id = ?
                ORDER BY d.created_at DESC
                """,
                (entity_id,),
            ).fetchall()
        return [self._doc_to_article(Document.from_row(row)) for row in rows]

    def get_article_entities(self, article_id: str) -> list[dict]:
        with closing(self._connect()) as conn:
            rows = conn.execute(
                """
                SELECT e.* FROM entities e
                JOIN article_entities ae ON ae.entity_id = e.id
                WHERE ae.article_id = ?
                ORDER BY e.reference_count DESC
                """,
                (article_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    # -- Embedding storage (delegates to KnowledgeService) ---------------------

    def has_embeddings(self, article_id: str) -> bool:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT 1 FROM embeddings_dense_v2 WHERE document_id = ? LIMIT 1",
                (article_id,),
            ).fetchone()
        return row is not None

    def articles_without_embeddings(self) -> list[Article]:
        docs = self._svc.docs.list_unembedded()
        return [self._doc_to_article(d) for d in docs if d.source_product == "readcast"]

    def articles_without_tags(self) -> list[Article]:
        docs = self._svc.docs.list(source_product="readcast", limit=1000)
        return [
            self._doc_to_article(d)
            for d in docs
            if not (d.metadata or {}).get("tags")
        ]

    def embed_article(self, article_id: str) -> bool:
        """Embed a single article using KnowledgeService."""
        return self._svc.embed_document(article_id)

    # -- Agent log -------------------------------------------------------------

    def log_agent_action(self, agent_name: str, action: str, target_id: str = None, payload: str = None) -> None:
        with closing(self._connect()) as conn:
            conn.execute(
                "INSERT INTO agent_log (agent_name, action, target_id, payload, created_at) VALUES (?, ?, ?, ?, ?)",
                (agent_name, action, target_id, payload, datetime.now(UTC).isoformat()),
            )
            conn.commit()

    # -- Lists -----------------------------------------------------------------

    def create_list(self, name: str, list_type: str, icon: str = "📋",
                    color: str = "#6b7084", bg: str = "rgba(107,112,132,0.12)") -> dict:
        import uuid
        list_id = str(uuid.uuid4())[:8]
        now = datetime.now(UTC).isoformat()
        with closing(self._connect()) as conn:
            max_order = conn.execute("SELECT COALESCE(MAX(sort_order), -1) FROM lists").fetchone()[0]
            conn.execute(
                "INSERT INTO lists (id, name, icon, color, bg, type, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (list_id, name, icon, color, bg, list_type, max_order + 1, now),
            )
            conn.commit()
        return self.get_list(list_id)

    def get_list(self, list_id: str) -> Optional[dict]:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT * FROM lists WHERE id = ?", (list_id,)).fetchone()
        if row is None:
            return None
        result = dict(row)
        result["item_count"] = self._list_item_count(list_id)
        return result

    def list_lists(self) -> list[dict]:
        with closing(self._connect()) as conn:
            rows = conn.execute("SELECT * FROM lists ORDER BY sort_order").fetchall()
        result = []
        for row in rows:
            d = dict(row)
            d["item_count"] = self._list_item_count(d["id"])
            result.append(d)
        return result

    def update_list(self, list_id: str, **fields) -> Optional[dict]:
        allowed = {"name", "icon", "color", "bg", "type", "sort_order"}
        updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
        if not updates:
            return self.get_list(list_id)
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [list_id]
        with closing(self._connect()) as conn:
            conn.execute(f"UPDATE lists SET {set_clause} WHERE id = ?", values)
            conn.commit()
        return self.get_list(list_id)

    def delete_list(self, list_id: str) -> bool:
        with closing(self._connect()) as conn:
            cursor = conn.execute("DELETE FROM lists WHERE id = ?", (list_id,))
            conn.commit()
        return cursor.rowcount > 0

    def reorder_lists(self, ids: list[str]) -> None:
        with closing(self._connect()) as conn:
            for i, list_id in enumerate(ids):
                conn.execute("UPDATE lists SET sort_order = ? WHERE id = ?", (i, list_id))
            conn.commit()

    def _list_item_count(self, list_id: str) -> int:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT COUNT(*) FROM list_items WHERE list_id = ?", (list_id,)).fetchone()
        return row[0] if row else 0

    # -- List items ------------------------------------------------------------

    def add_list_item(self, list_id: str, doc_id: str,
                      due: Optional[str] = None, use_summary: bool = False,
                      ai_suggested_due: bool = False) -> dict:
        import uuid
        item_id = str(uuid.uuid4())[:8]
        now = datetime.now(UTC).isoformat()
        with closing(self._connect()) as conn:
            max_pos = conn.execute(
                "SELECT COALESCE(MAX(position), -1) FROM list_items WHERE list_id = ?", (list_id,)
            ).fetchone()[0]
            conn.execute(
                """INSERT INTO list_items (id, list_id, doc_id, position, due, ai_suggested_due, use_summary, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (item_id, list_id, doc_id, max_pos + 1, due, int(ai_suggested_due), int(use_summary), now),
            )
            conn.commit()
        return self.get_list_item(list_id, doc_id)

    def remove_list_item(self, list_id: str, doc_id: str) -> bool:
        with closing(self._connect()) as conn:
            cursor = conn.execute(
                "DELETE FROM list_items WHERE list_id = ? AND doc_id = ?", (list_id, doc_id)
            )
            conn.commit()
        return cursor.rowcount > 0

    def update_list_item(self, list_id: str, doc_id: str, **fields) -> Optional[dict]:
        allowed = {"position", "due", "done", "ai_suggested_due", "done_at", "use_summary"}
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return self.get_list_item(list_id, doc_id)
        # Auto-set done_at when marking done
        if updates.get("done") and "done_at" not in updates:
            updates["done_at"] = datetime.now(UTC).isoformat()
        elif updates.get("done") == 0 or updates.get("done") is False:
            updates["done_at"] = None
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [list_id, doc_id]
        with closing(self._connect()) as conn:
            conn.execute(f"UPDATE list_items SET {set_clause} WHERE list_id = ? AND doc_id = ?", values)
            conn.commit()
        return self.get_list_item(list_id, doc_id)

    def get_list_item(self, list_id: str, doc_id: str) -> Optional[dict]:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT * FROM list_items WHERE list_id = ? AND doc_id = ?", (list_id, doc_id)
            ).fetchone()
        return dict(row) if row else None

    def get_list_items(self, list_id: str) -> list[dict]:
        with closing(self._connect()) as conn:
            rows = conn.execute(
                """SELECT li.*, d.title, d.source_uri, d.created_at as doc_created_at
                   FROM list_items li
                   JOIN documents d ON d.id = li.doc_id
                   WHERE li.list_id = ? AND d.deleted_at IS NULL
                   ORDER BY li.position""",
                (list_id,),
            ).fetchall()
        items = []
        for row in rows:
            item = dict(row)
            doc = self._svc.docs.get(item["doc_id"])
            if doc:
                item["article"] = self._doc_to_article(doc).to_dict()
            items.append(item)
        return items

    def reorder_list_items(self, list_id: str, doc_ids: list[str]) -> None:
        with closing(self._connect()) as conn:
            for i, doc_id in enumerate(doc_ids):
                conn.execute(
                    "UPDATE list_items SET position = ? WHERE list_id = ? AND doc_id = ?",
                    (i, list_id, doc_id),
                )
            conn.commit()

    def get_doc_list_memberships(self, doc_id: str) -> list[dict]:
        with closing(self._connect()) as conn:
            rows = conn.execute(
                """SELECT l.id, l.name, l.icon, l.color, l.bg, l.type, li.done, li.due
                   FROM list_items li JOIN lists l ON l.id = li.list_id
                   WHERE li.doc_id = ?
                   ORDER BY l.sort_order""",
                (doc_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    # -- Renditions ------------------------------------------------------------

    def get_renditions(self, doc_id: str) -> dict:
        doc = self._svc.docs.get(doc_id)
        if not doc:
            return {"audio": None, "summary": None, "audio_summary": None}
        meta = doc.metadata or {}
        renditions = meta.get("renditions")
        if renditions:
            return renditions
        # Backwards compat: build renditions from old flat fields
        audio = None
        status = meta.get("status", "queued")
        if status == "done" and meta.get("audio_duration_sec"):
            audio = {
                "state": "ready",
                "duration": meta.get("audio_duration_sec"),
                "voice": meta.get("voice"),
                "generated_at": meta.get("listened_at"),  # best approximation
            }
        elif status in ("queued", "synthesizing"):
            audio = {
                "state": "queued" if status == "queued" else "generating",
                "voice": meta.get("voice"),
                "duration": None,
                "generated_at": None,
            }
        summary = None
        if meta.get("description"):
            summary = {"text": meta["description"], "generated_at": None}
        return {"audio": audio, "summary": summary, "audio_summary": None}

    def set_rendition(self, doc_id: str, rendition_type: str, data: Optional[dict]) -> None:
        doc = self._svc.docs.get(doc_id, include_deleted=True)
        if not doc:
            return
        meta = doc.metadata or {}
        renditions = meta.get("renditions", {"audio": None, "summary": None, "audio_summary": None})
        renditions[rendition_type] = data
        meta["renditions"] = renditions
        doc.metadata = meta
        self._svc.docs.update(doc)

    def clear_rendition(self, doc_id: str, rendition_type: str) -> None:
        self.set_rendition(doc_id, rendition_type, None)

    # -- Helpers ---------------------------------------------------------------

    def _doc_to_article(self, doc: Document) -> Article:
        meta = doc.metadata or {}
        # Ensure core Document fields are present (migration may store partial metadata)
        defaults = {
            "id": doc.id,
            "title": doc.title or "",
            "source_url": doc.source_uri,
            "source_file": meta.get("source_file"),
            "author": meta.get("author"),
            "publication": meta.get("publication"),
            "published_date": meta.get("published_date"),
            "ingested_at": doc.created_at or "",
            "word_count": meta.get("word_count", 0),
            "estimated_read_min": meta.get("estimated_read_min", 0),
            "status": meta.get("status") or _INGEST_TO_STATUS.get(doc.ingest_status, "queued"),
        }
        merged = {**defaults, **meta}
        return Article.from_dict(merged)

    @staticmethod
    def _write_json(path: Path, payload: object) -> None:
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")
        tmp.replace(path)

    @staticmethod
    def _write_text(path: Path, content: str) -> None:
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(content, encoding="utf-8")
        tmp.replace(path)
