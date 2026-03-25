from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from email.utils import format_datetime
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urljoin
from xml.sax.saxutils import escape

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

log = logging.getLogger(__name__)

from readcast import __version__
from readcast.core.config import Config
from readcast.core.llm import complete as llm_complete, ensure_llm_running, llm_status as get_llm_status, stop_llm_server
from readcast.core.models import Article
from readcast.core.synthesizer import (
    ServerError,
    SynthesisError,
    ensure_server_running,
    resolve_kokoro_edge_binary,
)
from readcast.services import PreviewResult, ProcessingWorker, ReadcastService


STATIC_DIR = Path(__file__).resolve().parents[1] / "web" / "static"
EXTENSION_DIR = Path(__file__).resolve().parents[1] / "web" / "extension"


class AddArticleRequest(BaseModel):
    input: str = Field(min_length=1)
    html: Optional[str] = None
    source_url: Optional[str] = None
    author: Optional[str] = None
    published_date: Optional[str] = None
    voice: Optional[str] = None
    speed: Optional[float] = None
    process: bool = True


class PreviewRequest(BaseModel):
    input: str = Field(min_length=1)


class ReprocessRequest(BaseModel):
    voice: Optional[str] = None
    speed: Optional[float] = None


class UpdateArticleRequest(BaseModel):
    title: Optional[str] = None
    author: Optional[str] = None
    publication: Optional[str] = None
    published_date: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[list[str]] = None


class UpdateTextRequest(BaseModel):
    text: str = Field(min_length=1)


class PreferencesRequest(BaseModel):
    default_voice: Optional[str] = Field(default=None, min_length=1)
    playback_rate: Optional[float] = None


class LLMCompleteRequest(BaseModel):
    messages: list[dict] = Field(min_length=1)
    max_tokens: Optional[int] = 1024
    temperature: Optional[float] = 0.3


class PluginRunRequest(BaseModel):
    plugin_name: str = Field(min_length=1)
    scraped_data: Any = None
    prompt_template: Optional[str] = None
    process: bool = True


class CreateListRequest(BaseModel):
    name: str = Field(min_length=1)
    type: str = Field(pattern="^(collection|todo|playlist)$")
    icon: str = "📋"
    color: Optional[str] = None
    bg: Optional[str] = None


