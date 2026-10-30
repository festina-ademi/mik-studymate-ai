"""Upload and retrieval API for ingested documents."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import AliasChoices, BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.db.models import Chunk, Document
from app.db.session import get_session
from app.domain import Language, Level
from app.errors import AppError
from app.ingestion.code import detect_programming_language
from app.ingestion.pipeline import SUPPORTED_EXTENSIONS, ingest_upload
from app.llm.factory import get_llm_provider
from app.rag.factory import get_embedding_provider, get_vector_store
from app.rag.indexer import index_document
from app.services.adaptive import (
    MasteryOverviewEntry,
    ReexplainResponse,
    WeakTopicEntry,
    generate_reexplanation,
    get_mastery_overview,
    get_weak_topics,
)
from app.services.cache import ContentCache
from app.services.quiz import DEFAULT_QUESTIONS, QuizSetResponse, generate_quiz
from app.services.summary import (
    ExplanationRequest,
    ExplanationResponse,
    SummaryRequest,
    SummaryResponse,
    generate_explanation,
    generate_summary,
)
from app.services.tutor import (
    TutorHistoryEntry,
    TutorRequest,
    TutorResponse,
    clear_tutor_history,
    generate_tutor_answer,
    list_tutor_history,
)

router = APIRouter(tags=["documents"])

# Single source of truth for accepted file extensions, shared with the ingestion pipeline so the
# two can never silently drift apart (they previously did: this list was missing ".zip", which
# `app.ingestion.pipeline.SUPPORTED_EXTENSIONS` already accepted, making zip uploads unreachable).
_ALLOWED_SUFFIXES = SUPPORTED_EXTENSIONS


class DocumentSummary(BaseModel):
    """Public document metadata returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    content_hash: str
    content_type: str
    source_format: str
    detected_language: str | None = None
    size_bytes: int
    page_count: int | None = None


