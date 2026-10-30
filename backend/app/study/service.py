"""Participant-facing Study Mode business logic.

Consent, group assignment, the study timer, test delivery/submission, the questionnaire, usage
logging and withdrawal. Admin-facing logic (material/test import, overview, statistics, export)
lives in ``app.study.admin_service`` instead.
"""

from __future__ import annotations

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import QuestionKind, as_utc, utc_now
from app.domain import Language
from app.errors import AppError
from app.llm.base import LLMProvider
from app.study.models import (
    Participant,
    QuestionnaireResponse,
    StudyGroup,
    StudyMaterial,
    StudyPhase,
    StudyTest,
    TestItem,
    TestSubmission,
    UsageEvent,
    UsageEventType,
)
from app.study.randomization import DEFAULT_BLOCK_SIZE, assign_group, generate_participant_code
from app.study.scoring import score_submission_item
from app.study.timing import TimerStatus, retention_unlock_at, timer_status

_MAX_CODE_ATTEMPTS = 20


def _language_from_value(value: str) -> Language:
    try:
        return Language(value)
    except ValueError as exc:
        raise AppError(
            422, "validation_error", details={"field": "language", "value": value}
        ) from exc


# --- schemas --------------------------------------------------------------------------------


class ConsentRequest(BaseModel):
    """Request payload for creating a new participant."""

    language: str
    consent: bool


class ParticipantResponse(BaseModel):
    """A participant's current state, enough for the frontend to resume the flow."""

    code: str
    group: str
    language: str
    document_id: str | None
    material_name: str | None
    withdrawn: bool
    immediate_submitted: bool
    questionnaire_submitted: bool
    retention_submitted: bool
    retention_unlock_at: str | None


class TimerStatusResponse(BaseModel):
    """The study session timer, as the server sees it."""

    started: bool
    duration_seconds: int | None
    remaining_seconds: float | None
    expired: bool


class TestItemPublic(BaseModel):
    """One test item as shown to the participant: never the correct answer or rubric."""

    __test__ = False  # not a pytest test class; its name just starts with "Test"

    id: int
    kind: str
    topic: str
    question: str
    options: list[str] = Field(default_factory=list)
    max_score: float


class TestPublic(BaseModel):
    """A full test, ready to render one item per page."""

    __test__ = False  # not a pytest test class; its name just starts with "Test"

    test_id: str
    items: list[TestItemPublic]


class SubmitAnswer(BaseModel):
    """One answered item in a test submission."""

    item_id: int
    answer: str


class SubmitTestRequest(BaseModel):
    """Request payload for submitting a full test sitting."""

    answers: list[SubmitAnswer]


class SubmitTestResponse(BaseModel):
    """Just the score: per-item correctness is withheld so it cannot bias the later sitting."""

    phase: str
    total_score: float
    max_possible_score: float


class QuestionnaireRequest(BaseModel):
    """The experimental group's short post-session questionnaire."""

    perceived_usefulness: int = Field(ge=1, le=5)
    ease_of_understanding: int = Field(ge=1, le=5)
    open_comment: str | None = None


class RetentionStatusResponse(BaseModel):
    """Whether the retention test has unlocked yet, for the thank-you and return pages."""

    unlocked: bool
    unlock_at: str
    already_submitted: bool
    test: TestPublic | None = None


class UsageEventRequest(BaseModel):
    """One feature-usage event from the experimental workspace."""

    event_type: str
    detail: str | None = None


class WithdrawResponse(BaseModel):
    """Confirmation that a participant's data was deleted."""

    withdrawn: bool


# --- lookups ----------------------------------------------------------------------------------


def get_active_material(session: Session) -> StudyMaterial:
    """The currently active study material, or ``AppError(503, "study_not_configured")``."""
    material = session.scalar(select(StudyMaterial).where(StudyMaterial.is_active.is_(True)))
    if material is None:
        raise AppError(503, "study_not_configured")
    return material


def get_active_test(session: Session) -> StudyTest:
    """The currently active study test, or ``AppError(503, "study_not_configured")``."""
    test = session.scalar(select(StudyTest).where(StudyTest.is_active.is_(True)))
    if test is None:
        raise AppError(503, "study_not_configured")
    return test


def get_participant_by_code(session: Session, code: str) -> Participant:
    """A participant by their code, or ``AppError(404, "not_found")``."""
    normalized = code.strip().upper()
    participant = session.scalar(select(Participant).where(Participant.code == normalized))
    if participant is None:
        raise AppError(404, "not_found")
    return participant


def _submission(participant: Participant, phase: StudyPhase) -> TestSubmission | None:
    return next((s for s in participant.submissions if s.phase == phase), None)


# --- participant creation ---------------------------------------------------------------------