class UpdateListRequest(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    bg: Optional[str] = None


class ReorderRequest(BaseModel):
    ids: list[str] = Field(min_length=1)


class AddListItemRequest(BaseModel):
    doc_id: str = Field(min_length=1)
    due: Optional[str] = None
    use_summary: bool = False
    ai_suggested_due: bool = False


class UpdateListItemRequest(BaseModel):
    done: Optional[bool] = None
    due: Optional[str] = None
    position: Optional[int] = None
    use_summary: Optional[bool] = None
    ai_suggested_due: Optional[bool] = None


class GenerateAudioRequest(BaseModel):
    voice: Optional[str] = None


def create_app(base_dir: Optional[Path] = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        config = Config.load(base_dir)
        service = ReadcastService(config)
        worker = ProcessingWorker(service)
        app.state.config = config
        app.state.service = service
        app.state.worker = worker
        worker.start()
        yield
        worker.stop()
        stop_llm_server(config)

    app = FastAPI(title="readcast", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["*"],
    )
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.post("/api/preview")
    async def preview_article(request: Request, payload: PreviewRequest) -> dict[str, object]:
        service = _service(request)
        try:
            preview = service.preview_input(payload.input)
        except (ValueError, SynthesisError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"preview": _serialize_preview(preview)}

    @app.get("/api/articles")
    async def list_articles(
        request: Request,
        q: Optional[str] = Query(default=None),
        status: Optional[str] = Query(default=None),
    ) -> dict[str, object]:
        service = _service(request)
        articles = service.search_articles(q, limit=500) if q else service.list_articles(status=status, limit=500)
        return {"articles": [_serialize_article(service, article) for article in articles]}

    @app.get("/api/articles/{article_id}")
    async def get_article(request: Request, article_id: str) -> dict[str, object]:
        service = _service(request)
        article = service.get_article(article_id)
        if article is None:
            raise HTTPException(status_code=404, detail="Article not found")
        return {"article": _serialize_article(service, article)}

    @app.put("/api/articles/{article_id}")
    async def update_article_metadata(
        request: Request,
        article_id: str,
        payload: UpdateArticleRequest,
    ) -> dict[str, object]:
        service = _service(request)
        try:
            article = service.update_article_metadata(
                article_id,
                title=payload.title,
                author=payload.author,
                publication=payload.publication,
                published_date=payload.published_date,
                description=payload.description,
                tags=payload.tags,
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Article not found") from exc
        return {"article": _serialize_article(service, article)}

    @app.put("/api/articles/{article_id}/text")
    async def update_article_text(
        request: Request,
        article_id: str,
        payload: UpdateTextRequest,
    ) -> dict[str, object]:
        service = _service(request)
        try:
            article = service.update_article_text(article_id, payload.text)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Article not found") from exc
        return {"article": _serialize_article(service, article)}

    @app.get("/api/preferences")
    async def get_preferences(request: Request) -> dict[str, object]:
        service = _service(request)
        return {
            "preferences": {
                "default_voice": service.default_voice(),
                "playback_rate": service.playback_rate(),
                "available_playback_rates": list(service.PLAYBACK_RATES),
            }
        }

    @app.post("/api/articles", status_code=201)
    async def add_article(request: Request, payload: AddArticleRequest) -> dict[str, object]:
        service = _service(request)
        worker = _worker(request)
        try:
            result = service.add_input(
                payload.input, voice=payload.voice, speed=payload.speed,
                html=payload.html, source_url=payload.source_url,
                author=payload.author, published_date=payload.published_date,
            )
        except (ValueError, SynthesisError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        if payload.process:
            worker.kick()
        elif result.created:
            # Save-only: mark as "added" so the worker doesn't pick it up for TTS
            result.article.status = "added"
            service.store.update_article(result.article)
        return {"article": _serialize_article(service, result.article), "created": result.created}

    @app.delete("/api/articles/{article_id}", status_code=204)
    async def delete_article(request: Request, article_id: str) -> Response:
        service = _service(request)
        if not service.delete_article(article_id):
            raise HTTPException(status_code=404, detail="Article not found")
        return Response(status_code=204)

    @app.post("/api/articles/{article_id}/cancel")
    async def cancel_article(request: Request, article_id: str) -> dict[str, object]:
        service = _service(request)
        worker = _worker(request)
        try:
            article = service.cancel_article(article_id)
            worker.cancel(article_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Article not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"article": _serialize_article(service, article)}

    @app.delete("/api/articles/{article_id}/audio")
    async def remove_article_audio(request: Request, article_id: str) -> dict[str, object]:
        service = _service(request)
        worker = _worker(request)
        try:
            worker.cancel(article_id)
            article = service.remove_audio(article_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Article not found") from exc
        return {"article": _serialize_article(service, article)}

    @app.post("/api/articles/{article_id}/reprocess")
    async def reprocess_article(
        request: Request,
        article_id: str,
        payload: ReprocessRequest,
    ) -> dict[str, object]:
        service = _service(request)
        worker = _worker(request)
        try:
            article = service.reprocess_article(article_id, voice=payload.voice, speed=payload.speed)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Article not found") from exc
        worker.kick()
        return {"article": _serialize_article(service, article)}

    @app.get("/api/articles/{article_id}/text")
    async def article_text(request: Request, article_id: str) -> dict[str, object]:
        service = _service(request)
        article = service.get_article(article_id)
        if article is None:
            raise HTTPException(status_code=404, detail="Article not found")
        text = service.store.get_full_text(article_id)
        return {"text": text or ""}

    @app.get("/api/articles/{article_id}/audio")
    async def article_audio(request: Request, article_id: str) -> FileResponse:
        service = _service(request)
        path = service.audio_path_for_article(article_id)
        if path is None or not path.exists():
            raise HTTPException(status_code=404, detail="Audio not found")
        media_type = "audio/mp4" if path.suffix.lower() == ".m4a" else "audio/mpeg"
        return FileResponse(path, media_type=media_type, filename=path.name)

    @app.get("/api/status")
    async def api_status(request: Request) -> dict[str, object]:
        service = _service(request)
        worker = _worker(request)

        return {
            "readcast": {"ok": True, "version": __version__},
            "kokoro_edge": _kokoro_status_payload(service),
            "worker": {
                "running": worker.is_running(),
                "queued": service.queued_count(),
            },
        }

    @app.get("/api/voices")
    async def api_voices(request: Request) -> dict[str, object]:
        service = _service(request)
        try:
            ensure_server_running(service.config)
            voices = service.available_voices()
        except (ServerError, SynthesisError) as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return {"voices": voices}

    @app.put("/api/preferences")
    async def update_preferences(request: Request, payload: PreferencesRequest) -> dict[str, object]:
        service = _service(request)
        try:
            if payload.default_voice is None and payload.playback_rate is None:
                raise ValueError("Provide at least one preference value.")
            if payload.default_voice is not None:
                ensure_server_running(service.config)
                service.set_default_voice(payload.default_voice)
            if payload.playback_rate is not None:
                service.set_playback_rate(payload.playback_rate)
        except (ServerError, SynthesisError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {
            "preferences": {
                "default_voice": service.default_voice(),
                "playback_rate": service.playback_rate(),
                "available_playback_rates": list(service.PLAYBACK_RATES),
            }
        }

    # -- LLM endpoints ----------------------------------------------------------

    @app.get("/api/llm/status")
    async def api_llm_status(request: Request) -> dict[str, object]:
        config: Config = request.app.state.config
        return get_llm_status(config)

    @app.post("/api/llm/complete")
    async def api_llm_complete(request: Request, payload: LLMCompleteRequest) -> dict[str, object]:
        config: Config = request.app.state.config
        try:
            ensure_llm_running(config)
            content = llm_complete(
                payload.messages,
                config,
                max_tokens=payload.max_tokens or 1024,
                temperature=payload.temperature if payload.temperature is not None else 0.3,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return {"content": content}

    # -- Plugin endpoints -------------------------------------------------------

    @app.post("/api/plugins/run")
    async def run_plugin(request: Request, payload: PluginRunRequest) -> dict[str, object]:
        config: Config = request.app.state.config
        service = _service(request)
        worker = _worker(request)

        prompt = payload.prompt_template or _default_plugin_prompt(payload.plugin_name)
        import json as _json
        scraped_json = _json.dumps(payload.scraped_data, indent=2, default=str)
        count = len(payload.scraped_data) if isinstance(payload.scraped_data, list) else 1

        messages = [
            {
                "role": "user",
                "content": prompt.replace("{count}", str(count)).replace("{scraped_data_json}", scraped_json),
            }
        ]

        try:
            ensure_llm_running(config)
            analysis = llm_complete(messages, config, max_tokens=2048)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        # If the plugin has a backend extractor (e.g. YouTube transcript), run it
        from readcast.extractors import get_extractor
        extractor = get_extractor(payload.plugin_name)
        transcript = ""
        if extractor and isinstance(payload.scraped_data, dict):
            try:
                transcript = extractor(payload.scraped_data)
            except Exception:
                log.exception("Extractor failed for %s", payload.plugin_name)

        # Build article content: transcript (if any) + LLM analysis
        content = transcript + "\n\n---\n\n" + analysis if transcript else analysis

        # Create an article from the content
        try:
            result = service.add_input(content, source_url=f"plugin:{payload.plugin_name}")
            if payload.process:
                worker.kick()
            elif result.created:
                result.article.status = "added"
                service.store.update_article(result.article)
            article_id = result.article.id
        except Exception:
            article_id = None

        return {"analysis": analysis, "article_id": article_id}

    # -- Entity endpoints -------------------------------------------------------

    @app.get("/api/entities")
    async def list_entities(request: Request, limit: int = Query(default=200)) -> dict[str, object]:
        service = _service(request)
        entities = service.store.list_entities(limit=limit)
        return {"entities": entities}

    @app.get("/api/entities/{entity_id}/articles")
    async def entity_articles(request: Request, entity_id: int) -> dict[str, object]:
        service = _service(request)
        articles = service.store.get_entity_articles(entity_id)
        return {"articles": [_serialize_article(service, a) for a in articles]}

    @app.get("/api/articles/{article_id}/entities")
    async def article_entities(request: Request, article_id: str) -> dict[str, object]:
        service = _service(request)
        article = service.get_article(article_id)
        if article is None:
            raise HTTPException(status_code=404, detail="Article not found")
        entities = service.store.get_article_entities(article_id)
        return {"entities": entities}

    # -- Listen tracking -------------------------------------------------------

    @app.post("/api/articles/{article_id}/listened")
    async def record_listened(request: Request, article_id: str) -> dict[str, object]:
        service = _service(request)
        article = service.get_article(article_id)
        if article is None:
            raise HTTPException(status_code=404, detail="Article not found")
        body: dict = {}
        try:
            body = await request.json()
        except Exception:
            pass
        complete = bool(body.get("complete", False))
        service.store.record_listen(article_id, complete=complete)
        updated = service.get_article(article_id)
        return {"article": _serialize_article(service, updated)}

    @app.get("/api/update-check")
    async def update_check() -> dict[str, object]:
        return _check_latest_version()

    @app.get("/api/extension.zip")
    async def download_extension() -> Response:
        if not EXTENSION_DIR.is_dir():
            raise HTTPException(status_code=404, detail="Extension files not bundled")
        import io
        import zipfile
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for path in sorted(EXTENSION_DIR.rglob("*")):
                if path.is_file() and not path.name.startswith("."):
                    zf.write(path, f"readcast-extension/{path.relative_to(EXTENSION_DIR)}")
        buf.seek(0)
        return Response(
            content=buf.getvalue(),
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=readcast-extension.zip"},
        )

    @app.get("/feed.xml")
    async def feed(request: Request) -> Response:
        service = _service(request)
        xml = _build_feed_xml(request, service)
        return Response(content=xml, media_type="application/rss+xml")

    # -- Lists CRUD ------------------------------------------------------------

    @app.get("/api/lists")
    async def list_lists(request: Request) -> dict[str, object]:
        service = _service(request)
        return {"lists": service.store.list_lists()}

    @app.post("/api/lists", status_code=201)
    async def create_list(request: Request, payload: CreateListRequest) -> dict[str, object]:
        service = _service(request)
        _DEFAULT_COLORS = {
            "collection": ("#a855f7", "rgba(168,85,247,0.12)"),
            "todo": ("#ef9f27", "rgba(239,159,39,0.12)"),
            "playlist": ("#6c8cff", "rgba(108,140,255,0.12)"),
        }
        color = payload.color or _DEFAULT_COLORS.get(payload.type, ("#6b7084",))[0]
        bg = payload.bg or _DEFAULT_COLORS.get(payload.type, (None, "rgba(107,112,132,0.12)"))[1]
        lst = service.store.create_list(payload.name, payload.type, icon=payload.icon, color=color, bg=bg)
        return {"list": lst}

    @app.put("/api/lists/{list_id}")
    async def update_list(request: Request, list_id: str, payload: UpdateListRequest) -> dict[str, object]:
        service = _service(request)
        lst = service.store.update_list(list_id, **payload.model_dump(exclude_none=True))
        if lst is None:
            raise HTTPException(status_code=404, detail="List not found")
        return {"list": lst}

    @app.delete("/api/lists/{list_id}", status_code=204)
    async def delete_list(request: Request, list_id: str) -> Response:
        service = _service(request)
        if not service.store.delete_list(list_id):
            raise HTTPException(status_code=404, detail="List not found")
        return Response(status_code=204)

    @app.put("/api/lists/reorder", status_code=204)
    async def reorder_lists(request: Request, payload: ReorderRequest) -> Response:
        service = _service(request)
        service.store.reorder_lists(payload.ids)
        return Response(status_code=204)

    # -- List items ------------------------------------------------------------

    @app.get("/api/lists/{list_id}/items")
    async def list_items(request: Request, list_id: str) -> dict[str, object]:
        service = _service(request)
        if service.store.get_list(list_id) is None:
            raise HTTPException(status_code=404, detail="List not found")
        return {"items": service.store.get_list_items(list_id)}

    @app.post("/api/lists/{list_id}/items", status_code=201)
    async def add_list_item(request: Request, list_id: str, payload: AddListItemRequest) -> dict[str, object]:
        service = _service(request)
        if service.store.get_list(list_id) is None:
            raise HTTPException(status_code=404, detail="List not found")
        if service.get_article(payload.doc_id) is None:
            raise HTTPException(status_code=404, detail="Document not found")
        try:
            item = service.store.add_list_item(
                list_id, payload.doc_id,
                due=payload.due, use_summary=payload.use_summary,
                ai_suggested_due=payload.ai_suggested_due,
            )
        except Exception as exc:
            raise HTTPException(status_code=409, detail="Document already in list") from exc
        return {"item": item}

    @app.delete("/api/lists/{list_id}/items/{doc_id}", status_code=204)
    async def remove_list_item(request: Request, list_id: str, doc_id: str) -> Response:
        service = _service(request)
        if not service.store.remove_list_item(list_id, doc_id):
            raise HTTPException(status_code=404, detail="Item not found")
        return Response(status_code=204)

    @app.put("/api/lists/{list_id}/items/{doc_id}")
    async def update_list_item(request: Request, list_id: str, doc_id: str, payload: UpdateListItemRequest) -> dict[str, object]:
        service = _service(request)
        item = service.store.update_list_item(list_id, doc_id, **payload.model_dump(exclude_none=True))
        if item is None:
            raise HTTPException(status_code=404, detail="Item not found")
        return {"item": item}

    @app.put("/api/lists/{list_id}/items/reorder", status_code=204)
    async def reorder_list_items(request: Request, list_id: str, payload: ReorderRequest) -> Response:
        service = _service(request)
        service.store.reorder_list_items(list_id, payload.ids)
        return Response(status_code=204)

    # -- Renditions ------------------------------------------------------------

    @app.get("/api/docs/{doc_id}/renditions")
    async def get_renditions(request: Request, doc_id: str) -> dict[str, object]:
        service = _service(request)
        return {"renditions": service.store.get_renditions(doc_id)}

    @app.post("/api/docs/{doc_id}/renditions/audio")
    async def generate_audio(request: Request, doc_id: str, payload: GenerateAudioRequest) -> dict[str, object]:
        service = _service(request)
        worker = _worker(request)
        voice = payload.voice or service.default_voice()
        try:
            article = service.reprocess_article(doc_id, voice=voice)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Document not found") from exc
        service.store.set_rendition(doc_id, "audio", {"state": "queued", "voice": voice, "duration": None, "generated_at": None})
        worker.kick()
        return {"rendition": {"state": "queued", "voice": voice}}

    @app.delete("/api/docs/{doc_id}/renditions/audio", status_code=204)
    async def remove_audio_rendition(request: Request, doc_id: str) -> Response:
        service = _service(request)
        try:
            service.remove_audio(doc_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Document not found") from exc
        service.store.clear_rendition(doc_id, "audio")
        return Response(status_code=204)

    @app.post("/api/docs/{doc_id}/renditions/summary")
    async def generate_summary(request: Request, doc_id: str) -> dict[str, object]:
        service = _service(request)
        config: Config = request.app.state.config
        article = service.get_article(doc_id)
        if article is None:
            raise HTTPException(status_code=404, detail="Document not found")
        text = service.store.get_full_text(doc_id) or ""
        if not text.strip():
            raise HTTPException(status_code=400, detail="Document has no text content")
        try:
            ensure_llm_running(config)
            summary_text = llm_complete(
                [{"role": "user", "content": f"Summarize the following article in 2-3 sentences:\n\n{text[:4000]}"}],
                config, max_tokens=256, temperature=0.3,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        now = datetime.now(UTC).isoformat()
        service.store.set_rendition(doc_id, "summary", {"text": summary_text, "generated_at": now})
        return {"rendition": {"text": summary_text, "generated_at": now}}

    @app.delete("/api/docs/{doc_id}/renditions/summary", status_code=204)
    async def remove_summary(request: Request, doc_id: str) -> Response:
        service = _service(request)
        service.store.clear_rendition(doc_id, "summary")
        return Response(status_code=204)

    @app.post("/api/docs/{doc_id}/renditions/audio_summary")
    async def generate_audio_summary(request: Request, doc_id: str, payload: GenerateAudioRequest) -> dict[str, object]:
        service = _service(request)
        worker = _worker(request)
        renditions = service.store.get_renditions(doc_id)
        if not renditions.get("summary"):
            raise HTTPException(status_code=400, detail="Generate a text summary first")
        voice = payload.voice or service.default_voice()
        service.store.set_rendition(doc_id, "audio_summary", {"state": "queued", "voice": voice, "duration": None, "generated_at": None})
        # TODO: wire to ProcessingWorker for audio_summary jobs
        worker.kick()
        return {"rendition": {"state": "queued", "voice": voice}}

    @app.delete("/api/docs/{doc_id}/renditions/audio_summary", status_code=204)
    async def remove_audio_summary(request: Request, doc_id: str) -> Response:
        service = _service(request)
        service.store.clear_rendition(doc_id, "audio_summary")
        return Response(status_code=204)

    # -- Batch narration -------------------------------------------------------

    @app.post("/api/lists/{list_id}/batch-narrate")
    async def batch_narrate(request: Request, list_id: str) -> dict[str, object]:
        service = _service(request)
        worker = _worker(request)
        lst = service.store.get_list(list_id)
        if lst is None:
            raise HTTPException(status_code=404, detail="List not found")
        items = service.store.get_list_items(list_id)
        queued = 0
        for item in items:
            renditions = service.store.get_renditions(item["doc_id"])
            needs_audio = renditions.get("audio") is None or renditions["audio"].get("state") != "ready"
            if needs_audio:
                try:
                    voice = service.default_voice()
                    service.reprocess_article(item["doc_id"], voice=voice)
                    service.store.set_rendition(item["doc_id"], "audio", {"state": "queued", "voice": voice, "duration": None, "generated_at": None})
                    queued += 1
                except (KeyError, ValueError):
                    pass
        if queued:
            worker.kick()
        return {"queued": queued}

    return app


def _service(request: Request) -> ReadcastService:
    return request.app.state.service


def _worker(request: Request) -> ProcessingWorker:
    return request.app.state.worker


def _serialize_article(service: ReadcastService, article: Article) -> dict[str, Any]:
    payload = article.to_dict()
    payload["source"] = _article_source(article)
    path = service.audio_path_for_article(article.id)
    payload["audio_url"] = f"/api/articles/{article.id}/audio" if path else None
    payload["has_audio"] = path is not None
    payload["renditions"] = service.store.get_renditions(article.id)
    payload["list_memberships"] = service.store.get_doc_list_memberships(article.id)
    return payload


def _serialize_preview(preview: PreviewResult) -> dict[str, Any]:
    return {
        "article": preview.article.to_dict(),
        "source": _article_source(preview.article),
        "full_text": preview.full_text,
        "text_excerpt": preview.full_text[:2000],
        "chunks": [chunk.to_dict() for chunk in preview.chunks[:12]],
    }


def _article_source(article: Article) -> str:
    if article.publication:
        return article.publication
    if article.source_url:
        return article.source_url
    if article.source_file:
        return Path(article.source_file).name
    return "Pasted Text"


def _kokoro_status_payload(service: ReadcastService) -> dict[str, object]:
    try:
        status = service.daemon_status()
    except ServerError as exc:
        installed = _kokoro_binary_available(service.config)
        state = "missing" if not installed else "offline"
        message = (
            "kokoro-edge is not installed. Run `pixi run setup` or set READCAST_KOKORO_EDGE_BIN."
            if not installed
            else str(exc)
        )
        return {
            "installed": installed,
            "connected": False,
            "ready": False,
            "state": state,
            "models_loaded": [],
            "status": None,
            "error": message,
            "message": message,
        }

    models_loaded = status.get("models_loaded")
    model_names = models_loaded if isinstance(models_loaded, list) else []
    ready = bool(model_names) or models_loaded is None
    message = (
        "kokoro-edge is running but no model is loaded yet."
        if not ready
        else f"kokoro-edge is ready ({status.get('model', service.config.tts.model)})."
    )
    return {
        "installed": True,
        "connected": True,
        "ready": ready,
        "state": "ready" if ready else "warming",
        "models_loaded": model_names,
        "status": status,
        "error": None,
        "message": message,
    }


def _kokoro_binary_available(config: Config) -> bool:
    try:
        resolve_kokoro_edge_binary(config)
        return True
    except ServerError:
        return False


def _build_feed_xml(request: Request, service: ReadcastService) -> str:
    articles = [article for article in service.list_articles(limit=5000) if service.audio_path_for_article(article.id)]
    base_url = str(request.base_url)
    site_url = base_url.rstrip("/") + "/"
    channel_items = [
        "<rss version=\"2.0\">",
        "<channel>",
        "<title>readcast</title>",
        "<description>Articles converted into offline audio on this Mac.</description>",
        f"<link>{escape(site_url)}</link>",
        "<language>en-us</language>",
    ]
    for article in articles:
        audio_path = service.audio_path_for_article(article.id)
        if audio_path is None:
            continue
        audio_url = str(request.url_for("article_audio", article_id=article.id))
        source_link = article.source_url or audio_url
        description = article.author or article.publication or _article_source(article)
        pub_date = _feed_date(article)
        mime_type = "audio/mp4" if audio_path.suffix.lower() == ".m4a" else "audio/mpeg"
        channel_items.extend(
            [
                "<item>",
                f"<guid isPermaLink=\"false\">{escape(article.id)}</guid>",
                f"<title>{escape(article.title)}</title>",
                f"<link>{escape(source_link)}</link>",
                f"<description>{escape(description)}</description>",
                f"<pubDate>{escape(pub_date)}</pubDate>",
                (
                    f"<enclosure url=\"{escape(urljoin(site_url, audio_url.lstrip('/')))}\" "
                    f"length=\"{audio_path.stat().st_size}\" type=\"{mime_type}\" />"
                ),
                "</item>",
            ]
        )
    channel_items.extend(["</channel>", "</rss>"])
    return "\n".join(channel_items)


def _feed_date(article: Article) -> str:
    raw = article.published_date or article.ingested_at
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        parsed = datetime.now(UTC)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return format_datetime(parsed)


_GMAIL_PROMPT = """\
You are an email assistant producing an audio briefing.
Analyze these {count} emails and categorize each as: spam, bulk/corporate, \
system notification (git/confluence/jira/automated), or important (needs human response).

Output a natural spoken briefing in this format:
1. One-line summary: "In the last 24 hours you received X emails..."
2. Counts by category
3. For important emails: 1-2 sentence summary of each, including sender and what action is needed
4. For bulk/system: one sentence summarizing the general topics
5. Skip spam entirely

Emails:
{scraped_data_json}"""


def _default_plugin_prompt(plugin_name: str) -> str:
    prompts: dict[str, str] = {
        "gmail": _GMAIL_PROMPT,
    }
    if plugin_name in prompts:
        return prompts[plugin_name]
    return (
        "Analyze the following scraped data and produce a concise, natural-language "
        "audio briefing suitable for text-to-speech.\n\nData:\n{scraped_data_json}"
    )


_REPODATA_URL = "https://conda.anaconda.org/gjennings/noarch/repodata.json"
_update_cache: dict[str, object] = {}


def _check_latest_version() -> dict[str, object]:
    import time
    now = time.monotonic()
    if _update_cache and now - _update_cache.get("_ts", 0) < 3600:
        return {k: v for k, v in _update_cache.items() if k != "_ts"}

    import httpx
    from packaging.version import Version
    current = __version__
    try:
        resp = httpx.get(_REPODATA_URL, timeout=5.0)
        resp.raise_for_status()
        data = resp.json()
        versions = [
            v["version"]
            for v in data.get("packages.conda", {}).values()
            if v.get("name") == "readcast"
        ]
        if not versions:
            result: dict[str, object] = {"current": current, "latest": current, "update_available": False}
        else:
            latest = str(max(versions, key=Version))
            result = {
                "current": current,
                "latest": latest,
                "update_available": Version(latest) > Version(current),
            }
    except Exception:
        result = {"current": current, "latest": None, "update_available": False}

    _update_cache.clear()
    _update_cache.update(result)
    _update_cache["_ts"] = now
    return {k: v for k, v in result.items() if k != "_ts"}
