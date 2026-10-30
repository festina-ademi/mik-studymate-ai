"""End-to-end document ingestion pipeline."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.db.models import Chunk, Document, SourceFormat
from app.domain import ContentType, Language
from app.errors import AppError
from app.ingestion.chunker import chunk_text
from app.ingestion.code import extract_code_bundle
from app.ingestion.language import detect_language
from app.ingestion.pdf import extract_pdf_pages
from app.ingestion.pptx import extract_pptx_slides

SUPPORTED_EXTENSIONS = {
    ".pdf",
    ".pptx",
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".java",
    ".c",
    ".cc",
    ".cpp",
    ".h",
    ".hpp",
    ".cs",
    ".go",
    ".rs",
    ".php",
    ".rb",
    ".kt",
    ".swift",
    ".sql",
    ".html",
    ".css",
    ".sh",
    ".json",
    ".yaml",
    ".yml",
    ".md",
    ".zip",
}


def _file_hash(payloads: list[bytes]) -> str:
    """Hash the combined upload contents for deduplication."""
    digest = hashlib.sha256()
    for payload in payloads:
        digest.update(payload)
    return digest.hexdigest()


def _sanitize_filename(filename: str) -> str:
    """Strip dangerous characters and keep a readable basename."""
    candidate = Path(filename).name
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", candidate).strip("._")
    return cleaned or "upload.bin"


def _validate_upload(file_info: dict[str, Any], *, max_upload_bytes: int) -> tuple[str, bytes, str]:
    """Validate a raw upload and produce sanitized filename, bytes, and MIME type."""
    filename = _sanitize_filename(str(file_info.get("filename") or "upload.bin"))
    content = file_info.get("content")
    mime_type = str(file_info.get("content_type") or "").lower()

    if isinstance(content, str):
        payload = content.encode("utf-8")
    elif isinstance(content, (bytes, bytearray)):
        payload = bytes(content)
    else:
        raise AppError(400, "CORRUPT_FILE")

    if not payload:
        raise AppError(400, "EMPTY_DOCUMENT")
    if len(payload) > max_upload_bytes:
        raise AppError(413, "FILE_TOO_LARGE", details={"max_bytes": max_upload_bytes})
    if Path(filename).suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise AppError(400, "UNSUPPORTED_TYPE")
    if filename.lower().endswith(".pdf") and mime_type and mime_type != "application/pdf":
        raise AppError(400, "UNSUPPORTED_TYPE")
    if (
        filename.lower().endswith(".pptx")
        and mime_type
        and mime_type
        not in {
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/octet-stream",
        }
    ):
        raise AppError(400, "UNSUPPORTED_TYPE")
    return filename, payload, mime_type


def _lecture_chunks_from_pdf(
    filename: str,
    payload: bytes,
) -> tuple[str, list[dict[str, Any]], int | None]:
    """Extract page-based chunks from a PDF."""
    pages = extract_pdf_pages(payload)
    if not pages:
        raise AppError(400, "EMPTY_DOCUMENT")

    chunks: list[dict[str, Any]] = []
    for page in pages:
        text = page["text"].strip()
        if not text:
            continue
        chunks.extend(
            chunk_text(
                text,
                source_type="lecture",
                page_number=page["page_number"],
                section_title=f"Page {page['page_number']}",
            )
        )
    return "\n\n".join(page["text"] for page in pages if page["text"]).strip(), chunks, len(pages)


def _lecture_chunks_from_pptx(
    filename: str,
    payload: bytes,
) -> tuple[str, list[dict[str, Any]], int | None]:
    """Extract slide-based chunks from a PPTX."""
    slides = extract_pptx_slides(payload)
    if not slides:
        raise AppError(400, "EMPTY_DOCUMENT")

    chunks: list[dict[str, Any]] = []
    combined: list[str] = []
    for slide in slides:
        text_sections = [
            slide.get("title", ""),
            slide.get("body_text", ""),
            slide.get("tables", ""),
            slide.get("speaker_notes", ""),
        ]
        combined_text = "\n".join(
            section for section in text_sections if section and section.strip()
        )
        if not combined_text:
            continue
        combined.append(combined_text)
        chunks.extend(
            chunk_text(
                combined_text,
                source_type="lecture",
                slide_number=slide["slide_number"],
                section_title=slide.get("title") or f"Slide {slide['slide_number']}",
            )
        )
    return "\n\n".join(combined).strip(), chunks, len(slides)


def _code_chunks_from_files(files: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]], str]:
    """Extract code chunks from one or several code files, including .zip project bundles."""
    # A single .zip must go through extract_code_bundle's zip_bytes= path so it is actually
    # decompressed (with zip-slip and zip-bomb protection); its `files=` path treats an
    # archive's own filename as just another source file and would discard it as unreadable.
    if len(files) == 1 and str(files[0].get("name") or "").lower().endswith(".zip"):
        payload = files[0].get("content")
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        if not isinstance(payload, (bytes, bytearray)) or not payload:
            raise AppError(400, "EMPTY_DOCUMENT")
        bundle = extract_code_bundle(zip_bytes=bytes(payload))
        combined = "\n\n".join(chunk["text"] for chunk in bundle["chunks"] if chunk.get("text"))
        return combined.strip(), bundle["chunks"], "code"

    code_files: list[dict[str, Any]] = []
    for file_info in files:
        name = str(file_info.get("name") or file_info.get("filename") or "upload")
        payload = file_info.get("content")
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        if not isinstance(payload, (bytes, bytearray)):
            continue
        code_files.append({"name": name, "content": bytes(payload)})

    if not code_files:
        raise AppError(400, "EMPTY_DOCUMENT")

    bundle = extract_code_bundle(code_files)
    combined = "\n\n".join(chunk["text"] for chunk in bundle["chunks"] if chunk.get("text"))
    return combined.strip(), bundle["chunks"], "code"


def ingest_upload(
    files: list[dict[str, Any]],
    *,
    session_factory: Session | None = None,
    max_upload_bytes: int = 25 * 1024 * 1024,
) -> dict[str, Any]:
    """Validate, extract, detect language, build chunks and store a single Document record.

    Args:
        files: Raw uploads as ``{"filename"/"name", "content", "content_type"}`` dicts; a single
            PDF or PPTX is treated as lecture material, anything else (including a single .zip
            project archive) as source code.
        session_factory: Session factory used to persist the document and its chunks; when
            omitted, the extracted payload is returned without touching the database.
        max_upload_bytes: Per-file size cap, in bytes. Callers reachable from an HTTP endpoint
            should always pass the configured ``settings.max_upload_bytes`` here so this second,
            internal check (defence in depth against non-HTTP callers) stays consistent with the
            limit already enforced at the API layer, instead of silently applying its own default.
    """
    if not files:
        raise AppError(400, "EMPTY_DOCUMENT")

    normalized_files: list[dict[str, Any]] = []
    payloads: list[bytes] = []
    for file_info in files:
        filename, payload, mime_type = _validate_upload(
            file_info,
            max_upload_bytes=max_upload_bytes,
        )
        payloads.append(payload)
        normalized_files.append({"name": filename, "content": payload, "content_type": mime_type})

    combined_hash = _file_hash(payloads)

    if len(normalized_files) == 1 and normalized_files[0]["name"].lower().endswith(".pdf"):
        text, chunks, page_count = _lecture_chunks_from_pdf(
            normalized_files[0]["name"],
            normalized_files[0]["content"],
        )
        source_format = SourceFormat.PDF
        content_type = ContentType.LECTURE
    elif len(normalized_files) == 1 and normalized_files[0]["name"].lower().endswith(".pptx"):
        text, chunks, page_count = _lecture_chunks_from_pptx(
            normalized_files[0]["name"],
            normalized_files[0]["content"],
        )
        source_format = SourceFormat.PPTX
        content_type = ContentType.LECTURE
    else:
        text, chunks, _ = _code_chunks_from_files(normalized_files)
        source_format = SourceFormat.CODE
        content_type = ContentType.CODE
        page_count = None

    if not text:
        raise AppError(400, "EMPTY_DOCUMENT")

    language, confidence = detect_language(text)
    document_payload = {
        "id": "upload-" + combined_hash[:16],
        "filename": normalized_files[0]["name"],
        "content_hash": combined_hash,
        "content_type": content_type.value,
        "source_format": source_format.value,
        "detected_language": language,
        "language_confidence": confidence,
        "size_bytes": sum(len(payload) for payload in payloads),
        "page_count": page_count,
        "chunks": chunks,
    }

    if session_factory is None:
        return {"document": document_payload, "chunks": chunks}

    with session_factory() as session:
        existing = session.query(Document).filter(Document.content_hash == combined_hash).first()
        if existing is not None:
            return {
                "document": {
                    "id": existing.id,
                    "filename": existing.filename,
                    "content_hash": existing.content_hash,
                    "content_type": existing.content_type.value,
                    "source_format": existing.source_format.value,
                    "detected_language": (
                        existing.detected_language.value if existing.detected_language else None
                    ),
                    "size_bytes": existing.size_bytes,
                    "page_count": existing.page_count,
                },
                "chunks": [
                    {
                        "text": chunk.text,
                        "heading": chunk.heading,
                        "source_name": chunk.source_name,
                        "page_start": chunk.page_start,
                        "page_end": chunk.page_end,
                        "line_start": chunk.line_start,
                        "line_end": chunk.line_end,
                    }
                    for chunk in existing.chunks
                ],
            }

        document = Document(
            filename=document_payload["filename"],
            content_hash=document_payload["content_hash"],
            content_type=content_type,
            source_format=source_format,
            detected_language=Language(language),
            size_bytes=document_payload["size_bytes"],
            page_count=document_payload["page_count"],
            storage_path=None,
        )
        session.add(document)
        session.flush()

        for ordinal, chunk in enumerate(chunks, start=1):
            session.add(
                Chunk(
                    document_id=document.id,
                    ordinal=ordinal,
                    text=chunk.get("text", ""),
                    heading=chunk.get("section_title") or chunk.get("function_name"),
                    source_name=chunk.get("source_name"),
                    page_start=chunk.get("page_number") or chunk.get("slide_number"),
                    page_end=chunk.get("page_number") or chunk.get("slide_number"),
                    line_start=chunk.get("line_start"),
                    line_end=chunk.get("line_end"),
                )
            )
        session.commit()

        return {
            "document": {
                "id": document.id,
                "filename": document.filename,
                "content_hash": document.content_hash,
                "content_type": document.content_type.value,
                "source_format": document.source_format.value,
                "detected_language": (
                    document.detected_language.value if document.detected_language else None
                ),
                "size_bytes": document.size_bytes,
                "page_count": document.page_count,
            },
            "chunks": [
                {
                    "text": chunk.text,
                    "heading": chunk.heading,
                    "source_name": chunk.source_name,
                    "page_start": chunk.page_start,
                    "page_end": chunk.page_end,
                    "line_start": chunk.line_start,
                    "line_end": chunk.line_end,
                }
                for chunk in document.chunks
            ],
        }
