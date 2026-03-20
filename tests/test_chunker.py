from __future__ import annotations

import re

from readcast.core.chunker import _preprocess_for_tts, create_tts_segments
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
    text = " ".join([f"Sentence number {idx} ends here." for idx in range(1, 31)])
    chunks = [Chunk(idx=5, chunk_type="paragraph", text=text, html_tag="p")]
    segments = create_tts_segments(chunks, max_chars=500)

    assert len(segments) > 1
    assert all(len(segment.text) <= 500 for segment in segments)
    assert all(segment.source_chunk_idx == 5 for segment in segments)
    assert all(segment.source_chunk_end_idx == 5 for segment in segments)


def test_no_segment_exceeds_max_chars_even_with_long_unbroken_text() -> None:
    text = "x" * 1200
    chunks = [Chunk(idx=2, chunk_type="paragraph", text=text, html_tag="p")]
    segments = create_tts_segments(chunks, max_chars=200)

    assert all(len(segment.text) <= 200 for segment in segments)
    assert all(segment.source_chunk_idx == 2 for segment in segments)


def test_default_limit_splits_long_paragraph_on_sentences() -> None:
    text = ("Sentence with room to breathe. " * 50).strip()
    assert len(text) > 800
    chunks = [Chunk(idx=3, chunk_type="paragraph", text=text, html_tag="p")]

    segments = create_tts_segments(chunks)

    assert len(segments) > 1
    assert all(len(segment.text) <= 800 for segment in segments)
    combined = _normalize(" ".join(segment.text for segment in segments))
    assert combined == _normalize(text)


def test_default_limit_splits_very_long_paragraph() -> None:
    text = ("Longer sentence for kokoro chunking behavior. " * 280).strip()
    assert len(text) > 800
    chunks = [Chunk(idx=4, chunk_type="paragraph", text=text, html_tag="p")]

    segments = create_tts_segments(chunks)

    assert len(segments) > 1
    assert all(len(segment.text) <= 800 for segment in segments)
    combined = _normalize(" ".join(segment.text for segment in segments))
    assert combined == _normalize(text)


def test_short_paragraph_under_default_stays_single() -> None:
    text = "A short sentence. Another one."
    chunks = [Chunk(idx=0, chunk_type="paragraph", text=text, html_tag="p")]

    segments = create_tts_segments(chunks)

    assert len(segments) == 1


# --- Preprocessing tests ---


def test_preprocess_numbers_decimal() -> None:
    assert "four point six" in _preprocess_for_tts("Sonnet 4.6")
    assert "three point one two" in _preprocess_for_tts("version 3.12")


def test_preprocess_numbers_integer() -> None:
    result = _preprocess_for_tts("There are 42 items.")
    assert "forty-two" in result
    assert "42" not in result


def test_preprocess_numbers_ordinal() -> None:
    result = _preprocess_for_tts("The 1st and 23rd entries.")
    assert "first" in result
    assert "twenty-third" in result


def test_preprocess_numbers_percent() -> None:
    result = _preprocess_for_tts("Growth was 50% this year.")
    assert "fifty percent" in result


def test_preprocess_numbers_currency() -> None:
    result = _preprocess_for_tts("It costs $3.12 per unit.")
    assert "three dollars" in result
    assert "twelve cents" in result


def test_preprocess_em_dash() -> None:
    result = _preprocess_for_tts("Hello\u2014world")
    assert "\u2014" not in result
    assert ", " in result


def test_preprocess_en_dash() -> None:
    result = _preprocess_for_tts("2020\u20132024")
    assert "\u2013" not in result
    assert "-" in result


def test_preprocess_multi_hyphen() -> None:
    result = _preprocess_for_tts("Hello -- world")
    assert "--" not in result
    assert ", " in result


def test_preprocess_single_hyphen_preserved() -> None:
    result = _preprocess_for_tts("well-known fact")
    assert "well-known" in result


def test_preprocess_unicode_cleanup() -> None:
    result = _preprocess_for_tts("hello\u00a0world\u200b")
    assert "\u00a0" not in result
    assert "\u200b" not in result
    assert "hello world" in result


def test_preprocess_numbers_in_full_pipeline() -> None:
    chunks = [Chunk(idx=0, chunk_type="paragraph", text="Claude Sonnet 4.6 is great.", html_tag="p")]
    segments = create_tts_segments(chunks)
    assert len(segments) == 1
    assert "four point six" in segments[0].text
    assert "4.6" not in segments[0].text
