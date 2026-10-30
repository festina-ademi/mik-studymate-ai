"""Quiz generation, validation and grading for uploaded documents.

Generation asks the model for a batch of questions, then runs each candidate through
:func:`_validate_and_normalize` (shape checks, grounding heuristic) and
:func:`_deduplicate` (near-duplicate removal). If that leaves fewer than the requested
count, a bounded number of extra generation rounds ask for just the shortfall
("retry-and-repair"); the quiz degrades gracefully to whatever validates rather than
failing outright, unless nothing at all survives.

Grading is deterministic for multiple-choice (the selected option-index set compared against
the stored correct one) and LLM-graded at temperature 0 for short answer, against the
question's rubric and key points. Every multiple-choice question has exactly one correct
option (single-correct, radio-button UI); the grading formula is still written in terms of an
index *set* comparison (see :func:`grade_quiz_answer`) since that was kept when a since-removed
"select all that apply" variant existed, and a one-element set works the same way.
"""

from __future__ import annotations

import logging
import random
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from difflib import SequenceMatcher

from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.models import Chunk, Document, QuestionKind, QuizAttempt, QuizQuestion, QuizSet
from app.domain import Difficulty, Language, Level, Task
from app.errors import AppError
from app.llm.base import LLMProvider
from app.prompts import PromptBuilder, TemplateStore
from app.prompts.version import PROMPT_VERSION
from app.rag.embeddings import EmbeddingProvider
from app.rag.retriever import DocumentRetriever
from app.rag.store import ChromaVectorStore
from app.services import adaptive
from app.services.cache import CacheKey, ContentCache
from app.sse import sse_response

logger = logging.getLogger(__name__)

RETEST_TOP_K = 6

MIN_QUESTIONS = 1
MAX_QUESTIONS = 20
DEFAULT_QUESTIONS = 8
MAX_GENERATION_ROUNDS = 3  # one initial attempt plus up to two repair rounds
# Extra rounds without the "already asked" list, only when a quiz is still short after the
# normal rounds (the list can rule out most of a small document's obvious questions).
NO_AVOID_LIST_ROUNDS = 1
DUPLICATE_SIMILARITY_THRESHOLD = 0.85
SHORT_ANSWER_PASS_THRESHOLD = 0.6
MAX_MISSING_KEY_POINTS = 6
# How many of the document's most recent earlier questions a new quiz is told to avoid, and how
# much of each question's text is quoted for that.
MAX_AVOID_QUESTIONS = 30
AVOID_QUESTION_CHARS = 120

_VALID_KINDS = {"multiple_choice", "short_answer"}
_VALID_DIFFICULTIES = {"easy", "medium", "hard"}
_WORD_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿËëÇç]{4,}")
_DIFFICULTY_BY_LEVEL: dict[Level, Difficulty] = {
    Level.BEGINNER: Difficulty.EASY,
    Level.INTERMEDIATE: Difficulty.MEDIUM,
    Level.ADVANCED: Difficulty.HARD,
}


# --- model-facing schemas ----------------------------------------------------------------


class QuizQuestionInput(BaseModel):
    """One question as drafted by the model, before validation and normalization."""

    kind: str = ""
    topic: str = ""
    difficulty: str = ""
    question: str = ""
    options: list[str] = Field(default_factory=list)
    correct_answer: str = ""
    # For multiple_choice: the 0-based index of the one correct option into ``options``, as a
    # single-element list. Optional on the draft itself -- a model that only fills
    # ``correct_answer`` still works, via a derived index (see ``_validate_and_normalize``); a
    # model that returns more than one index has it truncated to the first, with a warning.
    correct_option_indices: list[int] = Field(default_factory=list)
    explanation: str | None = None
    source_reference: str | None = None
    rubric: str | None = None
    key_points: list[str] = Field(default_factory=list)


class QuizSetDraft(BaseModel):
    """Draft quiz response from the provider."""

    questions: list[QuizQuestionInput] = Field(default_factory=list)
    weak_topics: list[str] = Field(default_factory=list)


class ShortAnswerGrade(BaseModel):
    """Draft grading response from the provider."""

    score: float = 0.0
    feedback: str = ""
    missing_key_points: list[str] = Field(default_factory=list)


