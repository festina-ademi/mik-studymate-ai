"""A quiz contains only the question types the learner selected.

Regression: choosing only "Multiple choice" still produced short-answer questions, because the
quiz cache key ignored the selected types (and count), so a quiz generated earlier for both types
was replayed for a multiple-choice-only request.
"""

from collections import Counter

from fastapi.testclient import TestClient

from app.services.quiz import _describe_type_mix, normalize_requested_types
from tests.test_quiz import draft, make_client, seed_document
from tests.test_quiz_count_mix import mc, sa

MIXED = draft(mc(0), sa(0), mc(1), sa(1), mc(2), sa(2), mc(3), sa(3))


def quiz(client: TestClient, num: int = 4, **body: object) -> dict:
    response = client.post(
        "/api/documents/doc-quiz/quiz",
        json={"level": "beginner", "language": "en", "num_questions": num, **body},
    )
    assert response.status_code == 200, response.text
    return response.json()


def kinds(payload: dict) -> list[str]:
    return [question["kind"] for question in payload["questions"]]


def test_multiple_choice_only_gives_only_multiple_choice() -> None:
    # The model ignores the instruction and mixes in short answers; those are filtered out and
    # the missing multiple-choice questions are asked for again.
    client = make_client(draft(mc(0), sa(0), mc(1), sa(1)), draft(mc(2), mc(3)))
    seed_document(client)

    payload = quiz(client, question_types=["multiple_choice"])

    assert kinds(payload) == ["multiple_choice"] * 4
    first, second = client.app.state.llm_provider.calls
    for call in (first, second):
        assert "multiple-choice questions only" in (call.system or "")
        assert "Do NOT write any short-answer" in (call.system or "")
    assert "EXACTLY 2 questions" in (second.system or "")
    assert payload["metadata"]["types"] == ["multiple_choice"]


def test_short_answer_only_gives_no_multiple_choice() -> None:
    client = make_client(MIXED)
    seed_document(client)

    payload = quiz(client, question_types=["short_answer"])

    assert kinds(payload) == ["short_answer"] * 4
    (call,) = client.app.state.llm_provider.calls
    assert "short-answer questions only" in (call.system or "")
    assert "Do NOT write any multiple-choice question" in (call.system or "")


def test_both_types_give_an_even_alternating_mix() -> None:
    # Returned grouped by kind; the quiz alternates them, multiple-choice first.
    client = make_client(draft(mc(0), mc(1), sa(0), sa(1)))
    seed_document(client)

    payload = quiz(client, question_types=["multiple_choice", "short_answer"])

    assert kinds(payload) == ["multiple_choice", "short_answer"] * 2
    (call,) = client.app.state.llm_provider.calls
    assert "exactly 2 multiple-choice and 2 short-answer questions" in (call.system or "")


def test_an_odd_count_gives_the_extra_question_to_multiple_choice() -> None:
    client = make_client(MIXED)
    seed_document(client)

    payload = quiz(client, 5)

    assert kinds(payload) == ["multiple_choice", "short_answer"] * 2 + ["multiple_choice"]


def test_eight_questions_with_both_types_are_split_evenly() -> None:
    client = make_client(MIXED)
    seed_document(client)

    payload = quiz(client, 8)

    assert Counter(kinds(payload)) == {"multiple_choice": 4, "short_answer": 4}


def test_a_cached_mixed_quiz_is_not_replayed_for_multiple_choice_only() -> None:
    client = make_client(draft(mc(0), mc(1), sa(0), sa(1)), draft(mc(2), mc(3), mc(4), mc(5)))
    seed_document(client)

    mixed = quiz(client)
    mc_only = quiz(client, question_types=["multiple_choice"])

    assert set(kinds(mixed)) == {"multiple_choice", "short_answer"}
    assert kinds(mc_only) == ["multiple_choice"] * 4
    assert mc_only["metadata"]["cached"] is False
    assert len(client.app.state.llm_provider.calls) == 2


def test_the_same_selection_is_served_from_the_cache_in_any_order() -> None:
    client = make_client(MIXED)
    seed_document(client)

    first = quiz(client, question_types=["short_answer", "multiple_choice"])
    second = quiz(client, question_types=["multiple_choice", "short_answer"])

    assert second["metadata"]["cached"] is True
    assert second["quiz_set_id"] == first["quiz_set_id"]


def test_a_different_question_count_is_not_served_from_the_cache() -> None:
    client = make_client(draft(mc(0), mc(1)), draft(mc(2), mc(3), mc(4), mc(5)))
    seed_document(client)

    quiz(client, 2, question_types=["multiple_choice"])
    larger = quiz(client, 4, question_types=["multiple_choice"])

    assert len(larger["questions"]) == 4
    assert larger["metadata"]["cached"] is False


def test_the_older_types_field_is_still_accepted() -> None:
    client = make_client(MIXED)
    seed_document(client)

    payload = quiz(client, types=["short_answer"])

    assert kinds(payload) == ["short_answer"] * 4


def test_unknown_question_types_are_rejected() -> None:
    client = make_client(MIXED)
    seed_document(client)

    response = client.post(
        "/api/documents/doc-quiz/quiz",
        json={"level": "beginner", "language": "en", "question_types": ["essay"]},
    )

    assert response.status_code == 422
    assert client.app.state.llm_provider.calls == []


def test_normalize_requested_types() -> None:
    assert normalize_requested_types(None) == ["multiple_choice", "short_answer"]
    assert normalize_requested_types([]) == ["multiple_choice", "short_answer"]
    assert normalize_requested_types(["Short Answer", "multiple-choice"]) == [
        "multiple_choice",
        "short_answer",
    ]
    assert normalize_requested_types(["multiple_choice", "essay"]) == ["multiple_choice"]


def test_type_mix_wording() -> None:
    assert "exactly 4 options" in _describe_type_mix({"multiple_choice": 3})
    assert "Do NOT write any short-answer" in _describe_type_mix({"multiple_choice": 3})
    assert "Do NOT write any multiple-choice" in _describe_type_mix({"short_answer": 3})
    both = _describe_type_mix({"multiple_choice": 2, "short_answer": 2})
    assert "exactly 2 multiple-choice and 2 short-answer questions" in both
