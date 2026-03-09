from __future__ import annotations

import json
from pathlib import Path
import threading
from typing import Optional
import webbrowser

import click
from rich.console import Console
from rich.panel import Panel
from rich.progress import BarColumn, Progress, TextColumn, TimeElapsedColumn
from rich.table import Table

from readcast.core.config import Config
from readcast.core.extractor import ExtractionError
from readcast.core.models import Article
from readcast.core.store import Store
from readcast.core.synthesizer import (
    ProgressCallback,
    ServerError,
    ensure_server_running,
    fetch_server_status,
    start_server,
    stop_server,
)
from readcast.services import ProcessArticleResult, ReadcastService


console = Console()


class RichProgressCallback(ProgressCallback):
    def __init__(self, progress: Progress, task_id: int, article_id: str):
        self.progress = progress
        self.task_id = task_id
        self.article_id = article_id

    def on_status(self, article_id: str, stage: str, message: str) -> None:
        self.progress.update(self.task_id, description=f"{stage}: {message}")

    def on_progress(self, article_id: str, current: int, total: int) -> None:
        self.progress.update(self.task_id, completed=current, total=total)

    def on_error(self, article_id: str, error: str) -> None:
        console.print(f"[red]{article_id}[/red] {error}")

    def on_complete(self, article_id: str, audio_path: str) -> None:
        self.progress.update(self.task_id, description=f"done: {Path(audio_path).name}")


def _runtime(base_dir: Optional[Path] = None) -> tuple[Config, Store, ReadcastService]:
    config = Config.load(base_dir)
    store = Store(config.base_dir)
    service = ReadcastService(config, store)
    return config, store, service


@click.group()
@click.option("--base-dir", type=click.Path(path_type=Path), default=None, hidden=True)
@click.pass_context
def cli(ctx: click.Context, base_dir: Optional[Path]) -> None:
    """Convert web articles into offline audio files."""
    config, store, service = _runtime(base_dir)
    ctx.obj = {"config": config, "store": store, "service": service}


@cli.command()
@click.argument("sources", nargs=-1, required=True)
@click.option("--process", "process_now", is_flag=True, help="Immediately process added sources.")
@click.option("--voice", default=None, help="Override the configured voice for these articles.")
@click.option("--tags", default="", help="Comma-separated tags.")
@click.pass_context
def add(ctx: click.Context, sources: tuple[str, ...], process_now: bool, voice: Optional[str], tags: str) -> None:
    """Add URL(s), HTML file(s), or plain-text file(s) to the queue."""
    service: ReadcastService = ctx.obj["service"]
    parsed_tags = [item.strip() for item in tags.split(",") if item.strip()]
    added: list[Article] = []

    for source in sources:
        try:
            result = service.add_source(source, voice=voice, tags=parsed_tags)
        except ExtractionError as exc:
            console.print(f"[red]failed[/red] {source}: {exc}")
            continue

        article = result.article
        if not result.created:
            console.print(f"[yellow]duplicate[/yellow] {source}")
        else:
            console.print(f"[green]queued[/green] {article.id} {article.title}")
        added.append(article)

    if process_now and added:
        _process_articles(service, added)


@cli.command()
@click.option("--limit", type=int, default=None, help="Maximum number of queued articles to process.")
@click.pass_context
def process(ctx: click.Context, limit: Optional[int]) -> None:
    """Process queued articles."""
    service: ReadcastService = ctx.obj["service"]
    articles = service.store.get_queued()
    if limit is not None:
        articles = articles[:limit]
    if not articles:
        console.print("No queued articles.")
        return
    _process_articles(service, articles)


@cli.command()
@click.option("--host", default=None, help="Host interface for the local web server.")
@click.option("--port", type=int, default=None, help="Port for the local web server.")
@click.option("--no-open", is_flag=True, help="Do not open the browser automatically.")
@click.pass_context
def web(ctx: click.Context, host: Optional[str], port: Optional[int], no_open: bool) -> None:
    """Launch the local web frontend."""
    config: Config = ctx.obj["config"]

    try:
        ensure_server_running(config)
    except ServerError as exc:
        raise click.ClickException(str(exc)) from exc

    from readcast.api.app import create_app
    import uvicorn

    bind_host = host or config.web.host
    bind_port = port or config.web.port
    should_open = config.web.open_browser and not no_open
    url = f"http://{bind_host}:{bind_port}"
    if should_open:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    uvicorn.run(create_app(config.base_dir), host=bind_host, port=bind_port)


@cli.group()
def server() -> None:
    """Manage the kokoro-edge daemon."""


@server.command("start")
@click.pass_context
def server_start(ctx: click.Context) -> None:
    config: Config = ctx.obj["config"]
    try:
        payload = start_server(config)
    except ServerError as exc:
        raise click.ClickException(str(exc)) from exc
    console.print(
        f"[green]running[/green] kokoro-edge at {config.kokoro_edge.server_url} "
        f"({payload.get('model', config.tts.model)})"
    )


@server.command("stop")
@click.pass_context
def server_stop(ctx: click.Context) -> None:
    config: Config = ctx.obj["config"]
    try:
        stopped = stop_server(config)
    except ServerError as exc:
        raise click.ClickException(str(exc)) from exc
    if not stopped:
        console.print("kokoro-edge is not running.")
        return
    console.print("[green]stopped[/green] kokoro-edge")