def create_participant(
    session: Session, *, language: str, consent: bool, block_size: int = DEFAULT_BLOCK_SIZE
) -> Participant:
    """Record consent, assign a balanced group and the active material/test, and issue a code.

    See :func:`app.study.randomization.assign_group` for the balancing algorithm.
    """
    if not consent:
        raise AppError(400, "consent_required")
    parsed_language = _language_from_value(language)
    material = get_active_material(session)
    test = get_active_test(session)

    assigned_so_far = list(
        session.scalars(select(Participant.group).order_by(Participant.created_at)).all()
    )
    group = assign_group(assigned_so_far, block_size=block_size)

    code = None
    for _ in range(_MAX_CODE_ATTEMPTS):
        candidate = generate_participant_code()
        collision = session.scalar(select(Participant.id).where(Participant.code == candidate))
        if collision is None:
            code = candidate
            break
    if code is None:  # pragma: no cover - astronomically unlikely with a 33^4 code space
        raise AppError(500, "internal_error")

    participant = Participant(
        code=code,
        group=group,
        language=parsed_language,
        study_material_id=material.id,
        study_test_id=test.id,
    )
    session.add(participant)
    session.commit()
    return participant


def to_participant_response(participant: Participant, settings: Settings) -> ParticipantResponse:
    """Build the participant-facing state summary."""
    immediate = _submission(participant, StudyPhase.IMMEDIATE)
    retention = _submission(participant, StudyPhase.RETENTION)
    unlock_at = (
        retention_unlock_at(immediate.submitted_at, settings).isoformat() if immediate else None
    )
    material = participant.study_material
    return ParticipantResponse(
        code=participant.code,
        group=participant.group.value,
        language=participant.language.value,
        document_id=material.document_id if material else None,
        material_name=material.name if material else None,
        withdrawn=participant.withdrawn,
        immediate_submitted=immediate is not None,
        questionnaire_submitted=participant.questionnaire is not None,
        retention_submitted=retention is not None,
        retention_unlock_at=unlock_at,
    )


# --- study session timer -----------------------------------------------------------------------


def start_session_timer(
    session: Session, participant: Participant, *, duration_seconds: int
) -> TimerStatus:
    """Start the study session timer, once; a later call is a no-op that just reports status."""
    _require_active(participant)
    if participant.timer_started_at is None:
        participant.timer_started_at = utc_now()
        participant.timer_duration_seconds = duration_seconds
        session.commit()
    return timer_status(
        started_at=participant.timer_started_at, duration_seconds=participant.timer_duration_seconds
    )


def get_session_timer(participant: Participant) -> TimerStatus:
    """The study session timer's current status, without starting it."""
    return timer_status(
        started_at=participant.timer_started_at, duration_seconds=participant.timer_duration_seconds
    )


def _require_active(participant: Participant) -> None:
    if participant.withdrawn:
        raise AppError(410, "participant_withdrawn")


# --- test delivery and submission ---------------------------------------------------------------


def _item_public(item: TestItem, language: str) -> TestItemPublic:
    options: list[str] = []
    if item.kind == QuestionKind.MULTIPLE_CHOICE:
        options = (item.options or {}).get(language, [])
    return TestItemPublic(
        id=item.id,
        kind=item.kind.value,
        topic=item.topic,
        question=item.question.get(language, ""),
        options=options,
        max_score=item.max_score,
    )


def get_immediate_test(participant: Participant) -> TestPublic:
    """The immediate test's items, in the participant's study language, with no answer key."""
    _require_active(participant)
    test = participant.study_test
    if test is None:
        raise AppError(503, "study_not_configured")
    language = participant.language.value
    return TestPublic(test_id=test.id, items=[_item_public(item, language) for item in test.items])


def compute_submission_duration_seconds(participant: Participant, phase: StudyPhase) -> float:
    """Server-authoritative elapsed time for one test sitting.

    Immediate-test duration is measured from the study session timer's start (so it covers the
    workspace/viewer time and the test itself combined); retention-test duration is measured
    from ``retention_started_at`` (set the first time the unlocked retention test is fetched).
    Either way the clock is entirely server-side, never trusted from the client.
    """
    if phase == StudyPhase.IMMEDIATE:
        start = participant.timer_started_at
    else:
        start = participant.retention_started_at
    if start is None:
        return 0.0
    return max(0.0, (utc_now() - as_utc(start)).total_seconds())


