from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import math
from pathlib import Path
import re
from typing import Optional
from urllib.parse import urlparse

from bs4 import BeautifulSoup
import httpx

from .config import Config
from .models import Article, Chunk

try:
    from readability import Document
except ImportError:  # pragma: no cover
    Document = None


class ExtractionError(RuntimeError):
    pass


USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


def extract(source: str, config: Config) -> tuple[Article, list[Chunk]]:
    if source.startswith(("http://", "https://")):
        source_url = source
        source_file = None
        html = _fetch_url(source_url)
    else:
        path = Path(source).expanduser().resolve()
        if not path.exists():
            raise ExtractionError(f"Local file not found: {path}")
        source_url = None
        source_file = str(path)
        source = str(path)
        if path.suffix.lower() == ".txt":
            return _extract_plain_text(path, config)
        html = path.read_text(encoding="utf-8")

    article_html, extracted_title = _extract_readable_html(html)
    soup = BeautifulSoup(html, "lxml")
    content_soup = BeautifulSoup(article_html, "lxml")

    title = _extract_title(soup, extracted_title)
    author = _extract_meta_content(
        soup,
        [
            ("meta", {"name": "author"}),
            ("meta", {"property": "article:author"}),
            ("meta", {"name": "parsely-author"}),
        ],
    )
    if not author:
        author = _extract_byline(soup)

    published_date = _extract_published_date(soup)
    publication = _extract_publication(source_url, soup, config)
    chunks = _build_chunks(content_soup, title)
    if not chunks:
        raise ExtractionError("No readable article content was extracted")

    word_count = sum(len(chunk.text.split()) for chunk in chunks)
    estimated_read_min = max(1, math.ceil(word_count / 238))
    article_id = hashlib.sha256(source.encode("utf-8")).hexdigest()[:8]

    article = Article(
        id=article_id,
        source_url=source_url,
        source_file=source_file,
        title=title,
        author=author,
        publication=publication,
        published_date=published_date,
        ingested_at=datetime.now(UTC).isoformat(),
        word_count=word_count,
        estimated_read_min=estimated_read_min,
        language="en",
        status="queued",
    )
    return article, chunks


def _extract_plain_text(path: Path, config: Config) -> tuple[Article, list[Chunk]]:
    text = path.read_text(encoding="utf-8")
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n+", text) if part.strip()]
    title = _title_from_path(path)
    chunks = [Chunk(idx=0, chunk_type="title", text=title, html_tag="title")]
    for idx, paragraph in enumerate(paragraphs, start=1):
        normalized = _normalize_whitespace(paragraph)
        if not normalized:
            continue
        chunks.append(Chunk(idx=idx, chunk_type="paragraph", text=normalized, html_tag="txt"))

    if len(chunks) == 1:
        raise ExtractionError("Plain-text file did not contain any readable content")

    word_count = sum(len(chunk.text.split()) for chunk in chunks)
    estimated_read_min = max(1, math.ceil(word_count / 238))
    source = str(path)
    article_id = hashlib.sha256(source.encode("utf-8")).hexdigest()[:8]
    article = Article(
        id=article_id,
        source_url=None,
        source_file=source,
        title=title,
        author=None,
        publication=None,
        published_date=None,
        ingested_at=datetime.now(UTC).isoformat(),
        word_count=word_count,
        estimated_read_min=estimated_read_min,
        language="en",
        status="queued",
    )
    return article, chunks


def _fetch_url(url: str) -> str:
    headers = {"User-Agent": USER_AGENT}
    try:
        response = httpx.get(url, headers=headers, follow_redirects=True, timeout=30.0)
        response.raise_for_status()
        return response.text
    except httpx.HTTPError as exc:
        raise ExtractionError(f"Failed to fetch {url}: {exc}") from exc


def _extract_readable_html(html: str) -> tuple[str, Optional[str]]:
    if Document is None:
        soup = BeautifulSoup(html, "lxml")
        node = soup.find("article") or soup.find("main") or soup.body
        if node is None:
            return html, None
        return str(node), None

    document = Document(html)
    return document.summary(html_partial=True), document.title()


def _extract_title(soup: BeautifulSoup, readable_title: Optional[str]) -> str:
    for value in (
        readable_title,
        _extract_meta_content(soup, [("meta", {"property": "og:title"})]),
        soup.title.get_text(" ", strip=True) if soup.title else None,
    ):
        clean = _normalize_whitespace(value)
        if clean:
            return clean
    return "Untitled Article"


def _extract_published_date(soup: BeautifulSoup) -> Optional[str]:
    published = _extract_meta_content(
        soup,
        [
            ("meta", {"property": "article:published_time"}),
            ("meta", {"name": "date"}),
            ("meta", {"name": "pubdate"}),
        ],
    )
    if published:
        return _normalize_whitespace(published)
    time_tag = soup.find("time")
    if time_tag and time_tag.get("datetime"):
        return _normalize_whitespace(time_tag.get("datetime"))
    return None


def _extract_publication(source_url: Optional[str], soup: BeautifulSoup, config: Config) -> Optional[str]:
    if source_url:
        domain = (urlparse(source_url).hostname or "").lower()
        if domain in config.extraction.publications:
            return config.extraction.publications[domain]
        if domain.endswith(".substack.com"):
            return domain.split(".")[0]
        base = domain.split(".")
        if len(base) >= 2:
            return base[-2].replace("-", " ").title()
        return domain or None

    site_name = _extract_meta_content(soup, [("meta", {"property": "og:site_name"})])
    return _normalize_whitespace(site_name)


def _title_from_path(path: Path) -> str:
    stem = re.sub(r"[-_]+", " ", path.stem).strip()
    if not stem:
        return "Untitled Article"
    return " ".join(word.capitalize() for word in stem.split())


def _extract_meta_content(soup: BeautifulSoup, selectors: list[tuple[str, dict[str, str]]]) -> Optional[str]:
    for tag_name, attrs in selectors:
        tag = soup.find(tag_name, attrs=attrs)
        if tag and tag.get("content"):
            return tag["content"]
    return None


def _extract_byline(soup: BeautifulSoup) -> Optional[str]:
    byline = soup.find(attrs={"class": re.compile(r"byline|author", re.IGNORECASE)})
    if byline:
        return _normalize_whitespace(byline.get_text(" ", strip=True))
    return None


def _build_chunks(content_soup: BeautifulSoup, title: str) -> list[Chunk]:
    chunks: list[Chunk] = []
    idx = 0
    title_text = _normalize_whitespace(title)
    if title_text:
        chunks.append(Chunk(idx=idx, chunk_type="title", text=title_text, html_tag="title"))
        idx += 1

    for node in content_soup.find_all(["p", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "li"]):
        text = _normalize_whitespace(node.get_text(" ", strip=True))
        if not text:
            continue
        if text == title_text and node.name in {"h1", "h2"}:
            continue
        chunk_type = {
            "p": "paragraph",
            "blockquote": "blockquote",
            "li": "list_item",
        }.get(node.name, "heading")
        chunks.append(Chunk(idx=idx, chunk_type=chunk_type, text=text, html_tag=node.name))
        idx += 1
    return chunks


def _normalize_whitespace(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", value or "").strip()