class ChunkSummary(BaseModel):
    """Chunk metadata returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    text: str
    heading: str | None = None
    source_name: str | None = None
    page_start: int | None = None
    page_end: int | None = None
    line_start: int | None = None
    line_end: int | None = None


class QuizRequest(BaseModel):
    """Request payload for quiz generation."""

    level: str = "intermediate"
    language: str = "en"
    stream: bool = False
    num_questions: int = Field(default=DEFAULT_QUESTIONS, ge=1, le=20)
    # Which kinds to generate ("multiple_choice", "short_answer"); both when omitted.
    # Accepted as `question_types` (or the older `types`).
    question_types: list[str] | None = Field(
        default=None, validation_alias=AliasChoices("question_types", "types")
    )
    regenerate: bool = False
    # When set, generates a short quiz scoped to just this topic (a "retest" after a
    # weak-topic re-explanation) instead of drawing from the whole document.
    topic: str | None = None
    # Bumped by the frontend on every "New quiz", so each one is a separate cached generation.
    variation_seed: int = Field(default=0, ge=0)


@router.post(
    "/documents",
    response_model=dict[str, Any],
    status_code=status.HTTP_201_CREATED,
    summary="Upload one or many files for ingestion",
)
async def upload_documents(
    request: Request,
    files: Annotated[list[UploadFile], File()],
) -> dict[str, Any]:
    """Validate, extract, and store uploaded material."""
    if not files:
        raise AppError(400, "EMPTY_DOCUMENT")

    settings = request.app.state.settings
    items: list[dict[str, Any]] = []
    for upload in files:
        filename = upload.filename
        if filename is None:
            raise AppError(400, "UNSUPPORTED_TYPE")
        suffix = Path(filename).suffix.lower()
        if suffix not in _ALLOWED_SUFFIXES:
            raise AppError(400, "UNSUPPORTED_TYPE")

        content = await upload.read()
        if len(content) > settings.max_upload_bytes:
            raise AppError(413, "FILE_TOO_LARGE", details={"max_bytes": settings.max_upload_bytes})
        if not content:
            raise AppError(400, "EMPTY_DOCUMENT")

        items.append(
            {
                "filename": Path(filename).name,
                "content": content,
                "content_type": upload.content_type,
            }
        )

    result = ingest_upload(
        items,
        session_factory=request.app.state.session_factory,
        max_upload_bytes=settings.max_upload_bytes,
    )
    _index_uploaded_document(request, result["document"]["id"])
    return result


def _index_uploaded_document(request: Request, document_id: str) -> None:
    """Build the vector index for a just-ingested document, for the grounded tutor."""
    embedding_provider = get_embedding_provider(request)
    store = get_vector_store(request)
    with request.app.state.session_factory() as session:
        document = session.get(Document, document_id)
        if document is not None:
            index_document(document, store=store, embedding_provider=embedding_provider)


# Maps the 14 real dropdown choices to a file extension `ingest_upload` already recognizes as
# code (see `app.ingestion.pipeline.SUPPORTED_EXTENSIONS`); "auto" is handled separately below.
PROGRAMMING_LANGUAGE_EXTENSIONS: dict[str, str] = {
    "python": "py",
    "javascript": "js",
    "typescript": "ts",
    "java": "java",
    "cpp": "cpp",
    "csharp": "cs",
    "php": "php",
    "sql": "sql",
    "html": "html",
    "css": "css",
    "go": "go",
    "rust": "rs",
    "kotlin": "kt",
    "swift": "swift",
}
MIN_PASTED_CODE_CHARS = 10


class CodeUploadRequest(BaseModel):
    """Request payload for pasted/typed source code."""

    code: str
    language: str = "auto"
    filename: str | None = None


def _resolve_code_filename(filename: str | None, extension: str) -> str:
    """A filename ending in ``extension``, from the given name or a dated default."""
    if filename and filename.strip():
        stem = Path(filename.strip()).stem or "pasted_code"
        return f"{stem}.{extension}"
    today = datetime.now(UTC).date().isoformat()
    return f"pasted_code_{today}.{extension}"


@router.post(
    "/documents/code",
    response_model=dict[str, Any],
    status_code=status.HTTP_201_CREATED,
    summary="Ingest pasted or typed source code",
)
async def upload_code(request: Request, payload: CodeUploadRequest) -> dict[str, Any]:
    """Create a code document from pasted/typed text, instead of a file upload.

    Reuses ``ingest_upload``'s existing code path (chunking, hashing, persistence) by handing
    it a single in-memory "file" named with the resolved language's extension, so every tab
    (Summary/Explanation/Quiz/Chat/Avatar) works on it exactly as it would on an uploaded code
    file -- including RAG indexing just below, which the grounded tutor needs.
    """
    code = payload.code.strip()
    if len(code) < MIN_PASTED_CODE_CHARS:
        raise AppError(400, "EMPTY_DOCUMENT")

    requested = payload.language.strip().lower()
    if requested == "auto" or requested not in PROGRAMMING_LANGUAGE_EXTENSIONS:
        resolved_language = detect_programming_language(code)
        detected_automatically = True
    else:
        resolved_language = requested
        detected_automatically = False

    # ".md" (already an accepted upload extension) is the fallback for the ambiguous/no-match
    # case: it still routes through the generic, non-Python block chunker in
    # `ingestion/code.py`, same as every other non-Python language above. Widening the shared
    # `SUPPORTED_EXTENSIONS` allow-list itself (e.g. adding ".txt") would also loosen the
    # existing file-upload endpoint's validation, which Phase 11 must not touch.
    extension = PROGRAMMING_LANGUAGE_EXTENSIONS.get(resolved_language or "", "md")
    filename = _resolve_code_filename(payload.filename, extension)

    settings = request.app.state.settings
    result = ingest_upload(
        [{"filename": filename, "content": code}],
        session_factory=request.app.state.session_factory,
        max_upload_bytes=settings.max_upload_bytes,
    )
    _index_uploaded_document(request, result["document"]["id"])
    result["detected_programming_language"] = resolved_language
    result["language_detected_automatically"] = detected_automatically
    return result


@router.get("/documents/{document_id}", response_model=DocumentSummary)
async def get_document(document_id: str, session: Session = Depends(get_session)) -> Document:
    """Fetch a stored document by id."""
    document = session.get(Document, document_id)
    if document is None:
        raise AppError(404, "not_found")
    return document


@router.post("/documents/{document_id}/summary", response_model=None)
async def post_document_summary(
    document_id: str,
    request: Request,
    payload: SummaryRequest,
    session: Session = Depends(get_session),
) -> SummaryResponse | StreamingResponse:
    """Generate a cached structured summary for a document."""
    document = session.get(Document, document_id)
    if document is None:
        raise AppError(404, "not_found")
    provider = get_llm_provider(request)
    cache = ContentCache(request.app.state.session_factory)
    result = await generate_summary(
        document=document,
        provider=provider,
        cache=cache,
        level=Level(payload.level),
        language=Language(payload.language),
    )
    if payload.stream:
        return await result.stream_response()
    return result


@router.post("/documents/{document_id}/explanation", response_model=None)
async def post_document_explanation(
    document_id: str,
    request: Request,
    payload: ExplanationRequest,
    session: Session = Depends(get_session),
) -> ExplanationResponse | StreamingResponse:
    """Generate a cached structured explanation for a document."""
    document = session.get(Document, document_id)
    if document is None:
        raise AppError(404, "not_found")
    provider = get_llm_provider(request)
    cache = ContentCache(request.app.state.session_factory)
    result = await generate_explanation(
        document=document,
        provider=provider,
        cache=cache,
        level=Level(payload.level),
        language=Language(payload.language),
        depth=payload.depth,
    )
    if payload.stream:
        return await result.stream_response()
    return result


@router.post("/documents/{document_id}/quiz", response_model=None)
async def post_document_quiz(
    document_id: str,
    request: Request,
    payload: QuizRequest,
    session: Session = Depends(get_session),
) -> QuizSetResponse | StreamingResponse:
    """Generate a quiz set for a document and persist the questions."""
    document = session.get(Document, document_id)
    if document is None:
        raise AppError(404, "not_found")
    provider = get_llm_provider(request)
    cache = ContentCache(request.app.state.session_factory)
    result = await generate_quiz(
        document=document,
        provider=provider,
        cache=cache,
        level=Level(payload.level),
        language=Language(payload.language),
        num_questions=payload.num_questions,
        types=payload.question_types,
        regenerate=payload.regenerate,
        topic=payload.topic,
        variation_seed=payload.variation_seed,
        store=get_vector_store(request),
        embedding_provider=get_embedding_provider(request),
        session=session,
    )
    if payload.stream:
        return await result.stream_response()
    return result


@router.post("/documents/{document_id}/reindex", response_model=dict[str, int])
async def reindex_document(
    document_id: str,
    request: Request,
    session: Session = Depends(get_session),
) -> dict[str, int]:
    """Rebuild the vector index for a document, e.g. after changing the embedding model."""
    document = session.get(Document, document_id)
    if document is None:
        raise AppError(404, "not_found")
    embedding_provider = get_embedding_provider(request)
    store = get_vector_store(request)
    indexed_chunks = index_document(document, store=store, embedding_provider=embedding_provider)
    return {"indexed_chunks": indexed_chunks}


@router.get("/documents/{document_id}/weak-topics", response_model=list[WeakTopicEntry])
async def get_document_weak_topics(
    document_id: str,
    request: Request,
    session: Session = Depends(get_session),
) -> list[WeakTopicEntry]:
    """Topics with low running mastery for this document, weakest first."""
    document = session.get(Document, document_id)
    if document is None:
        raise AppError(404, "not_found")
    settings = request.app.state.settings
    return get_weak_topics(document, weak_threshold=settings.mastery_weak_threshold)


@router.get("/documents/{document_id}/mastery", response_model=list[MasteryOverviewEntry])
async def get_document_mastery(
    document_id: str,
    request: Request,
    session: Session = Depends(get_session),
) -> list[MasteryOverviewEntry]:
    """Every attempted topic's mastery, classified weak/developing/strong, for the mastery panel."""
    document = session.get(Document, document_id)
    if document is None:
        raise AppError(404, "not_found")
    settings = request.app.state.settings
    return get_mastery_overview(
        document,
        weak_threshold=settings.mastery_weak_threshold,
        developing_threshold=settings.mastery_developing_threshold,
    )


