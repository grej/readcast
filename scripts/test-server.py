"""Start a readcast web server with a temporary, seeded database for e2e tests."""
from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

# Ensure src/ and project root are importable
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))

from tests.e2e.seed import seed_database  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9876)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    tmpdir = tempfile.mkdtemp(prefix="readcast-e2e-")
    base_dir = Path(tmpdir) / ".readcast"
    base_dir.mkdir(parents=True, exist_ok=True)

    print(f"[test-server] base_dir={base_dir}", flush=True)
    seed_database(base_dir)
    print("[test-server] database seeded", flush=True)

    import uvicorn  # noqa: E402

    from readcast.api.app import create_app  # noqa: E402

    app = create_app(base_dir)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
