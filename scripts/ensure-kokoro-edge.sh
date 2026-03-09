#!/usr/bin/env bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SIBLING_BUILD="$PROJECT_ROOT/../kokoro-mlx/.build-xcode/stage/bin/kokoro-edge"
LOCAL_BIN_DIR="$HOME/.local/bin"
LOCAL_BIN="$LOCAL_BIN_DIR/kokoro-edge"

if [ -n "${READCAST_KOKORO_EDGE_BIN:-}" ] && [ -x "${READCAST_KOKORO_EDGE_BIN}" ]; then
  echo "kokoro-edge already configured at ${READCAST_KOKORO_EDGE_BIN}"
  exit 0
fi

if command -v kokoro-edge >/dev/null 2>&1; then
  echo "kokoro-edge already available on PATH"
  exit 0
fi

if [ -x "$SIBLING_BUILD" ]; then
  mkdir -p "$LOCAL_BIN_DIR"
  ln -sf "$SIBLING_BUILD" "$LOCAL_BIN"
  echo "linked kokoro-edge from sibling build: $LOCAL_BIN"
  exit 0
fi

if [ -n "${KOKORO_EDGE_INSTALL_URL:-}" ]; then
  mkdir -p "$LOCAL_BIN_DIR"
  temp_script="$(mktemp)"
  trap 'rm -f "$temp_script"' EXIT
  curl -fsSL "$KOKORO_EDGE_INSTALL_URL" -o "$temp_script"
  chmod +x "$temp_script"
  "$temp_script"
  echo "installed kokoro-edge via installer URL"
  exit 0
fi

echo "kokoro-edge not found. Install it, build ../kokoro-mlx, or set KOKORO_EDGE_INSTALL_URL." >&2
exit 1
