"""Deterministic scoring for study test items.

Multiple-choice is scored by exact match; short answer by a keyword/key-point rubric. No AI is
used to score the study by default — the whole point of the experiment is to measure the AI
tutor's effect on *learning*, so grading the test itself with a second, separately-behaving AI
would add uncontrolled noise (and cost, and non-reproducibility) to the one measurement the
thesis depends on. An LLM-assisted path exists (``score_short_answer_llm_assisted``, reached
through ``score_submission_item``) for when the admin explicitly wants it — set
``STUDY_LLM_ASSISTED_SCORING=true`` — but it is off by default, and turning it on is a
deliberate methodological choice the admin makes, not something this module does on its own.
"""

from __future__ import annotations

import logging
import re

from app.db.models import QuestionKind
from app.domain import Language
from app.llm.base import LLMProvider
from app.prompts import PromptBuilder
from app.services.quiz import ShortAnswerGrade
from app.study.models import TestItem

logger = logging.getLogger(__name__)

_WORD_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿËëÇç]+")


def _normalize_words(text: str) -> set[str]:
    return {word.lower() for word in _WORD_RE.findall(text)}


def score_multiple_choice(answer: str, correct_answer: str) -> float:
    """1.0 for an exact, case-insensitive match to ``correct_answer``, else 0.0."""
    return 1.0 if answer.strip().casefold() == correct_answer.strip().casefold() else 0.0


def score_short_answer_deterministic(answer: str, keywords: list[str]) -> float:
    """Fraction of rubric keywords/key-phrases present in ``answer``, in ``[0, 1]``.

    A single-word keyword must appear as a whole word (so "cat" does not match inside
    "category"); a multi-word phrase matches as a case-insensitive substring. A rubric with no
    keywords always scores 0 — a short-answer item must ship at least one keyword to be
    gradable, which the admin import validates.
    """
    if not keywords:
        return 0.0
    haystack_words = _normalize_words(answer)
    haystack_text = answer.casefold()
    matched = 0
    for keyword in keywords:
        keyword_norm = keyword.strip().casefold()
        if not keyword_norm:
            continue
        if " " in keyword_norm:
            matched += keyword_norm in haystack_text
        else:
            matched += keyword_norm in haystack_words
    return matched / len(keywords)


def score_item(item: TestItem, language: str, answer: str) -> tuple[float, float, bool]:
    """Score one submitted answer against ``item``.

    Returns ``(score, max_score, is_correct)``; ``is_correct`` is the fraction rounding to a
    full match (``>= 1.0``) for multiple-choice, or clearing 60% of the rubric for short answer
    (the same threshold the regular quiz's short-answer grading uses).
    """
    max_score = item.max_score
    if item.kind == QuestionKind.MULTIPLE_CHOICE:
        correct = item.correct_answer.get(language, "")
        fraction = score_multiple_choice(answer, correct)
        is_correct = fraction >= 1.0
    else:
        keywords = (item.rubric_keywords or {}).get(language, [])
        fraction = score_short_answer_deterministic(answer, keywords)
        is_correct = fraction >= 0.6
    return fraction * max_score, max_score, is_correct


async def score_short_answer_llm_assisted(
    *,
    provider: LLMProvider,
    language: Language,
    question: str,
    keywords: list[str],
    answer: str,
) -> float:
    """LLM-assisted short-answer scoring: an admin convenience, never the study's official score.

    Only reachable when ``STUDY_LLM_ASSISTED_SCORING=true`` is explicitly set (off by default;
    see the module docstring). Returns a fraction in ``[0, 1]``, at temperature 0 for
    reproducibility, using the same grading prompt and schema as the regular quiz's
    short-answer grading.
    """
    builder = PromptBuilder()
    rubric = "Award credit for each key idea the answer conveys, in the student's own words."
    prompt = builder.build_grading_prompt(
        language=language,
        question=question,
        rubric=rubric,
        key_points=keywords,
        student_answer=answer,
    )
    grade = await provider.generate_json(
        prompt.user, ShortAnswerGrade, system=prompt.system, temperature=0.0
    )
    return max(0.0, min(1.0, grade.score))


async def score_submission_item(
    item: TestItem,
    language: str,
    answer: str,
    *,
    use_llm_assist: bool,
    provider: LLMProvider | None,
) -> tuple[float, float, bool]:
    """Score one submitted answer, the entry point the submission endpoints use.

    Deterministic scoring is always the fallback (and, with ``use_llm_assist=False``, the only
    path — the study's default). When LLM-assisted scoring is explicitly enabled and a provider
    is available, a short-answer item is scored by the model instead; a failure of that call
    (rate limit, timeout, malformed output) is logged and silently falls back to the
    deterministic rubric rather than blocking the participant's submission.
    """
    if use_llm_assist and provider is not None and item.kind == QuestionKind.SHORT_ANSWER:
        try:
            keywords = (item.rubric_keywords or {}).get(language, [])
            fraction = await score_short_answer_llm_assisted(
                provider=provider,
                language=Language(language),
                question=item.question.get(language, ""),
                keywords=keywords,
                answer=answer,
            )
            return fraction * item.max_score, item.max_score, fraction >= 0.6
        except Exception:  # noqa: BLE001 - any failure here must not block a submission
            logger.exception("study_llm_assisted_scoring_failed", extra={"item_id": item.id})
    return score_item(item, language, answer)
