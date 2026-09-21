"""SQLAlchemy 2 models.

Study Mode tables (participants, sessions, tests) are added in a later phase.
Timestamps are stored in UTC; SQLite returns them without tzinfo.
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
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.domain import ContentType, Language, Level, Task


def utc_now() -> datetime:
    """Current time in UTC."""
    return datetime.now(UTC)


def new_id() -> str:
    """A random 32-character hex identifier for publicly visible rows."""
    return uuid.uuid4().hex


def _enum_column(enum_class: type[StrEnum]) -> Enum:
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


class Base(DeclarativeBase):
    """Declarative base for all models."""


class Document(Base):
    """An uploaded lecture file or source-code file."""

    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    filename: Mapped[str] = mapped_column(String(255))
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    content_type: Mapped[ContentType] = mapped_column(_enum_column(ContentType))
    source_format: Mapped[SourceFormat] = mapped_column(_enum_column(SourceFormat))
    detected_language: Mapped[Language | None] = mapped_column(_enum_column(Language))
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
    task: Mapped[Task] = mapped_column(_enum_column(Task))
    level: Mapped[Level] = mapped_column(_enum_column(Level))
    language: Mapped[Language] = mapped_column(_enum_column(Language))
    model: Mapped[str] = mapped_column(String(128))
    prompt_version: Mapped[str] = mapped_column(String(32))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class QuizSet(Base):
    """A generated quiz for a document."""

    __tablename__ = "quiz_sets"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    level: Mapped[Level] = mapped_column(_enum_column(Level))
    language: Mapped[Language] = mapped_column(_enum_column(Language))
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
    kind: Mapped[QuestionKind] = mapped_column(_enum_column(QuestionKind))
    topic: Mapped[str] = mapped_column(String(255))
    question: Mapped[str] = mapped_column(Text)
    options: Mapped[list[str] | None] = mapped_column(JSON)
    correct_answer: Mapped[str] = mapped_column(Text)
    explanation: Mapped[str | None] = mapped_column(Text)
    source_reference: Mapped[str | None] = mapped_column(String(255))

    quiz_set: Mapped[QuizSet] = relationship(back_populates="questions")
    attempts: Mapped[list["QuizAttempt"]] = relationship(
        back_populates="question", cascade="all, delete-orphan"
    )


class QuizAttempt(Base):
    """A learner's answer to a question."""

    __tablename__ = "quiz_attempts"

    id: Mapped[int] = mapped_column(primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("quiz_questions.id", ondelete="CASCADE"))
    answer: Mapped[str] = mapped_column(Text)
    is_correct: Mapped[bool] = mapped_column(Boolean)
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


class TutorMessage(Base):
    """One turn of the tutor conversation about a document."""

    __tablename__ = "tutor_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    role: Mapped[MessageRole] = mapped_column(_enum_column(MessageRole))
    content: Mapped[str] = mapped_column(Text)
    language: Mapped[Language] = mapped_column(_enum_column(Language))
    citations: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    document: Mapped[Document] = relationship(back_populates="tutor_messages")


class ExplainerScript(Base):
    """Spoken script for one section of a document, used by Explainer Mode."""

    __tablename__ = "explainer_scripts"
    __table_args__ = (
        UniqueConstraint("document_id", "section_index", "language", "level", "simplified"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    section_index: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(255))
    page_start: Mapped[int | None] = mapped_column(Integer)
    page_end: Mapped[int | None] = mapped_column(Integer)
    language: Mapped[Language] = mapped_column(_enum_column(Language))
    level: Mapped[Level] = mapped_column(_enum_column(Level))
    simplified: Mapped[bool] = mapped_column(Boolean, default=False)
    script: Mapped[str] = mapped_column(Text)
    model: Mapped[str] = mapped_column(String(128))
    prompt_version: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    document: Mapped[Document] = relationship(back_populates="explainer_scripts")
