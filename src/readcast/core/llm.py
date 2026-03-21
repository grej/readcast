"""LLM client — delegates to localknowledge.llm.

Preserves readcast's API (functions take Config), while
the underlying implementation lives in localknowledge.
"""

from __future__ import annotations

from localknowledge.llm import (
    complete as _lk_complete,
    is_available as _lk_is_available,
    ensure_llm_running as _lk_ensure,
    llm_status as _lk_status,
    start_llm_server as _lk_start,
    stop_llm_server as _lk_stop,
)

from readcast.core.config import Config


def complete(
    messages: list[dict],
    config: Config,
    max_tokens: int = 1024,
    temperature: float = 0.3,
) -> str:
    """Send a chat completion request and return the assistant message content."""
    return _lk_complete(messages, config.llm, max_tokens=max_tokens, temperature=temperature)


def is_available(config: Config) -> bool:
    """Check whether the configured LLM endpoint is reachable."""
    return _lk_is_available(config.llm)


def ensure_llm_running(config: Config) -> None:
    """For local provider, start mlx_lm.server if not already running."""
    return _lk_ensure(config.llm)


def start_llm_server(config: Config) -> None:
    """Spawn mlx_lm.server as a background process and wait until it responds."""
    return _lk_start(config.llm)


def stop_llm_server(config: Config) -> None:
    """Stop the managed mlx_lm.server process if running."""
    return _lk_stop(config.llm)


def llm_status(config: Config) -> dict:
    """Return a status dict describing the current LLM backend."""
    return _lk_status(config.llm)