# --- API-facing schemas -------------------------------------------------------------------


class QuizQuestionPublic(BaseModel):
    """Quiz question as shown to the learner before it is answered (no answer key)."""

    id: int
    kind: str
    topic: str
    difficulty: str
    question: str
    options: list[str] = Field(default_factory=list)
    # Always false: multi-correct ("select all that apply") questions were removed, so every
    # multiple_choice question is single-correct. Kept (rather than deleted) so an old cached
    # quiz set that predates this still deserializes and renders as radio buttons.
    allow_multiple: bool = False
    source_reference: str | None = None


class QuizSetResponse(BaseModel):
    """Quiz payload returned to the frontend."""

    quiz_set_id: str
    questions: list[QuizQuestionPublic]
    weak_topics: list[str] = Field(default_factory=list)
    metadata: dict[str, object] = Field(default_factory=dict)

    async def stream_response(self) -> StreamingResponse:
        """Stream the JSON payload as SSE tokens."""

        async def iterator() -> AsyncIterator[str]:
            payload = self.model_dump_json(ensure_ascii=False)
            for index in range(0, len(payload), 32):
                yield payload[index : index + 32]

        return sse_response(iterator())


class QuizAnswerRequest(BaseModel):
    """Request payload for answering one question."""

    answer: str = ""
    # 0-based option indices for multiple_choice (one or more); ignored for short_answer.
    selected_option_indices: list[int] = Field(default_factory=list)
    # True when the learner had opened the exam-mode "View source" affordance at least once
    # since this question (or the quiz) started.
    peeked: bool = False


class QuizAnswerResult(BaseModel):
    """Outcome of grading a single answer."""

    question_id: int
    kind: str
    topic: str
    correct: bool
    score: float
    provided: str
    expected: str
    # Revealed only now that the question has been answered, so the frontend can mark each
    # option correct/incorrect. Empty for short_answer.
    correct_option_indices: list[int] = Field(default_factory=list)
    explanation: str | None = None
    feedback: str | None = None
    missing_key_points: list[str] = Field(default_factory=list)
    source_reference: str | None = None
    peeked: bool = False


class TopicBreakdownEntry(BaseModel):
    """Aggregated performance on one topic within a quiz."""

    topic: str
    correct: int
    total: int
    answered: int
    average_score: float


class QuizResultsResponse(BaseModel):
    """Aggregated results for a whole quiz set."""

    quiz_set_id: str
    total_questions: int
    answered_questions: int
    correct_count: int
    score: float
    topic_breakdown: list[TopicBreakdownEntry]
    weak_topics: list[str]
    # True if the learner opened "View source" at any point during this quiz. Recorded for the
    # thesis's study-mode integrity; the score itself is never adjusted because of it.
    peeked: bool = False


# --- request coercion ----------------------------------------------------------------------


def _level_from_value(value: str) -> Level:
    try:
        return Level(value)
    except ValueError as exc:  # pragma: no cover - validation on endpoint input
        raise AppError(422, "validation_error", details={"field": "level", "value": value}) from exc


def _language_from_value(value: str) -> Language:
    try:
        return Language(value)
    except ValueError as exc:  # pragma: no cover - validation on endpoint input
        raise AppError(
            422, "validation_error", details={"field": "language", "value": value}
        ) from exc


def _coerce_kind(value: str) -> str:
    """Normalize a question kind, or ``""`` if it is not a recognized kind."""
    normalized = (value or "").strip().lower().replace(" ", "_").replace("-", "_")
    return normalized if normalized in _VALID_KINDS else ""


def normalize_requested_types(types: list[str] | None) -> list[str]:
    """Normalize the requested question-type mix, defaulting to both kinds when none is given.

    Always returned in the canonical order (multiple-choice first), so the same selection gives
    the same cache key whatever order the checkboxes were ticked in.

    Raises:
        AppError: Types were given but none of them is a recognized kind.
    """
    if not types:
        return ["multiple_choice", "short_answer"]
    requested = {_coerce_kind(item) for item in types} - {""}
    if not requested:
        raise AppError(422, "validation_error", details={"field": "question_types"})
    return [kind for kind in ("multiple_choice", "short_answer") if kind in requested]


