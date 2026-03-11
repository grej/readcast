# readcast

Turn articles into podcasts on your Mac.

`readcast` is a local-first tool for converting web articles, saved HTML, or pasted text
into offline audio files. It runs on Apple Silicon, uses `kokoro-edge` for speech
synthesis, and keeps your source text, metadata, and audio library on your machine.

![readcast web UI](docs/assets/readcast-ui.svg)

## Status

`readcast` is early but usable. It is currently:

- macOS 15+ only
- Apple Silicon only
- localhost-only
- built around a local `kokoro-edge` install

## Quickstart

```bash
pixi install
pixi run setup
pixi run readcast web
```

That opens the local web UI at `http://127.0.0.1:8765` by default.

You can also use the CLI directly:

```bash
pixi run readcast add --process https://example.com/article
pixi run readcast add --process article.html
pixi run readcast add --process article.txt
pixi run readcast process
pixi run readcast list
pixi run readcast search "strategic defeat"
```

## `kokoro-edge` dependency

`readcast` does not bundle its own TTS runtime. It talks to the local `kokoro-edge`
daemon over HTTP and uses it as the only speech backend.

`pixi run setup` checks for `kokoro-edge` in this order:

1. `READCAST_KOKORO_EDGE_BIN`
2. `PATH`
3. sibling dev build at `../kokoro-mlx/.build-xcode/stage/bin/kokoro-edge`
4. installer URL via `KOKORO_EDGE_INSTALL_URL`

## Web app

`pixi run readcast web` starts:

- the local FastAPI server
- the shared article-processing service layer
- the sequential background worker
- browser UI on one localhost port

The web app supports:

- paste a URL or raw text into one input field
- choose a Kokoro voice from the live daemon inventory
- watch queued and synthesizing articles update in place
- search the article library with SQLite FTS
- play generated audio from a persistent bottom player

## Privacy and storage

`readcast` is local-first:

- no cloud TTS
- no hosted backend
- article text, metadata, and audio stay on your machine

By default data lives under `~/.readcast/`:

- `config.toml`
- `index.db`
- `articles/{id}/...`
- `output/`

## Development

```bash
npm install
pixi run test
pixi run lint
pixi run frontend:build
pixi run check
pixi run check:runtime
pixi run package:check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, architecture, and contributor workflow.