async def submit_test(
    session: Session,
    participant: Participant,
    *,
    phase: StudyPhase,
    answers: list[SubmitAnswer],
    duration_seconds: float,
    provider: LLMProvider | None,
    use_llm_assist: bool,
) -> TestSubmission:
    """Grade and store one test sitting. Each phase may only be submitted once."""
    _require_active(participant)
    if _submission(participant, phase) is not None:
        raise AppError(409, "already_submitted")
    test = participant.study_test
    if test is None:
        raise AppError(503, "study_not_configured")

    language = participant.language.value
    items_by_id = {item.id: item for item in test.items}
    graded: list[dict[str, object]] = []
    total_score = 0.0
    max_possible_score = 0.0
    for answer in answers:
        item = items_by_id.get(answer.item_id)
        if item is None:
            continue
        score, max_score, is_correct = await score_submission_item(
            item, language, answer.answer, use_llm_assist=use_llm_assist, provider=provider
        )
        total_score += score
        max_possible_score += max_score
        graded.append(
            {
                "item_id": item.id,
                "answer": answer.answer,
                "score": score,
                "max_score": max_score,
                "is_correct": is_correct,
            }
        )

    submission = TestSubmission(
        participant_id=participant.id,
        test_id=test.id,
        phase=phase,
        answers=graded,
        total_score=total_score,
        max_possible_score=max_possible_score,
        duration_seconds=max(0.0, duration_seconds),
    )
    session.add(submission)
    session.commit()
    return submission


# --- questionnaire -----------------------------------------------------------------------------


def submit_questionnaire(
    session: Session, participant: Participant, *, payload: QuestionnaireRequest
) -> QuestionnaireResponse:
    """Store the experimental group's post-session questionnaire (once per participant)."""
    _require_active(participant)
    if participant.group != StudyGroup.EXPERIMENTAL:
        raise AppError(403, "control_group_no_questionnaire")
    if participant.questionnaire is not None:
        raise AppError(409, "already_submitted")
    response = QuestionnaireResponse(
        participant_id=participant.id,
        perceived_usefulness=payload.perceived_usefulness,
        ease_of_understanding=payload.ease_of_understanding,
        open_comment=(payload.open_comment or "").strip() or None,
    )
    session.add(response)
    session.commit()
    return response


# --- retention test ----------------------------------------------------------------------------


def get_retention_status(
    session: Session, participant: Participant, settings: Settings
) -> RetentionStatusResponse:
    """Whether the retention test has unlocked, and its items once it has (and is unanswered).

    The first time this is called while unlocked and unanswered, it also starts the
    server-authoritative retention-test timer (``Participant.retention_started_at``), the same
    way the study session timer starts — so the retention test's own duration can be measured
    without trusting the client's clock.
    """
    immediate = _submission(participant, StudyPhase.IMMEDIATE)
    if immediate is None:
        raise AppError(409, "immediate_test_required")
    unlock_at = retention_unlock_at(immediate.submitted_at, settings)
    unlocked = utc_now() >= unlock_at
    already_submitted = _submission(participant, StudyPhase.RETENTION) is not None
    test_public = None
    if unlocked and not already_submitted and not participant.withdrawn:
        test = participant.study_test
        if test is not None:
            language = participant.language.value
            test_public = TestPublic(
                test_id=test.id, items=[_item_public(item, language) for item in test.items]
            )
        if participant.retention_started_at is None:
            participant.retention_started_at = utc_now()
            session.commit()
    return RetentionStatusResponse(
        unlocked=unlocked,
        unlock_at=unlock_at.isoformat(),
        already_submitted=already_submitted,
        test=test_public,
    )


# --- usage logging (experimental group only) --------------------------------------------------


def log_usage_event(
    session: Session, participant: Participant, *, event_type: str, detail: str | None
) -> None:
    """Log one feature-usage event, only for active experimental participants."""
    if participant.withdrawn or participant.group != StudyGroup.EXPERIMENTAL:
        return
    try:
        parsed_type = UsageEventType(event_type)
    except ValueError as exc:
        raise AppError(
            422, "validation_error", details={"field": "event_type", "value": event_type}
        ) from exc
    detail_value = (detail or "").strip()[:64] or None
    session.add(
        UsageEvent(participant_id=participant.id, event_type=parsed_type, detail=detail_value)
    )
    session.commit()


# --- withdrawal ---------------------------------------------------------------------------------


def withdraw_participant(session: Session, participant: Participant) -> Participant:
    """Delete all of a participant's substantive data.

    Keeps only the anonymous bookkeeping (code, group, language, timestamps) needed for honest
    attrition reporting and to keep the block randomization balanced for everyone assigned
    after them.
    """
    if participant.withdrawn:
        return participant
    participant.submissions.clear()
    participant.questionnaire = None
    participant.usage_events.clear()
    participant.withdrawn = True
    participant.withdrawn_at = utc_now()
    participant.timer_started_at = None
    participant.timer_duration_seconds = None
    session.commit()
    return participant
