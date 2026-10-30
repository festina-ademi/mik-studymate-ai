"""Adaptive personalization: mastery tracking, weak-topic re-explanation, and the tutor's profile.

Mastery is a running exponentially weighted moving average (EWMA) of graded quiz scores per
``(document, topic)``, in ``[0, 1]``. Each new observation is blended with the running value at
a rate that scales with the question's difficulty, so a hard question answered well moves
mastery further than an easy one (and vice versa for a wrong answer): a difficult question is
stronger evidence either way.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.models import AdaptationAction, AdaptationEvent, Document, QuizQuestion, TopicMastery
from app.domain import Difficulty, Language, Level, MasteryLevel, Task
from app.errors import AppError
from app.llm.base import LLMProvider
from app.prompts import PromptBuilder
from app.prompts.version import PROMPT_VERSION
from app.rag.embeddings import EmbeddingProvider
from app.rag.retriever import DocumentRetriever
from app.rag.store import ChromaVectorStore
from app.services.cache import CacheKey, ContentCache
from app.sse import sse_response

DEFAULT_WEAK_THRESHOLD = 0.5
DEFAULT_DEVELOPING_THRESHOLD = 0.75
DEFAULT_EWMA_ALPHA = 0.3
REEXPLAIN_TOP_K = 4

# A harder question answered (in)correctly is stronger evidence of (non-)mastery than an easy
# one, so it shifts the running average further: the EWMA's effective weight scales with this.
_DIFFICULTY_WEIGHT: dict[Difficulty, float] = {
    Difficulty.EASY: 0.7,
    Difficulty.MEDIUM: 1.0,
    Difficulty.HARD: 1.4,
}

_ONE_STEP_EASIER: dict[Level, Level] = {
    Level.ADVANCED: Level.INTERMEDIATE,
    Level.INTERMEDIATE: Level.BEGINNER,
    Level.BEGINNER: Level.BEGINNER,  # already the simplest level
}


# --- schemas ---------------------------------------------------------------------------------


class MasteryOverviewEntry(BaseModel):
    """One topic's running mastery, classified for the mastery panel and the tutor profile."""

    topic: str
    mastery: float
    level: MasteryLevel
    attempts: int
    correct: int


class WeakTopicEntry(BaseModel):
    """One document-level topic the learner has struggled with, across all quizzes."""

    topic: str
    mastery: float
    attempts: int


class ReexplainDraft(BaseModel):
    """Structured re-explanation requested from the model."""

    explanation: str = ""
    example: str = ""
    trace: str = ""
    references: list[str] = Field(default_factory=list)


class ReexplainResponse(BaseModel):
    """A weak-topic re-explanation, one level simpler with a worked example."""

    topic: str
    level: str
    explanation: str
    example: str
    trace: str = ""
    references: list[str] = Field(default_factory=list)
    mastery: float
    metadata: dict[str, object] = Field(default_factory=dict)

    async def stream_response(self) -> StreamingResponse:
        """Stream the JSON payload as SSE tokens."""

        async def iterator() -> AsyncIterator[str]:
            payload = self.model_dump_json(ensure_ascii=False)
            for index in range(0, len(payload), 32):
                yield payload[index : index + 32]

        return sse_response(iterator())


# --- mastery classification and updates -------------------------------------------------------


def classify_mastery(
    value: float,
    *,
    weak_threshold: float = DEFAULT_WEAK_THRESHOLD,
    developing_threshold: float = DEFAULT_DEVELOPING_THRESHOLD,
) -> MasteryLevel:
    """Classify a mastery value as weak/developing/strong against the given thresholds."""
    if value < weak_threshold:
        return MasteryLevel.WEAK
    if value < developing_threshold:
        return MasteryLevel.DEVELOPING
    return MasteryLevel.STRONG


def one_step_easier(level: Level) -> Level:
    """The next level down (beginner stays beginner: it is already the simplest)."""
    return _ONE_STEP_EASIER[level]


def normalize_topic(topic: str) -> str:
    """Comparison key for a topic label: trimmed, whitespace-collapsed and case-folded."""
    return " ".join(topic.split()).casefold()


def find_topic_mastery(document: Document, topic: str) -> TopicMastery | None:
    """The document's mastery row for ``topic``, matched on :func:`normalize_topic`."""
    key = normalize_topic(topic)
    for entry in document.topic_mastery:
        if normalize_topic(entry.topic) == key:
            return entry
    return None


