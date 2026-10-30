"""Cross-document history and full data wipe for the single local user.

There is no auth yet (see ``app.api.documents``): every document and quiz attempt in the
database belongs to "the user" of this local instance, so these simply aggregate across all of
them rather than filtering by an account.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.models import Document, GeneratedContent, QuizSet
from app.rag.store import ChromaVectorStore
from app.services.quiz import build_quiz_results


class UserDocumentSummary(BaseModel):
    """One uploaded document, for the profile page's document history."""

    id: str
    filename: str
    content_type: str
    source_format: str
    size_bytes: int
    page_count: int | None = None
    created_at: str


class UserQuizHistoryEntry(BaseModel):
    """One attempted quiz, for the profile page's quiz history."""

    quiz_set_id: str
    document_id: str
    document_name: str
    level: str
    language: str
    created_at: str
    total_questions: int
    answered_questions: int
    correct_count: int
    score: float


def list_user_documents(session: Session) -> list[UserDocumentSummary]:
    """Every uploaded document, newest first."""
    documents = session.scalars(select(Document).order_by(Document.created_at.desc())).all()
    return [
        UserDocumentSummary(
            id=document.id,
            filename=document.filename,
            content_type=document.content_type.value,
            source_format=document.source_format.value,
            size_bytes=document.size_bytes,
            page_count=document.page_count,
            created_at=document.created_at.isoformat(),
        )
        for document in documents
    ]


def list_user_quiz_history(
    session: Session, *, weak_threshold: float
) -> list[UserQuizHistoryEntry]:
    """Every quiz with at least one answered question, newest first."""
    quiz_sets = session.scalars(select(QuizSet).order_by(QuizSet.created_at.desc())).all()
    entries: list[UserQuizHistoryEntry] = []
    for quiz_set in quiz_sets:
        results = build_quiz_results(quiz_set, weak_threshold=weak_threshold)
        if results.answered_questions == 0:
            continue
        entries.append(
            UserQuizHistoryEntry(
                quiz_set_id=quiz_set.id,
                document_id=quiz_set.document_id,
                document_name=quiz_set.document.filename,
                level=quiz_set.level.value,
                language=quiz_set.language.value,
                created_at=quiz_set.created_at.isoformat(),
                total_questions=results.total_questions,
                answered_questions=results.answered_questions,
                correct_count=results.correct_count,
                score=results.score,
            )
        )
    return entries


class DeleteAllUserDataResult(BaseModel):
    """How much was removed by :func:`delete_all_user_data`."""

    deleted_documents: int


def delete_all_user_data(
    session: Session, *, store: ChromaVectorStore, tts_cache_dir: Path
) -> DeleteAllUserDataResult:
    """Wipe every document, the generation cache, the vector index, and the TTS audio cache.

    Mirrors ``app.study.admin_service.delete_all_study_data``'s shape, but for the main app's
    own data rather than the Study Mode participant tables (which this never touches).
    """
    documents = session.scalars(select(Document)).all()
    deleted_documents = len(documents)
    for document in documents:
        store.delete_document(document.id)
        session.delete(document)
    session.execute(delete(GeneratedContent))
    session.commit()

    if tts_cache_dir.is_dir():
        for cached_file in tts_cache_dir.iterdir():
            if cached_file.is_file():
                cached_file.unlink(missing_ok=True)

    return DeleteAllUserDataResult(deleted_documents=deleted_documents)
