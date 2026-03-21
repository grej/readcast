# readcast

A personal knowledge engine for your Mac.

`readcast` is a local-first knowledge engine that captures web articles, Twitter threads,
or pasted text — then makes them searchable by keyword and meaning, auto-tags them with
topics and entities, builds a knowledge graph, and generates audio podcasts. Everything
runs locally on Apple Silicon using MLX for embeddings and inference, `kokoro-edge` for
speech synthesis, and SQLite for storage. No cloud, no API keys, no data leaves your machine.

![readcast web UI](docs/assets/readcast-ui.png)

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

The recommended way to run readcast is as part of
[Local Knowledge](https://github.com/grej/local-knowledge), which manages all services
from a single menu bar icon:

```bash
pixi global install local-knowledge --channel gjennings --channel conda-forge
lk-desktop
```

This installs readcast, the knowledge base, web UI, MCP server, TTS engine, and the
menu bar launcher. `lk-desktop` starts everything — click **Readcast** to open the web UI.

### Readcast only

If you just want readcast without the full ecosystem:

```bash
pixi global install readcast --channel gjennings --channel conda-forge
readcast web
```

The web UI launches at `http://127.0.0.1:8765`. ML models (~600MB for embeddings + TTS)
download automatically on first use.

### Local Knowledge ecosystem

readcast builds on [local-knowledge](https://github.com/grej/local-knowledge) (>=0.2.0),
which provides the shared knowledge base, search engine, and embedding infrastructure.
Articles you add in readcast land in the shared database at `~/.localknowledge/store.db`
and are automatically:

- searchable via `lk search` CLI and the `lk-ui` web interface
- available to Claude and other LLM tools via the `lk-mcp` MCP server
- cross-referenced with documents from other products like Spock

### From source

```bash
git clone https://github.com/grej/readcast.git
cd readcast
pixi run start
```

`pixi run start` handles setup and launches the web UI.

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

The browser extension captures articles while you browse. This is the one manual setup
step — browser security policies require loading extensions by hand.

**Setup** (Brave, Chrome, or Edge):

1. Go to `brave://extensions/` (or `chrome://extensions/`)
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` directory in this repo
4. Make sure readcast is running (`readcast web`)

The extension adds:
- **Add Page** — sends the current page URL + rendered HTML to readcast
- **Add Selection** — sends highlighted text as a new article
- Right-click context menus for both actions

## Architecture

readcast stores article files under `~/.readcast/` and uses the shared Local Knowledge
database at `~/.localknowledge/store.db`:

- **`~/.localknowledge/store.db`** — shared SQLite database (documents, embeddings, tags,
  entities, knowledge graph)
- **`~/.readcast/articles/{id}/`** — extracted text, metadata, chunks, and audio per article
- **`~/.readcast/config.toml`** — readcast-specific configuration
- **`~/.readcast/output/`** — symlinks to generated audio files

Search uses hybrid Reciprocal Rank Fusion: FTS5 keyword results and cosine-similarity
vector results are merged with `score(d) = Σ 1/(k + rank(d))`, so both exact matches
and semantic matches surface without needing to normalize BM25 and cosine scores.

`kokoro-edge` runs as a local daemon on `localhost:7777`, providing an OpenAI-compatible
TTS API. readcast starts it automatically when needed.

## Status

`readcast` is early but usable:

- macOS 15+, Apple Silicon only
- localhost-only (all data stays on your machine)
- no cloud dependencies — TTS, embeddings, and LLM inference all run locally
- extensible schema — reserved columns and tables for future extensions

## Privacy and storage

All data lives locally in two directories:

- **`~/.readcast/`** — config, article files, audio, output symlinks
- **`~/.localknowledge/store.db`** — shared knowledge database (documents, embeddings,
  tags, knowledge graph)

Subscribe to your articles as a podcast by copying the feed URL from the web UI
or pointing your podcast app at `http://127.0.0.1:8765/feed.xml`.

## Development

```bash
git clone https://github.com/grej/readcast.git
cd readcast
pixi install          # installs Python, ffmpeg, nodejs, and all dependencies
pixi run test         # run tests
pixi run lint         # run linter
pixi run frontend:build  # rebuild React frontend
pixi run check        # all checks (lint + test + build)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture and contributor workflow.
