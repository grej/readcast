from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from readcast.core.config import Config
from readcast.core.models import Article
from readcast.core.synthesizer import ServerError, SynthesisError, ensure_server_running
from readcast.services import ProcessingWorker, ReadcastService


STATIC_DIR = Path(__file__).resolve().parents[1] / "web" / "static"


class AddArticleRequest(BaseModel):
    input: str = Field(min_length=1)
    voice: Optional[str] = None
    speed: Optional[float] = None
    process: bool = True


class ReprocessRequest(BaseModel):
    voice: Optional[str] = None
    speed: Optional[float] = None


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

    app = FastAPI(title="readcast", lifespan=lifespan)
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

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

    @app.post("/api/articles", status_code=201)
    async def add_article(request: Request, payload: AddArticleRequest) -> dict[str, object]:
        service = _service(request)
        worker = _worker(request)
        try:
            result = service.add_input(payload.input, voice=payload.voice, speed=payload.speed)
        except (ValueError, SynthesisError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        if payload.process:
            worker.kick()
        return {"article": _serialize_article(service, result.article), "created": result.created}

    @app.delete("/api/articles/{article_id}", status_code=204)
    async def delete_article(request: Request, article_id: str) -> Response:
        service = _service(request)
        if not service.delete_article(article_id):
            raise HTTPException(status_code=404, detail="Article not found")
        return Response(status_code=204)

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
        try:
            kokoro = service.daemon_status()
            connected = True
            error = None
        except ServerError as exc:
            kokoro = None
            connected = False
            error = str(exc)

        return {
            "readcast": {"ok": True},
            "kokoro_edge": {
                "connected": connected,
                "status": kokoro,
                "error": error,
            },
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
    return payload


def _article_source(article: Article) -> str:
    if article.publication:
        return article.publication
    if article.source_url:
        return article.source_url
    if article.source_file:
        return Path(article.source_file).name
    return "Pasted Text"
