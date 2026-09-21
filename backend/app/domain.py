"""Vocabulary shared across the backend: languages, levels, content types and tasks."""

from enum import StrEnum


class Language(StrEnum):
    """Output language chosen by the user (independent of the document language)."""

    SQ = "sq"
    EN = "en"


class Level(StrEnum):
    """Self-declared learner level."""

    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"


class ContentType(StrEnum):
    """Kind of uploaded material."""

    LECTURE = "lecture"
    CODE = "code"


class Task(StrEnum):
    """Generation tasks that have a prompt template. Later phases add more members."""

    SUMMARY = "summary"
    EXPLANATION = "explanation"
