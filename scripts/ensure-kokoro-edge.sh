#!/usr/bin/env bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SIBLING_BUILD="$PROJECT_ROOT/../kokoro-mlx/.build-xcode/stage/bin/kokoro-edge"
LOCAL_BIN_DIR="$HOME/.local/bin"
LOCAL_BIN="$LOCAL_BIN_DIR/kokoro-edge"
MINIMUM_VERSION="0.2.0"

supports_uds() {
  executable="$1"
  version_output="$("$executable" --version 2>&1 || true)"
  version="$(printf '%s\n' "$version_output" | sed -E -n 's/.*([0-9]+\.[0-9]+\.[0-9]+).*/\1/p' | head -1)"
  if [ -z "$version" ]; then
    return 1
  fi
  if ! awk -F. -v found="$version" -v required="$MINIMUM_VERSION" 'BEGIN {
    split(found, f, "."); split(required, r, ".");
    for (i = 1; i <= 3; i++) {
      if ((f[i] + 0) > (r[i] + 0)) exit 0;
      if ((f[i] + 0) < (r[i] + 0)) exit 1;
    }
    exit 0;
  }'; then
    return 1
  fi
  "$executable" serve --help 2>&1 | grep -q -- "--socket"
}

report_incompatible() {
  echo "ignoring incompatible kokoro-edge at $1; version >=${MINIMUM_VERSION} with --socket support is required" >&2
}

if [ -n "${READCAST_KOKORO_EDGE_BIN:-}" ] && [ -x "${READCAST_KOKORO_EDGE_BIN}" ]; then
  if supports_uds "${READCAST_KOKORO_EDGE_BIN}"; then
    echo "kokoro-edge >=${MINIMUM_VERSION} configured at ${READCAST_KOKORO_EDGE_BIN}"
    exit 0
  fi
  report_incompatible "${READCAST_KOKORO_EDGE_BIN}"
fi

if command -v kokoro-edge >/dev/null 2>&1; then
  PATH_KOKORO_EDGE="$(command -v kokoro-edge)"
  if supports_uds "$PATH_KOKORO_EDGE"; then
    echo "kokoro-edge >=${MINIMUM_VERSION} available on PATH"
    exit 0
  fi
  report_incompatible "$PATH_KOKORO_EDGE"
fi

if [ -x "$SIBLING_BUILD" ]; then
  if supports_uds "$SIBLING_BUILD"; then
    mkdir -p "$LOCAL_BIN_DIR"
    ln -sf "$SIBLING_BUILD" "$LOCAL_BIN"
    echo "linked kokoro-edge >=${MINIMUM_VERSION} from sibling build: $LOCAL_BIN"
    exit 0
  fi
  report_incompatible "$SIBLING_BUILD"
fi

if [ -n "${KOKORO_EDGE_INSTALL_URL:-}" ]; then
  mkdir -p "$LOCAL_BIN_DIR"
  temp_script="$(mktemp)"
  trap 'rm -f "$temp_script"' EXIT
  curl -fsSL "$KOKORO_EDGE_INSTALL_URL" -o "$temp_script"
  chmod +x "$temp_script"
  "$temp_script"
  INSTALLED_KOKORO_EDGE="$(command -v kokoro-edge 2>/dev/null || true)"
  if [ -z "$INSTALLED_KOKORO_EDGE" ] && [ -x "$LOCAL_BIN" ]; then
    INSTALLED_KOKORO_EDGE="$LOCAL_BIN"
  fi
  if [ -n "$INSTALLED_KOKORO_EDGE" ] && supports_uds "$INSTALLED_KOKORO_EDGE"; then
    echo "installed kokoro-edge >=${MINIMUM_VERSION} via installer URL"
    exit 0
  fi
  report_incompatible "${INSTALLED_KOKORO_EDGE:-installer output}"
fi

echo "kokoro-edge >=${MINIMUM_VERSION} with UDS support is required." >&2
echo "Upgrade it, build ../kokoro-mlx, or set KOKORO_EDGE_INSTALL_URL." >&2
exit 1
