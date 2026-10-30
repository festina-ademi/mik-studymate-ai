"""Tests for deterministic study-test scoring (multiple-choice and the keyword rubric)."""

from __future__ import annotations

import json

import pytest

from app.db.models import QuestionKind
from app.domain import Language
from app.llm.mock import MockProvider
from app.study.models import TestItem
from app.study.scoring import (
    score_item,
    score_multiple_choice,
    score_short_answer_deterministic,
    score_short_answer_llm_assisted,
    score_submission_item,
)


def test_multiple_choice_exact_match_scores_full_credit() -> None:
    assert score_multiple_choice("Sort", "Sort") == 1.0


def test_multiple_choice_is_case_insensitive_and_trims_whitespace() -> None:
    assert score_multiple_choice("  sort  ", "Sort") == 1.0


def test_multiple_choice_wrong_answer_scores_zero() -> None:
    assert score_multiple_choice("Copy", "Sort") == 0.0


def test_short_answer_rubric_awards_the_fraction_of_matched_keywords() -> None:
    score = score_short_answer_deterministic(
        "Binary search needs sorted data.", ["sorted", "binary", "logarithmic"]
    )
    assert score == pytest.approx(2 / 3)


def test_short_answer_rubric_matches_whole_words_only() -> None:
    # "cat" must not match inside "category".
    assert score_short_answer_deterministic("a category of algorithms", ["cat"]) == 0.0


def test_short_answer_rubric_matches_multi_word_phrases_as_substrings() -> None:
    score = score_short_answer_deterministic("the data must be sorted first", ["must be sorted"])
    assert score == 1.0


def test_short_answer_rubric_with_no_keywords_always_scores_zero() -> None:
    assert score_short_answer_deterministic("anything at all", []) == 0.0


def test_short_answer_rubric_is_case_insensitive() -> None:
    assert score_short_answer_deterministic("SORTED data", ["sorted"]) == 1.0


def _mc_item(**overrides: object) -> TestItem:
    defaults = dict(
        id=1,
        test_id="test-1",
        ordinal=1,
        kind=QuestionKind.MULTIPLE_CHOICE,
        topic="Sorting",
        question={"en": "Which operation orders values?", "sq": "Cili operacion rendit?"},
        options={"en": ["Sort", "Copy"], "sq": ["Rendit", "Kopjo"]},
        correct_answer={"en": "Sort", "sq": "Rendit"},
        rubric_keywords=None,
        max_score=1.0,
    )
    defaults.update(overrides)
    return TestItem(**defaults)


def _sa_item(**overrides: object) -> TestItem:
    defaults = dict(
        id=2,
        test_id="test-1",
        ordinal=2,
        kind=QuestionKind.SHORT_ANSWER,
        topic="Searching",
        question={"en": "Explain binary search.", "sq": "Shpjego kerkimin binar."},
        options=None,
        correct_answer={"en": "halves the range", "sq": "pergjysmon intervalin"},
        rubric_keywords={"en": ["sorted", "half"], "sq": ["renditur", "gjysm"]},
        max_score=2.0,
    )
    defaults.update(overrides)
    return TestItem(**defaults)


def test_score_item_multiple_choice_uses_the_items_language_specific_correct_answer() -> None:
    item = _mc_item()
    score, max_score, is_correct = score_item(item, "sq", "Rendit")
    assert (score, max_score, is_correct) == (1.0, 1.0, True)

    score_en, _, is_correct_en = score_item(item, "en", "Rendit")  # wrong language's answer
    assert score_en == 0.0
    assert is_correct_en is False


def test_score_item_short_answer_uses_the_items_language_specific_rubric() -> None:
    item = _sa_item()
    score, max_score, is_correct = score_item(item, "en", "the data must be sorted and half")
    assert max_score == 2.0
    assert score == pytest.approx(2.0)
    assert is_correct is True


def test_score_item_short_answer_below_threshold_is_marked_incorrect() -> None:
    item = _sa_item()
    score, _, is_correct = score_item(item, "en", "no relevant words here")
    assert score == 0.0
    assert is_correct is False


@pytest.mark.anyio
async def test_score_submission_item_uses_deterministic_scoring_by_default() -> None:
    item = _sa_item()
    provider = MockProvider([json.dumps({"score": 1.0, "feedback": "", "missing_key_points": []})])

    score, max_score, is_correct = await score_submission_item(
        item, "en", "irrelevant answer with no keywords", use_llm_assist=False, provider=provider
    )

    assert score == 0.0
    assert max_score == 2.0
    assert is_correct is False
    assert provider.calls == []  # the LLM must never be called when assist is off


@pytest.mark.anyio
async def test_score_submission_item_uses_the_llm_when_assist_is_enabled_for_short_answer() -> None:
    item = _sa_item()
    provider = MockProvider([json.dumps({"score": 0.9, "feedback": "", "missing_key_points": []})])

    score, max_score, is_correct = await score_submission_item(
        item, "en", "a reasonable free-form answer", use_llm_assist=True, provider=provider
    )

    assert score == pytest.approx(1.8)
    assert max_score == 2.0
    assert is_correct is True
    assert len(provider.calls) == 1


@pytest.mark.anyio
async def test_score_submission_item_never_uses_the_llm_for_multiple_choice() -> None:
    item = _mc_item()
    provider = MockProvider([json.dumps({"score": 1.0})])

    score, _, _ = await score_submission_item(
        item, "en", "Sort", use_llm_assist=True, provider=provider
    )

    assert score == 1.0
    assert provider.calls == []


@pytest.mark.anyio
async def test_score_submission_item_falls_back_to_deterministic_when_the_llm_call_fails() -> None:
    item = _sa_item()
    provider = MockProvider([RuntimeError("boom")])

    score, max_score, is_correct = await score_submission_item(
        item, "en", "the data must be sorted and half", use_llm_assist=True, provider=provider
    )

    # Falls back to the deterministic rubric, which this answer satisfies fully.
    assert score == pytest.approx(2.0)
    assert max_score == 2.0
    assert is_correct is True


@pytest.mark.anyio
async def test_score_short_answer_llm_assisted_clamps_an_out_of_range_score() -> None:
    provider = MockProvider([json.dumps({"score": 1.7, "feedback": "", "missing_key_points": []})])

    fraction = await score_short_answer_llm_assisted(
        provider=provider,
        language=Language.EN,
        question="Explain binary search.",
        keywords=["sorted", "half"],
        answer="anything",
    )

    assert fraction == 1.0
