from __future__ import annotations

import argparse
from pathlib import Path
import re


VERSION_PATTERN = re.compile(r"^[0-9]+(?:\.[0-9]+){2}(?:[a-zA-Z0-9.+-]*)?$")
PROJECT_VERSION_PATTERN = re.compile(r'(?m)^(version\s*=\s*)"([^"]+)"(\s*)$')


def sync_project_version(pyproject_path: Path, version: str) -> str:
    if not VERSION_PATTERN.fullmatch(version):
        raise ValueError(f"Invalid release version: {version}")

    content = pyproject_path.read_text()
    matches = list(PROJECT_VERSION_PATTERN.finditer(content))
    if len(matches) != 1:
        raise ValueError(f"Expected one project version in {pyproject_path}, found {len(matches)}")

    match = matches[0]
    replacement = f'{match.group(1)}"{version}"{match.group(3)}'
    pyproject_path.write_text(content[: match.start()] + replacement + content[match.end() :])
    return match.group(2)


def main() -> int:
    parser = argparse.ArgumentParser(description="Set the PEP 621 project version for a tagged build.")
    parser.add_argument("version")
    parser.add_argument("--pyproject", type=Path, default=Path("pyproject.toml"))
    args = parser.parse_args()

    previous = sync_project_version(args.pyproject, args.version)
    print(f"Updated {args.pyproject}: {previous} -> {args.version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
