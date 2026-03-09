from __future__ import annotations

import json

from readcast.core.models import Article, Chunk, TTSSegment, slugify


def test_dataclasses_round_trip() -> None:
    article = Article(
        id="deadbeef",
        source_url="https://example.com/article",
        source_file=None,
        title="Example",
        author="Author",
        publication="Publication",
        published_date="2026-03-07",
        ingested_at="2026-03-07T00:00:00Z",
        word_count=100,
        estimated_read_min=1,
        tags=["policy"],
    )
    chunk = Chunk(idx=0, chunk_type="paragraph", text="Alpha beta", html_tag="p")
    segment = TTSSegment(idx=0, text="Alpha beta", source_chunk_idx=0, source_chunk_end_idx=2)

    loaded_article = Article.from_dict(json.loads(json.dumps(article.to_dict())))
    loaded_chunk = Chunk.from_dict(json.loads(json.dumps(chunk.to_dict())))
    loaded_segment = TTSSegment.from_dict(json.loads(json.dumps(segment.to_dict())))

    assert loaded_article == article
    assert loaded_chunk == chunk
    assert loaded_segment == segment


def test_slugify() -> None:
    assert slugify("Why the US is Facing Strategic Defeat!") == "why-the-us-is-facing-strategic-defeat"
