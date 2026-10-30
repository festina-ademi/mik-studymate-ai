"""SQLAlchemy 2 models.

Study Mode tables (participants, materials, tests, submissions, admin sessions) live in
``app.study.models`` instead of here, since they are a separate, self-contained feature area,
but share this module's ``Base`` (and therefore the same database and ``create_all()`` call).
Timestamps are stored in UTC; SQLite returns them without tzinfo (see :func:`as_utc`).
"""

import uuid
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.domain import ContentType, Difficulty, Language, Level, Task


def utc_now() -> datetime:
    """Current time in UTC."""
    return datetime.now(UTC)


def new_id() -> str:
    """A random 32-character hex identifier for publicly visible rows."""
    return uuid.uuid4().hex


def as_utc(value: datetime) -> datetime:
    """Attach UTC tzinfo to a naive datetime, as SQLite returns a stored one.

    Pass an already-aware value through unchanged. Needed before comparing or subtracting a
    value read back from the database against a fresh :func:`utc_now`.
    """
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def enum_column(enum_class: type[StrEnum]) -> Enum:
    """Store a ``StrEnum`` as its string value in a plain VARCHAR column."""
    return Enum(
        enum_class,
        native_enum=False,
        validate_strings=True,
        values_callable=lambda members: [member.value for member in members],
        length=32,
    )


class SourceFormat(StrEnum):
    """File format of an uploaded document."""

    PDF = "pdf"
    PPTX = "pptx"
    CODE = "code"


class QuestionKind(StrEnum):
    """Quiz question types."""

    MULTIPLE_CHOICE = "multiple_choice"
    SHORT_ANSWER = "short_answer"


class MessageRole(StrEnum):
    """Author of a tutor message."""

    USER = "user"
    ASSISTANT = "assistant"


class AdaptationAction(StrEnum):
    """What the adaptive loop did, logged for the thesis."""

    QUIZ_ANSWER = "quiz_answer"
    REEXPLAIN = "reexplain"


class Base(DeclarativeBase):
    """Declarative base for all models."""


