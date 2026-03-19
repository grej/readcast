# readcast

A personal knowledge engine for your Mac.

`readcast` is a local-first knowledge engine that captures web articles, Twitter threads,
or pasted text — then makes them searchable by keyword and meaning, auto-tags them with
topics and entities, builds a knowledge graph, and generates audio podcasts. Everything
runs locally on Apple Silicon using MLX for embeddings and inference, `kokoro-edge` for
speech synthesis, and SQLite for storage. No cloud, no API keys, no data leaves your machine.

![readcast web UI](docs/assets/readcast-ui.svg)

## Features

- **Hybrid search** — keyword (FTS5) and semantic (vector embeddings) search fused via
  Reciprocal Rank Fusion. Search "BLAS" and find articles about GPU linear algebra even
  if they never use that exact word.
- **Auto-tagging** — local LLM extracts topics, entities, relationships, summaries, and
  authors from every article on ingestion.
- **Knowledge graph** — entities (people, companies, technologies) and their relationships
  are extracted and linked across articles.
- **Audio podcasts** — turn any article into a narrated podcast via `kokoro-edge` TTS.
  Subscribe in your podcast app via RSS.
- **Listen tracking** — tracks when you've listened to an article (>80% completion).
- **Browser extension** — capture articles directly from Brave, Chrome, or Edge.
- **Backfill pipeline** — `readcast backfill` runs tagging, entity extraction, and
  embedding generation across your entire library.

## Install

### One-line install (conda)

```bash
pixi global install readcast -c https://conda.anaconda.org/gjennings -c conda-forge
readcast web
```

This installs readcast and all dependencies (Python, ffmpeg, etc.) in an isolated
environment. You still need `kokoro-edge` for TTS — see below.

### From source

```bash
git clone https://github.com/gjennings/readcast.git
cd readcast
pixi run start
```

`pixi run start` handles setup and launches the web UI at `http://127.0.0.1:8765`.

### ML extras

Semantic search and auto-tagging require the `ml` optional dependencies:

```bash
pip install 'readcast[ml]'
```

These pull in `mlx-embeddings` (for vector embeddings via `BAAI/bge-small-en-v1.5`) and
`mlx-lm` (for auto-tagging via `Qwen2.5-0.5B`). Both run locally on Apple Silicon via
MLX — no torch, no CUDA, no cloud API. Models auto-download on first use (~600MB total).

When installed from source via pixi, ML extras are included automatically.

### CLI usage

```bash
readcast add --process https://example.com/article
readcast list
readcast search "BLAS"
readcast backfill             # tags + entities + embeddings for all articles
readcast tags backfill        # auto-tag untagged articles
readcast embeddings backfill  # generate embeddings for un-embedded articles
```

If running from source, prefix commands with `pixi run readcast`.

## Browser extension

A Chromium extension (works in Brave, Chrome, Edge) lets you capture articles while
browsing:

1. Go to `brave://extensions/` (or `chrome://extensions/`)
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` directory in this repo
4. Make sure readcast is running (`readcast web`)

The extension adds:
- **Add Page** — sends the current page URL + rendered HTML to readcast
- **Add Selection** — sends highlighted text as a new article
- Right-click context menus for both actions

## `kokoro-edge` dependency

`readcast` talks to the local `kokoro-edge` daemon for text-to-speech. It does not
bundle its own TTS runtime.

`readcast` checks for `kokoro-edge` in this order:

1. `READCAST_KOKORO_EDGE_BIN` environment variable
2. `PATH`
3. sibling dev build at `../kokoro-mlx/.build-xcode/stage/bin/kokoro-edge`
4. installer URL via `KOKORO_EDGE_INSTALL_URL`

## Architecture

readcast stores everything in SQLite under `~/.readcast/`:

- **articles** — metadata, full text, TTS audio, tags, listen history
- **embeddings** — 384-dim vectors (bge-small-en-v1.5) for semantic search
- **entities / relationships** — knowledge graph extracted by local LLM
- **article_entities** — links articles to entities
- **concepts** — reserved for future extensions
- **agent_log** — audit trail of automated actions

Search uses hybrid Reciprocal Rank Fusion: FTS5 keyword results and cosine-similarity
vector results are merged with `score(d) = Σ 1/(k + rank(d))`, so both exact matches
and semantic matches surface without needing to normalize BM25 and cosine scores.

## Status

`readcast` is early but usable:

- macOS 15+, Apple Silicon only
- localhost-only (all data stays on your machine)
- no cloud dependencies — TTS, embeddings, and LLM inference all run locally
- extensible schema — reserved columns and tables for future extensions

## Privacy and storage

All data lives locally under `~/.readcast/`:

- `config.toml` — configuration
- `index.db` — SQLite database with full-text search, embeddings, and knowledge graph
- `articles/{id}/` — extracted text, metadata, chunks, and audio
- `output/` — symlinks to generated audio files

Subscribe to your articles as a podcast by copying the feed URL from the web UI
or pointing your podcast app at `http://127.0.0.1:8765/feed.xml`.

## Development

```bash
pixi install          # installs Python, ffmpeg, nodejs, and all dependencies
pixi run test         # run tests
pixi run lint         # run linter
pixi run frontend:build  # rebuild React frontend
pixi run check        # all checks (lint + test + build)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture and contributor workflow.
