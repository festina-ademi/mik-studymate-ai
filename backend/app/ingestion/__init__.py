"""Ingestion helpers for uploaded lecture and code documents."""

from app.ingestion.chunker import chunk_text
from app.ingestion.code import extract_code_bundle
from app.ingestion.language import detect_language
from app.ingestion.pdf import extract_pdf_pages
from app.ingestion.pipeline import ingest_upload
from app.ingestion.pptx import extract_pptx_slides

__all__ = [
    "chunk_text",
    "detect_language",
    "extract_code_bundle",
    "extract_pdf_pages",
    "extract_pptx_slides",
    "ingest_upload",
]
