"""Utilities for extracting and normalizing PDF text pages."""

from __future__ import annotations

import io
import re
from collections import Counter
from typing import Any

from pypdf import PdfReader

from app.errors import AppError

MAX_PAGES = 400


def _normalize_page_text(text: str) -> str:
    """Normalize whitespace and hyphenation found in extracted PDF text."""
    if not text:
        return ""
    text = text.replace("\u00a0", " ")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"(?<=\w)\s*-\s*\n\s*(?=\w)", "", text)
    text = re.sub(r"(?<=\w)\s*-\s*(?=\w)", "", text)
    lines = []
    for raw_line in text.splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def _drop_repeated_header_footer(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Remove repeated header/footer lines when they are clearly duplicated across pages."""
    if len(pages) < 2:
        return pages

    all_lines = []
    for page in pages:
        for line in page["text"].splitlines():
            stripped = line.strip()
            if len(stripped) < 3 or len(stripped.split()) > 12:
                continue
            all_lines.append(stripped)

    counts = Counter(all_lines)
    repeated = {
        line
        for line, count in counts.items()
        if count >= max(2, len(pages) // 2) and line.lower() not in {"page", "copyright"}
    }

    for page in pages:
        lines = []
        for line in page["text"].splitlines():
            stripped = line.strip()
            if stripped in repeated:
                continue
            lines.append(line)
        page["text"] = "\n".join(lines).strip()
    return pages


def extract_pdf_pages(pdf_bytes: bytes) -> list[dict[str, Any]]:
    """Extract readable text page-by-page from a PDF and normalize it."""
    if not pdf_bytes:
        raise AppError(400, "EMPTY_DOCUMENT")

    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except Exception as exc:  # pragma: no cover - depends on library parsing errors
        raise AppError(400, "CORRUPT_FILE") from exc

    if not reader.pages:
        raise AppError(400, "EMPTY_DOCUMENT")
    if len(reader.pages) > MAX_PAGES:
        raise AppError(400, "TOO_MANY_PAGES", details={"page_count": len(reader.pages)})

    pages: list[dict[str, Any]] = []
    total_text_length = 0
    for index, page in enumerate(reader.pages, start=1):
        raw_text = page.extract_text() or ""
        normalized = _normalize_page_text(raw_text)
        total_text_length += len(normalized)
        pages.append({"page_number": index, "text": normalized})

    if total_text_length < max(120, len(pages) * 60):
        raise AppError(422, "SCANNED_PDF", details={"page_count": len(pages)})

    return _drop_repeated_header_footer(pages)
