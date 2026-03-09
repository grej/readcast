from __future__ import annotations

from pathlib import Path
import sys

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = PROJECT_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


@pytest.fixture()
def base_dir(tmp_path: Path) -> Path:
    return tmp_path / ".readcast"


@pytest.fixture()
def fixture_dir() -> Path:
    return Path(__file__).resolve().parent / "fixtures"

