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
    """Generation tasks that have a prompt template."""

    SUMMARY = "summary"
    EXPLANATION = "explanation"
    QUIZ = "quiz"
    TUTOR = "tutor"
    REEXPLAIN = "reexplain"
    EXPLAINER = "explainer"


class ExplanationDepth(StrEnum):
    """How finely a code explanation breaks the source down (lectures ignore this)."""

    LINE_BY_LINE = "line-by-line"
    BLOCKS = "blocks"


class Difficulty(StrEnum):
    """Quiz question difficulty, normally following the learner's selected level."""

    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class MasteryLevel(StrEnum):
    """Classification of a topic's running mastery score, for the UI and the tutor profile."""

    WEAK = "weak"
    DEVELOPING = "developing"
    STRONG = "strong"
