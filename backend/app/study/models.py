"""Study Mode data model.

Participants, materials, tests, submissions, questionnaires, usage events and admin sessions
for the controlled experiment (PROJECT_SPEC.md section 9).

No personal data is ever stored. A participant is identified only by a random, human-readable
code they keep for themselves (e.g. ``P-7K2M``); there are no names, emails or IP addresses
anywhere in this schema. ``Participant.withdrawn`` documents how withdrawal is implemented:
the participant row itself (code, group, language, timestamps) is kept — deleting it outright
would silently unbalance the block randomization and understate the study's true attrition —
but every substantive answer, score, questionnaire response and usage event is deleted.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models import Base, Document, QuestionKind, enum_column, new_id, utc_now
from app.domain import Language


class StudyGroup(StrEnum):
    """The two arms of the experiment."""

    EXPERIMENTAL = "experimental"
    CONTROL = "control"


class StudyPhase(StrEnum):
    """Which sitting of the (single, shared) test a submission belongs to."""

    IMMEDIATE = "immediate"
    RETENTION = "retention"


class UsageEventType(StrEnum):
    """Feature-usage events logged for experimental participants only."""

    TAB_VIEW = "tab_view"
    QUIZ_ATTEMPT = "quiz_attempt"


class StudyMaterial(Base):
    """A candidate material set the admin imported; only the active one is given to new arrivals.

    Reuses the existing ingestion pipeline: ``document_id`` points at a normal ``Document`` row
    (with its chunks), so a participant sees the material through the same viewer/AI endpoints
    as any other uploaded document.
    """

    __tablename__ = "study_materials"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    document: Mapped[Document] = relationship()


class StudyTest(Base):
    """A researcher-authored test, imported from JSON (never AI-generated).

    The SAME test is used for both groups and both sessions; ``TestSubmission.phase`` records
    which sitting (immediate or retention) an answer set belongs to.
    """

    __tablename__ = "study_tests"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    items: Mapped[list[TestItem]] = relationship(
        back_populates="test", cascade="all, delete-orphan", order_by="TestItem.ordinal"
    )


class TestItem(Base):
    """One test item, authored bilingually so the same test can run in either study language.

    ``question``/``options``/``correct_answer``/``rubric_keywords`` are
    ``{"en": ..., "sq": ...}`` dicts; ``options``/``rubric_keywords`` are ``None`` for the
    question kind that does not use them. ``correct_answer`` for a short-answer item is a
    reference answer shown only to the admin; scoring uses ``rubric_keywords`` instead.
    """

    __test__ = False  # not a pytest test class; its name just starts with "Test"

    __tablename__ = "test_items"
    __table_args__ = (UniqueConstraint("test_id", "ordinal"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    test_id: Mapped[str] = mapped_column(ForeignKey("study_tests.id", ondelete="CASCADE"))
    ordinal: Mapped[int] = mapped_column(Integer)
    kind: Mapped[QuestionKind] = mapped_column(enum_column(QuestionKind))
    topic: Mapped[str] = mapped_column(String(255), default="General")
    question: Mapped[dict[str, str]] = mapped_column(JSON)
    options: Mapped[dict[str, list[str]] | None] = mapped_column(JSON)
    correct_answer: Mapped[dict[str, str]] = mapped_column(JSON)
    rubric_keywords: Mapped[dict[str, list[str]] | None] = mapped_column(JSON)
    max_score: Mapped[float] = mapped_column(Float, default=1.0)

    test: Mapped[StudyTest] = relationship(back_populates="items")


class Participant(Base):
    """An anonymous study participant, identified only by ``code``."""

    __tablename__ = "participants"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    group: Mapped[StudyGroup] = mapped_column(enum_column(StudyGroup))
    language: Mapped[Language] = mapped_column(enum_column(Language))
    study_material_id: Mapped[str | None] = mapped_column(
        ForeignKey("study_materials.id", ondelete="SET NULL")
    )
    study_test_id: Mapped[str | None] = mapped_column(
        ForeignKey("study_tests.id", ondelete="SET NULL")
    )
    consented_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    withdrawn: Mapped[bool] = mapped_column(Boolean, default=False)
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Server-authoritative study timer: set once, when the participant starts their session.
    timer_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    timer_duration_seconds: Mapped[int | None] = mapped_column(Integer)
    # Set once, the first time the (unlocked) retention test is fetched, so its own duration
    # can be measured the same server-authoritative way as the immediate session/test.
    retention_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    study_material: Mapped[StudyMaterial | None] = relationship()
    study_test: Mapped[StudyTest | None] = relationship()
    submissions: Mapped[list[TestSubmission]] = relationship(
        back_populates="participant", cascade="all, delete-orphan", order_by="TestSubmission.id"
    )
    questionnaire: Mapped[QuestionnaireResponse | None] = relationship(
        back_populates="participant", cascade="all, delete-orphan"
    )
    usage_events: Mapped[list[UsageEvent]] = relationship(
        back_populates="participant", cascade="all, delete-orphan", order_by="UsageEvent.id"
    )


class TestSubmission(Base):
    """One participant's graded answers for one sitting (immediate or retention) of the test."""

    __test__ = False  # not a pytest test class; its name just starts with "Test"

    __tablename__ = "test_submissions"
    __table_args__ = (UniqueConstraint("participant_id", "phase"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    participant_id: Mapped[str] = mapped_column(ForeignKey("participants.id", ondelete="CASCADE"))
    test_id: Mapped[str] = mapped_column(ForeignKey("study_tests.id", ondelete="CASCADE"))
    phase: Mapped[StudyPhase] = mapped_column(enum_column(StudyPhase))
    # [{"item_id": int, "answer": str, "score": float, "max_score": float, "is_correct": bool}]
    answers: Mapped[list[dict]] = mapped_column(JSON)
    total_score: Mapped[float] = mapped_column(Float)
    max_possible_score: Mapped[float] = mapped_column(Float)
    duration_seconds: Mapped[float] = mapped_column(Float)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    participant: Mapped[Participant] = relationship(back_populates="submissions")


class QuestionnaireResponse(Base):
    """The experimental group's short post-session questionnaire (never shown to control)."""

    __tablename__ = "questionnaire_responses"

    id: Mapped[int] = mapped_column(primary_key=True)
    participant_id: Mapped[str] = mapped_column(
        ForeignKey("participants.id", ondelete="CASCADE"), unique=True
    )
    perceived_usefulness: Mapped[int] = mapped_column(Integer)
    ease_of_understanding: Mapped[int] = mapped_column(Integer)
    open_comment: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    participant: Mapped[Participant] = relationship(back_populates="questionnaire")


class UsageEvent(Base):
    """A feature-usage event for an experimental participant: which tab, or a quiz attempt.

    Never carries personal data, only a feature name/detail string chosen from a fixed set by
    the frontend (e.g. a tab id) — never free text, never a timestamp-correlatable identifier.
    """

    __tablename__ = "usage_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    participant_id: Mapped[str] = mapped_column(ForeignKey("participants.id", ondelete="CASCADE"))
    event_type: Mapped[UsageEventType] = mapped_column(enum_column(UsageEventType))
    detail: Mapped[str | None] = mapped_column(String(64))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    participant: Mapped[Participant] = relationship(back_populates="usage_events")


class AdminSession(Base):
    """A signed-in admin session: a random opaque token, never tied to any participant."""

    __tablename__ = "admin_sessions"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
