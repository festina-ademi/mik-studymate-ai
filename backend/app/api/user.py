"""Cross-document history and full data wipe for the single local user, mounted at ``/api/user``.

See ``app.services.user_data`` for why these are not scoped to an account: there is no auth yet,
so "the user" means everything stored in this local instance.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.rag.factory import get_vector_store
from app.services.user_data import (
    DeleteAllUserDataResult,
    UserDocumentSummary,
    UserQuizHistoryEntry,
    delete_all_user_data,
    list_user_documents,
    list_user_quiz_history,
)

router = APIRouter(prefix="/user", tags=["user"])


@router.get("/documents", response_model=list[UserDocumentSummary])
async def get_user_documents(session: Session = Depends(get_session)) -> list[UserDocumentSummary]:
    """Every uploaded document, for the profile page's history."""
    return list_user_documents(session)


@router.get("/quiz-history", response_model=list[UserQuizHistoryEntry])
async def get_user_quiz_history(
    request: Request, session: Session = Depends(get_session)
) -> list[UserQuizHistoryEntry]:
    """Every attempted quiz, for the profile page's history."""
    weak_threshold = request.app.state.settings.mastery_weak_threshold
    return list_user_quiz_history(session, weak_threshold=weak_threshold)


@router.delete("/all-data", response_model=DeleteAllUserDataResult)
async def delete_user_all_data(
    request: Request, session: Session = Depends(get_session)
) -> DeleteAllUserDataResult:
    """Permanently delete every document, quiz, and other generated data for this local user."""
    settings = request.app.state.settings
    return delete_all_user_data(
        session, store=get_vector_store(request), tts_cache_dir=settings.tts_cache_dir
    )
