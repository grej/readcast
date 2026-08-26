from __future__ import annotations

from pathlib import Path

import pytest

from scripts.sync_project_version import sync_project_version


def test_sync_project_version_updates_only_project_version(tmp_path: Path) -> None:
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text('[project]\nname = "readcast"\nversion = "2.0.0"\ndependencies = ["httpx>=0.27"]\n')

    previous = sync_project_version(pyproject, "2.1.0")

    assert previous == "2.0.0"
    assert pyproject.read_text() == '[project]\nname = "readcast"\nversion = "2.1.0"\ndependencies = ["httpx>=0.27"]\n'


@pytest.mark.parametrize("version", ["v2.1.0", "2.1", "release", "2.1.0 bad"])
def test_sync_project_version_rejects_invalid_versions(tmp_path: Path, version: str) -> None:
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text('[project]\nversion = "2.0.0"\n')

    with pytest.raises(ValueError, match="Invalid release version"):
        sync_project_version(pyproject, version)
