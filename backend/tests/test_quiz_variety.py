"""Quiz variety: shuffled multiple-choice options and no repeated questions across quizzes.

Models tend to put the correct option first and, given the same prompt again, to ask the same
questions in slightly different words. Options are therefore shuffled before storage, and every
new generation is told (and filtered against) what the document's earlier quizzes already asked.
"""

from collections import Counter

from app.domain import Level
from app.services.quiz import _shuffle_options, _validate_and_normalize
from tests.test_quiz import (
    QuizQuestionInput,
    _document_with_chunks,
    draft,
    make_client,
    mc_question,
    option_index,
    seed_document,
)

# Multiple-choice only: these tests are about variation across quizzes, not the type mix.
QUIZ_BODY = {
    "level": "beginner",
    "language": "en",
    "num_questions": 2,
    "types": ["multiple_choice"],
}

# Two quizzes' worth of distinct, grounded questions (they share words with the seeded chunks).
FIRST_QUIZ = [
    mc_question(question="Which operation arranges values in order?", correct="Sort"),
    mc_question(
        question="What does binary search require of the data?",
        correct="Sorted data",
        topic="Searching",
        source_reference="Page 2",
    ),
]
SECOND_QUIZ = [
    mc_question(question="Why does sorting values make a later lookup faster?", correct="Order"),
    mc_question(
        question="In what time does binary search work on sorted data?",
        correct="Logarithmic",
        topic="Searching",
        source_reference="Page 2",
    ),
]


def _stem(question: str) -> str:
    return " ".join(question.split())[:50].casefold()


# --- shuffling ------------------------------------------------------------------------------


def test_shuffle_spreads_the_correct_position_evenly_across_many_questions() -> None:
    positions = Counter(
        _shuffle_options(f"Question number {n}?", ["A", "B", "C", "D"], [0])[1][0]
        for n in range(400)
    )

    assert set(positions) == {0, 1, 2, 3}
    for count in positions.values():
        assert 0.15 <= count / 400 <= 0.35


def test_correct_answer_is_not_always_first_even_when_the_model_always_puts_it_first() -> None:
    # Every draft lists its correct option first, exactly the bias observed from Gemini.
    candidates = [
        QuizQuestionInput.model_validate(
            mc_question(
                question=f"Variant {n}: which operation arranges values in order for lookup?",
                correct="Sort",
                options=["Sort", "Search", "Copy", "Delete"],
                correct_option_indices=[0],
            )
        )
        for n in range(20)
    ]

    normalized = _validate_and_normalize(
        candidates,
        document=_document_with_chunks(),
        level=Level.BEGINNER,
        allowed_kinds={"multiple_choice"},
    )

    assert len(normalized) == 20
    first_count = sum(1 for item in normalized if item.correct_option_indices == [0])
    assert 0.15 <= first_count / 20 <= 0.35
    # The answer key still points at the right text after the shuffle.
    assert all(item.options[item.correct_option_indices[0]] == "Sort" for item in normalized)
    assert all(item.correct_answer == "Sort" for item in normalized)


def test_shuffle_is_deterministic_per_question() -> None:
    options = ["Sort", "Search", "Copy", "Delete"]
    first = _shuffle_options("Which operation arranges values in order?", options, [0])
    again = _shuffle_options("Which operation arranges values in order?", options, [0])

    assert first == again
    assert options == ["Sort", "Search", "Copy", "Delete"]  # the input list is not mutated


def test_a_reread_quiz_shows_the_same_shuffled_order() -> None:
    client = make_client(draft(*FIRST_QUIZ))
    seed_document(client)

    first = client.post("/api/documents/doc-quiz/quiz", json=QUIZ_BODY).json()
    reread = client.post("/api/documents/doc-quiz/quiz", json=QUIZ_BODY).json()

    assert reread["metadata"]["cached"] is True
    assert [q["options"] for q in reread["questions"]] == [q["options"] for q in first["questions"]]


