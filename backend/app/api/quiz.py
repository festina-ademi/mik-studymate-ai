"""Quiz answering and results API, mounted at ``/api/quiz``.

Generation lives under ``/api/documents/{id}/quiz`` (see ``app.api.documents``) since it is
scoped to a document; answering and results are scoped to a quiz question/set instead.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.db.models import AdaptationAction, QuizQuestion, QuizSet
from app.db.session import get_session
from app.errors import AppError
from app.llm.factory import get_llm_provider
from app.services.adaptive import log_adaptation_event, update_topic_mastery
from app.services.quiz import (
    QuizAnswerRequest,
    QuizAnswerResult,
    QuizResultsResponse,
    build_quiz_results,
    grade_quiz_answer,
)

router = APIRouter(prefix="/quiz", tags=["quiz"])


@router.post("/{question_id}/answer", response_model=QuizAnswerResult)
async def answer_quiz_question(
    question_id: int,
    request: Request,
    payload: QuizAnswerRequest,
    session: Session = Depends(get_session),
) -> QuizAnswerResult:
    """Grade a submitted answer and update the document's topic mastery."""
    question = session.get(QuizQuestion, question_id)
    if question is None:
        raise AppError(404, "not_found")

    provider = get_llm_provider(request)
    result = await grade_quiz_answer(
        provider=provider,
        question=question,
        answer=payload.answer,
        selected_option_indices=payload.selected_option_indices,
        peeked=payload.peeked,
    )
    document = question.quiz_set.document
    mastery_before, mastery_after = update_topic_mastery(
        document=document,
        question=question,
        score=result.score,
        is_correct=result.correct,
        alpha=request.app.state.settings.mastery_ewma_alpha,
    )
    log_adaptation_event(
        session,
        document_id=document.id,
        topic=question.topic,
        mastery_before=mastery_before,
        mastery_after=mastery_after,
        action=AdaptationAction.QUIZ_ANSWER,
    )
    session.add(question)
    session.commit()
    return result


@router.get("/{quiz_set_id}/results", response_model=QuizResultsResponse)
async def get_quiz_results(
    quiz_set_id: str,
    request: Request,
    session: Session = Depends(get_session),
) -> QuizResultsResponse:
    """Aggregate score and per-topic breakdown for one generated quiz."""
    quiz_set = session.get(QuizSet, quiz_set_id)
    if quiz_set is None:
        raise AppError(404, "not_found")
    weak_threshold = request.app.state.settings.mastery_weak_threshold
    return build_quiz_results(quiz_set, weak_threshold=weak_threshold)
