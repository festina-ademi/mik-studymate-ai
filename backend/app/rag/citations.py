"""Shared helper for turning a chunk's location into a citable label."""

from __future__ import annotations

from app.db.models import Chunk


def chunk_reference(chunk: Chunk) -> str:
    """A human-readable location label for ``chunk``, e.g. ``"Page 3"`` or ``"f"``.

    Language-specific citation labels (``Faqja``/``Page``, ``Slajdi``/``Slide``) are applied by
    the prompt templates, not here: this only decides *which* location a chunk represents.
    """
    if chunk.page_start is not None and chunk.page_end is not None:
        if chunk.page_start == chunk.page_end:
            if chunk.heading and "page" in chunk.heading.lower():
                return chunk.heading
            return f"Page {chunk.page_start}"
        return f"Pages {chunk.page_start}-{chunk.page_end}"
    if chunk.heading:
        return chunk.heading
    return "Document section"


def numbered_code_lines(text: str, line_start: int | None) -> str:
    """Prefix each line of a code chunk with its absolute line number in the source file.

    This lets the model (and, separately, the Original Material panel on the frontend) point
    at an exact line instead of inventing an approximate one. ``line_start`` is ``None`` for
    text whose position in the file is not known (should not normally happen for code chunks,
    but is handled rather than risking a crash), in which case the text is returned unchanged.
    """
    if line_start is None:
        return text
    lines = text.splitlines()
    if not lines:
        return text
    width = len(str(line_start + len(lines) - 1))
    return "\n".join(f"{line_start + index:>{width}}: {line}" for index, line in enumerate(lines))
