"""Integration helpers for the shared Local Knowledge TTS boundary.

Readcast deliberately does not implement a TTS transport or daemon lifecycle.  The
implementation lives in ``localknowledge-core``; this module only loads the shared
collaborators and provides the small amount of endpoint presentation needed by the
readcast CLI and API.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


DEFAULT_SOCKET_PATH = "~/.localknowledge/run/kokoro-edge.sock"


class TTSIntegrationError(RuntimeError):
    """Raised when the shared Local Knowledge TTS integration is unavailable."""


def load_shared_tts_collaborators() -> tuple[Any, Any]:
    """Construct the shared TTS client and lifecycle controller.

    The imports are intentionally lazy.  This keeps readcast's article-management
    commands usable when the optional runtime is not exercised, while producing an
    actionable error when synthesis or daemon management is requested.
    """

    try:
        from localknowledge.config import Config as LocalKnowledgeConfig
        from localknowledge.tts import TTSClient, TTSRuntime
    except (ImportError, AttributeError) as exc:
        raise TTSIntegrationError(
            "localknowledge-core with shared TTSClient and TTSRuntime APIs is required; "
            "upgrade localknowledge-core before using kokoro-edge"
        ) from exc
    config = LocalKnowledgeConfig.load().tts
    return TTSClient(config), TTSRuntime(config)


def load_shared_tts_client() -> Any:
    """Construct only the shared client for direct synthesis callers."""

    try:
        from localknowledge.config import Config as LocalKnowledgeConfig
        from localknowledge.tts import TTSClient
    except (ImportError, AttributeError) as exc:
        raise TTSIntegrationError(
            "localknowledge-core with the shared TTSClient API is required; "
            "upgrade localknowledge-core before using kokoro-edge"
        ) from exc
    shared_config = LocalKnowledgeConfig.load()
    return TTSClient(shared_config.tts)


def load_shared_tts_runtime() -> Any:
    """Construct only the shared lifecycle controller."""

    try:
        from localknowledge.config import Config as LocalKnowledgeConfig
        from localknowledge.tts import TTSRuntime
    except (ImportError, AttributeError) as exc:
        raise TTSIntegrationError(
            "localknowledge-core with the shared TTSRuntime API is required; "
            "upgrade localknowledge-core before using kokoro-edge"
        ) from exc
    return TTSRuntime(LocalKnowledgeConfig.load().tts)


def endpoint_label(client: Any = None, runtime: Any = None) -> str:
    """Return a safe display label for the configured TTS endpoint."""

    config = getattr(client, "config", None) or getattr(runtime, "config", None)
    if config is not None:
        transport = getattr(config, "transport", None)
        if transport == "tcp":
            server_url = getattr(config, "server_url", None)
            if server_url:
                return str(server_url).rstrip("/")
        socket_path = getattr(config, "socket_path", None)
        if socket_path:
            return f"unix:{Path(str(socket_path)).expanduser()}"
        server_url = getattr(config, "server_url", None)
        if server_url:
            return str(server_url).rstrip("/")

    for collaborator in (client, runtime):
        endpoint = getattr(collaborator, "endpoint", None)
        if endpoint:
            return str(endpoint)

    return f"unix:{Path(DEFAULT_SOCKET_PATH).expanduser()}"