class ReexplainRequest(BaseModel):
    """Request payload for a weak-topic re-explanation."""

    level: str = "intermediate"
    language: str = "en"
    stream: bool = False


@router.post("/documents/{document_id}/topics/{topic}/reexplain", response_model=None)
async def post_topic_reexplain(
    document_id: str,
    topic: str,
    request: Request,
    payload: ReexplainRequest,
    session: Session = Depends(get_session),
) -> ReexplainResponse | StreamingResponse:
    """Generate a simpler, example-led re-explanation of one weak topic."""
    document = session.get(Document, document_id)
    if document is None:
        raise AppError(404, "not_found")
    provider = get_llm_provider(request)
    cache = ContentCache(request.app.state.session_factory)
    result = await generate_reexplanation(
        document=document,
        provider=provider,
        cache=cache,
        store=get_vector_store(request),
        embedding_provider=get_embedding_provider(request),
        topic=topic,
        level=Level(payload.level),
        language=Language(payload.language),
        session=session,
    )
    if payload.stream:
        return await result.stream_response()
    return result


@router.post("/documents/{document_id}/tutor", response_model=None)
async def post_document_tutor(
    document_id: str,
    request: Request,
    payload: TutorRequest,
    session: Session = Depends(get_session),
) -> TutorResponse | StreamingResponse:
    """Ask a grounded follow-up question about the uploaded material."""
    document = session.get(Document, document_id)
    if document is None:
        raise AppError(404, "not_found")
    provider = get_llm_provider(request)
    settings = request.app.state.settings
    result = await generate_tutor_answer(
        document=document,
        provider=provider,
        store=get_vector_store(request),
        embedding_provider=get_embedding_provider(request),
        message=payload.message,
        level=Level(payload.level),
        language=Language(payload.language),
        conversation_id=payload.conversation_id,
        history_limit=settings.tutor_history_messages,
        weak_threshold=settings.mastery_weak_threshold,
        developing_threshold=settings.mastery_developing_threshold,
        session=session,
    )
    if payload.stream:
        return await result.stream_response()
    return result


