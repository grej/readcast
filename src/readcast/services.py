from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import hashlib
import logging
import math
from pathlib import Path
import re
import shutil
import threading
from typing import Callable, Optional, Protocol

from .core.chunker import create_tts_segments
from .core.config import Config
from .core.extractor import ExtractionError, extract
from .core.models import Article, Chunk
from .core.store import Store
from .core.synthesizer import (
    ProgressCallback,
    ServerError,
    audio_duration,
    synthesize,
)
from .core.tts import endpoint_label, load_shared_tts_client, load_shared_tts_collaborators, load_shared_tts_runtime

log = logging.getLogger(__name__)


class TTSClientProtocol(Protocol):
    def server_status(self) -> dict[str, object]: ...
    def fetch_voices(self) -> list[dict[str, object]]: ...
    def synthesize_text(self, text: str, **kwargs: object) -> bytes: ...


class TTSRuntimeProtocol(Protocol):
    def ensure_running(self) -> dict[str, object]: ...
    def start(self) -> dict[str, object]: ...
    def stop(self) -> bool: ...


@dataclass(slots=True)
class AddArticleResult:
    article: Article
    created: bool


@dataclass(slots=True)
class PreviewResult:
    article: Article
    chunks: list[Chunk]
    full_text: str


@dataclass(slots=True)
class ProcessArticleResult:
    article: Article
    success: bool
    output_path: Optional[Path] = None
    link_path: Optional[Path] = None
    error: Optional[str] = None


