from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import hashlib
import math
from pathlib import Path
import re
import shutil
import threading
from typing import Callable, Optional

from .core.chunker import create_tts_segments
from .core.config import Config
from .core.extractor import ExtractionError, extract
from .core.models import Article, Chunk
from .core.store import Store
from .core.synthesizer import (
    ProgressCallback,
    ServerError,
    audio_duration,
    ensure_server_running,
    fetch_server_status,
    synthesize,
)


@dataclass(slots=True)
class AddArticleResult:
    article: Article
    created: bool


@dataclass(slots=True)
class ProcessArticleResult:
    article: Article
    success: bool
    output_path: Optional[Path] = None
    link_path: Optional[Path] = None
    error: Optional[str] = None


class ReadcastService:
    def __init__(self, config: Config, store: Optional[Store] = None):
        self.config = config
        self.store = store or Store(config.base_dir)

    def list_articles(self, status: Optional[str] = None, limit: int = 500) -> list[Article]:
        return self.store.list_articles(status=status, limit=limit)

    def search_articles(self, query: str, limit: int = 20) -> list[Article]:
        return self.store.search(query, limit=limit)

    def get_article(self, article_id: str) -> Optional[Article]:
        return self.store.get_article(article_id)

    def delete_article(self, article_id: str) -> bool:
        return self.store.delete_article(article_id)

    def retry_article(self, article_id: str) -> Article:
        article = self._require_article(article_id)
        article.status = "queued"
        article.error_message = None
        self.store.update_article(article)
        return article

    def reprocess_article(self, article_id: str, voice: Optional[str] = None, speed: Optional[float] = None) -> Article:
        article = self._require_article(article_id)
        if voice is not None:
            article.voice = voice
        if speed is not None:
            article.speed = speed
        article.status = "queued"
        article.error_message = None
        self.store.update_article(article)
        return article

    def add_source(
        self,
        source: str,
        voice: Optional[str] = None,
        speed: Optional[float] = None,
        tags: Optional[list[str]] = None,
    ) -> AddArticleResult:
        article, chunks = extract(source, self.config)
        return self._store_article(article, chunks, voice=voice, speed=speed, tags=tags)

    def add_input(
        self,
        input_value: str,
        voice: Optional[str] = None,
        speed: Optional[float] = None,
        tags: Optional[list[str]] = None,
    ) -> AddArticleResult:
        stripped = input_value.strip()
        if stripped.startswith(("http://", "https://")):
            return self.add_source(stripped, voice=voice, speed=speed, tags=tags)
        return self.add_text(stripped, voice=voice, speed=speed, tags=tags)

    def add_text(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: Optional[float] = None,
        tags: Optional[list[str]] = None,
        duplicate_window_sec: int = 5,
    ) -> AddArticleResult:
        normalized_text = text.strip()
        if not normalized_text:
            raise ExtractionError("Input text is empty.")

        existing = self._find_recent_text_duplicate(normalized_text, within_seconds=duplicate_window_sec)
        if existing is not None:
            return AddArticleResult(article=existing, created=False)

        article, chunks = self._build_text_article(normalized_text)
        return self._store_article(article, chunks, voice=voice, speed=speed, tags=tags)

    def process_queued(
        self,
        limit: Optional[int] = None,
        progress_factory: Optional[Callable[[Article], Optional[ProgressCallback]]] = None,
    ) -> list[ProcessArticleResult]:
        articles = self.store.get_queued()
        if limit is not None:
            articles = articles[:limit]
        return self.process_articles(articles, progress_factory=progress_factory)

    def process_articles(
        self,
        articles: list[Article],
        progress_factory: Optional[Callable[[Article], Optional[ProgressCallback]]] = None,
    ) -> list[ProcessArticleResult]:
        if not articles:
            return []

        ensure_server_running(self.config)
        results: list[ProcessArticleResult] = []
        for article in articles:
            progress = progress_factory(article) if progress_factory else None
            results.append(self._process_article(article, progress=progress))
        return results

    def available_voices(self) -> list[dict[str, object]]:
        from .core.synthesizer import fetch_voices

        return fetch_voices(self.config)

    def daemon_status(self) -> dict[str, object]:
        return fetch_server_status(self.config)

    def audio_path_for_article(self, article_id: str) -> Optional[Path]:
        article_dir = self.store.get_article_dir(article_id)
        for extension in ("mp3", "m4a"):
            candidate = article_dir / f"audio.{extension}"
            if candidate.exists():
                return candidate
        return None

    def queued_count(self) -> int:
        return len(self.store.get_queued())

    def _store_article(
        self,
        article: Article,
        chunks: list[Chunk],
        voice: Optional[str],
        speed: Optional[float],
        tags: Optional[list[str]],
    ) -> AddArticleResult:
        article.tags = list(tags or [])
        if voice is not None:
            article.voice = voice
        if speed is not None:
            article.speed = speed
        full_text = "\n\n".join(chunk.text for chunk in chunks)
        created = self.store.add_article(article, chunks, full_text)
        if not created:
            existing = self.store.get_article(article.id)
            if existing is None:
                raise RuntimeError(f"Article {article.id} reported duplicate but was not found in the store.")
            return AddArticleResult(article=existing, created=False)

        self.store.update_article(article)
        stored = self.store.get_article(article.id)
        if stored is None:
            raise RuntimeError(f"Stored article {article.id} could not be loaded after insertion.")
        return AddArticleResult(article=stored, created=True)

    def _process_article(self, article: Article, progress: Optional[ProgressCallback] = None) -> ProcessArticleResult:
        self.store.update_status(article.id, "synthesizing")
        chunks = self.store.get_chunks(article.id)
        segments = create_tts_segments(chunks, max_chars=self.config.tts.max_chunk_chars)
        article_dir = self.store.get_article_dir(article.id)

        try:
            output_path = synthesize(segments, article_dir, self.config, progress=progress)
        except Exception as exc:
            message = str(exc)
            self.store.update_status(article.id, "failed", message)
            return ProcessArticleResult(article=self._require_article(article.id), success=False, error=message)

        current = self._require_article(article.id)
        duration = audio_duration(output_path)
        voice = current.voice or self.config.tts.voice
        speed = current.speed if current.speed is not None else self.config.tts.speed
        self.store.update_audio_metadata(article.id, duration, voice, self.config.tts.model, speed)
        latest = self._require_article(article.id)
        link_path = self.store.create_output_symlink(latest, output_path)
        self._cleanup_segments(article_dir)
        return ProcessArticleResult(article=latest, success=True, output_path=output_path, link_path=link_path)

    def _require_article(self, article_id: str) -> Article:
        article = self.store.get_article(article_id)
        if article is None:
            raise KeyError(article_id)
        return article

    def _build_text_article(self, text: str) -> tuple[Article, list[Chunk]]:
        ingested_at = datetime.now(UTC).isoformat()
        title = _derive_text_title(text)
        paragraphs = [part.strip() for part in re.split(r"\n\s*\n+", text) if part.strip()]
        if paragraphs and paragraphs[0].strip() == title and len(paragraphs) > 1:
            paragraphs = paragraphs[1:]

        chunks = [Chunk(idx=0, chunk_type="title", text=title, html_tag="title")]
        for idx, paragraph in enumerate(paragraphs, start=1):
            normalized = re.sub(r"\s+", " ", paragraph).strip()
            if normalized:
                chunks.append(Chunk(idx=idx, chunk_type="paragraph", text=normalized, html_tag="text"))

        if len(chunks) == 1:
            raise ExtractionError("Input text did not contain any readable content.")

        body_text = "\n\n".join(chunk.text for chunk in chunks[1:])
        article_id = hashlib.sha256(f"text:{body_text}:{ingested_at}".encode("utf-8")).hexdigest()[:8]
        word_count = sum(len(chunk.text.split()) for chunk in chunks)
        article = Article(
            id=article_id,
            source_url=None,
            source_file=None,
            title=title,
            author=None,
            publication=None,
            published_date=None,
            ingested_at=ingested_at,
            word_count=word_count,
            estimated_read_min=max(1, math.ceil(word_count / 238)),
            language="en",
            status="queued",
        )
        return article, chunks

    def _cleanup_segments(self, article_dir: Path) -> None:
        segments_dir = article_dir / "segments"
        if not segments_dir.exists():
            return
        try:
            shutil.rmtree(segments_dir)
        except OSError:
            return

    def _find_recent_text_duplicate(self, text: str, within_seconds: int) -> Optional[Article]:
        threshold = datetime.now(UTC) - timedelta(seconds=within_seconds)
        normalized_input = text.strip()
        for article in self.store.list_articles(limit=50):
            if article.source_url is not None or article.source_file is not None:
                continue
            try:
                ingested_at = datetime.fromisoformat(article.ingested_at)
            except ValueError:
                continue
            if ingested_at < threshold:
                continue
            full_text = self.store.get_full_text(article.id)
            if full_text and full_text.strip() == normalized_input:
                return article
        return None


class ProcessingWorker:
    def __init__(self, service: ReadcastService):
        self.service = service
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="readcast-worker", daemon=True)
        self._thread.start()
        if self.service.queued_count():
            self.kick()

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=timeout)

    def kick(self) -> None:
        self._wake.set()

    def is_running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def _run(self) -> None:
        while not self._stop.is_set():
            self._wake.wait(timeout=0.5)
            self._wake.clear()
            while not self._stop.is_set():
                queued = self.service.store.get_queued()
                if not queued:
                    break
                try:
                    self.service.process_articles(queued[:1])
                except ServerError:
                    break


def _derive_text_title(text: str, limit: int = 80) -> str:
    for line in text.splitlines():
        stripped = " ".join(line.split())
        if not stripped:
            continue
        if len(stripped) <= limit:
            return stripped
        return stripped[: limit - 3].rstrip() + "..."
    return "Untitled Note"