@router.get("/documents/{document_id}/tutor/history", response_model=list[TutorHistoryEntry])
async def get_document_tutor_history(
    document_id: str,
    session: Session = Depends(get_session),
) -> list[TutorHistoryEntry]:
    """Return the saved conversation history for a document."""
    document = session.get(Document, document_id)
    if document is None:
        raise AppError(404, "not_found")
    return list_tutor_history(document)


@router.delete("/documents/{document_id}/tutor/history", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document_tutor_history(
    document_id: str,
    session: Session = Depends(get_session),
) -> None:
    """Delete the conversation history while keeping the document itself."""
    document = session.get(Document, document_id)
    if document is None:
        raise AppError(404, "not_found")
    clear_tutor_history(document, session)


@router.get("/documents/{document_id}/chunks", response_model=list[ChunkSummary])
async def get_document_chunks(
    document_id: str,
    session: Session = Depends(get_session),
) -> list[Chunk]:
    """Fetch chunk metadata for a stored document."""
    document = session.get(Document, document_id)
    if document is None:
        raise AppError(404, "not_found")
    return document.chunks


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: str, request: Request, session: Session = Depends(get_session)
) -> None:
    """Delete a stored document, its chunks and generated data, its vector index, and its file."""
    document = session.get(Document, document_id)
    if document is None:
        raise AppError(404, "not_found")
    storage_path = document.storage_path
    session.delete(document)
    session.commit()
    get_vector_store(request).delete_document(document_id)
    if storage_path:
        _delete_uploaded_file(Path(storage_path), request.app.state.settings.upload_dir)


def _delete_uploaded_file(path: Path, upload_dir: Path) -> None:
    """Remove a stored upload, but never anything outside ``upload_dir``."""
    resolved = path.resolve()
    if resolved.is_relative_to(upload_dir.resolve()):
        resolved.unlink(missing_ok=True)
