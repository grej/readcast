from __future__ import annotations

import re

from readcast.core.chunker import create_tts_segments
from readcast.core.models import Chunk


def _normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def test_short_paragraph_stays_single_segment() -> None:
    chunks = [Chunk(idx=0, chunk_type="paragraph", text="A short paragraph.", html_tag="p")]
    segments = create_tts_segments(chunks, max_chars=200)
    assert len(segments) == 1


def test_large_batches_group_contiguous_chunks() -> None:
    chunks = [
        Chunk(idx=0, chunk_type="title", text="Title", html_tag="title"),
        Chunk(idx=1, chunk_type="paragraph", text="First paragraph.", html_tag="p"),
        Chunk(idx=2, chunk_type="paragraph", text="Second paragraph.", html_tag="p"),
    ]

    segments = create_tts_segments(chunks, max_chars=80)

    assert len(segments) == 1
    assert segments[0].text == "Title\n\nFirst paragraph.\n\nSecond paragraph."
    assert segments[0].source_chunk_idx == 0
    assert segments[0].source_chunk_end_idx == 2


def test_long_paragraph_splits_on_sentence_boundaries_when_single_chunk_is_oversized() -> None:
    text = " ".join([f"Sentence {idx} ends here." for idx in range(1, 31)])
    chunks = [Chunk(idx=5, chunk_type="paragraph", text=text, html_tag="p")]
    segments = create_tts_segments(chunks, max_chars=120)

    assert len(segments) > 1
    assert all(len(segment.text) <= 120 for segment in segments)
    assert all(segment.source_chunk_idx == 5 for segment in segments)
    assert all(segment.source_chunk_end_idx == 5 for segment in segments)
    assert _normalize(" ".join(segment.text for segment in segments)) == _normalize(text)


def test_no_segment_exceeds_max_chars_even_with_long_unbroken_text() -> None:
    text = "x" * 1200
    chunks = [Chunk(idx=2, chunk_type="paragraph", text=text, html_tag="p")]
    segments = create_tts_segments(chunks, max_chars=200)

    assert all(len(segment.text) <= 200 for segment in segments)
    assert all(segment.source_chunk_idx == 2 for segment in segments)


def test_default_limit_keeps_1500_char_paragraph_as_one_segment() -> None:
    text = ("Sentence with room to breathe. " * 50).strip()
    assert len(text) < 12000
    chunks = [Chunk(idx=3, chunk_type="paragraph", text=text, html_tag="p")]

    segments = create_tts_segments(chunks)

    assert len(segments) == 1
    assert segments[0].text == _normalize(text)


def test_default_limit_keeps_3000_char_paragraph_as_one_segment() -> None:
    text = ("Longer sentence for kokoro chunking behavior. " * 80).strip()
    assert len(text) < 12000
    chunks = [Chunk(idx=4, chunk_type="paragraph", text=text, html_tag="p")]

    segments = create_tts_segments(chunks)

    assert len(segments) == 1
    assert _normalize(" ".join(segment.text for segment in segments)) == _normalize(text)


def test_default_limit_splits_very_long_paragraph() -> None:
    text = ("Longer sentence for kokoro chunking behavior. " * 280).strip()
    assert len(text) > 12000
    chunks = [Chunk(idx=4, chunk_type="paragraph", text=text, html_tag="p")]

    segments = create_tts_segments(chunks)

    assert len(segments) > 1
    assert all(len(segment.text) <= 12000 for segment in segments)
    assert _normalize(" ".join(segment.text for segment in segments)) == _normalize(text)
