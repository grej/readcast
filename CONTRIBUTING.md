# Contributing to readcast

## Local setup

```bash
pixi install
pixi run setup
npm install
pixi run frontend:build
```

## Architecture

The codebase is intentionally layered:

- `readcast.core`
  - models, config, extraction, chunking, storage, synthesis client
- `readcast.services`
  - shared orchestration for add/process/retry/reprocess/delete
- `readcast.cli`
  - thin CLI wrapper over the service layer
- `readcast.api`
  - thin FastAPI wrapper over the service layer
- `readcast.web`
  - static frontend bundle and source JSX

Keep orchestration out of the CLI and API layers. If behavior is shared between the web app
and the CLI, it should usually live in `readcast.services`.

## Common commands

```bash
pixi run test
pixi run lint
pixi run frontend:build
pixi run check
pixi run check:runtime
pixi run package:check
```

## Working with `kokoro-edge`

`readcast` depends on a local `kokoro-edge` binary. For development, the setup script checks:

1. `READCAST_KOKORO_EDGE_BIN`
2. `PATH`
3. sibling build at `../kokoro-mlx/.build-xcode/stage/bin/kokoro-edge`

Useful commands:

```bash
pixi run serve
pixi run readcast server status
pixi run readcast web
```

## Frontend workflow

The shipped web UI uses the checked-in bundle at `src/readcast/web/static/bundle.js`.
Edit `src/readcast/web/frontend/app.jsx`, then rebuild:

```bash
pixi run frontend:build
```

## Tests

- unit and mocked integration coverage live under `tests/`
- true local synthesis checks remain manual
- CI runs lint, non-integration tests, and the frontend build
- `pixi run check` is CI-safe and does not require a local `kokoro-edge` binary
- `pixi run check:runtime` includes the same checks but boots `kokoro-edge` first

## Pull requests

- keep changes focused
- update tests with behavior changes
- run `pixi run check` before opening a PR
- if you are changing local runtime integration, also run `pixi run check:runtime`
- if packaging or static assets are touched, also run `pixi run package:check`