class ReadcastService:
    DEFAULT_VOICE_SETTING_KEY = "default_voice"
    PLAYBACK_RATE_SETTING_KEY = "playback_rate"
    PLAYBACK_RATES = (1.0, 1.25, 1.5, 1.75, 2.0)
    PENDING_AUDIO_STATES = frozenset({"queued", "generating"})

    def __init__(
        self,
        config: Config,
        store: Optional[Store] = None,
        tts_client: Optional[TTSClientProtocol] = None,
        tts_runtime: Optional[TTSRuntimeProtocol] = None,
    ):
        self.config = config
        self.store = store or Store(config.base_dir)
        self.tts_client = tts_client
        self.tts_runtime = tts_runtime

    def list_articles(self, status: Optional[str] = None, limit: int = 500) -> list[Article]:
        return self.store.list_articles(status=status, limit=limit)

    def search_articles(self, query: str, limit: int = 20) -> list[Article]:
        return self.store.search(query, limit=limit)

    def get_article(self, article_id: str) -> Optional[Article]:
        return self.store.get_article(article_id)

    def list_deleted_articles(self, limit: int = 500) -> list[Article]:
        return self.store.list_deleted_articles(limit=limit)

    def get_deleted_article(self, article_id: str) -> Optional[Article]:
        return self.store.get_deleted_article(article_id)

    def delete_article(self, article_id: str) -> bool:
        article = self.store.get_article(article_id)
        if article is None:
            return False
        if article.status in {"queued", "synthesizing"}:
            article.status = "added"
            article.error_message = None
            self.store.update_article(article)
            self.store.clear_rendition(article_id, "audio")
        return self.store.delete_article(article_id)

    def restore_article(self, article_id: str) -> Optional[Article]:
        if not self.store.restore_article(article_id):
            return None
        return self.store.get_article(article_id)

    def permanently_delete_article(self, article_id: str) -> bool:
        return self.store.permanently_delete_article(article_id)

    def empty_trash(self) -> int:
        return self.store.empty_trash()

    def default_voice(self) -> str:
        return self.store.get_setting(self.DEFAULT_VOICE_SETTING_KEY) or self.config.tts.voice

    def playback_rate(self) -> float:
        raw = self.store.get_setting(self.PLAYBACK_RATE_SETTING_KEY)
        try:
            value = float(raw) if raw is not None else 1.0
        except (TypeError, ValueError):
            value = 1.0
        return value if value in self.PLAYBACK_RATES else 1.0

    def set_default_voice(self, voice: str) -> str:
        available = {item["name"] for item in self.available_voices() if isinstance(item.get("name"), str)}
        if available and voice not in available:
            raise ValueError(f"Voice '{voice}' is not available.")
        self.store.set_setting(self.DEFAULT_VOICE_SETTING_KEY, voice)
        return voice

    def set_playback_rate(self, rate: float) -> float:
        try:
            value = float(rate)
        except (TypeError, ValueError) as exc:
            raise ValueError("Playback rate must be numeric.") from exc
        if value not in self.PLAYBACK_RATES:
            supported = ", ".join(f"{item:.2g}x" for item in self.PLAYBACK_RATES)
            raise ValueError(f"Playback rate must be one of: {supported}.")
        self.store.set_setting(self.PLAYBACK_RATE_SETTING_KEY, str(value))
        return value

    def preview_input(self, input_value: str) -> PreviewResult:
        stripped = input_value.strip()
        if not stripped:
            raise ExtractionError("Input text is empty.")
        if stripped.startswith(("http://", "https://")):
            article, chunks = extract(stripped, self.config)
        else:
            article, chunks = self._build_text_article(stripped)
        full_text = "\n\n".join(chunk.text for chunk in chunks)
        return PreviewResult(article=article, chunks=chunks, full_text=full_text)

    def update_article_metadata(
        self,
        article_id: str,
        title: Optional[str] = None,
        author: Optional[str] = None,
        publication: Optional[str] = None,
        published_date: Optional[str] = None,
        description: Optional[str] = None,
        tags: Optional[list[str]] = None,
    ) -> Article:
        article = self._require_article(article_id)
        if title is not None:
            article.title = title
        if author is not None:
            article.author = author
        if publication is not None:
            article.publication = publication
        if published_date is not None:
            article.published_date = published_date
        if description is not None:
            article.description = description
        if tags is not None:
            article.tags = tags
        self.store.update_article(article)
        return article

    def update_article_text(self, article_id: str, new_text: str) -> Article:
        article = self._require_article(article_id)
        paragraphs = [part.strip() for part in re.split(r"\n\s*\n+", new_text) if part.strip()]
        chunks = [Chunk(idx=0, chunk_type="title", text=article.title, html_tag="title")]
        for idx, paragraph in enumerate(paragraphs, start=1):
            normalized = re.sub(r"\s+", " ", paragraph).strip()
            if normalized:
                chunks.append(Chunk(idx=idx, chunk_type="paragraph", text=normalized, html_tag="text"))

        full_text = "\n\n".join(chunk.text for chunk in chunks)
        article.word_count = sum(len(chunk.text.split()) for chunk in chunks)
        article.estimated_read_min = max(1, math.ceil(article.word_count / 238))
        self.store.update_article(article)
        self.store.update_full_text(article_id, full_text, chunks)

        # Re-embed after text change
        try:
            self.store.embed_article(article_id)
        except Exception:
            log.debug("Embedding failed for %s", article_id, exc_info=True)

        return article

    def retry_article(self, article_id: str) -> Article:
        article = self._require_article(article_id)
        article.status = "queued"
        article.error_message = None
        self.store.update_article(article)
        self._set_audio_rendition(article, "queued")
        return article

    def cancel_article(self, article_id: str) -> Article:
        """Cancel a queued or in-progress synthesis. Sets status to 'added' so worker skips it."""
        article = self._require_article(article_id)
        if article.status not in ("queued", "synthesizing"):
            raise ValueError(f"Cannot cancel article with status '{article.status}'")
        article.status = "added"
        article.error_message = None
        self.store.update_article(article)
        self.store.clear_rendition(article_id, "audio")
        return article

    def remove_audio(self, article_id: str) -> Article:
        """Remove audio files for an article without deleting the article itself."""
        article = self._require_article(article_id)
        article_dir = self.store.get_article_dir(article_id)

        # Remove audio files
        for ext in ("mp3", "m4a", "wav"):
            audio_file = article_dir / f"audio.{ext}"
            if audio_file.exists():
                audio_file.unlink()

        # Remove segments dir if it exists
        self._cleanup_segments(article_dir)

        # Remove output symlinks pointing to this article
        for path in self.store.output_dir.iterdir():
            if path.is_symlink():
                try:
                    if path.resolve().parent == article_dir:
                        path.unlink()
                except OSError:
                    pass

        # Reset audio metadata
        article.audio_duration_sec = None
        article.status = "added"
        article.error_message = None
        self.store.update_article(article)
        self.store.clear_rendition(article_id, "audio")
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
        self._set_audio_rendition(article, "queued")
        return article

    def recover_interrupted_audio_jobs(self) -> int:
        """Reconcile audio jobs left nonterminal by a prior process shutdown."""
        reconciled = 0
        for article in self.store.list_articles(limit=1000):
            audio = self.store.get_renditions(article.id).get("audio")
            audio_state = audio.get("state") if isinstance(audio, dict) else None
            interrupted = article.status == "synthesizing" or (
                article.status == "failed" and audio_state in self.PENDING_AUDIO_STATES
            )

            if interrupted:
                self.store.update_status(article.id, "queued")
                article.status = "queued"
                article.error_message = None
                self._set_audio_rendition(article, "queued")
                reconciled += 1
                continue

            if article.status == "queued" and audio_state == "generating":
                self._set_audio_rendition(article, "queued")
                reconciled += 1
                continue

            if article.status == "done" and audio_state in self.PENDING_AUDIO_STATES:
                audio_path = self.audio_path_for_article(article.id)
                if audio_path is not None and article.audio_duration_sec is not None:
                    self._set_audio_rendition(
                        article,
                        "ready",
                        duration=article.audio_duration_sec,
                        generated_at=audio.get("generated_at") if isinstance(audio, dict) else None,
                    )
                    reconciled += 1

        return reconciled

    def add_source(
        self,
        source: str,
        voice: Optional[str] = None,
        speed: Optional[float] = None,
        tags: Optional[list[str]] = None,
        html: Optional[str] = None,
    ) -> AddArticleResult:
        article, chunks = extract(source, self.config, html=html)
        return self._store_article(article, chunks, voice=voice, speed=speed, tags=tags)

    def add_input(
        self,
        input_value: str,
        voice: Optional[str] = None,
        speed: Optional[float] = None,
        tags: Optional[list[str]] = None,
        html: Optional[str] = None,
        source_url: Optional[str] = None,
        author: Optional[str] = None,
        published_date: Optional[str] = None,
    ) -> AddArticleResult:
        stripped = input_value.strip()
        if stripped.startswith(("http://", "https://")):
            return self.add_source(stripped, voice=voice, speed=speed, tags=tags, html=html)
        return self.add_text(
            stripped, voice=voice, speed=speed, tags=tags,
            source_url=source_url, author=author, published_date=published_date,
        )

    def add_text(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: Optional[float] = None,
        tags: Optional[list[str]] = None,
        duplicate_window_sec: int = 5,
        source_url: Optional[str] = None,
        author: Optional[str] = None,
        published_date: Optional[str] = None,
    ) -> AddArticleResult:
        normalized_text = text.strip()
        if not normalized_text:
            raise ExtractionError("Input text is empty.")

        existing = self._find_recent_text_duplicate(normalized_text, within_seconds=duplicate_window_sec)
        if existing is not None:
            return AddArticleResult(article=existing, created=False)

        article, chunks = self._build_text_article(normalized_text)
        if source_url:
            article.source_url = source_url
        if author:
            article.author = author
        if published_date:
            article.published_date = published_date
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

        self.ensure_server_running()
        results: list[ProcessArticleResult] = []
        for article in articles:
            progress = progress_factory(article) if progress_factory else None
            results.append(self._process_article(article, progress=progress))
        return results

    def available_voices(self) -> list[dict[str, object]]:
        client = self._ensure_tts_collaborators()[0]
        try:
            return client.fetch_voices()
        except Exception as exc:
            raise ServerError(f"Failed to fetch kokoro-edge voices at {self.tts_endpoint()}: {exc}") from exc

    def daemon_status(self) -> dict[str, object]:
        client = self._ensure_tts_collaborators()[0]
        try:
            return client.server_status()
        except Exception as exc:
            raise ServerError(f"kokoro-edge status failed at {self.tts_endpoint()}: {exc}") from exc

    def ensure_tts_running(self) -> dict[str, object]:
        runtime = self._ensure_tts_collaborators()[1]
        try:
            return runtime.ensure_running()
        except Exception as exc:
            if isinstance(exc, ServerError):
                raise
            raise ServerError(f"kokoro-edge could not become ready at {self.tts_endpoint()}: {exc}") from exc

    def ensure_server_running(self) -> dict[str, object]:
        return self.ensure_tts_running()

    def start_tts(self) -> dict[str, object]:
        runtime = self._ensure_tts_collaborators()[1]
        try:
            return runtime.start()
        except Exception as exc:
            if isinstance(exc, ServerError):
                raise
            raise ServerError(f"kokoro-edge could not start at {self.tts_endpoint()}: {exc}") from exc

    def stop_tts(self) -> bool:
        runtime = self._ensure_tts_collaborators()[1]
        try:
            return bool(runtime.stop())
        except Exception as exc:
            if isinstance(exc, ServerError):
                raise
            raise ServerError(f"kokoro-edge could not stop at {self.tts_endpoint()}: {exc}") from exc

    def start_server(self) -> dict[str, object]:
        return self.start_tts()

    def stop_server(self) -> bool:
        return self.stop_tts()

    def tts_endpoint(self) -> str:
        return endpoint_label(self.tts_client, self.tts_runtime)

    def tts_binary_available(self) -> bool:
        try:
            runtime = self._ensure_tts_collaborators()[1]
        except ServerError:
            return False
        checker = getattr(runtime, "binary_available", None)
        if not callable(checker):
            return True
        try:
            return bool(checker())
        except Exception:
            return False

    def _ensure_tts_collaborators(self) -> tuple[TTSClientProtocol, TTSRuntimeProtocol]:
        try:
            if self.tts_client is None and self.tts_runtime is None:
                self.tts_client, self.tts_runtime = load_shared_tts_collaborators()
            elif self.tts_client is None:
                self.tts_client = load_shared_tts_client()
            elif self.tts_runtime is None:
                self.tts_runtime = load_shared_tts_runtime()
        except Exception as exc:
            raise ServerError(str(exc)) from exc
        return self.tts_client, self.tts_runtime

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
        article.voice = voice if voice is not None else self.default_voice()
        if speed is not None:
            article.speed = speed
        full_text = "\n\n".join(chunk.text for chunk in chunks)
        created = self.store.add_article(article, chunks, full_text)
        if not created:
            existing = self.store.get_article(article.id)
            if existing is None and article.source_url:
                existing = self.store.get_article_by_source_url(article.source_url)
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
        current = self._require_article(article.id)
        self._set_audio_rendition(current, "generating")

        try:
            chunks = self.store.get_chunks(article.id)
            segments = create_tts_segments(chunks, max_chars=self.config.tts.max_chunk_chars)
            article_dir = self.store.get_article_dir(article.id)
            output_path = synthesize(
                segments,
                article_dir,
                self.config,
                progress=progress,
                tts_client=self._ensure_tts_collaborators()[0],
            )
            current = self.store.get_article(article.id)
            if current is None:
                self._cleanup_segments(article_dir)
                return ProcessArticleResult(
                    article=article,
                    success=False,
                    output_path=output_path,
                    error="Article was moved to Trash during synthesis.",
                )
            duration = audio_duration(output_path)
            voice = current.voice or self.default_voice()
            speed = current.speed if current.speed is not None else self.config.tts.speed
            self.store.update_audio_metadata(article.id, duration, voice, self.config.tts.model, speed)
            latest = self._require_article(article.id)
            self._set_audio_rendition(latest, "ready", duration=duration, generated_at=datetime.now(UTC).isoformat())
            link_path = self.store.create_output_symlink(latest, output_path)
            self._cleanup_segments(article_dir)
            return ProcessArticleResult(article=latest, success=True, output_path=output_path, link_path=link_path)
        except Exception as exc:
            message = str(exc)
            if self.store.get_article(article.id) is None:
                self._cleanup_segments(self.store.get_article_dir(article.id))
                return ProcessArticleResult(article=article, success=False, error="Article was moved to Trash during synthesis.")
            self.store.update_status(article.id, "failed", message)
            failed = self._require_article(article.id)
            self._set_audio_rendition(failed, "failed", error=message)
            return ProcessArticleResult(article=failed, success=False, error=message)

    def _set_audio_rendition(
        self,
        article: Article,
        state: str,
        *,
        duration: Optional[float] = None,
        generated_at: Optional[str] = None,
        error: Optional[str] = None,
    ) -> None:
        self.store.set_rendition(
            article.id,
            "audio",
            {
                "state": state,
                "voice": article.voice or self.default_voice(),
                "duration": duration,
                "generated_at": generated_at,
                "error": error,
            },
        )

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
        self._cancelled: set[str] = set()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        reconciled = self.service.recover_interrupted_audio_jobs()
        if reconciled:
            log.info("Reconciled %d interrupted audio job(s)", reconciled)
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

    def cancel(self, article_id: str) -> None:
        self._cancelled.add(article_id)

    def resume(self, article_id: str) -> None:
        self._cancelled.discard(article_id)

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
                article = queued[0]
                if article.id in self._cancelled:
                    self._cancelled.discard(article.id)
                    try:
                        self.service.cancel_article(article.id)
                    except (KeyError, ValueError):
                        pass
                    continue
                try:
                    self.service.process_articles([article])
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
