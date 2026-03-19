# Readcast Roadmap

## Completed
- Article extraction with metadata (title, author, publication, date, description, image, canonical URL)
- SQLite + FTS5 full-text search
- CLI and web UI
- TTS via kokoro-edge with voice selection and renarration
- Browser extension (Chromium/Brave) with Twitter/X smart extraction
- Inline metadata editing and paragraph-level text editing
- RSS/podcast feed output
- Conda packaging (anaconda.org/gjennings) with GitHub Actions publish
- Batteries-included install: `pixi global install readcast` includes kokoro-edge
- Port conflict detection on startup
- Hybrid semantic search (FTS5 + vector embeddings via bge-small-en-v1.5 on MLX)
- Auto-tagging with local LLM (topics, entities, summary, author via Qwen2.5-0.5B)
- Knowledge graph (entity-relationship extraction, dedup, API endpoints)
- Listen tracking (80% completion detection, listened badge)
- Backfill pipeline (`readcast backfill` for tags + embeddings)

## Next Up

### Source-Specific Extractors
- Extractor dispatcher: route URLs by domain to specialized extractors
- arXiv: extract title, authors, abstract from arxiv.org URLs
- Twitter/X: authenticated API path via secondary account for thread capture
- Substack: newsletter-specific metadata (newsletter name, subtitle)

### Search & Library UI
- Rich search with filters: author, source type, date range, tags
- Result snippets with highlighted matches
- Article library grid/list view with sorting and batch operations
- Thumbnails from og:image
- Related articles via semantic similarity
- Tags and collections for organizing content

## Ideas / Future

### AI-Assisted Content Parsing
- Small model to handle formulas, images, complex layouts
- Convert non-naratable content to naratable text (describe images, read equations aloud)

### RSS/Atom Feed Ingestion
- Subscribe to feeds as input sources
- Auto-ingest new articles from feeds you follow

### Mobile Companion
- Companion app or PWA for listening on the go
- Sync via podcast feed already works for audio

### Export & Sync
- Export article library as JSON/CSV
- Sync between machines via shared storage or cloud

### Alternative TTS Backends
- Plugin architecture for TTS providers beyond kokoro-edge
- Cloud TTS options (ElevenLabs, OpenAI TTS) for users without Apple Silicon
