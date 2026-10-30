"""Regression tests: a "retest this topic" quiz must update that topic's mastery.

The model labels each generated question with its own topic string, which drifts from the
label the original quiz used ("Password Length" vs "password length check"). Retest answers
then updated a different mastery row, and the retested topic stayed where it was.
"""

from pathlib import Path

from fastapi.testclient import TestClient

from app.db.models import Document, QuizQuestion, TopicMastery
from app.rag.embeddings import HashingEmbeddingProvider
from app.rag.indexer import index_document
from app.rag.store import ChromaVectorStore
from app.services.adaptive import normalize_topic
from tests.test_quiz import draft, make_client, mc_question, seed_document

# Three distinct, grounded questions whose model-assigned topic labels all drift from "Sorting".
_RETEST_QUESTIONS = [
    mc_question(
        question="Which operation arranges values in order?",
        correct="Sort",
        topic="sorting algorithms",
        correct_option_indices=[1],
    ),
    mc_question(
        question="What puts values in order for faster lookup?",
        correct="Sorting",
        topic="  SORTING ",
        correct_option_indices=[1],
    ),
    mc_question(
        question="Ordering values in advance gives faster what?",
        correct="Lookup",
        topic="ordering values",
        correct_option_indices=[1],
    ),
]
_RETEST_BODY = {
    "level": "beginner",
    "language": "en",
    "num_questions": 3,
    "types": ["multiple_choice"],
    "regenerate": True,
    "topic": "Sorting",
}


def _retest_client(tmp_path: Path, *responses: str) -> TestClient:
    """A client with a seeded, indexed document (a topic-scoped retest retrieves its chunks)."""
    client = make_client(*responses)
    seed_document(client)
    embedding_provider = HashingEmbeddingProvider()
    store = ChromaVectorStore(tmp_path / "chroma")
    with client.app.state.session_factory() as session:
        document = session.get(Document, "doc-quiz")
        assert document is not None
        index_document(document, store=store, embedding_provider=embedding_provider)
    client.app.state.embedding_provider = embedding_provider
    client.app.state.vector_store = store
    return client


def _seed_mastery(client: TestClient, mastery: float) -> None:
    with client.app.state.session_factory() as session:
        session.add(
            TopicMastery(
                document_id="doc-quiz", topic="Sorting", attempts=2, correct=1, mastery=mastery
            )
        )
        session.commit()


def _mastery_rows(client: TestClient) -> dict[str, float]:
    return {
        entry["topic"]: entry["mastery"]
        for entry in client.get("/api/documents/doc-quiz/mastery").json()
    }


def _answer_all(client: TestClient, questions: list[dict], *, correctly: bool) -> None:
    for question in questions:
        with client.app.state.session_factory() as session:
            row = session.get(QuizQuestion, question["id"])
            assert row is not None and row.correct_option_indices is not None
            correct_index = row.correct_option_indices[0]
        pick = correct_index if correctly else (correct_index + 1) % len(question["options"])
        response = client.post(
            f"/api/quiz/{question['id']}/answer",
            json={"answer": "", "selected_option_indices": [pick]},
        )
        assert response.status_code == 200
        assert response.json()["correct"] is correctly


def test_normalize_topic_ignores_case_and_surrounding_or_repeated_whitespace() -> None:
    assert normalize_topic("  Password   Length ") == normalize_topic("password length")


def test_retest_questions_are_pinned_to_the_topics_stored_spelling(tmp_path: Path) -> None:
    client = _retest_client(tmp_path, draft(*_RETEST_QUESTIONS))
    _seed_mastery(client, 0.5)

    retest = client.post(
        "/api/documents/doc-quiz/quiz", json={**_RETEST_BODY, "topic": "  sorting "}
    ).json()

    assert [question["topic"] for question in retest["questions"]] == ["Sorting"] * 3


def test_retest_all_correct_raises_mastery_above_its_pre_retest_value(tmp_path: Path) -> None:
    client = _retest_client(tmp_path, draft(*_RETEST_QUESTIONS))
    _seed_mastery(client, 0.5)

    retest = client.post("/api/documents/doc-quiz/quiz", json=_RETEST_BODY).json()
    _answer_all(client, retest["questions"], correctly=True)

    rows = _mastery_rows(client)
    assert rows["Sorting"] > 0.5
    # The retest answers landed on the retested topic, not on new rows under drifted labels.
    assert list(rows) == ["Sorting"]
    with client.app.state.session_factory() as session:
        document = session.get(Document, "doc-quiz")
        assert document is not None
        assert document.topic_mastery[0].attempts == 2 + 3


def test_full_flow_original_quiz_then_retest_raises_mastery(tmp_path: Path) -> None:
    original = mc_question(correct_option_indices=[1], topic="Sorting")
    second = mc_question(
        question="What puts values in order before a lookup?",
        correct="Sorting",
        topic="Sorting",
        correct_option_indices=[1],
    )
    client = _retest_client(tmp_path, draft(original, second), draft(*_RETEST_QUESTIONS))
    quiz = client.post(
        "/api/documents/doc-quiz/quiz",
        json={
            "level": "beginner",
            "language": "en",
            "num_questions": 2,
            "types": ["multiple_choice"],
        },
    ).json()
    first_question, second_question = quiz["questions"]
    _answer_all(client, [first_question], correctly=False)
    _answer_all(client, [second_question], correctly=True)
    before = _mastery_rows(client)["Sorting"]
    assert 0.0 < before < 0.5

    retest = client.post("/api/documents/doc-quiz/quiz", json=_RETEST_BODY).json()
    _answer_all(client, retest["questions"], correctly=True)

    assert _mastery_rows(client)["Sorting"] > before


def test_starting_a_retest_does_not_reset_mastery(tmp_path: Path) -> None:
    client = _retest_client(tmp_path, draft(*_RETEST_QUESTIONS))
    _seed_mastery(client, 0.5)

    response = client.post("/api/documents/doc-quiz/quiz", json=_RETEST_BODY)

    assert response.status_code == 200
    assert _mastery_rows(client) == {"Sorting": 0.5}


def test_retest_with_all_wrong_answers_does_not_raise_mastery(tmp_path: Path) -> None:
    client = _retest_client(tmp_path, draft(*_RETEST_QUESTIONS))
    _seed_mastery(client, 0.5)

    retest = client.post("/api/documents/doc-quiz/quiz", json=_RETEST_BODY).json()
    _answer_all(client, retest["questions"], correctly=False)

    assert _mastery_rows(client)["Sorting"] < 0.5
