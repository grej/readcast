from __future__ import annotations

from dataclasses import asdict, dataclass, field
import re
import unicodedata
from typing import Any, Optional


def _strip_none(data: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in data.items()}


def slugify(title: str) -> str:
    normalized = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii")
    normalized = normalized.lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    normalized = re.sub(r"-{2,}", "-", normalized)
    return normalized.strip("-")


@dataclass(slots=True)
class Article:
    id: str
    source_url: Optional[str]
    source_file: Optional[str]
    title: str
    author: Optional[str]
    publication: Optional[str]
    published_date: Optional[str]
    ingested_at: str
    word_count: int
    estimated_read_min: int
    language: str = "en"
    status: str = "queued"
    error_message: Optional[str] = None
    audio_duration_sec: Optional[float] = None
    voice: Optional[str] = None
    tts_model: Optional[str] = None
    speed: Optional[float] = None
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return _strip_none(asdict(self))

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Article":
        payload = dict(data)
        payload["tags"] = list(payload.get("tags", []))
        return cls(**payload)


@dataclass(slots=True)
class Chunk:
    idx: int
    chunk_type: str
    text: str
    html_tag: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return _strip_none(asdict(self))

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Chunk":
        return cls(**data)


@dataclass(slots=True)
class TTSSegment:
    idx: int
    text: str
    source_chunk_idx: int
    source_chunk_end_idx: Optional[int] = None
    wav_path: Optional[str] = None
    duration_sec: Optional[float] = None

    def __post_init__(self) -> None:
        if self.source_chunk_end_idx is None:
            self.source_chunk_end_idx = self.source_chunk_idx

    def to_dict(self) -> dict[str, Any]:
        return _strip_none(asdict(self))

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TTSSegment":
        payload = dict(data)
        if "source_chunk_end_idx" not in payload:
            payload["source_chunk_end_idx"] = payload.get("source_chunk_idx")
        return cls(**payload)