@server.command("status")
@click.pass_context
def server_status_command(ctx: click.Context) -> None:
    config: Config = ctx.obj["config"]
    try:
        payload = fetch_server_status(config)
    except ServerError:
        console.print("kokoro-edge is not running.")
        raise click.exceptions.Exit(1)
    console.print(
        f"kokoro-edge v{payload.get('version', '?')} at {config.kokoro_edge.server_url} "
        f"(model: {payload.get('model', config.tts.model)}, "
        f"voices: {len(payload.get('voices_available', []))}, "
        f"uptime: {payload.get('uptime_seconds', '?')}s)"
    )


@cli.command(name="list")
@click.option("--status", default=None, help="Filter by status.")
@click.option("--format", "output_format", type=click.Choice(["table", "json"]), default="table")
@click.pass_context
def list_articles(ctx: click.Context, status: Optional[str], output_format: str) -> None:
    """List stored articles."""
    service: ReadcastService = ctx.obj["service"]
    articles = service.list_articles(status=status, limit=500)
    if output_format == "json":
        click.echo(json.dumps([article.to_dict() for article in articles], indent=2))
        return

    table = Table(title="Articles", expand=True)
    table.add_column("ID")
    table.add_column("Status")
    table.add_column("Title", overflow="fold")
    table.add_column("Publication")
    table.add_column("Read")
    for article in articles:
        table.add_row(
            article.id,
            _status_label(article.status),
            article.title,
            article.publication or "",
            f"{article.estimated_read_min}m",
        )
    console.print(table)


@cli.command()
@click.argument("query")
@click.option("--limit", type=int, default=20)
@click.pass_context
def search(ctx: click.Context, query: str, limit: int) -> None:
    """Full-text search articles."""
    service: ReadcastService = ctx.obj["service"]
    results = service.search_articles(query, limit=limit)
    table = Table(title=f'Search: "{query}"', expand=True)
    table.add_column("ID")
    table.add_column("Status")
    table.add_column("Title", overflow="fold")
    table.add_column("Publication")
    for article in results:
        table.add_row(article.id, _status_label(article.status), article.title, article.publication or "")
    console.print(table)


@cli.command()
@click.argument("article_id")
@click.pass_context
def show(ctx: click.Context, article_id: str) -> None:
    """Show article details."""
    service: ReadcastService = ctx.obj["service"]
    article = service.get_article(article_id)
    if article is None:
        raise click.ClickException(f"Unknown article: {article_id}")
    console.print(Panel(json.dumps(article.to_dict(), indent=2), title=article.title))


@cli.command()
@click.argument("article_id")
@click.pass_context
def retry(ctx: click.Context, article_id: str) -> None:
    """Reset a failed article back to queued."""
    service: ReadcastService = ctx.obj["service"]
    try:
        article = service.retry_article(article_id)
    except KeyError as exc:
        raise click.ClickException(f"Unknown article: {article_id}") from exc
    console.print(f"[green]queued[/green] {article.id}")


@cli.command()
@click.argument("article_id")
@click.pass_context
def delete(ctx: click.Context, article_id: str) -> None:
    """Delete an article and all stored files."""
    service: ReadcastService = ctx.obj["service"]
    if not service.delete_article(article_id):
        raise click.ClickException(f"Unknown article: {article_id}")
    console.print(f"[green]deleted[/green] {article_id}")


@cli.group(invoke_without_command=True)
@click.pass_context
def config(ctx: click.Context) -> None:
    """Show or update configuration."""
    if ctx.invoked_subcommand is None:
        runtime_config: Config = ctx.obj["config"]
        console.print(Panel(json.dumps(runtime_config.to_dict(), indent=2), title="Config"))


@config.command("set")
@click.argument("key")
@click.argument("value")
@click.pass_context
def config_set(ctx: click.Context, key: str, value: str) -> None:
    runtime_config: Config = ctx.obj["config"]
    try:
        runtime_config.set_value(key, value)
    except KeyError as exc:
        raise click.ClickException(f"Unknown config key: {key}") from exc
    console.print(f"[green]updated[/green] {key}")


@cli.group()
def feed() -> None:
    """Future podcast feed helpers."""


@feed.command("generate")
def feed_generate() -> None:
    raise click.ClickException("Feed generation is not implemented in Phase 1.")


def _process_articles(service: ReadcastService, articles: list[Article]) -> None:
    for article in articles:
        with Progress(
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("{task.completed}/{task.total}"),
            TimeElapsedColumn(),
            console=console,
        ) as progress:
            task_id = progress.add_task(f"{article.id} {article.title}", total=1)
            callback = RichProgressCallback(progress, task_id, article.id)
            try:
                result = service.process_articles([article], progress_factory=lambda _: callback)[0]
            except ServerError as exc:
                console.print(f"[red]failed[/red] kokoro-edge: {exc}")
                return
        _render_process_result(result)


def _render_process_result(result: ProcessArticleResult) -> None:
    if not result.success:
        console.print(f"[red]failed[/red] {result.article.id}: {result.error}")
        return
    destination = result.link_path or result.output_path
    console.print(f"[green]done[/green] {result.article.id} -> {destination}")


def _status_label(status: str) -> str:
    colors = {
        "queued": "yellow",
        "extracting": "blue",
        "synthesizing": "blue",
        "done": "green",
        "failed": "red",
    }
    color = colors.get(status, "white")
    return f"[{color}]{status}[/{color}]"


if __name__ == "__main__":
    cli()