def test_grading_uses_the_shuffled_positions() -> None:
    client = make_client(draft(*FIRST_QUIZ))
    seed_document(client)
    question = client.post("/api/documents/doc-quiz/quiz", json=QUIZ_BODY).json()["questions"][0]
    correct = option_index(question, "Sort")
    wrong = option_index(question, "Copy")

    right_answer = client.post(
        f"/api/quiz/{question['id']}/answer", json={"selected_option_indices": [correct]}
    ).json()
    wrong_answer = client.post(
        f"/api/quiz/{question['id']}/answer", json={"selected_option_indices": [wrong]}
    ).json()

    assert (right_answer["score"], right_answer["correct"]) == (1.0, True)
    assert (wrong_answer["score"], wrong_answer["correct"]) == (0.0, False)
    assert right_answer["correct_option_indices"] == [correct]


# --- variation across quizzes ----------------------------------------------------------------


def test_variation_seed_is_part_of_the_cache_key() -> None:
    client = make_client(draft(*FIRST_QUIZ), draft(*SECOND_QUIZ))
    seed_document(client)

    base = client.post("/api/documents/doc-quiz/quiz", json=QUIZ_BODY).json()
    varied = client.post("/api/documents/doc-quiz/quiz", json={**QUIZ_BODY, "variation_seed": 1})
    varied_again = client.post(
        "/api/documents/doc-quiz/quiz", json={**QUIZ_BODY, "variation_seed": 1}
    )

    assert varied.json()["metadata"]["cached"] is False
    assert varied.json()["metadata"]["variation_seed"] == 1
    assert varied.json()["quiz_set_id"] != base["quiz_set_id"]
    # The same seed again is a cache hit on that seed's own entry.
    assert varied_again.json()["metadata"]["cached"] is True
    assert varied_again.json()["quiz_set_id"] == varied.json()["quiz_set_id"]


def test_a_new_quiz_prompt_lists_the_earlier_questions_to_avoid() -> None:
    client = make_client(draft(*FIRST_QUIZ), draft(*SECOND_QUIZ))
    seed_document(client)

    client.post("/api/documents/doc-quiz/quiz", json=QUIZ_BODY)
    client.post("/api/documents/doc-quiz/quiz", json={**QUIZ_BODY, "variation_seed": 1})

    first_call, second_call = client.app.state.llm_provider.calls
    assert first_call.system is not None and second_call.system is not None
    assert "already seen" not in first_call.system
    assert "Questions the learner has already seen" in second_call.system
    assert "- Which operation arranges values in order?" in second_call.system
    assert "- What does binary search require of the data?" in second_call.system


def test_a_new_quiz_shares_under_30_percent_of_its_question_stems_with_the_last_one() -> None:
    # The model repeats one earlier question verbatim alongside two new ones: the repeat is
    # held back because enough new questions are available.
    repeat = FIRST_QUIZ[0]
    client = make_client(draft(*FIRST_QUIZ), draft(repeat, *SECOND_QUIZ))
    seed_document(client)

    quiz_a = client.post("/api/documents/doc-quiz/quiz", json=QUIZ_BODY).json()
    quiz_b = client.post(
        "/api/documents/doc-quiz/quiz", json={**QUIZ_BODY, "variation_seed": 1}
    ).json()

    stems_a = {_stem(q["question"]) for q in quiz_a["questions"]}
    stems_b = [_stem(q["question"]) for q in quiz_b["questions"]]
    assert len(stems_b) == 2
    assert sum(stem in stems_a for stem in stems_b) / len(stems_b) < 0.3


def test_repeats_still_top_up_a_quiz_that_would_otherwise_come_out_short() -> None:
    # Every round only offers the earlier question again: better a repeat than no quiz at all.
    client = make_client(draft(FIRST_QUIZ[0]), draft(FIRST_QUIZ[0]))
    seed_document(client)
    body = {**QUIZ_BODY, "num_questions": 1}

    client.post("/api/documents/doc-quiz/quiz", json=body)
    response = client.post("/api/documents/doc-quiz/quiz", json={**body, "variation_seed": 1})

    assert response.status_code == 200
    assert [q["question"] for q in response.json()["questions"]] == [FIRST_QUIZ[0]["question"]]
