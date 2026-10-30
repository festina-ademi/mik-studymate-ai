"""Tests for quiz generation, validation, grading and aggregation."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.db.models import Chunk, Document, SourceFormat
from app.domain import ContentType, Language, Level
from app.llm.mock import MockProvider
from app.main import create_app
from app.rag.embeddings import HashingEmbeddingProvider
from app.rag.indexer import index_document
from app.rag.store import ChromaVectorStore
from app.services.quiz import QuizQuestionInput, _deduplicate, _is_grounded, _validate_and_normalize

SORTING_TEXT = "Sorting puts values in order for faster lookup."
SEARCHING_TEXT = "Binary search requires sorted data and works in logarithmic time."


def make_client(*responses: str) -> TestClient:
    settings = Settings(_env_file=None, database_url="sqlite://", llm_provider="mock")
    app = create_app(settings)
    app.state.llm_provider = MockProvider(list(responses))
    return TestClient(app)


def seed_document(client: TestClient, document_id: str = "doc-quiz") -> str:
    with client.app.state.session_factory() as session:
        doc = Document(
            id=document_id,
            filename="lecture.pdf",
            content_hash=f"hash-{document_id}",
            content_type=ContentType.LECTURE,
            source_format=SourceFormat.PDF,
            detected_language=Language.EN,
            size_bytes=123,
            page_count=2,
        )
        session.add(doc)
        session.add_all(
            [
                Chunk(
                    document_id=document_id,
                    ordinal=1,
                    text=SORTING_TEXT,
                    heading="Page 1",
                    page_start=1,
                    page_end=1,
                ),
                Chunk(
                    document_id=document_id,
                    ordinal=2,
                    text=SEARCHING_TEXT,
                    heading="Page 2",
                    page_start=2,
                    page_end=2,
                ),
            ]
        )
        session.commit()
    return document_id


def mc_question(
    question: str = "Which operation arranges values in order?",
    correct: str = "Sort",
    topic: str = "Sorting",
    source_reference: str = "Page 1",
    options: list[str] | None = None,
    correct_option_indices: list[int] | None = None,
) -> dict:
    """A single-correct multiple_choice draft. Omitting ``correct_option_indices`` exercises
    the legacy backfill path (deriving indices from ``correct_answer`` text), which is the more
    interesting default for most tests; pass it explicitly to test the new field directly."""
    question_options = options or ["Search", correct, "Copy", "Delete"]
    draft = {
        "kind": "multiple_choice",
        "topic": topic,
        "difficulty": "easy",
        "question": question,
        "options": question_options,
        "correct_answer": correct,
        "explanation": "Sorting organizes values in order.",
        "source_reference": source_reference,
    }
    if correct_option_indices is not None:
        draft["correct_option_indices"] = correct_option_indices
    return draft


def multi_correct_mc_question(
    question: str = "Which statements about sorting values are true? Select all that apply.",
    options: list[str] | None = None,
    correct_option_indices: list[int] | None = None,
    topic: str = "Sorting",
    source_reference: str = "Page 1",
) -> dict:
    """A "select all that apply" multiple_choice draft (2+ correct options). The default
    wording deliberately reuses words from ``SORTING_TEXT`` so it passes the grounding check."""
    question_options = options or [
        "Sorting puts values in order",
        "Sorting enables faster lookup",
        "Sorting deletes duplicate values",
        "Sorting requires unsorted output",
    ]
    indices = correct_option_indices if correct_option_indices is not None else [0, 1]
    return {
        "kind": "multiple_choice",
        "topic": topic,
        "difficulty": "easy",
        "question": question,
        "options": question_options,
        "correct_option_indices": indices,
        "correct_answer": "; ".join(question_options[index] for index in indices),
        "explanation": "Both are comparison-based sorting algorithms.",
        "source_reference": source_reference,
    }


def short_answer_question(
    question: str = "Why must data be sorted before binary search works?",
    topic: str = "Searching",
    source_reference: str = "Page 2",
) -> dict:
    return {
        "kind": "short_answer",
        "topic": topic,
        "difficulty": "medium",
        "question": question,
        "options": [],
        "correct_answer": (
            "Binary search relies on sorted order to eliminate half the remaining values "
            "at each step."
        ),
        "explanation": "Binary search assumes sorted data.",
        "source_reference": source_reference,
        "rubric": "Mentions that binary search needs sorted data to work correctly.",
        "key_points": ["sorted data", "halves the search range"],
    }


def option_index(question: dict, text: str) -> int:
    """Where option ``text`` ended up: multiple-choice options are shuffled before storage."""
    return question["options"].index(text)


def draft(*questions: dict, weak_topics: list[str] | None = None) -> str:
    return json.dumps({"questions": list(questions), "weak_topics": weak_topics or []})


# --- generation --------------------------------------------------------------------------


def test_generate_quiz_endpoint_returns_validated_question_set() -> None:
    client = make_client(draft(mc_question(), short_answer_question(), weak_topics=["Searching"]))
    seed_document(client)

    response = client.post(
        "/api/documents/doc-quiz/quiz",
        json={"level": "beginner", "language": "en", "num_questions": 2},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["quiz_set_id"]
    assert len(payload["questions"]) == 2
    assert payload["weak_topics"] == ["Searching"]
    assert payload["metadata"]["generated_questions"] == 2
    assert payload["metadata"]["cached"] is False
    # The public question view never leaks the answer key up front.
    for question in payload["questions"]:
        assert "correct_answer" not in question
        assert "explanation" not in question
    mc_payload = next(q for q in payload["questions"] if q["kind"] == "multiple_choice")
    assert mc_payload["difficulty"] == "easy"
    assert len(mc_payload["options"]) == 4


def test_generated_question_count_matches_the_requested_count_exactly() -> None:
    """Picking N questions returns exactly N, never a hardcoded default (e.g. 8) -- even when
    the model returns more candidates than asked, they are trimmed down to N."""
    client = make_client(
        draft(
            mc_question(),
            mc_question(
                question="Which structure keeps values arranged for fast lookup?",
                source_reference="Page 1",
            ),
            short_answer_question(),
            mc_question(
                question="What do sorted values enable for binary search?",
                source_reference="Page 2",
            ),
            mc_question(
                question="Why does order matter when values are sorted?",
                source_reference="Page 1",
            ),
        )
    )
    seed_document(client)

    response = client.post(
        "/api/documents/doc-quiz/quiz",
        json={"level": "beginner", "language": "en", "num_questions": 4},
    )

    payload = response.json()
    assert len(payload["questions"]) == 4
    assert payload["metadata"]["requested_questions"] == 4
    assert payload["metadata"]["generated_questions"] == 4


def test_single_correct_multiple_choice_question_does_not_allow_multiple_selection() -> None:
    client = make_client(draft(mc_question()))
    seed_document(client)

    response = client.post(
        "/api/documents/doc-quiz/quiz",
        json={"level": "beginner", "language": "en", "num_questions": 1},
    )

    question = response.json()["questions"][0]
    assert question["allow_multiple"] is False


def test_a_model_that_still_tries_multi_correct_is_truncated_to_its_first_index() -> None:
    """Multi-correct ("select all that apply") was removed: if a model nonetheless returns
    more than one correct index, the question is kept (not dropped) but truncated to single-
    correct, taking the first index -- never surfaced to the learner as `allow_multiple`."""
    client = make_client(draft(multi_correct_mc_question(correct_option_indices=[0, 1])))
    seed_document(client)

    response = client.post(
        "/api/documents/doc-quiz/quiz",
        json={"level": "beginner", "language": "en", "num_questions": 1},
    )

    question = response.json()["questions"][0]
    assert question["allow_multiple"] is False
    assert "correct_option_indices" not in question  # still never leaked up front

    # Only the first index ("Sorting puts values in order") is actually correct now.
    right = client.post(
        f"/api/quiz/{question['id']}/answer",
        json={"selected_option_indices": [option_index(question, "Sorting puts values in order")]},
    )
    wrong = client.post(
        f"/api/quiz/{question['id']}/answer",
        json={"selected_option_indices": [option_index(question, "Sorting enables faster lookup")]},
    )
    assert right.json()["score"] == 1.0
    assert wrong.json()["score"] == 0.0


def test_mc_question_with_every_option_marked_correct_is_still_single_correct() -> None:
    """Even a model that marks all 4 options "correct" still only yields a single-correct
    question (truncated to the first index) rather than being dropped outright."""
    all_marked = multi_correct_mc_question(correct_option_indices=[0, 1, 2, 3])
    client = make_client(draft(all_marked, mc_question()))
    seed_document(client)

    response = client.post(
        "/api/documents/doc-quiz/quiz",
        json={"level": "beginner", "language": "en", "num_questions": 2},
    )

    payload = response.json()
    assert len(payload["questions"]) == 2
    assert all(question["allow_multiple"] is False for question in payload["questions"])


def test_generate_quiz_filters_invalid_questions_and_retries_for_the_shortfall() -> None:
    round_one = draft(
        mc_question(),
        {  # invalid: only 3 options, dropped by validation
            "kind": "multiple_choice",
            "topic": "Sorting",
            "difficulty": "easy",
            "question": "Which of these is a sorting algorithm?",
            "options": ["Quicksort", "Mergesort", "Heapsort"],
            "correct_answer": "Quicksort",
            "explanation": "Quicksort sorts values.",
            "source_reference": "Page 1",
        },
    )
    round_two = draft(
        short_answer_question(),
        mc_question(
            question="Which structure keeps values arranged for fast lookup?",
            correct="Sort",
            source_reference="Page 1",
        ),
    )
    client = make_client(round_one, round_two)
    seed_document(client)

    response = client.post(
        "/api/documents/doc-quiz/quiz",
        json={"level": "intermediate", "language": "en", "num_questions": 3},
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["questions"]) == 3
    assert len(client.app.state.llm_provider.calls) == 2  # one retry round for the shortfall


def test_generate_quiz_rejects_ungrounded_questions() -> None:
    fabricated = mc_question(
        question="What year was the Eiffel Tower built?",
        correct="1889",
    )
    fabricated["options"] = ["1889", "1901", "1923", "1945"]
    fabricated["explanation"] = "The Eiffel Tower was completed in 1889 for the World's Fair."
    client = make_client(draft(fabricated, mc_question()))
    seed_document(client)

    response = client.post(
        "/api/documents/doc-quiz/quiz",
        json={"level": "beginner", "language": "en", "num_questions": 2},
    )

    payload = response.json()
    # Only the grounded question survives; the fabricated one is dropped even though the
    # provider will not be asked again (num_questions caps generation rounds via MockProvider
    # falling back to an empty default draft on further calls).
    assert len(payload["questions"]) == 1
    assert payload["questions"][0]["topic"] == "Sorting"


def test_topic_scoped_quiz_only_uses_that_topics_chunks_and_caches_separately(
    tmp_path: Path,
) -> None:
    client = make_client(draft(mc_question()), draft(short_answer_question()))
    seed_document(client)
    embedding_provider = HashingEmbeddingProvider()
    store = ChromaVectorStore(tmp_path / "chroma")
    with client.app.state.session_factory() as session:
        document = session.get(Document, "doc-quiz")
        assert document is not None
        index_document(document, store=store, embedding_provider=embedding_provider)
    client.app.state.embedding_provider = embedding_provider
    client.app.state.vector_store = store

    whole_document = client.post(
        "/api/documents/doc-quiz/quiz",
        json={"level": "beginner", "language": "en", "num_questions": 1},
    ).json()
    retest = client.post(
        "/api/documents/doc-quiz/quiz",
        json={"level": "beginner", "language": "en", "num_questions": 1, "topic": "Searching"},
    ).json()

    assert retest["metadata"]["topic"] == "Searching"
    assert whole_document["metadata"]["topic"] is None
    # A topic-scoped "retest" quiz is a different cached entry from the whole-document one.
    assert retest["quiz_set_id"] != whole_document["quiz_set_id"]


def test_quiz_cache_hit_replays_the_same_quiz_set() -> None:
    client = make_client(draft(mc_question()))
    seed_document(client)
    body = {"level": "beginner", "language": "en", "num_questions": 1}

    first = client.post("/api/documents/doc-quiz/quiz", json=body)
    second = client.post("/api/documents/doc-quiz/quiz", json=body)

    assert first.json()["metadata"]["cached"] is False
    assert second.json()["metadata"]["cached"] is True
    assert first.json()["quiz_set_id"] == second.json()["quiz_set_id"]
    assert len(client.app.state.llm_provider.calls) == 1


def test_regenerate_bypasses_cache_and_creates_a_fresh_quiz_set() -> None:
    client = make_client(
        draft(mc_question()),
        draft(
            mc_question(question="What puts values in order for faster lookup?", correct="Sorting")
        ),
    )
    seed_document(client)
    body = {"level": "beginner", "language": "en", "num_questions": 1}

    first = client.post("/api/documents/doc-quiz/quiz", json=body)
    second = client.post("/api/documents/doc-quiz/quiz", json={**body, "regenerate": True})

    assert first.json()["metadata"]["cached"] is False
    assert second.json()["metadata"]["cached"] is False
    assert first.json()["quiz_set_id"] != second.json()["quiz_set_id"]
    assert len(client.app.state.llm_provider.calls) == 2


# --- grading -------------------------------------------------------------------------------


def test_multiple_choice_grading_is_deterministic() -> None:
    client = make_client(draft(mc_question()))
    seed_document(client)
    quiz = client.post(
        "/api/documents/doc-quiz/quiz",
        json={
            "level": "beginner",
            "language": "en",
            "num_questions": 1,
            "types": ["multiple_choice"],
        },
    ).json()
    question_id = quiz["questions"][0]["id"]
    sort_index = option_index(quiz["questions"][0], "Sort")

    wrong = client.post(f"/api/quiz/{question_id}/answer", json={"answer": "Copy"})
    right = client.post(f"/api/quiz/{question_id}/answer", json={"answer": "Sort"})

    assert wrong.status_code == 200
    assert wrong.json() == {
        "question_id": question_id,
        "kind": "multiple_choice",
        "topic": "Sorting",
        "correct": False,
        "score": 0.0,
        "provided": "Copy",
        "expected": "Sort",
        "correct_option_indices": [sort_index],
        "explanation": "Sorting organizes values in order.",
        "feedback": None,
        "missing_key_points": [],
        "source_reference": "Page 1",
        "peeked": False,
    }
    assert right.json()["correct"] is True
    assert right.json()["score"] == 1.0
    # No LLM calls are made for deterministic multiple-choice grading.
    assert len(client.app.state.llm_provider.calls) == 1


def test_short_answer_grading_uses_the_llm_and_parses_score_feedback_and_missing_points() -> None:
    client = make_client(draft(short_answer_question()))
    seed_document(client)
    quiz = client.post(
        "/api/documents/doc-quiz/quiz",
        json={
            "level": "intermediate",
            "language": "en",
            "num_questions": 1,
            "types": ["short_answer"],
        },
    ).json()
    question_id = quiz["questions"][0]["id"]

    client.app.state.llm_provider.enqueue(
        json.dumps(
            {
                "score": 0.5,
                "feedback": "You explained the ordering but missed the halving step.",
                "missing_key_points": ["halves the search range"],
            }
        )
    )

    response = client.post(
        f"/api/quiz/{question_id}/answer",
        json={"answer": "Binary search needs sorted data."},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["score"] == 0.5
    assert payload["correct"] is False  # below the 0.6 pass threshold
    assert payload["feedback"] == "You explained the ordering but missed the halving step."
    assert payload["missing_key_points"] == ["halves the search range"]
    # The grading call is temperature 0.
    assert client.app.state.llm_provider.calls[-1].temperature == 0.0


def _make_legacy_multi_correct_row(client: TestClient) -> int:
    """Directly writes a ``correct_option_indices`` of length 2 onto a freshly generated
    (now always single-correct) question, simulating a row cached from before multi-correct
    ("select all that apply") was removed -- generation itself can no longer produce this."""
    quiz = client.post(
        "/api/documents/doc-quiz/quiz",
        json={
            "level": "beginner",
            "language": "en",
            "num_questions": 1,
            "types": ["multiple_choice"],
        },
    ).json()
    question_id = quiz["questions"][0]["id"]
    with client.app.state.session_factory() as session:
        from app.db.models import QuizQuestion

        question = session.get(QuizQuestion, question_id)
        assert question is not None
        question.correct_option_indices = [0, 1]
        session.commit()
    return question_id


def test_grading_still_handles_a_legacy_multi_correct_row_with_partial_credit() -> None:
    """Multi-correct can no longer be generated, but grading math is untouched, so a question
    cached from before its removal (correct = {0, 1}) still grades with the same formula:
    exact match = full credit, a partial match = partial credit, nothing/all-wrong = 0."""
    client = make_client(draft(mc_question()))
    seed_document(client)
    question_id = _make_legacy_multi_correct_row(client)

    exact = client.post(f"/api/quiz/{question_id}/answer", json={"selected_option_indices": [0, 1]})
    assert exact.json()["correct"] is True
    assert exact.json()["score"] == 1.0

    nothing = client.post(f"/api/quiz/{question_id}/answer", json={"selected_option_indices": []})
    assert nothing.json()["score"] == 0.0

    # One of two correct, no wrong picks: (1 - 0) / 2 = 0.5.
    half = client.post(f"/api/quiz/{question_id}/answer", json={"selected_option_indices": [0]})
    assert half.json()["score"] == 0.5
    assert half.json()["correct"] is False

    # Both wrong options picked: (0 - 2) / 2 = -1, clamped to 0.
    both_wrong = client.post(
        f"/api/quiz/{question_id}/answer", json={"selected_option_indices": [2, 3]}
    )
    assert both_wrong.json()["score"] == 0.0


def test_legacy_quiz_question_without_stored_indices_still_grades_correctly() -> None:
    """A pre-upgrade cached row has no ``correct_option_indices`` in the database; grading
    backfills it from the ``correct_answer`` text instead of failing."""
    client = make_client(draft(mc_question()))
    seed_document(client)
    quiz = client.post(
        "/api/documents/doc-quiz/quiz",
        json={"level": "beginner", "language": "en", "num_questions": 1},
    ).json()
    question_id = quiz["questions"][0]["id"]
    sort_index = option_index(quiz["questions"][0], "Sort")
    with client.app.state.session_factory() as session:
        from app.db.models import QuizQuestion

        question = session.get(QuizQuestion, question_id)
        assert question is not None
        question.correct_option_indices = None  # simulate a row written before this column
        session.commit()

    response = client.post(
        f"/api/quiz/{question_id}/answer", json={"selected_option_indices": [sort_index]}
    )

    assert response.json()["correct"] is True
    assert response.json()["score"] == 1.0
    assert response.json()["correct_option_indices"] == [sort_index]


def test_peeked_flag_is_recorded_on_the_attempt_and_the_aggregated_results() -> None:
    client = make_client(draft(mc_question()))
    seed_document(client)
    quiz = client.post(
        "/api/documents/doc-quiz/quiz",
        json={"level": "beginner", "language": "en", "num_questions": 1},
    ).json()
    question_id = quiz["questions"][0]["id"]

    answer = client.post(
        f"/api/quiz/{question_id}/answer",
        json={
            "selected_option_indices": [option_index(quiz["questions"][0], "Sort")],
            "peeked": True,
        },
    )
    assert answer.json()["peeked"] is True
    # Peeking is recorded for the thesis's integrity tracking; it never changes the score.
    assert answer.json()["score"] == 1.0

    results = client.get(f"/api/quiz/{quiz['quiz_set_id']}/results").json()
    assert results["peeked"] is True


def test_peeked_defaults_to_false_when_never_flagged() -> None:
    client = make_client(draft(mc_question()))
    seed_document(client)
    quiz = client.post(
        "/api/documents/doc-quiz/quiz",
        json={"level": "beginner", "language": "en", "num_questions": 1},
    ).json()
    question_id = quiz["questions"][0]["id"]

    client.post(f"/api/quiz/{question_id}/answer", json={"selected_option_indices": [1]})

    results = client.get(f"/api/quiz/{quiz['quiz_set_id']}/results").json()
    assert results["peeked"] is False


# --- results and weak topics -----------------------------------------------------------------


def test_quiz_results_and_weak_topics_aggregate_across_questions() -> None:
    client = make_client(
        draft(
            mc_question(topic="Sorting", source_reference="Page 1"),
            mc_question(
                question="Which structure keeps values arranged for fast lookup?",
                correct="Binary tree",
                topic="Searching",
                source_reference="Page 2",
            ),
        )
    )
    seed_document(client)
    quiz = client.post(
        "/api/documents/doc-quiz/quiz",
        json={"level": "beginner", "language": "en", "num_questions": 2},
    ).json()
    sorting_question = next(q for q in quiz["questions"] if q["topic"] == "Sorting")
    searching_question = next(q for q in quiz["questions"] if q["topic"] == "Searching")

    client.post(f"/api/quiz/{sorting_question['id']}/answer", json={"answer": "Sort"})
    client.post(f"/api/quiz/{searching_question['id']}/answer", json={"answer": "Wrong option"})

    results = client.get(f"/api/quiz/{quiz['quiz_set_id']}/results").json()
    assert results["total_questions"] == 2
    assert results["answered_questions"] == 2
    assert results["correct_count"] == 1
    assert results["score"] == 0.5
    breakdown_by_topic = {entry["topic"]: entry for entry in results["topic_breakdown"]}
    assert breakdown_by_topic["Sorting"]["correct"] == 1
    assert breakdown_by_topic["Searching"]["correct"] == 0
    assert results["weak_topics"] == ["Searching"]

    weak_topics = client.get("/api/documents/doc-quiz/weak-topics").json()
    assert [entry["topic"] for entry in weak_topics] == ["Searching"]
    assert weak_topics[0]["mastery"] == 0.0
    assert weak_topics[0]["attempts"] == 1


def test_answering_an_unknown_question_returns_not_found() -> None:
    client = make_client()
    seed_document(client)

    response = client.post("/api/quiz/999999/answer", json={"answer": "anything"})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


# --- validation / deduplication unit tests -----------------------------------------------


def _document_with_chunks() -> Document:
    document = Document(
        filename="lecture.pdf",
        content_hash="c" * 64,
        content_type=ContentType.LECTURE,
        source_format=SourceFormat.PDF,
        detected_language=Language.EN,
        size_bytes=64,
        page_count=2,
    )
    document.chunks = [
        Chunk(ordinal=1, text=SORTING_TEXT, heading="Page 1", page_start=1, page_end=1),
        Chunk(ordinal=2, text=SEARCHING_TEXT, heading="Page 2", page_start=2, page_end=2),
    ]
    return document


def _validate(item: QuizQuestionInput, *, kind: str, level: Level = Level.BEGINNER) -> list:
    return _validate_and_normalize(
        [item], document=_document_with_chunks(), level=level, allowed_kinds={kind}
    )


def test_validate_and_normalize_drops_multiple_choice_without_four_options() -> None:
    item = QuizQuestionInput(**mc_question())
    item.options = item.options[:3]

    assert _validate(item, kind="multiple_choice") == []


def test_validate_and_normalize_drops_multiple_choice_when_answer_missing_from_options() -> None:
    item = QuizQuestionInput(**mc_question())
    item.correct_answer = "Merge"

    assert _validate(item, kind="multiple_choice") == []


def test_validate_and_normalize_drops_short_answer_without_key_points() -> None:
    item = QuizQuestionInput(**short_answer_question())
    item.key_points = []

    assert _validate(item, kind="short_answer") == []


def test_validate_and_normalize_falls_back_to_level_difficulty_when_missing() -> None:
    item = QuizQuestionInput(**mc_question())
    item.difficulty = "impossible"

    result = _validate(item, kind="multiple_choice", level=Level.ADVANCED)

    assert result[0].difficulty == "hard"


def test_is_grounded_rejects_questions_with_no_shared_vocabulary() -> None:
    chunks = _document_with_chunks().chunks

    assert _is_grounded("Which operation arranges values in order? Sort", chunks) is True
    assert _is_grounded("What year was the Eiffel Tower built? 1889", chunks) is False


def test_deduplicate_drops_near_identical_questions() -> None:
    first = QuizQuestionInput(**mc_question())
    near_duplicate = QuizQuestionInput(
        **mc_question(question="Which operation arranges values in order??")
    )
    distinct = QuizQuestionInput(
        **mc_question(question="Which structure keeps values arranged for fast lookup?")
    )

    result = _deduplicate([first, near_duplicate, distinct])

    assert len(result) == 2
    assert result[0].question == first.question
    assert result[1].question == distinct.question
