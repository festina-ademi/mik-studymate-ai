"""Participant-facing Study Mode API, mounted at ``/api/study``.

Every endpoint after participant creation is scoped by the participant's own code — there is no
session cookie or login for participants, since the code itself (kept only by the participant)
is the credential, matching the "no personal data, no accounts" design of the study.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.errors import AppError
from app.llm.factory import get_llm_provider
from app.study import service
from app.study.models import StudyPhase
from app.study.service import (
    ConsentRequest,
    ParticipantResponse,
    QuestionnaireRequest,
    RetentionStatusResponse,
    SubmitTestRequest,
    SubmitTestResponse,
    TestPublic,
    TimerStatusResponse,
    UsageEventRequest,
    WithdrawResponse,
)

router = APIRouter(prefix="/study", tags=["study"])


def _timer_response(status: service.TimerStatus) -> TimerStatusResponse:
    return TimerStatusResponse(
        started=status.started,
        duration_seconds=status.duration_seconds,
        remaining_seconds=status.remaining_seconds,
        expired=status.expired,
    )


@router.post("/participants", response_model=ParticipantResponse)
async def create_participant(
    request: Request,
    payload: ConsentRequest,
    session: Session = Depends(get_session),
) -> ParticipantResponse:
    """Record consent and create a new participant: language, consent → code + balanced group."""
    settings = request.app.state.settings
    participant = service.create_participant(
        session,
        language=payload.language,
        consent=payload.consent,
        block_size=settings.study_block_size,
    )
    return service.to_participant_response(participant, settings)


@router.get("/participants/{code}", response_model=ParticipantResponse)
async def get_participant(
    code: str, request: Request, session: Session = Depends(get_session)
) -> ParticipantResponse:
    """The participant's current state, so the frontend can resume the flow after a refresh."""
    participant = service.get_participant_by_code(session, code)
    return service.to_participant_response(participant, request.app.state.settings)


@router.post("/participants/{code}/timer/start", response_model=TimerStatusResponse)
async def start_timer(
    code: str, request: Request, session: Session = Depends(get_session)
) -> TimerStatusResponse:
    """Start the study session timer (idempotent: a later call just reports the status)."""
    participant = service.get_participant_by_code(session, code)
    settings = request.app.state.settings
    status = service.start_session_timer(
        session, participant, duration_seconds=settings.study_session_minutes * 60
    )
    return _timer_response(status)


@router.get("/participants/{code}/timer", response_model=TimerStatusResponse)
async def get_timer(code: str, session: Session = Depends(get_session)) -> TimerStatusResponse:
    """The study session timer's current status."""
    participant = service.get_participant_by_code(session, code)
    return _timer_response(service.get_session_timer(participant))


@router.get("/participants/{code}/test", response_model=TestPublic)
async def get_immediate_test(code: str, session: Session = Depends(get_session)) -> TestPublic:
    """The immediate test's items (no answer key), in the participant's study language."""
    participant = service.get_participant_by_code(session, code)
    return service.get_immediate_test(participant)


@router.post("/participants/{code}/test/immediate", response_model=SubmitTestResponse)
async def submit_immediate_test(
    code: str,
    request: Request,
    payload: SubmitTestRequest,
    session: Session = Depends(get_session),
) -> SubmitTestResponse:
    """Grade and store the immediate test (once per participant)."""
    participant = service.get_participant_by_code(session, code)
    settings = request.app.state.settings
    duration = service.compute_submission_duration_seconds(participant, StudyPhase.IMMEDIATE)
    provider = get_llm_provider(request) if settings.study_llm_assisted_scoring else None
    submission = await service.submit_test(
        session,
        participant,
        phase=StudyPhase.IMMEDIATE,
        answers=payload.answers,
        duration_seconds=duration,
        provider=provider,
        use_llm_assist=settings.study_llm_assisted_scoring,
    )
    return SubmitTestResponse(
        phase=submission.phase.value,
        total_score=submission.total_score,
        max_possible_score=submission.max_possible_score,
    )


@router.post("/participants/{code}/questionnaire", status_code=204)
async def submit_questionnaire(
    code: str, payload: QuestionnaireRequest, session: Session = Depends(get_session)
) -> None:
    """Store the experimental group's post-session questionnaire (once per participant)."""
    participant = service.get_participant_by_code(session, code)
    service.submit_questionnaire(session, participant, payload=payload)


@router.get("/participants/{code}/retention", response_model=RetentionStatusResponse)
async def get_retention(
    code: str, request: Request, session: Session = Depends(get_session)
) -> RetentionStatusResponse:
    """Whether the retention test has unlocked yet, and its items once it has."""
    participant = service.get_participant_by_code(session, code)
    return service.get_retention_status(session, participant, request.app.state.settings)


@router.post("/participants/{code}/test/retention", response_model=SubmitTestResponse)
async def submit_retention_test(
    code: str,
    request: Request,
    payload: SubmitTestRequest,
    session: Session = Depends(get_session),
) -> SubmitTestResponse:
    """Grade and store the retention test (once per participant, once unlocked)."""
    participant = service.get_participant_by_code(session, code)
    settings = request.app.state.settings
    status = service.get_retention_status(session, participant, settings)
    if not status.unlocked:
        raise AppError(403, "retention_locked")
    duration = service.compute_submission_duration_seconds(participant, StudyPhase.RETENTION)
    provider = get_llm_provider(request) if settings.study_llm_assisted_scoring else None
    submission = await service.submit_test(
        session,
        participant,
        phase=StudyPhase.RETENTION,
        answers=payload.answers,
        duration_seconds=duration,
        provider=provider,
        use_llm_assist=settings.study_llm_assisted_scoring,
    )
    return SubmitTestResponse(
        phase=submission.phase.value,
        total_score=submission.total_score,
        max_possible_score=submission.max_possible_score,
    )


@router.post("/participants/{code}/usage-events", status_code=204)
async def log_usage_event(
    code: str, payload: UsageEventRequest, session: Session = Depends(get_session)
) -> None:
    """Log one feature-usage event (tab view, quiz attempt) for an experimental participant."""
    participant = service.get_participant_by_code(session, code)
    service.log_usage_event(
        session, participant, event_type=payload.event_type, detail=payload.detail
    )


@router.post("/participants/{code}/withdraw", response_model=WithdrawResponse)
async def withdraw(code: str, session: Session = Depends(get_session)) -> WithdrawResponse:
    """Withdraw and delete all of the participant's substantive data."""
    participant = service.get_participant_by_code(session, code)
    service.withdraw_participant(session, participant)
    return WithdrawResponse(withdrawn=True)
