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
- Port conflict detection on startup

## Next Up

### Source-Specific Extractors
- Extractor dispatcher: route URLs by domain to specialized extractors
- arXiv: extract title, authors, abstract from arxiv.org URLs
- Twitter/X: authenticated API path via secondary account for thread capture
- Substack: newsletter-specific metadata (newsletter name, subtitle)

### Semantic Search (MLX Embeddings)
- Local embedding model (nomic-embed-text or similar via mlx-community)
- sqlite-vec for vector storage and cosine similarity queries
- Hybrid search: FTS5 keyword + semantic similarity with weighted ranking
- Backfill embeddings for existing articles

### Search & Library UI
- Rich search with filters: author, source type, date range, tags
- Result snippets with highlighted matches
- Article library grid/list view with sorting and batch operations
- Thumbnails from og:image
- Related articles via semantic similarity
- Tags and collections for organizing content

## Ideas / Future

### MLX Author Extraction
- Use a small local MLX model (Qwen2.5-0.5B or similar) to extract author name from article text
- Run as post-processing step when HTML extraction returns no author
- Could also extract publication name, date, and summary
- Structured prompt: "Extract the author name from this text. Return only the name."

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
