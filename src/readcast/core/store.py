from __future__ import annotations

from contextlib import closing
import json
from pathlib import Path
import shutil
import sqlite3
from typing import Optional

from .models import Article, Chunk, slugify


SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    source_url TEXT UNIQUE,
    source_file TEXT,
    title TEXT NOT NULL,
    author TEXT,
    publication TEXT,
    published_date TEXT,
    ingested_at TEXT NOT NULL,
    word_count INTEGER NOT NULL,
    estimated_read_min INTEGER NOT NULL,
    description TEXT,
    image_url TEXT,
    canonical_url TEXT,
    site_name TEXT,
    language TEXT NOT NULL DEFAULT 'en',
    status TEXT NOT NULL DEFAULT 'queued',
    error_message TEXT,
    audio_duration_sec REAL,
    voice TEXT,
    tts_model TEXT,
    speed REAL,
    tags TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS articles_fts_content (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    title TEXT,
    author TEXT,
    publication TEXT,
    full_text TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
    title,
    author,
    publication,
    full_text,
    content='articles_fts_content',
    content_rowid='rowid'
);

CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class Store:
    def __init__(self, base_dir: Path = Path("~/.readcast").expanduser()):
        self.base_dir = base_dir.expanduser()
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.articles_dir = self.base_dir / "articles"
        self.output_dir = self.base_dir / "output"
        self.feed_dir = self.base_dir / "feed"
        self.db_path = self.base_dir / "index.db"
        for directory in (self.articles_dir, self.output_dir, self.feed_dir):
            directory.mkdir(parents=True, exist_ok=True)
        self._initialize_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    _MIGRATION_COLUMNS = [
        ("description", "TEXT"),
        ("image_url", "TEXT"),
        ("canonical_url", "TEXT"),
        ("site_name", "TEXT"),
    ]

    def _initialize_db(self) -> None:
        with closing(self._connect()) as conn:
            conn.executescript(SCHEMA)
            self._migrate(conn)
            conn.commit()

    def _migrate(self, conn: sqlite3.Connection) -> None:
        existing = {row[1] for row in conn.execute("PRAGMA table_info(articles)").fetchall()}
        for col_name, col_type in self._MIGRATION_COLUMNS:
            if col_name not in existing:
                conn.execute(f"ALTER TABLE articles ADD COLUMN {col_name} {col_type}")

    def add_article(self, article: Article, chunks: list[Chunk], full_text: str) -> bool:
        article_dir = self.get_article_dir(article.id)
        try:
            with closing(self._connect()) as conn:
                conn.execute(
                    """
                    INSERT INTO articles (
                        id, source_url, source_file, title, author, publication, published_date,
                        ingested_at, word_count, estimated_read_min,
                        description, image_url, canonical_url, site_name,
                        language, status,
                        error_message, audio_duration_sec, voice, tts_model, speed, tags
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        article.id,
                        article.source_url,
                        article.source_file,
                        article.title,
                        article.author,
                        article.publication,
                        article.published_date,
                        article.ingested_at,
                        article.word_count,
                        article.estimated_read_min,
                        article.description,
                        article.image_url,
                        article.canonical_url,
                        article.site_name,
                        article.language,
                        article.status,
                        article.error_message,
                        article.audio_duration_sec,
                        article.voice,
                        article.tts_model,
                        article.speed,
                        json.dumps(article.tags),
                    ),
                )
                cursor = conn.execute(
                    """
                    INSERT INTO articles_fts_content (article_id, title, author, publication, full_text)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        article.id,
                        article.title,
                        article.author,
                        article.publication,
                        full_text,
                    ),
                )
                rowid = cursor.lastrowid
                conn.execute(
                    """
                    INSERT INTO articles_fts(rowid, title, author, publication, full_text)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (rowid, article.title, article.author, article.publication, full_text),
                )
                conn.commit()
        except sqlite3.IntegrityError:
            return False

        self._write_json(article_dir / "meta.json", article.to_dict())
        self._write_text(article_dir / "source.txt", full_text)
        self._write_json(article_dir / "chunks.json", [chunk.to_dict() for chunk in chunks])
        return True

    def get_article(self, article_id: str) -> Optional[Article]:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT * FROM articles WHERE id = ?", (article_id,)).fetchone()
        return self._row_to_article(row) if row else None

    def list_articles(self, status: Optional[str] = None, limit: int = 50) -> list[Article]:
        query = "SELECT * FROM articles"
        params: list[object] = []
        if status:
            query += " WHERE status = ?"
            params.append(status)
        query += " ORDER BY ingested_at DESC LIMIT ?"
        params.append(limit)
        with closing(self._connect()) as conn:
            rows = conn.execute(query, params).fetchall()
        return [self._row_to_article(row) for row in rows]

    def update_status(self, article_id: str, status: str, error_message: Optional[str] = None) -> None:
        with closing(self._connect()) as conn:
            conn.execute(
                "UPDATE articles SET status = ?, error_message = ? WHERE id = ?",
                (status, error_message, article_id),
            )
            conn.commit()

    def update_audio_metadata(self, article_id: str, duration_sec: float, voice: str, model: str, speed: float) -> None:
        with closing(self._connect()) as conn:
            conn.execute(
                """
                UPDATE articles
                SET audio_duration_sec = ?, voice = ?, tts_model = ?, speed = ?, status = ?, error_message = NULL
                WHERE id = ?
                """,
                (duration_sec, voice, model, speed, "done", article_id),
            )
            conn.commit()

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
        with closing(self._connect()) as conn:
            rows = conn.execute(
                """
                SELECT a.*
                FROM articles_fts
                JOIN articles_fts_content c ON c.rowid = articles_fts.rowid
                JOIN articles a ON a.id = c.article_id
                WHERE articles_fts MATCH ?
                ORDER BY bm25(articles_fts)
                LIMIT ?
                """,
                (query, limit),
            ).fetchall()
        return [self._row_to_article(row) for row in rows]

    def get_queued(self) -> list[Article]:
        with closing(self._connect()) as conn:
            rows = conn.execute(
                "SELECT * FROM articles WHERE status = 'queued' ORDER BY ingested_at ASC"
            ).fetchall()
        return [self._row_to_article(row) for row in rows]

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

        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT rowid FROM articles_fts_content WHERE article_id = ?", (article_id,)
            ).fetchone()
            if row:
                conn.execute("DELETE FROM articles_fts WHERE rowid = ?", (row["rowid"],))
                conn.execute("DELETE FROM articles_fts_content WHERE rowid = ?", (row["rowid"],))

            article = self._row_to_article(
                conn.execute("SELECT * FROM articles WHERE id = ?", (article_id,)).fetchone()
            )
            cursor = conn.execute(
                """
                INSERT INTO articles_fts_content (article_id, title, author, publication, full_text)
                VALUES (?, ?, ?, ?, ?)
                """,
                (article_id, article.title, article.author, article.publication, full_text),
            )
            rowid = cursor.lastrowid
            conn.execute(
                """
                INSERT INTO articles_fts(rowid, title, author, publication, full_text)
                VALUES (?, ?, ?, ?, ?)
                """,
                (rowid, article.title, article.author, article.publication, full_text),
            )
            conn.commit()

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

        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT rowid FROM articles_fts_content WHERE article_id = ?", (article_id,)
            ).fetchone()
            if row:
                conn.execute("DELETE FROM articles_fts WHERE rowid = ?", (row["rowid"],))
                conn.execute("DELETE FROM articles_fts_content WHERE rowid = ?", (row["rowid"],))
            conn.execute("DELETE FROM articles WHERE id = ?", (article_id,))
            conn.commit()

        article_dir = self.articles_dir / article_id
        if article_dir.exists():
            shutil.rmtree(article_dir)

        for path in self.output_dir.iterdir():
            if path.is_symlink() and path.resolve().parent == article_dir:
                path.unlink()
        return True

    def update_article(self, article: Article) -> None:
        with closing(self._connect()) as conn:
            conn.execute(
                """
                UPDATE articles
                SET title = ?, author = ?, publication = ?, published_date = ?, word_count = ?,
                    estimated_read_min = ?,
                    description = ?, image_url = ?, canonical_url = ?, site_name = ?,
                    language = ?, status = ?, error_message = ?,
                    audio_duration_sec = ?, voice = ?, tts_model = ?, speed = ?, tags = ?
                WHERE id = ?
                """,
                (
                    article.title,
                    article.author,
                    article.publication,
                    article.published_date,
                    article.word_count,
                    article.estimated_read_min,
                    article.description,
                    article.image_url,
                    article.canonical_url,
                    article.site_name,
                    article.language,
                    article.status,
                    article.error_message,
                    article.audio_duration_sec,
                    article.voice,
                    article.tts_model,
                    article.speed,
                    json.dumps(article.tags),
                    article.id,
                ),
            )
            conn.commit()
        self._write_json(self.get_article_dir(article.id) / "meta.json", article.to_dict())

    def _row_to_article(self, row: sqlite3.Row) -> Article:
        payload = dict(row)
        payload["tags"] = json.loads(payload.get("tags") or "[]")
        for col in ("description", "image_url", "canonical_url", "site_name"):
            payload.setdefault(col, None)
        return Article.from_dict(payload)

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
