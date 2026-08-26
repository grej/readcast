from __future__ import annotations

import pathlib
import os
import shutil
import subprocess
import sys
import tempfile
import tarfile
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
DIST_DIR = ROOT / "dist"
STATIC_EXPECTED = [
    "readcast/web/static/index.html",
    "readcast/web/static/app.js",
    "readcast/web/extension/manifest.json",
    "readcast/web/extension/background.js",
    "readcast/web/extension/content.js",
    "readcast/web/extension/popup.html",
    "readcast/web/extension/popup.js",
]


def main() -> int:
    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    DIST_DIR.mkdir(parents=True, exist_ok=True)

    build_cmd = [sys.executable, "-m", "build", "--no-isolation", "--wheel", "--sdist", "--outdir", str(DIST_DIR)]
    subprocess.run(build_cmd, cwd=ROOT, check=True)

    wheel = _latest("readcast-*.whl")
    sdist = _latest("readcast-*.tar.gz")
    _check_archive_contains(wheel, STATIC_EXPECTED)
    sdist_root = _sdist_root(sdist)
    _check_archive_contains(sdist, [f"{sdist_root}/src/{path}" for path in STATIC_EXPECTED])

    with tempfile.TemporaryDirectory() as target:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--no-deps", "--target", target, str(wheel)],
            cwd=ROOT,
            check=True,
        )
        env = dict(**{"PYTHONPATH": target})
        subprocess.run(
            [
                sys.executable,
                "-c",
                (
                    "from readcast.api.app import STATIC_DIR; "
                    "assert STATIC_DIR.exists(); "
                    "assert (STATIC_DIR / 'index.html').exists(); "
                    "assert (STATIC_DIR / 'app.js').exists(); "
                    "print('distribution-ok')"
                ),
            ],
            cwd=ROOT,
            check=True,
            env={**os.environ, **env},
        )

    print("distribution-ok")
    return 0


def _latest(pattern: str) -> pathlib.Path:
    matches = sorted(DIST_DIR.glob(pattern))
    if not matches:
        raise SystemExit(f"Missing build artifact for pattern: {pattern}")
    return matches[-1]


def _check_archive_contains(archive: pathlib.Path, expected: list[str]) -> None:
    if archive.suffix == ".whl":
        with zipfile.ZipFile(archive) as handle:
            archive_names = handle.namelist()
    else:
        with tarfile.open(archive) as handle:
            archive_names = [member.name for member in handle.getmembers()]
    missing = [path for path in expected if path not in archive_names]
    if missing:
        raise SystemExit(f"Missing files in {archive.name}: {', '.join(missing)}")


def _sdist_root(archive: pathlib.Path) -> str:
    with tarfile.open(archive) as handle:
        roots = {pathlib.PurePosixPath(member.name).parts[0] for member in handle.getmembers() if member.name}
    if len(roots) != 1:
        raise SystemExit(f"Expected one root directory in {archive.name}, found: {', '.join(sorted(roots))}")
    return roots.pop()


if __name__ == "__main__":
    raise SystemExit(main())