def _kind_targets(num_questions: int, kinds: list[str]) -> dict[str, int]:
    """How many questions of each kind a quiz aims for.

    With both kinds requested, an even split (an odd count gives the extra question to
    multiple-choice, which leads the alternating order): an explicit count, since a model given a
    loose "roughly half" tends to drop short-answer questions entirely for some material,
    notably source code.
    """
    if {"multiple_choice", "short_answer"} <= set(kinds) and num_questions >= 2:
        short = num_questions // 2
        return {"multiple_choice": num_questions - short, "short_answer": short}
    return {kinds[0]: num_questions}


def _describe_type_mix(counts: dict[str, int]) -> str:
    """The prompt's ``{{type_mix}}`` for the questions still needed, by kind."""
    multiple_choice = counts.get("multiple_choice", 0)
    short_answer = counts.get("short_answer", 0)
    if multiple_choice and short_answer:
        return (
            f"exactly {multiple_choice} multiple-choice and {short_answer} short-answer "
            "questions (both types are required); every multiple-choice question has exactly "
            "4 options and exactly one correct option"
        )
    if multiple_choice:
        return (
            "multiple-choice questions only, each with exactly 4 options and exactly one "
            "correct option. Do NOT write any short-answer (free-text) question"
        )
    return (
        "short-answer questions only, each answered with a short written text. Do NOT write "
        "any multiple-choice question"
    )


def _interleave_kinds(questions: list[QuizQuestionInput]) -> list[QuizQuestionInput]:
    """Alternate multiple-choice and short-answer questions, multiple-choice first.

    Keeps each kind's own order; once one kind runs out, the rest of the other follows.
    """
    by_kind = {
        kind: [item for item in questions if item.kind == kind]
        for kind in ("multiple_choice", "short_answer")
    }
    interleaved: list[QuizQuestionInput] = []
    for index in range(max(len(group) for group in by_kind.values())):
        interleaved.extend(group[index] for group in by_kind.values() if index < len(group))
    return interleaved


# --- grounding / validation / deduplication -------------------------------------------------


def _chunk_reference(chunk: Chunk) -> str:
    if chunk.page_start is not None and chunk.page_end is not None:
        if chunk.page_start == chunk.page_end:
            if chunk.heading and "page" in chunk.heading.lower():
                return chunk.heading
            return f"Page {chunk.page_start}"
        return f"Pages {chunk.page_start}-{chunk.page_end}"
    if chunk.heading:
        return chunk.heading
    return "Document section"


def _render_chunk_text(document: Document) -> str:
    if not document.chunks:
        raise AppError(400, "EMPTY_DOCUMENT")
    return "\n\n".join(
        f"[{_chunk_reference(chunk)}]\n{chunk.text.strip()}" for chunk in document.chunks
    )


def _render_topic_chunk_text(
    document: Document, topic: str, store: ChromaVectorStore, embedding_provider: EmbeddingProvider
) -> str:
    """The chunks most relevant to ``topic`` only, for a topic-scoped retest quiz."""
    retriever = DocumentRetriever(store, embedding_provider)
    hits = retriever.search(document.id, topic, top_k=RETEST_TOP_K)
    if not hits:
        raise AppError(400, "EMPTY_DOCUMENT")
    return "\n\n".join(
        f"[{hit.metadata.get('heading') or 'Document section'}]\n{hit.text.strip()}" for hit in hits
    )


def _is_grounded(evidence: str, chunks: list[Chunk]) -> bool:
    """Heuristic check that a question shares real vocabulary with at least one chunk.

    ``evidence`` is everything the question says: its text, answer, explanation, options and
    key points. This cannot prove the answer is correct, but it catches fabricated questions
    that share no concrete terms with anything in the material. Looking at the question and
    answer alone was far too strict: a natural-language question about source code, or an
    answer written in another language than the material, rarely repeats two of its words,
    so most short-answer and "why/how" questions were thrown away.
    """
    haystack = {word.lower() for word in _WORD_RE.findall(evidence)}
    if not haystack:
        return False
    for chunk in chunks:
        chunk_words = {word.lower() for word in _WORD_RE.findall(chunk.text)}
        if len(haystack & chunk_words) >= 2:
            return True
    return False


