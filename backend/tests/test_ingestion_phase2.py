import io
import zipfile

import pytest
from fastapi.testclient import TestClient
from pptx import Presentation
from pypdf import PdfWriter
from reportlab.pdfgen import canvas

from app.errors import AppError
from app.ingestion.chunker import chunk_text
from app.ingestion.code import extract_code_bundle
from app.ingestion.language import detect_language
from app.ingestion.pdf import extract_pdf_pages
from app.ingestion.pipeline import ingest_upload
from app.ingestion.pptx import extract_pptx_slides


@pytest.fixture
def english_text() -> str:
    return "The algorithm sorts the values in ascending order and returns the final result."


@pytest.fixture
def albanian_text() -> str:
    return "Algoritmi rendit vlerat në rend zbritës dhe kthen rezultatin final."


def _make_pdf_bytes(pages: list[str]) -> bytes:
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer)
    for index, page_text in enumerate(pages, start=1):
        pdf.setPageSize((612, 792))
        pdf.setFont("Helvetica", 12)
        lines = page_text.splitlines()
        for offset, line in enumerate(lines, start=1):
            pdf.drawString(72, 780 - offset * 18, line)
        if index != len(pages):
            pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def test_language_detector_handles_albanian_and_english(
    english_text: str,
    albanian_text: str,
) -> None:
    english_lang, english_score = detect_language(english_text)
    albanian_lang, albanian_score = detect_language(albanian_text)

    assert english_lang == "en"
    assert albanian_lang == "sq"
    assert english_score > 0.3
    assert albanian_score > 0.3


def test_pdf_extraction_normalizes_and_strips_header_footer() -> None:
    page_1 = "StudyMate AI CS101\nIntroduction to algorithms\nStudyMate AI 2026"
    page_2 = "StudyMate AI CS101\nSorting uses comparisons\nStudyMate AI 2026"
    pdf_bytes = _make_pdf_bytes([page_1, page_2])

    pages = extract_pdf_pages(pdf_bytes)

    assert len(pages) == 2
    assert "StudyMate AI" not in pages[0]["text"]
    assert "CS101" not in pages[0]["text"]
    assert "Sorting uses comparisons" in pages[1]["text"]


def test_pdf_extraction_raises_scanned_pdf_error_for_unreadable_content() -> None:
    buffer = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.write(buffer)

    with pytest.raises(AppError, match="SCANNED_PDF"):
        extract_pdf_pages(buffer.getvalue())


def test_pptx_extractor_reads_slide_text_notes_and_tables() -> None:
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    title_box = slide.shapes.add_textbox(0.5, 0.5, 2.0, 0.5)
    title_box.text = "Sorting"
    body_box = slide.shapes.add_textbox(0.5, 1.0, 3.0, 1.5)
    body_box.text = "Bubble sort\nCompare adjacent values"

    table = slide.shapes.add_table(2, 2, 0.5, 2.5, 3.0, 1.5).table
    table.cell(0, 0).text = "A"
    table.cell(0, 1).text = "B"
    table.cell(1, 0).text = "1"
    table.cell(1, 1).text = "2"

    notes_text = slide.notes_slide.notes_text_frame
    notes_text.text = "Speaker notes: compare pairs"

    stream = io.BytesIO()
    presentation.save(stream)

    slides = extract_pptx_slides(stream.getvalue())

    assert slides[0]["title"] == "Sorting"
    assert "Bubble sort" in slides[0]["body_text"]
    assert "A | B" in slides[0]["tables"]
    assert "Speaker notes: compare pairs" in slides[0]["speaker_notes"]


def test_code_extractor_parses_python_ast_and_zip_project() -> None:
    python_code = """
class Greeter:
    def greet(self, name):
        return f"Hello {name}"

def build_message():
    return "done"
"""

    bundle = extract_code_bundle(
        [
            {"name": "sample.py", "content": python_code},
            {"name": "notes.md", "content": "### Intro\nThis is English documentation."},
        ]
    )

    chunks = bundle["chunks"]
    assert any(
        chunk["function_name"] == "Greeter" or chunk["function_name"] == "greet" for chunk in chunks
    )
    assert any("This is English documentation." in chunk["text"] for chunk in chunks)

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w") as archive:
        archive.writestr("src/main.py", python_code)
        archive.writestr("node_modules/ignored.js", "console.log('skip me');")
        archive.writestr("README.md", "This is a project description.")
    bundle_from_zip = extract_code_bundle([], zip_bytes=zip_buffer.getvalue())
    assert len(bundle_from_zip["chunks"]) >= 2
    assert all("node_modules" not in chunk["source_name"] for chunk in bundle_from_zip["chunks"])


def test_ingest_upload_extracts_a_zipped_code_project() -> None:
    """A single .zip upload must actually be decompressed, not treated as one unreadable file.

    Regression test: ``ingest_upload`` used to hand a .zip straight to the "many files" code
    path, which only recognizes individual source extensions, silently dropped the archive, and
    raised EMPTY_DOCUMENT — so project-archive uploads (advertised by SUPPORTED_EXTENSIONS) were
    unreachable end-to-end even though the archive extractor itself worked in isolation.
    """
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w") as archive:
        archive.writestr("src/main.py", "def add(a, b):\n    return a + b\n")
        archive.writestr("README.md", "Small sample project.")

    result = ingest_upload(
        [{"filename": "project.zip", "content": zip_buffer.getvalue()}],
        max_upload_bytes=25 * 1024 * 1024,
    )

    assert result["document"]["source_format"] == "code"
    assert result["chunks"]
    assert any("add" in chunk["text"] for chunk in result["chunks"])


def test_chunker_keeps_metadata_ranges() -> None:
    chunks = chunk_text(
        "This paragraph explains the algorithm in detail. It has several sentences for chunking.",
        source_type="lecture",
        page_number=7,
        section_title="Sorting",
        function_name="bubblesort",
        line_start=42,
        line_end=58,
    )

    assert chunks
    assert chunks[0]["source_type"] == "lecture"
    assert chunks[0]["page_number"] == 7
    assert chunks[0]["section_title"] == "Sorting"
    assert chunks[0]["function_name"] == "bubblesort"
    assert chunks[0]["line_start"] == 42
    assert chunks[0]["line_end"] == 58


def test_ingest_upload_deduplicates_content() -> None:
    payload = b"print('hello world')\n"

    first = ingest_upload(
        [
            {"filename": "demo.py", "content": payload, "content_type": "text/x-python"},
        ],
        session_factory=None,
    )
    second = ingest_upload(
        [
            {"filename": "demo.py", "content": payload, "content_type": "text/x-python"},
        ],
        session_factory=None,
    )

    assert first["document"]["content_hash"] == second["document"]["content_hash"]
    assert first["document"]["id"] == second["document"]["id"]


def test_upload_route_rejects_unsupported_and_large_files(client: TestClient) -> None:
    bad = client.post("/api/documents", files=[("files", ("notes.txt", b"hello world"))])
    assert bad.status_code == 400
    assert bad.json()["error"]["code"] == "UNSUPPORTED_TYPE"

    oversized = client.post(
        "/api/documents",
        files=[("files", ("large.py", b"print('x')" * 4_000_000))],
    )
    assert oversized.status_code == 413
    assert oversized.json()["error"]["code"] == "FILE_TOO_LARGE"