class Document(Base):
    """An uploaded lecture file or source-code file."""

    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    filename: Mapped[str] = mapped_column(String(255))
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    content_type: Mapped[ContentType] = mapped_column(enum_column(ContentType))
    source_format: Mapped[SourceFormat] = mapped_column(enum_column(SourceFormat))
    detected_language: Mapped[Language | None] = mapped_column(enum_column(Language))
    size_bytes: Mapped[int] = mapped_column(Integer)
    page_count: Mapped[int | None] = mapped_column(Integer)
    storage_path: Mapped[str | None] = mapped_column(String(1024))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    chunks: Mapped[list["Chunk"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", order_by="Chunk.ordinal"
    )
    quiz_sets: Mapped[list["QuizSet"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )
    topic_mastery: Mapped[list["TopicMastery"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )
    adaptation_events: Mapped[list["AdaptationEvent"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", order_by="AdaptationEvent.id"
    )
    tutor_messages: Mapped[list["TutorMessage"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", order_by="TutorMessage.id"
    )
    explainer_scripts: Mapped[list["ExplainerScript"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="ExplainerScript.section_index",
    )


class Chunk(Base):
    """A retrievable piece of a document with its location, used for grounding and citations."""

    __tablename__ = "chunks"
    __table_args__ = (UniqueConstraint("document_id", "ordinal"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    ordinal: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    heading: Mapped[str | None] = mapped_column(String(255))
    # The source file name for a code chunk (a document can bundle several files); unused for
    # lecture material, where a page/slide number already identifies the source uniquely.
    source_name: Mapped[str | None] = mapped_column(String(255))
    page_start: Mapped[int | None] = mapped_column(Integer)
    page_end: Mapped[int | None] = mapped_column(Integer)
    line_start: Mapped[int | None] = mapped_column(Integer)
    line_end: Mapped[int | None] = mapped_column(Integer)

    document: Mapped[Document] = relationship(back_populates="chunks")


class GeneratedContent(Base):
    """Cached model output.

    Keyed by (document hash, task, level, language, model, prompt version); see ``CacheKey``.
    """

    __tablename__ = "generated_content"

    id: Mapped[int] = mapped_column(primary_key=True)
    cache_key: Mapped[str] = mapped_column(String(64), unique=True)
    document_hash: Mapped[str] = mapped_column(String(64), index=True)
    task: Mapped[Task] = mapped_column(enum_column(Task))
    level: Mapped[Level] = mapped_column(enum_column(Level))
    language: Mapped[Language] = mapped_column(enum_column(Language))
    model: Mapped[str] = mapped_column(String(128))
    prompt_version: Mapped[str] = mapped_column(String(32))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class QuizSet(Base):
    """A generated quiz for a document."""

    __tablename__ = "quiz_sets"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    level: Mapped[Level] = mapped_column(enum_column(Level))
    language: Mapped[Language] = mapped_column(enum_column(Language))
    model: Mapped[str] = mapped_column(String(128))
    prompt_version: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    document: Mapped[Document] = relationship(back_populates="quiz_sets")
    questions: Mapped[list["QuizQuestion"]] = relationship(
        back_populates="quiz_set", cascade="all, delete-orphan", order_by="QuizQuestion.ordinal"
    )


class QuizQuestion(Base):
    """One multiple-choice or short-answer question."""

    __tablename__ = "quiz_questions"
    __table_args__ = (UniqueConstraint("quiz_set_id", "ordinal"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    quiz_set_id: Mapped[str] = mapped_column(ForeignKey("quiz_sets.id", ondelete="CASCADE"))
    ordinal: Mapped[int] = mapped_column(Integer)
    kind: Mapped[QuestionKind] = mapped_column(enum_column(QuestionKind))
    topic: Mapped[str] = mapped_column(String(255))
    difficulty: Mapped[Difficulty] = mapped_column(enum_column(Difficulty))
    language: Mapped[Language] = mapped_column(enum_column(Language))
    question: Mapped[str] = mapped_column(Text)
    options: Mapped[list[str] | None] = mapped_column(JSON)
    correct_answer: Mapped[str] = mapped_column(Text)
    # A single-element list holding the 0-based index of the one correct option into
    # ``options`` (every multiple_choice question is single-correct). ``None`` for
    # short_answer, and for multiple_choice rows written before this column existed (grading
    # falls back to ``correct_answer`` text then). May hold a stale 2+-element list from the
    # now-removed "select all that apply" variant on a quiz cached from before that removal;
    # grading still handles that correctly since it compares option-index sets.
    correct_option_indices: Mapped[list[int] | None] = mapped_column(JSON)
    explanation: Mapped[str | None] = mapped_column(Text)
    source_reference: Mapped[str | None] = mapped_column(String(255))
    rubric: Mapped[str | None] = mapped_column(Text)
    key_points: Mapped[list[str] | None] = mapped_column(JSON)

    quiz_set: Mapped[QuizSet] = relationship(back_populates="questions")
    attempts: Mapped[list["QuizAttempt"]] = relationship(
        back_populates="question", cascade="all, delete-orphan", order_by="QuizAttempt.id"
    )


class QuizAttempt(Base):
    """A learner's answer to a question.

    ``score`` is 1.0/0.0 for multiple-choice and the LLM-graded 0..1 score for short answer.
    """

    __tablename__ = "quiz_attempts"

    id: Mapped[int] = mapped_column(primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("quiz_questions.id", ondelete="CASCADE"))
    answer: Mapped[str] = mapped_column(Text)
    is_correct: Mapped[bool] = mapped_column(Boolean)
    score: Mapped[float] = mapped_column(Float, default=0.0)
    feedback: Mapped[str | None] = mapped_column(Text)
    missing_key_points: Mapped[list[str] | None] = mapped_column(JSON)
    # True when the learner had the source material open (via the exam-mode "View source"
    # affordance) at the time of this answer; recorded for the thesis's study-mode integrity,
    # not used to penalize the score.
    peeked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    question: Mapped[QuizQuestion] = relationship(back_populates="attempts")


class TopicMastery(Base):
    """Running mastery estimate (0-1) of one topic of one document, updated from quiz answers."""

    __tablename__ = "topic_mastery"
    __table_args__ = (UniqueConstraint("document_id", "topic"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    topic: Mapped[str] = mapped_column(String(255))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    correct: Mapped[int] = mapped_column(Integer, default=0)
    mastery: Mapped[float] = mapped_column(Float, default=0.0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    document: Mapped[Document] = relationship(back_populates="topic_mastery")


class AdaptationEvent(Base):
    """One step of the adaptive loop, logged for later analysis in the thesis.

    Never carries personal data: only the document id (already anonymous), a topic name drawn
    from the material, mastery values, and which action was taken.
    """

    __tablename__ = "adaptation_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    topic: Mapped[str] = mapped_column(String(255))
    mastery_before: Mapped[float] = mapped_column(Float)
    mastery_after: Mapped[float] = mapped_column(Float)
    action: Mapped[AdaptationAction] = mapped_column(enum_column(AdaptationAction))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    document: Mapped[Document] = relationship(back_populates="adaptation_events")


class TutorMessage(Base):
    """One turn of the tutor conversation about a document.

    ``conversation_id`` groups messages into one thread; a document can have several over
    time (each "clear conversation" starts a fresh one), but only the latest is normally
    shown. ``follow_up_questions`` is only set on assistant turns.
    """

    __tablename__ = "tutor_messages"
    __table_args__ = (Index("ix_tutor_messages_conversation", "document_id", "conversation_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    conversation_id: Mapped[str] = mapped_column(String(32), default=new_id)
    role: Mapped[MessageRole] = mapped_column(enum_column(MessageRole))
    content: Mapped[str] = mapped_column(Text)
    language: Mapped[Language] = mapped_column(enum_column(Language))
    citations: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)
    follow_up_questions: Mapped[list[str] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    document: Mapped[Document] = relationship(back_populates="tutor_messages")


class ExplainerScript(Base):
    """Spoken script for one section of a document (or the overview), used by Explainer Mode.

    ``section_index`` is ``-1`` for the whole-document overview and ``0, 1, 2, ...`` for real
    sections, in playback order. ``quiz_set_id`` links to the mini-quiz generated for that
    section (``None`` for the overview, which has no mini-quiz).
    """

    __tablename__ = "explainer_scripts"
    __table_args__ = (
        UniqueConstraint("document_id", "section_index", "language", "level", "simplified"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    section_index: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(255))
    source_reference: Mapped[str | None] = mapped_column(String(255))
    page_start: Mapped[int | None] = mapped_column(Integer)
    page_end: Mapped[int | None] = mapped_column(Integer)
    line_start: Mapped[int | None] = mapped_column(Integer)
    line_end: Mapped[int | None] = mapped_column(Integer)
    language: Mapped[Language] = mapped_column(enum_column(Language))
    level: Mapped[Level] = mapped_column(enum_column(Level))
    simplified: Mapped[bool] = mapped_column(Boolean, default=False)
    script: Mapped[str] = mapped_column(Text)
    captions: Mapped[list[str]] = mapped_column(JSON, default=list)
    quiz_set_id: Mapped[str | None] = mapped_column(ForeignKey("quiz_sets.id", ondelete="SET NULL"))
    model: Mapped[str] = mapped_column(String(128))
    prompt_version: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    document: Mapped[Document] = relationship(back_populates="explainer_scripts")
    quiz_set: Mapped["QuizSet | None"] = relationship()


class UserQuotaUsage(Base):
    """One counted action (e.g. an upload) toward a client's daily quota.

    ``user_id`` is the anonymous random identifier the browser generates for itself (there are
    no accounts), never a name, email or IP address.
    """

    __tablename__ = "user_quota_usage"
    __table_args__ = (Index("ix_user_quota_usage_lookup", "user_id", "action_type", "timestamp"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64))
    action_type: Mapped[str] = mapped_column(String(32))
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