def canonical_topic(document: Document, topic: str) -> str:
    """The stored spelling of ``topic`` if the document already tracks it, else ``topic`` trimmed.

    A topic-scoped retest pins its questions to this label so their answers update the same
    mastery row the original quiz created, however the model happened to phrase the topic.
    """
    entry = find_topic_mastery(document, topic)
    return entry.topic if entry is not None else " ".join(topic.split())


def update_topic_mastery(
    *,
    document: Document,
    question: QuizQuestion,
    score: float,
    is_correct: bool,
    alpha: float = DEFAULT_EWMA_ALPHA,
) -> tuple[float, float]:
    """Update the topic's running EWMA mastery from one graded quiz answer.

    The new observation's weight is ``alpha`` scaled by the question's difficulty, so a harder
    question shifts mastery more than an easy one. Topics match on :func:`normalize_topic`, so
    "Password Length" and "password  length" update the same row.

    Returns ``(mastery_before, mastery_after)`` for adaptation-event logging; a topic seen for
    the first time has no prior average, so its mastery becomes the observed score directly and
    ``mastery_before`` is reported as ``0.0``.
    """
    score = max(0.0, min(1.0, score))
    entry = find_topic_mastery(document, question.topic)
    if entry is not None:
        before = entry.mastery
        entry.attempts += 1
        if is_correct:
            entry.correct += 1
        effective_alpha = min(1.0, alpha * _DIFFICULTY_WEIGHT[question.difficulty])
        entry.mastery = (1 - effective_alpha) * before + effective_alpha * score
        return before, entry.mastery

    document.topic_mastery.append(
        TopicMastery(
            topic=question.topic,
            attempts=1,
            correct=1 if is_correct else 0,
            mastery=score,
        )
    )
    return 0.0, score


def log_adaptation_event(
    session: Session,
    *,
    document_id: str,
    topic: str,
    mastery_before: float,
    mastery_after: float,
    action: AdaptationAction,
) -> None:
    """Record one adaptive-loop step for later analysis (no personal data)."""
    session.add(
        AdaptationEvent(
            document_id=document_id,
            topic=topic,
            mastery_before=mastery_before,
            mastery_after=mastery_after,
            action=action,
        )
    )


# --- reading mastery ---------------------------------------------------------------------------


def get_mastery_overview(
    document: Document,
    *,
    weak_threshold: float = DEFAULT_WEAK_THRESHOLD,
    developing_threshold: float = DEFAULT_DEVELOPING_THRESHOLD,
) -> list[MasteryOverviewEntry]:
    """Every attempted topic's mastery, classified, strongest first (for the mastery panel)."""
    entries = [
        MasteryOverviewEntry(
            topic=entry.topic,
            mastery=entry.mastery,
            level=classify_mastery(
                entry.mastery,
                weak_threshold=weak_threshold,
                developing_threshold=developing_threshold,
            ),
            attempts=entry.attempts,
            correct=entry.correct,
        )
        for entry in document.topic_mastery
        if entry.attempts > 0
    ]
    return sorted(entries, key=lambda entry: entry.mastery, reverse=True)


def get_weak_topics(
    document: Document, *, weak_threshold: float = DEFAULT_WEAK_THRESHOLD
) -> list[WeakTopicEntry]:
    """Document-level topics with low running mastery, weakest first."""
    entries = [
        WeakTopicEntry(topic=entry.topic, mastery=entry.mastery, attempts=entry.attempts)
        for entry in document.topic_mastery
        if entry.attempts > 0 and entry.mastery < weak_threshold
    ]
    return sorted(entries, key=lambda entry: entry.mastery)


def render_learner_profile(
    *,
    level: Level,
    topic_entries: list[TopicMastery],
    weak_threshold: float = DEFAULT_WEAK_THRESHOLD,
    developing_threshold: float = DEFAULT_DEVELOPING_THRESHOLD,
) -> str:
    """A short block describing the learner, for the tutor's system prompt.

    Empty when there is not enough quiz history yet to say anything useful.
    """
    weak: list[str] = []
    strong: list[str] = []
    for entry in topic_entries:
        if entry.attempts <= 0:
            continue
        classification = classify_mastery(
            entry.mastery, weak_threshold=weak_threshold, developing_threshold=developing_threshold
        )
        if classification is MasteryLevel.WEAK:
            weak.append(entry.topic)
        elif classification is MasteryLevel.STRONG:
            strong.append(entry.topic)

    if not weak and not strong:
        return ""

    lines = ["## Learner profile", f"Declared level: {level.value}."]
    if weak:
        topics = ", ".join(weak)
        lines.append(
            f"Topics this learner is still weak on (from quiz results): {topics}. When these "
            "come up, offer extra clarity, check understanding, and mention that a deeper "
            "re-explanation is available."
        )
    if strong:
        topics = ", ".join(strong)
        lines.append(
            f"Topics this learner has already mastered (from quiz results): {topics}. You can "
            "be more concise and skip the basics for these."
        )
    return "\n".join(lines)