def _shuffle_options(
    seed: str, options: list[str], correct_indices: list[int]
) -> tuple[list[str], list[int]]:
    """Deterministically shuffle multiple-choice options and remap the correct indices.

    Models tend to list the correct option first and then invent distractors, which would make
    "always pick option 1" a winning strategy. Seeded by ``seed`` (the question text), so the
    same question always gets the same order while different questions get different orders.
    """
    if len(options) <= 1:
        return options, correct_indices
    indexed = list(enumerate(options))
    random.Random(seed).shuffle(indexed)
    old_to_new = {old: new for new, (old, _) in enumerate(indexed)}
    return [option for _, option in indexed], sorted(old_to_new[i] for i in correct_indices)


def _validate_and_normalize(
    candidates: list[QuizQuestionInput],
    *,
    document: Document,
    level: Level,
    allowed_kinds: set[str],
) -> list[QuizQuestionInput]:
    """Keep only well-formed, grounded questions of an allowed kind, normalizing their fields."""
    chunks = list(document.chunks)
    result: list[QuizQuestionInput] = []
    for item in candidates:
        kind = _coerce_kind(item.kind)
        if kind not in allowed_kinds:
            continue
        question_text = (item.question or "").strip()
        if not question_text:
            continue
        if not (item.source_reference or "").strip():
            continue

        options: list[str] = []
        correct_answer = (item.correct_answer or "").strip()
        correct_option_indices: list[int] = []
        key_points = [point.strip() for point in item.key_points if point and point.strip()]
        if kind == "multiple_choice":
            options = [option.strip() for option in item.options if option and option.strip()]
            if len(options) != 4:
                continue
            indices = sorted(
                {index for index in item.correct_option_indices if 0 <= index < len(options)}
            )
            if not indices and correct_answer in options:
                # A draft that only filled the legacy single `correct_answer` string.
                indices = [options.index(correct_answer)]
            if not indices:
                continue
            if len(indices) > 1:
                # Every multiple-choice question is single-correct; a model that returns more
                # than one index is truncated to its first rather than rejecting an otherwise
                # good question outright.
                logger.warning(
                    "quiz_mc_multiple_correct_indices_truncated question=%r indices=%r",
                    question_text,
                    indices,
                )
                indices = indices[:1]
            options, correct_option_indices = _shuffle_options(question_text, options, indices)
            correct_answer = options[correct_option_indices[0]]
        else:
            if not key_points or not correct_answer:
                continue

        evidence = " ".join(
            [question_text, correct_answer, item.explanation or "", *options, *key_points]
        )
        if not _is_grounded(evidence, chunks):
            continue

        difficulty = (item.difficulty or "").strip().lower()
        if difficulty not in _VALID_DIFFICULTIES:
            difficulty = _DIFFICULTY_BY_LEVEL[level].value

        result.append(
            item.model_copy(
                update={
                    "kind": kind,
                    "topic": (item.topic or "").strip() or "General",
                    "difficulty": difficulty,
                    "question": question_text,
                    "options": options,
                    "correct_answer": correct_answer,
                    "correct_option_indices": correct_option_indices,
                    "explanation": (item.explanation or "").strip() or None,
                    "source_reference": (item.source_reference or "").strip() or None,
                    "rubric": (item.rubric or "").strip() or None,
                    "key_points": key_points,
                }
            )
        )
    return result


