"""Site-specific backend extractors — add-on modules kept separate from core."""

from __future__ import annotations

from typing import Callable

_REGISTRY: dict[str, Callable] = {}


def register(name: str, func: Callable) -> None:
    _REGISTRY[name] = func


def get_extractor(name: str) -> Callable | None:
    return _REGISTRY.get(name)


# Auto-register available extractors
from . import youtube as _youtube  # noqa: F401, E402