# --- re-explanation ------------------------------------------------------------------------


def _coerce_level(value: str) -> Level:
    try:
        return Level(value)
    except ValueError as exc:  # pragma: no cover - validation on endpoint input
        raise AppError(422, "validation_error", details={"field": "level", "value": value}) from exc


def _coerce_language(value: str) -> Language:
    try:
        return Language(value)
    except ValueError as exc:  # pragma: no cover - validation on endpoint input
        raise AppError(
            422, "validation_error", details={"field": "language", "value": value}
        ) from exc


def _render_topic_context(retriever: DocumentRetriever, document_id: str, topic: str) -> str:
    hits = retriever.search(document_id, topic, top_k=REEXPLAIN_TOP_K)
    if not hits:
        raise AppError(400, "EMPTY_DOCUMENT")
    sections: list[str] = []
    for hit in hits:
        heading = str(hit.metadata.get("heading") or "Document section")
        sections.append(f"[{heading}]\n{hit.text.strip()}")
    return "\n\n".join(sections)


def _current_mastery(document: Document, topic: str) -> float:
    entry = find_topic_mastery(document, topic)
    return entry.mastery if entry is not None else 0.0


async def generate_reexplanation(
    *,
    document: Document,
    provider: LLMProvider,
    cache: ContentCache,
    store: ChromaVectorStore,
    embedding_provider: EmbeddingProvider,
    topic: str,
    level: Level | str,
    language: Language | str,
    session: Session,
) -> ReexplainResponse:
    """Generate (or replay from cache) a simpler, example-led re-explanation of one weak topic.

    Uses a level one step easier than the learner's selected level, retrieves only the chunks
    most relevant to ``topic`` (not the whole document), and logs an :class:`AdaptationEvent`.
    """
    level = _coerce_level(level.value if isinstance(level, Level) else level)
    language = _coerce_language(language.value if isinstance(language, Language) else language)
    topic = (topic or "").strip()
    if not topic:
        raise AppError(400, "EMPTY_DOCUMENT")
    easier_level = one_step_easier(level)

    key = CacheKey(
        document_hash=document.content_hash,
        task=Task.REEXPLAIN,
        level=easier_level,
        language=language,
        model=provider.model,
        extra=topic.casefold(),
    )

    async def build() -> str:
        retriever = DocumentRetriever(store, embedding_provider)
        context = _render_topic_context(retriever, document.id, topic)

        builder = PromptBuilder()
        prompt = builder.build(
            task=Task.REEXPLAIN,
            content_type=document.content_type,
            level=easier_level,
            language=language,
            document_text=context,
            task_params={"topic": topic},
        )
        draft = await provider.generate_json(prompt.user, ReexplainDraft, system=prompt.system)

        payload = ReexplainResponse(
            topic=topic,
            level=easier_level.value,
            explanation=draft.explanation.strip(),
            example=draft.example.strip(),
            trace=draft.trace.strip(),
            references=draft.references[:6],
            mastery=0.0,  # placeholder; the caller fills in the current value, cached or not
            metadata={
                "document_id": document.id,
                "content_type": document.content_type.value,
                "task": Task.REEXPLAIN.value,
                "level": easier_level.value,
                "requested_level": level.value,
                "language": language.value,
                "prompt_version": PROMPT_VERSION,
                "model": provider.model,
                "cached": False,
            },
        )
        return payload.model_dump_json(ensure_ascii=False)

    cached = await cache.get_or_generate(key, build)
    payload = ReexplainResponse.model_validate_json(cached.content)
    payload.metadata["cached"] = cached.hit
    mastery_now = _current_mastery(document, topic)
    payload.mastery = mastery_now

    # Logged every time a re-explanation is delivered (cached or freshly generated), since a
    # cache hit is still an adaptive action the learner experienced.
    log_adaptation_event(
        session,
        document_id=document.id,
        topic=topic,
        mastery_before=mastery_now,
        mastery_after=mastery_now,
        action=AdaptationAction.REEXPLAIN,
    )
    session.commit()
    return payload
