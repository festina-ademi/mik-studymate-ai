"""Token-aware chunking for text extracted from lectures and code."""

from __future__ import annotations

import math
from typing import Any

TOKEN_ESTIMATE = 4
TARGET_TOKENS = 500
OVERLAP_TOKENS = 80


def _estimate_tokens(text: str) -> int:
    """Estimate token count conservatively from word count."""
    words = text.split()
    return max(1, int(len(words) / max(1, TOKEN_ESTIMATE / 4)))


def chunk_text(
    text: str,
    *,
    source_type: str,
    page_number: int | None = None,
    slide_number: int | None = None,
    section_title: str | None = None,
    function_name: str | None = None,
    line_start: int | None = None,
    line_end: int | None = None,
) -> list[dict[str, Any]]:
    """Split text into ~500-token chunks with small overlap while preserving metadata."""
    normalized = text.strip()
    if not normalized:
        return []

    sentences = [part.strip() for part in normalized.replace("\n", " ").split(". ") if part.strip()]
    if not sentences:
        sentences = [normalized]

    chunks: list[dict[str, Any]] = []
    current: list[str] = []
    current_tokens = 0

    for sentence in sentences:
        sentence_tokens = _estimate_tokens(sentence)
        if current and current_tokens + sentence_tokens > TARGET_TOKENS:
            chunk_text_value = " ".join(current).strip()
            if chunk_text_value:
                chunks.append(
                    {
                        "text": chunk_text_value,
                        "source_type": source_type,
                        "page_number": page_number,
                        "slide_number": slide_number,
                        "section_title": section_title,
                        "function_name": function_name,
                        "line_start": line_start,
                        "line_end": line_end,
                    }
                )
            overlap_count = max(1, math.ceil(OVERLAP_TOKENS / max(1, sentence_tokens)))
            current = current[-overlap_count:] if current else []
            current_tokens = sum(_estimate_tokens(part) for part in current)
        current.append(sentence)
        current_tokens += sentence_tokens

    if current:
        chunk_text_value = " ".join(current).strip()
        if chunk_text_value:
            chunks.append(
                {
                    "text": chunk_text_value,
                    "source_type": source_type,
                    "page_number": page_number,
                    "slide_number": slide_number,
                    "section_title": section_title,
                    "function_name": function_name,
                    "line_start": line_start,
                    "line_end": line_end,
                }
            )

    return chunks
