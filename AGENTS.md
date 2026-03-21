# AGENTS.md

## Project overview

readcast is a personal knowledge engine for macOS that captures web articles, auto-tags
them with topics and entities, builds a knowledge graph, and generates audio podcasts via
local TTS. Everything runs locally on Apple Silicon.

readcast is part of the Local Knowledge ecosystem. Articles land in the shared database
at `~/.localknowledge/store.db` and are automatically available to `lk` CLI, `lk-ui` web
UI, `lk-mcp` MCP server, and other products like Spock.

## Development commands

```bash
pixi install                 # install deps + editable package
pixi run setup               # ensure kokoro-edge TTS binary is available
npm install                  # install frontend build deps
pixi run test                # pytest
pixi run lint                # ruff check
pixi run frontend:build      # rebuild React frontend (npm run build:frontend)
pixi run check               # lint + test + frontend build
pixi run check:runtime       # same as check but runs setup first
pixi run package:check       # verify distribution contents
pixi run start               # setup + launch web UI
pixi run readcast <cmd>      # run any readcast CLI command
```

## Architecture

```
src/readcast/
├── core/          models, config, extractor, chunker, store, synthesizer, tagger, llm
├── services.py    orchestration layer (add, process, retry, reprocess, delete)
├── cli/           thin Click CLI wrapper over services
├── api/           thin FastAPI wrapper over services
└── web/           static frontend bundle + JSX source
```

- **Service layer pattern**: `services.py` is the shared orchestration layer. CLI and API are thin wrappers — business logic goes in services.
- **Frontend**: React (JSX) in `src/readcast/web/frontend/`, built to `src/readcast/web/static/bundle.js`. Rebuild with `npm run build:frontend`.
- **Browser extension**: `extension/` directory, loaded unpacked in Brave/Chrome/Edge.

## Testing

- Framework: pytest with `addopts = "-ra"`
- Marker: `@pytest.mark.integration` for tests requiring ffmpeg/kokoro-edge
- Fixtures: `base_dir` (tmp_path), `fixture_dir` (test fixtures directory)
- Test files in `tests/` — one per module
- Run: `pixi run test`

## Dependencies

- Depends on `localknowledge-core` (editable from `../local-knowledge/packages/core` in dev, `local-knowledge >=0.2.0` in conda recipe)
- kokoro-edge: TTS engine, managed by `scripts/ensure-kokoro-edge.sh`
- Optional ML extras: `mlx-embeddings`, `mlx-lm`, `huggingface-hub` (installed via `[ml]` extra)

## Storage

- `~/.localknowledge/store.db` — shared knowledge database (documents, embeddings, tags, entities)
- `~/.readcast/articles/{id}/` — extracted text, metadata, chunks, audio per article
- `~/.readcast/config.toml` — readcast-specific configuration
- `~/.readcast/output/` — symlinks to generated audio files

## Build and release

- Build system: hatchling with `src/` layout
- Conda recipe: `recipe/recipe.yaml` — rattler-build, published to anaconda.org/gjennings
- CI: `.github/workflows/publish-conda.yml` — triggered by `v*` tag push, runs on macos-15
- CI: `.github/workflows/ci.yml` — runs on PR and push to main (lint + test + frontend build)
- Version: extracted from git tag, not pyproject.toml

## Key conventions

- Python 3.11+, macOS 15+, Apple Silicon only
- Ruff config: `line-length = 140`, selects `["E", "F"]` only
- Dependencies managed via pixi (conda) — never raw pip
- `src/` layout, hatchling build
- Frontend bundle is checked in (`web/static/bundle.js`) — rebuild after JSX changes