def _normalize_for_dedupe(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def _is_near_duplicate_text(question: str, existing: list[str]) -> bool:
    normalized = _normalize_for_dedupe(question)
    return any(
        SequenceMatcher(None, normalized, _normalize_for_dedupe(other)).ratio()
        > DUPLICATE_SIMILARITY_THRESHOLD
        for other in existing
    )


def _is_near_duplicate(candidate: QuizQuestionInput, existing: list[QuizQuestionInput]) -> bool:
    return _is_near_duplicate_text(candidate.question, [other.question for other in existing])


def _previous_questions(document: Document) -> list[str]:
    """The document's most recent earlier quiz questions, newest first."""
    quiz_sets = sorted(document.quiz_sets, key=lambda quiz_set: quiz_set.created_at, reverse=True)
    questions = [question.question for quiz_set in quiz_sets for question in quiz_set.questions]
    return questions[:MAX_AVOID_QUESTIONS]


def _render_avoid_questions(previous_questions: list[str]) -> str:
    """The "already asked" prompt section, or an empty string with no quiz history."""
    if not previous_questions:
        return ""
    lines = "\n".join(
        f"- {' '.join(question.split())[:AVOID_QUESTION_CHARS]}" for question in previous_questions
    )
    return TemplateStore().render("tasks/quiz_avoid_previous", questions=lines)


def _deduplicate(candidates: list[QuizQuestionInput]) -> list[QuizQuestionInput]:
    unique: list[QuizQuestionInput] = []
    for candidate in candidates:
        if not _is_near_duplicate(candidate, unique):
            unique.append(candidate)
    return unique


@dataclass
class _GenerationResult:
    questions: list[QuizQuestionInput]
    weak_topics: list[str]


async def _generate_validated_questions(
    *,
    document: Document,
    provider: LLMProvider,
    level: Level,
    language: Language,
    num_questions: int,
    kinds: list[str],
    topic: str | None = None,
    store: ChromaVectorStore | None = None,
    embedding_provider: EmbeddingProvider | None = None,
    previous_questions: list[str] | None = None,
) -> _GenerationResult:
    """Generate, validate, deduplicate and (if short) retry-and-repair a batch of questions.

    When ``topic`` is given (with ``store``/``embedding_provider``), only the chunks most
    relevant to that topic are used as context, for a focused "retest this topic" quiz.

    ``previous_questions`` (the document's earlier quiz questions) are listed in the prompt as
    questions not to repeat, and a candidate that still comes back near-verbatim is held back.

    Each round asks only for what is still missing, by kind (see :func:`_kind_targets`). If the
    normal rounds leave the quiz short, one more round runs without the "already asked" list;
    any remaining gap is filled with surplus questions of the other kind, then with held-back
    repeats, so the learner gets the requested count whenever the model produced enough.
    """
    previous = previous_questions or []
    avoid_questions = _render_avoid_questions(previous)
    targets = _kind_targets(num_questions, kinds)
    spares: list[QuizQuestionInput] = []  # valid, but beyond their kind's target
    repeats: list[QuizQuestionInput] = []
    allowed_kinds = set(kinds)
    document_text = (
        _render_topic_chunk_text(document, topic, store, embedding_provider)
        if topic and store is not None and embedding_provider is not None
        else _render_chunk_text(document)
    )
    accepted: list[QuizQuestionInput] = []
    weak_topics: list[str] = []

    rounds = [avoid_questions] * MAX_GENERATION_ROUNDS
    if avoid_questions:
        rounds += [""] * NO_AVOID_LIST_ROUNDS
    for round_number, round_avoid_questions in enumerate(rounds):
        missing = {
            kind: target - sum(1 for item in accepted if item.kind == kind)
            for kind, target in targets.items()
        }
        missing = {kind: count for kind, count in missing.items() if count > 0}
        if not missing:
            break

        builder = PromptBuilder()
        prompt = builder.build(
            task=Task.QUIZ,
            content_type=document.content_type,
            level=level,
            language=language,
            document_text=document_text,
            task_params={
                "num_questions": str(sum(missing.values())),
                "type_mix": _describe_type_mix(missing),
                "avoid_questions": round_avoid_questions,
            },
        )
        draft = await provider.generate_json(prompt.user, QuizSetDraft, system=prompt.system)
        if round_number == 0:
            weak_topics = draft.weak_topics[:8]

        candidates = _validate_and_normalize(
            draft.questions, document=document, level=level, allowed_kinds=allowed_kinds
        )
        for candidate in candidates:
            if _is_near_duplicate(candidate, accepted + spares):
                continue
            if _is_near_duplicate_text(candidate.question, previous):
                repeats.append(candidate)
            elif missing.get(candidate.kind, 0) > 0:
                accepted.append(candidate)
                missing[candidate.kind] -= 1
            else:
                spares.append(candidate)

    for fallback in (spares, _deduplicate(repeats)):
        accepted.extend(fallback[: max(0, num_questions - len(accepted))])
    return _GenerationResult(
        questions=_interleave_kinds(_deduplicate(accepted)[:num_questions]),
        weak_topics=weak_topics,
    )


# --- generation -----------------------------------------------------------------------------


def _quiz_cache_extra(
    topic: str | None, variation_seed: int, kinds: list[str], num_questions: int
) -> str:
    """The cache key's ``extra`` part: everything besides the standard key that shapes a quiz.

    The question types and count must be part of it: without them, a quiz generated for one
    selection (e.g. both types) was replayed from the cache for another (multiple-choice only).
    """
    extra = topic.casefold() if topic else ""
    extra = f"{extra}|types={','.join(kinds)}|count={num_questions}"
    if variation_seed:
        extra = f"{extra}|variation={variation_seed}"
    return extra


async def generate_quiz(
    *,
    document: Document,
    provider: LLMProvider,
    cache: ContentCache,
    level: Level,
    language: Language,
    num_questions: int = DEFAULT_QUESTIONS,
    types: list[str] | None = None,
    regenerate: bool = False,
    topic: str | None = None,
    variation_seed: int = 0,
    store: ChromaVectorStore | None = None,
    embedding_provider: EmbeddingProvider | None = None,
    session: Session | None = None,
) -> QuizSetResponse:
    """Generate (or, on a cache hit, replay) a validated quiz set for a document.

    Caching uses the standard ``(document, task, level, language, model, prompt version)``
    key, same as summaries and explanations, plus ``topic`` when given so a topic-scoped
    "retest" quiz caches separately from the whole-document one. ``regenerate=True`` bypasses
    a cache hit and replaces the cached entry with newly generated questions.

    ``variation_seed`` (bumped by the frontend's "New quiz") is part of the cache key too, so each
    new quiz is its own generation; every generation is also told which questions the document's
    earlier quizzes already asked, so a new quiz is not a paraphrase of the last one.
    """
    level = _level_from_value(level.value if isinstance(level, Level) else level)
    language = _language_from_value(language.value if isinstance(language, Language) else language)
    if not document.chunks:
        raise AppError(400, "EMPTY_DOCUMENT")
    num_questions = min(max(num_questions, MIN_QUESTIONS), MAX_QUESTIONS)
    kinds = normalize_requested_types(types)
    topic = (topic or "").strip() or None

    key = CacheKey(
        document_hash=document.content_hash,
        task=Task.QUIZ,
        level=level,
        language=language,
        model=provider.model,
        extra=_quiz_cache_extra(topic, variation_seed, kinds, num_questions),
    )

    # A retest's questions all count toward the topic being retested, under the label the
    # document already tracks it by -- the model's own per-question topic labels drift ("password
    # length check" vs "Password Length"), which would otherwise update a different mastery row.
    pinned_topic = adaptive.canonical_topic(document, topic) if topic else None

    async def build() -> str:
        generated = await _generate_validated_questions(
            document=document,
            provider=provider,
            level=level,
            language=language,
            num_questions=num_questions,
            kinds=kinds,
            topic=topic,
            store=store,
            embedding_provider=embedding_provider,
            previous_questions=_previous_questions(document),
        )
        if not generated.questions:
            raise AppError(500, "internal_error")

        set_record = QuizSet(
            document_id=document.id,
            level=level,
            language=language,
            model=provider.model,
            prompt_version=PROMPT_VERSION,
        )
        if session is not None:
            session.add(set_record)
            session.flush()

        question_rows: list[QuizQuestionPublic] = []
        for index, item in enumerate(generated.questions):
            kind = QuestionKind(item.kind)
            record = QuizQuestion(
                quiz_set_id=set_record.id,
                ordinal=index,
                kind=kind,
                topic=pinned_topic or item.topic,
                difficulty=Difficulty(item.difficulty),
                language=language,
                question=item.question,
                options=item.options or None,
                correct_answer=item.correct_answer,
                correct_option_indices=item.correct_option_indices or None,
                explanation=item.explanation,
                source_reference=item.source_reference,
                rubric=item.rubric,
                key_points=item.key_points or None,
            )
            if session is not None:
                session.add(record)
                session.flush()
            question_rows.append(
                QuizQuestionPublic(
                    id=record.id if session is not None else index + 1,
                    kind=kind.value,
                    topic=record.topic,
                    difficulty=record.difficulty.value,
                    question=record.question,
                    options=record.options or [],
                    # Multi-correct ("select all that apply") was removed: every multiple_choice
                    # question is single-correct now, so this is always false. The field (and
                    # the frontend code that reads it) is kept rather than deleted, so an old
                    # quiz cached from before this change still renders as radios too.
                    allow_multiple=False,
                    source_reference=record.source_reference,
                )
            )

        if session is not None:
            session.commit()

        response = QuizSetResponse(
            quiz_set_id=set_record.id if session is not None else "unsaved",
            questions=question_rows,
            weak_topics=generated.weak_topics,
            metadata={
                "document_id": document.id,
                "content_type": document.content_type.value,
                "task": Task.QUIZ.value,
                "level": level.value,
                "language": language.value,
                "chunks_used": len(document.chunks),
                "requested_questions": num_questions,
                "generated_questions": len(generated.questions),
                "types": kinds,
                "topic": topic,
                "variation_seed": variation_seed,
                "prompt_version": PROMPT_VERSION,
                "model": provider.model,
                "cached": False,
            },
        )
        return response.model_dump_json(ensure_ascii=False)

    if regenerate:
        content = await build()
        cache.put(key, content)
        hit = False
    else:
        cached = await cache.get_or_generate(key, build)
        content, hit = cached.content, cached.hit

    payload = QuizSetResponse.model_validate_json(content)
    payload.metadata["cached"] = hit
    return payload


# --- grading -------------------------------------------------------------------------------


async def _grade_short_answer(
    *, provider: LLMProvider, question: QuizQuestion, answer: str
) -> ShortAnswerGrade:
    builder = PromptBuilder()
    prompt = builder.build_grading_prompt(
        language=question.language,
        question=question.question,
        rubric=question.rubric or "",
        key_points=question.key_points or [],
        student_answer=answer,
    )
    return await provider.generate_json(
        prompt.user, ShortAnswerGrade, system=prompt.system, temperature=0.0
    )


def _resolve_correct_indices(question: QuizQuestion) -> set[int]:
    """The correct option index set.

    Backfills from ``correct_answer`` text for a multiple_choice row generated before
    ``correct_option_indices`` existed.
    """
    if question.correct_option_indices:
        return set(question.correct_option_indices)
    options = question.options or []
    correct_text = question.correct_answer.strip().casefold()
    return {
        index for index, option in enumerate(options) if option.strip().casefold() == correct_text
    }


def _resolve_selected_indices(
    question: QuizQuestion, *, selected_option_indices: list[int], answer: str
) -> set[int]:
    """The learner's selected option index set.

    Uses the new index-based payload when given, else derives it from the legacy plain-text
    answer (an option's exact text).
    """
    options = question.options or []
    if selected_option_indices:
        return {index for index in selected_option_indices if 0 <= index < len(options)}
    provided_text = answer.strip().casefold()
    if not provided_text:
        return set()
    return {
        index for index, option in enumerate(options) if option.strip().casefold() == provided_text
    }


async def grade_quiz_answer(
    *,
    provider: LLMProvider,
    question: QuizQuestion,
    answer: str = "",
    selected_option_indices: list[int] | None = None,
    peeked: bool = False,
) -> QuizAnswerResult:
    """Grade a submitted answer: deterministic for multiple-choice, LLM-graded otherwise.

    Multiple-choice compares the learner's selected option set against the correct set:
    ``score = max(0, (correctly_selected - incorrectly_selected) / total_correct)``, clamped to
    [0, 1], which is 1.0 exactly when the two sets match and 0.0 otherwise for every current
    question (single-correct: one option picked, right or wrong). The set-based formula is
    kept rather than simplified to a plain equality check because it also still grades a
    multi-correct quiz cached from before that variant was removed, correctly.
    """
    provided = (answer or "").strip()
    selected_option_indices = selected_option_indices or []

    if question.kind == QuestionKind.MULTIPLE_CHOICE:
        correct_indices = _resolve_correct_indices(question)
        selected = _resolve_selected_indices(
            question, selected_option_indices=selected_option_indices, answer=provided
        )
        total_correct = len(correct_indices) or 1
        correctly_selected = len(selected & correct_indices)
        incorrectly_selected = len(selected - correct_indices)
        score = max(0.0, min(1.0, (correctly_selected - incorrectly_selected) / total_correct))
        is_correct = selected == correct_indices
        options = question.options or []
        provided_label = (
            "; ".join(options[index] for index in sorted(selected) if index < len(options))
            or provided
        )
        result = QuizAnswerResult(
            question_id=question.id,
            kind=question.kind.value,
            topic=question.topic,
            correct=is_correct,
            score=score,
            provided=provided_label,
            expected=question.correct_answer,
            correct_option_indices=sorted(correct_indices),
            explanation=question.explanation,
            feedback=None,
            missing_key_points=[],
            source_reference=question.source_reference,
            peeked=peeked,
        )
    else:
        grade = await _grade_short_answer(provider=provider, question=question, answer=provided)
        score = max(0.0, min(1.0, grade.score))
        is_correct = score >= SHORT_ANSWER_PASS_THRESHOLD
        result = QuizAnswerResult(
            question_id=question.id,
            kind=question.kind.value,
            topic=question.topic,
            correct=is_correct,
            score=score,
            provided=provided,
            expected=question.correct_answer,
            correct_option_indices=[],
            explanation=question.explanation,
            feedback=grade.feedback.strip() or None,
            missing_key_points=grade.missing_key_points[:MAX_MISSING_KEY_POINTS],
            source_reference=question.source_reference,
            peeked=peeked,
        )

    question.attempts.append(
        QuizAttempt(
            answer=result.provided,
            is_correct=result.correct,
            score=result.score,
            feedback=result.feedback,
            missing_key_points=result.missing_key_points or None,
            peeked=peeked,
        )
    )
    return result


# --- results / weak topics ------------------------------------------------------------------
#
# Mastery tracking itself (the EWMA update, weak/developing/strong classification, and the
# document-level weak-topics list) lives in ``app.services.adaptive`` alongside the rest of
# the adaptive-personalization feature; only this quiz-scoped, per-quiz-set aggregation stays
# here.


def build_quiz_results(
    quiz_set: QuizSet, *, weak_threshold: float = adaptive.DEFAULT_WEAK_THRESHOLD
) -> QuizResultsResponse:
    """Aggregate the latest attempt per question into a score and per-topic breakdown."""
    topic_totals: dict[str, dict[str, float]] = {}
    total_score = 0.0
    answered = 0
    correct_count = 0
    peeked = False

    for question in quiz_set.questions:
        stats = topic_totals.setdefault(
            question.topic, {"correct": 0, "total": 0, "answered": 0, "score_sum": 0.0}
        )
        stats["total"] += 1
        latest = question.attempts[-1] if question.attempts else None
        if latest is None:
            continue
        answered += 1
        stats["answered"] += 1
        total_score += latest.score
        stats["score_sum"] += latest.score
        if latest.is_correct:
            correct_count += 1
            stats["correct"] += 1
        if any(attempt.peeked for attempt in question.attempts):
            peeked = True

    breakdown = [
        TopicBreakdownEntry(
            topic=topic,
            correct=int(stats["correct"]),
            total=int(stats["total"]),
            answered=int(stats["answered"]),
            average_score=(stats["score_sum"] / stats["answered"]) if stats["answered"] else 0.0,
        )
        for topic, stats in topic_totals.items()
    ]
    weak = {
        entry.topic: entry.average_score
        for entry in breakdown
        if entry.answered and entry.average_score < weak_threshold
    }
    weak_topics = sorted(weak, key=lambda topic: weak[topic])

    return QuizResultsResponse(
        quiz_set_id=quiz_set.id,
        total_questions=len(quiz_set.questions),
        answered_questions=answered,
        correct_count=correct_count,
        score=(total_score / answered) if answered else 0.0,
        topic_breakdown=breakdown,
        weak_topics=weak_topics,
        peeked=peeked,
    )
