from __future__ import annotations

import re

from .models import Chunk, TTSSegment


SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+")
CLAUSE_BOUNDARY = re.compile(r"(?<=[,;:])\s+")
WORD_BOUNDARY = re.compile(r"\s+")


def create_tts_segments(chunks: list[Chunk], max_chars: int = 12000) -> list[TTSSegment]:
    segments: list[TTSSegment] = []
    segment_idx = 0
    current_texts: list[str] = []
    current_start_idx: int | None = None
    current_end_idx: int | None = None
    current_length = 0

    def flush() -> None:
        nonlocal segment_idx, current_texts, current_start_idx, current_end_idx, current_length
        if not current_texts or current_start_idx is None or current_end_idx is None:
            return
        segments.append(
            TTSSegment(
                idx=segment_idx,
                text="\n\n".join(current_texts),
                source_chunk_idx=current_start_idx,
                source_chunk_end_idx=current_end_idx,
            )
        )
        segment_idx += 1
        current_texts = []
        current_start_idx = None
        current_end_idx = None
        current_length = 0

    for chunk in chunks:
        text = chunk.text.strip()
        if not text:
            continue
        if len(text) > max_chars:
            flush()
            for piece in _split_text(text, max_chars=max_chars):
                segments.append(
                    TTSSegment(
                        idx=segment_idx,
                        text=piece,
                        source_chunk_idx=chunk.idx,
                        source_chunk_end_idx=chunk.idx,
                    )
                )
                segment_idx += 1
            continue

        joiner_length = 2 if current_texts else 0
        tentative_length = current_length + joiner_length + len(text)
        if current_texts and tentative_length > max_chars:
            flush()

        if current_start_idx is None:
            current_start_idx = chunk.idx
        current_end_idx = chunk.idx
        current_texts.append(text)
        current_length = current_length + joiner_length + len(text) if current_length else len(text)

    flush()
    return segments


def _split_text(text: str, max_chars: int) -> list[str]:
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        return []
    if len(normalized) <= max_chars:
        return [normalized]
    return _split_with_boundaries(normalized, max_chars, SENTENCE_BOUNDARY, CLAUSE_BOUNDARY)


def _split_with_boundaries(
    text: str,
    max_chars: int,
    primary: re.Pattern[str],
    secondary: re.Pattern[str],
) -> list[str]:
    parts = [part.strip() for part in primary.split(text) if part.strip()]
    if len(parts) == 1:
        return _split_with_secondary(text, max_chars, secondary)
    output: list[str] = []
    current = ""
    for part in parts:
        if len(part) > max_chars:
            if current:
                output.append(current)
                current = ""
            output.extend(_split_with_secondary(part, max_chars, secondary))
            continue
        tentative = f"{current} {part}".strip() if current else part
        if len(tentative) <= max_chars:
            current = tentative
        else:
            if current:
                output.append(current)
            current = part
    if current:
        output.append(current)
    return output


def _split_with_secondary(text: str, max_chars: int, secondary: re.Pattern[str]) -> list[str]:
    parts = [part.strip() for part in secondary.split(text) if part.strip()]
    if len(parts) == 1:
        return _split_on_words(text, max_chars)

    output: list[str] = []
    current = ""
    for part in parts:
        if len(part) > max_chars:
            if current:
                output.append(current)
                current = ""
            output.extend(_split_on_words(part, max_chars))
            continue
        tentative = f"{current} {part}".strip() if current else part
        if len(tentative) <= max_chars:
            current = tentative
        else:
            if current:
                output.append(current)
            current = part
    if current:
        output.append(current)
    return output


def _split_on_words(text: str, max_chars: int) -> list[str]:
    words = [word for word in WORD_BOUNDARY.split(text) if word]
    if not words:
        return []
    output: list[str] = []
    current = ""
    for word in words:
        if len(word) > max_chars:
            if current:
                output.append(current)
                current = ""
            output.extend(_hard_wrap(word, max_chars))
            continue
        tentative = f"{current} {word}".strip() if current else word
        if len(tentative) <= max_chars:
            current = tentative
        else:
            output.append(current)
            current = word
    if current:
        output.append(current)
    return output


def _hard_wrap(text: str, max_chars: int) -> list[str]:
    return [text[idx : idx + max_chars] for idx in range(0, len(text), max_chars)]
