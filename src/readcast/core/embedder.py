"""Embedding generation and semantic search using BAAI/bge-small-en-v1.5 via mlx-embeddings."""

from __future__ import annotations

import logging
import struct
from typing import Optional

_model_cache: dict[str, object] = {}

EMBEDDING_DIM = 384
MODEL_NAME = "BAAI/bge-small-en-v1.5"

log = logging.getLogger(__name__)


def _load_model():
    """Lazy-load the embedding model (cached after first call)."""
    if "model" not in _model_cache:
        from mlx_embeddings.utils import load

        model, tokenizer = load(MODEL_NAME)
        _model_cache["model"] = model
        _model_cache["tokenizer"] = tokenizer
    return _model_cache["model"], _model_cache["tokenizer"]


def _embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts, returning normalized 384-dim vectors."""
    import mlx.core as mx
    from mlx_embeddings.utils import generate

    model, tokenizer = _load_model()
    result = generate(model, tokenizer, texts)
    embeddings = result.text_embeds  # shape (N, 384)
    # L2 normalize
    norms = mx.sqrt(mx.sum(embeddings * embeddings, axis=1, keepdims=True))
    norms = mx.maximum(norms, 1e-12)
    embeddings = embeddings / norms
    return embeddings.tolist()


def embed_text(text: str) -> list[float]:
    """Generate a 384-dim embedding for a document text string."""
    return _embed_batch([text])[0]


def embed_query(text: str) -> list[float]:
    """Generate an embedding for a search query."""
    return _embed_batch([text])[0]


def embedding_to_bytes(embedding: list[float]) -> bytes:
    """Convert a list of floats to a compact bytes blob (float32)."""
    return struct.pack(f"{len(embedding)}f", *embedding)


def embedding_from_bytes(data: bytes) -> list[float]:
    """Convert a bytes blob back to a list of floats."""
    count = len(data) // 4
    return list(struct.unpack(f"{count}f", data))


def chunk_article(text: str, max_tokens: int = 300) -> list[tuple[str, int, int]]:
    """Split article text into overlapping chunks at paragraph boundaries.

    Returns list of (chunk_text, char_start, char_end).
    Strategy:
    - Split on double newlines (paragraph boundaries)
    - Merge short consecutive paragraphs up to ~max_tokens
    - Never split mid-sentence
    - Overlap by one paragraph between chunks
    """
    paragraphs: list[tuple[str, int, int]] = []
    pos = 0
    for segment in text.split("\n\n"):
        stripped = segment.strip()
        if stripped:
            start = text.find(stripped, pos)
            end = start + len(stripped)
            paragraphs.append((stripped, start, end))
            pos = end

    if not paragraphs:
        return [(text.strip(), 0, len(text))] if text.strip() else []

    def _approx_tokens(s: str) -> int:
        return len(s.split())

    chunks: list[tuple[str, int, int]] = []
    i = 0
    while i < len(paragraphs):
        merged_parts = [paragraphs[i]]
        token_count = _approx_tokens(paragraphs[i][0])
        j = i + 1
        while j < len(paragraphs) and token_count + _approx_tokens(paragraphs[j][0]) <= max_tokens:
            merged_parts.append(paragraphs[j])
            token_count += _approx_tokens(paragraphs[j][0])
            j += 1

        chunk_text = "\n\n".join(p[0] for p in merged_parts)
        chunk_start = merged_parts[0][1]
        chunk_end = merged_parts[-1][2]
        chunks.append((chunk_text, chunk_start, chunk_end))

        # Overlap: step back by one paragraph so the last paragraph of this chunk
        # becomes the first paragraph of the next chunk
        if j > i + 1:
            i = j - 1  # overlap by one paragraph
        else:
            i = j  # single paragraph chunk, just advance

    return chunks


def embed_article(article_id: str, store, text: Optional[str] = None) -> int:
    """Chunk an article, generate embeddings, and store them. Returns chunk count."""
    if text is None:
        text = store.get_full_text(article_id)
    if not text:
        return 0

    chunks = chunk_article(text)
    if not chunks:
        return 0

    # Batch embed all chunks at once for efficiency
    chunk_texts = [c[0] for c in chunks]
    vectors = _embed_batch(chunk_texts)

    records = []
    for idx, ((chunk_text, start, end), vec) in enumerate(zip(chunks, vectors)):
        records.append({
            "chunk_index": idx,
            "chunk_text": chunk_text,
            "chunk_start": start,
            "chunk_end": end,
            "embedding": embedding_to_bytes(vec),
        })

    store.store_embeddings(article_id, records)
    return len(records)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def semantic_search(query: str, store, limit: int = 20) -> list[tuple[str, float]]:
    """Search embeddings by cosine similarity. Returns list of (article_id, max_similarity)."""
    query_vec = embed_query(query)
    all_embeddings = store.get_all_embeddings()

    if not all_embeddings:
        return []

    # Score each chunk, then aggregate to article level (max similarity per article)
    article_scores: dict[str, float] = {}
    for row in all_embeddings:
        vec = embedding_from_bytes(row["embedding"])
        sim = cosine_similarity(query_vec, vec)
        aid = row["article_id"]
        if aid not in article_scores or sim > article_scores[aid]:
            article_scores[aid] = sim

    ranked = sorted(article_scores.items(), key=lambda x: x[1], reverse=True)
    return ranked[:limit]


def hybrid_search(query: str, store, limit: int = 20, k: int = 60) -> list:
    """Hybrid search using Reciprocal Rank Fusion of FTS5 + semantic results.

    RRF score: score(d) = Σ 1/(k + rank(d))
    """
    # FTS5 keyword search
    fts_results = store.search(query, limit=limit * 2)
    fts_ids = [a.id for a in fts_results]

    # Semantic search
    try:
        semantic_results = semantic_search(query, store, limit=limit * 2)
        sem_ids = [aid for aid, _ in semantic_results]
    except ImportError:
        sem_ids = []
    except Exception as exc:
        log.warning("Semantic search failed, using FTS only: %s", exc)
        sem_ids = []

    # RRF fusion
    scores: dict[str, float] = {}
    for rank, aid in enumerate(fts_ids, start=1):
        scores[aid] = scores.get(aid, 0) + 1.0 / (k + rank)
    for rank, aid in enumerate(sem_ids, start=1):
        scores[aid] = scores.get(aid, 0) + 1.0 / (k + rank)

    ranked_ids = sorted(scores, key=lambda aid: scores[aid], reverse=True)[:limit]

    # Fetch full articles in ranked order
    articles = []
    for aid in ranked_ids:
        article = store.get_article(aid)
        if article:
            articles.append(article)
    return articles
