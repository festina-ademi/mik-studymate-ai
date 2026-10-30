"""Utilities for extracting slide text, tables and notes from PPTX files."""

from __future__ import annotations

import io
from typing import Any

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

from app.errors import AppError


def _walk_group_shapes(shape: object) -> list[object]:
    """Collect shapes from grouped objects in reading order."""
    output: list[object] = []
    if getattr(shape, "has_text_frame", False):
        output.append(shape)
    if hasattr(shape, "shapes"):
        for child in shape.shapes:
            output.extend(_walk_group_shapes(child))
    return output


def _shape_text(shape: object) -> str:
    """Return text from a shape, including tables or grouped shapes."""
    if getattr(shape, "has_table", False):
        table = shape.table
        rows: list[str] = []
        for row in table.rows:
            values = [cell.text.strip() for cell in row.cells if cell.text and cell.text.strip()]
            if values:
                rows.append(" | ".join(values))
        return "\n".join(rows)
    if getattr(shape, "has_text_frame", False):
        return shape.text.strip()
    return ""


def extract_pptx_slides(pptx_bytes: bytes) -> list[dict[str, Any]]:
    """Extract slide metadata in reading order, including notes and tables."""
    if not pptx_bytes:
        raise AppError(400, "EMPTY_DOCUMENT")

    try:
        presentation = Presentation(io.BytesIO(pptx_bytes))
    except Exception as exc:  # pragma: no cover - depends on library parsing errors
        raise AppError(400, "CORRUPT_FILE") from exc

    slides: list[dict[str, Any]] = []
    for index, slide in enumerate(presentation.slides, start=1):
        title = ""
        body_lines: list[str] = []
        tables: list[str] = []
        grouped_text: list[str] = []

        for shape in slide.shapes:
            if shape.is_placeholder and shape.placeholder_format.type == 1 and shape.has_text_frame:
                title = shape.text.strip()
            if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
                for child in _walk_group_shapes(shape):
                    child_text = _shape_text(child)
                    if child_text:
                        grouped_text.append(child_text)
            if getattr(shape, "has_table", False):
                table_text = _shape_text(shape)
                if table_text:
                    tables.append(table_text)
            if getattr(shape, "has_text_frame", False) and not getattr(shape, "has_table", False):
                text = shape.text.strip()
                if text and (not title or text != title):
                    body_lines.append(text)

        notes = ""
        if getattr(slide, "notes_slide", None) is not None:
            notes_frame = getattr(slide.notes_slide, "notes_text_frame", None)
            if notes_frame is not None:
                notes = notes_frame.text.strip()

        slides.append(
            {
                "slide_number": index,
                "title": title or (body_lines[0].splitlines()[0] if body_lines else ""),
                "body_text": "\n".join(body_lines + grouped_text).strip(),
                "tables": "\n".join(tables).strip(),
                "speaker_notes": notes,
            }
        )

    return slides
