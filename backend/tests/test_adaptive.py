"""Tests for adaptive personalization: mastery EWMA, thresholds, re-explanation, and the
tutor's learner profile.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.models import (
    AdaptationAction,
    Chunk,
    Document,
    QuestionKind,
    QuizQuestion,
    SourceFormat,
    TopicMastery,
)
from app.db.session import SessionFactory
from app.domain import ContentType, Difficulty, Language, Level, MasteryLevel
from app.llm.mock import MockProvider
from app.rag.embeddings import HashingEmbeddingProvider
from app.rag.indexer import index_document
from app.rag.store import ChromaVectorStore
from app.services.adaptive import (
    DEFAULT_DEVELOPING_THRESHOLD,
    DEFAULT_WEAK_THRESHOLD,
    classify_mastery,
    generate_reexplanation,
    get_mastery_overview,
    get_weak_topics,
    one_step_easier,
    render_learner_profile,
    update_topic_mastery,
)
from app.services.cache import ContentCache
from app.services.tutor import generate_tutor_answer

# --- mastery EWMA math ------------------------------------------------------------------------


def _question(topic: str = "Sorting", difficulty: Difficulty = Difficulty.MEDIUM) -> QuizQuestion:
    return QuizQuestion(
        ordinal=0,
        kind=QuestionKind.MULTIPLE_CHOICE,
        topic=topic,
        difficulty=difficulty,
        language=Language.EN,
        question="q",
        correct_answer="a",
    )


def test_first_observation_sets_mastery_to_the_observed_score() -> None:
    document = Document(
        filename="f.pdf",
        content_hash="a" * 64,
        content_type=ContentType.LECTURE,
        source_format=SourceFormat.PDF,
        size_bytes=1,
    )

    before, after = update_topic_mastery(
        document=document, question=_question(), score=0.8, is_correct=True
    )

    assert before == 0.0
    assert after == pytest.approx(0.8)
    assert document.topic_mastery[0].attempts == 1
    assert document.topic_mastery[0].correct == 1


def test_ewma_blends_the_new_score_with_the_running_average_at_medium_difficulty() -> None:
    document = Document(
        filename="f.pdf",
        content_hash="a" * 64,
        content_type=ContentType.LECTURE,
        source_format=SourceFormat.PDF,
        size_bytes=1,
    )
    document.topic_mastery = [TopicMastery(topic="Sorting", attempts=1, correct=1, mastery=0.8)]

    # Medium difficulty: effective_alpha = alpha * 1.0 = 0.3.
    before, after = update_topic_mastery(
        document=document,
        question=_question(difficulty=Difficulty.MEDIUM),
        score=0.2,
        is_correct=False,
        alpha=0.3,
    )

    assert before == pytest.approx(0.8)
    assert after == pytest.approx(0.7 * 0.8 + 0.3 * 0.2)  # 0.62
    assert document.topic_mastery[0].attempts == 2
    assert document.topic_mastery[0].correct == 1  # unchanged: this answer was wrong


def test_a_hard_question_moves_mastery_further_than_an_easy_one() -> None:
    def blended(difficulty: Difficulty) -> float:
        document = Document(
            filename="f.pdf",
            content_hash="a" * 64,
            content_type=ContentType.LECTURE,
            source_format=SourceFormat.PDF,
            size_bytes=1,
        )
        document.topic_mastery = [TopicMastery(topic="Sorting", attempts=1, correct=1, mastery=0.5)]
        _, after = update_topic_mastery(
            document=document,
            question=_question(difficulty=difficulty),
            score=1.0,
            is_correct=True,
            alpha=0.3,
        )
        return after

    easy_result = blended(Difficulty.EASY)
    medium_result = blended(Difficulty.MEDIUM)
    hard_result = blended(Difficulty.HARD)

    # All three start at 0.5 and are answered perfectly; a harder question must pull the
    # running average up further because it is stronger evidence of mastery.
    assert easy_result < medium_result < hard_result


def test_effective_alpha_is_capped_at_one_for_very_hard_high_alpha_combinations() -> None:
    document = Document(
        filename="f.pdf",
        content_hash="a" * 64,
        content_type=ContentType.LECTURE,
        source_format=SourceFormat.PDF,
        size_bytes=1,
    )
    document.topic_mastery = [TopicMastery(topic="Sorting", attempts=1, correct=1, mastery=0.9)]

    # alpha=0.9 * a 1.4 hard-difficulty weight would exceed 1.0 without the cap; capped, the
    # new score should fully replace the running average.
    _, after = update_topic_mastery(
        document=document,
        question=_question(difficulty=Difficulty.HARD),
        score=0.1,
        is_correct=False,
        alpha=0.9,
    )

    assert after == pytest.approx(0.1)


# --- thresholds / classification ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (0.0, MasteryLevel.WEAK),
        (0.49, MasteryLevel.WEAK),
        (0.5, MasteryLevel.DEVELOPING),
        (0.74, MasteryLevel.DEVELOPING),
        (0.75, MasteryLevel.STRONG),
        (1.0, MasteryLevel.STRONG),
    ],
)
def test_classify_mastery_default_thresholds(value: float, expected: MasteryLevel) -> None:
    assert classify_mastery(value) is expected


def test_classify_mastery_honors_custom_thresholds() -> None:
    assert classify_mastery(0.55, weak_threshold=0.6, developing_threshold=0.8) is MasteryLevel.WEAK
    assert (
        classify_mastery(0.65, weak_threshold=0.6, developing_threshold=0.8)
        is MasteryLevel.DEVELOPING
    )
    assert (
        classify_mastery(0.85, weak_threshold=0.6, developing_threshold=0.8) is MasteryLevel.STRONG
    )


def test_one_step_easier() -> None:
    assert one_step_easier(Level.ADVANCED) is Level.INTERMEDIATE
    assert one_step_easier(Level.INTERMEDIATE) is Level.BEGINNER
    assert one_step_easier(Level.BEGINNER) is Level.BEGINNER  # already the simplest


def test_get_weak_topics_and_mastery_overview_classify_consistently() -> None:
    document = Document(
        filename="f.pdf",
        content_hash="a" * 64,
        content_type=ContentType.LECTURE,
        source_format=SourceFormat.PDF,
        size_bytes=1,
    )
    document.topic_mastery = [
        TopicMastery(topic="Weak topic", attempts=3, correct=1, mastery=0.3),
        TopicMastery(topic="Developing topic", attempts=3, correct=2, mastery=0.6),
        TopicMastery(topic="Strong topic", attempts=3, correct=3, mastery=0.9),
        TopicMastery(topic="Untouched topic", attempts=0, correct=0, mastery=0.0),
    ]

    weak = get_weak_topics(document)
    assert [entry.topic for entry in weak] == ["Weak topic"]

    overview = get_mastery_overview(document)
    assert [entry.topic for entry in overview] == ["Strong topic", "Developing topic", "Weak topic"]
    by_topic = {entry.topic: entry.level for entry in overview}
    assert by_topic == {
        "Strong topic": MasteryLevel.STRONG,
        "Developing topic": MasteryLevel.DEVELOPING,
        "Weak topic": MasteryLevel.WEAK,
    }


# --- adaptation trigger through the API ---------------------------------------------------------


def test_answering_a_quiz_question_logs_a_quiz_answer_adaptation_event(client: TestClient) -> None:
    client.app.state.llm_provider = MockProvider(
        [
            json.dumps(
                {
                    "questions": [
                        {
                            "kind": "multiple_choice",
                            "topic": "Sorting",
                            "difficulty": "medium",
                            "question": "Which operation arranges values in order?",
                            "options": ["Search", "Sort", "Copy", "Delete"],
                            "correct_answer": "Sort",
                            "explanation": "Sorting organizes values in order.",
                            "source_reference": "Page 1",
                        }
                    ],
                    "weak_topics": [],
                }
            )
        ]
    )
    with client.app.state.session_factory() as session:
        document = Document(
            id="doc-adapt",
            filename="lecture.pdf",
            content_hash="hash-adapt",
            content_type=ContentType.LECTURE,
            source_format=SourceFormat.PDF,
            detected_language=Language.EN,
            size_bytes=1,
            page_count=1,
        )
        session.add(document)
        session.add(
            Chunk(
                document_id="doc-adapt",
                ordinal=1,
                text="Sorting puts values in order for faster lookup.",
                heading="Page 1",
                page_start=1,
                page_end=1,
            )
        )
        session.commit()

    quiz = client.post(
        "/api/documents/doc-adapt/quiz",
        json={"level": "beginner", "language": "en", "num_questions": 1},
    ).json()
    question_id = quiz["questions"][0]["id"]

    response = client.post(f"/api/quiz/{question_id}/answer", json={"answer": "Sort"})
    assert response.status_code == 200

    with client.app.state.session_factory() as session:
        document = session.get(Document, "doc-adapt")
        assert document is not None
        events = document.adaptation_events
        assert len(events) == 1
        assert events[0].action is AdaptationAction.QUIZ_ANSWER
        assert events[0].topic == "Sorting"
        assert events[0].mastery_before == 0.0
        assert events[0].mastery_after == pytest.approx(1.0)


# --- re-explanation -------------------------------------------------------------------------


@pytest.fixture
def rag_store(tmp_path: Path) -> ChromaVectorStore:
    return ChromaVectorStore(tmp_path / "chroma")


def _tutor_style_document(session: Session, store: ChromaVectorStore, document_id: str) -> Document:
    document = Document(
        id=document_id,
        filename="lecture.pdf",
        content_hash=f"{document_id}-hash",
        content_type=ContentType.LECTURE,
        source_format=SourceFormat.PDF,
        detected_language=Language.EN,
        size_bytes=64,
        page_count=1,
    )
    session.add(document)
    session.add(
        Chunk(
            document_id=document_id,
            ordinal=1,
            text="Binary search halves the remaining range at each step on sorted data.",
            heading="Page 1",
            page_start=1,
            page_end=1,
        )
    )
    session.commit()
    session.refresh(document)
    index_document(document, store=store, embedding_provider=HashingEmbeddingProvider())
    return document


def _reexplain_draft(
    explanation: str = "Binary search halves the range each time.",
    example: str = "Looking up 7 in [1,3,5,7,9] checks 5, then 7.",
    trace: str = "",
    references: list[str] | None = None,
) -> str:
    return json.dumps(
        {
            "explanation": explanation,
            "example": example,
            "trace": trace,
            "references": references or ["Page 1"],
        }
    )


@pytest.mark.anyio
async def test_reexplain_uses_a_level_one_step_easier_and_is_grounded(
    session_factory: SessionFactory, rag_store: ChromaVectorStore
) -> None:
    embedding_provider = HashingEmbeddingProvider()
    with session_factory() as session:
        document = _tutor_style_document(session, rag_store, "doc-reexplain")
        document.topic_mastery = [
            TopicMastery(topic="Binary search", attempts=2, correct=0, mastery=0.2)
        ]
        session.commit()
        session.refresh(document)

        provider = MockProvider([_reexplain_draft()])
        cache = ContentCache(session_factory)

        result = await generate_reexplanation(
            document=document,
            provider=provider,
            cache=cache,
            store=rag_store,
            embedding_provider=embedding_provider,
            topic="Binary search",
            level="advanced",
            language="en",
            session=session,
        )

        assert result.level == "intermediate"  # one step easier than "advanced"
        assert result.explanation == "Binary search halves the range each time."
        assert result.example
        assert result.references == ["Page 1"]
        assert result.mastery == pytest.approx(0.2)


@pytest.mark.anyio
async def test_reexplain_caches_per_topic_and_logs_an_adaptation_event_on_every_delivery(
    session_factory: SessionFactory, rag_store: ChromaVectorStore
) -> None:
    embedding_provider = HashingEmbeddingProvider()
    with session_factory() as session:
        document = _tutor_style_document(session, rag_store, "doc-reexplain-cache")
        provider = MockProvider([_reexplain_draft()])
        cache = ContentCache(session_factory)

        first = await generate_reexplanation(
            document=document,
            provider=provider,
            cache=cache,
            store=rag_store,
            embedding_provider=embedding_provider,
            topic="Binary search",
            level="intermediate",
            language="en",
            session=session,
        )
        second = await generate_reexplanation(
            document=document,
            provider=provider,
            cache=cache,
            store=rag_store,
            embedding_provider=embedding_provider,
            topic="Binary search",
            level="intermediate",
            language="en",
            session=session,
        )

        assert first.metadata["cached"] is False
        assert second.metadata["cached"] is True
        assert len(provider.calls) == 1  # the model is only asked once; the rest is cached

        session.refresh(document)
        events = [e for e in document.adaptation_events if e.action == "reexplain"]
        assert len(events) == 2  # logged on both the fresh generation and the cache replay


@pytest.mark.anyio
async def test_reexplain_for_a_different_topic_is_not_served_from_the_other_topics_cache(
    session_factory: SessionFactory, rag_store: ChromaVectorStore
) -> None:
    embedding_provider = HashingEmbeddingProvider()
    with session_factory() as session:
        document = _tutor_style_document(session, rag_store, "doc-reexplain-topics")
        provider = MockProvider(
            [
                _reexplain_draft(explanation="About binary search."),
                _reexplain_draft(explanation="About sorted data in general."),
            ]
        )
        cache = ContentCache(session_factory)

        first = await generate_reexplanation(
            document=document,
            provider=provider,
            cache=cache,
            store=rag_store,
            embedding_provider=embedding_provider,
            topic="Binary search",
            level="intermediate",
            language="en",
            session=session,
        )
        second = await generate_reexplanation(
            document=document,
            provider=provider,
            cache=cache,
            store=rag_store,
            embedding_provider=embedding_provider,
            topic="Sorted data",
            level="intermediate",
            language="en",
            session=session,
        )

        assert first.explanation == "About binary search."
        assert second.explanation == "About sorted data in general."
        assert len(provider.calls) == 2


def test_reexplain_endpoint_end_to_end(client: TestClient, tmp_path: Path) -> None:
    embedding_provider = HashingEmbeddingProvider()
    rag_store = ChromaVectorStore(tmp_path / "chroma")
    client.app.state.embedding_provider = embedding_provider
    client.app.state.vector_store = rag_store
    with client.app.state.session_factory() as session:
        _tutor_style_document(session, rag_store, "doc-reexplain-api")

    client.app.state.llm_provider = MockProvider([_reexplain_draft(trace="step 1, step 2")])

    response = client.post(
        "/api/documents/doc-reexplain-api/topics/Binary%20search/reexplain",
        json={"level": "advanced", "language": "en"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["topic"] == "Binary search"
    assert payload["level"] == "intermediate"
    assert payload["explanation"]
    assert payload["example"]


# --- learner profile in the tutor system prompt --------------------------------------------


def _tutor_draft(answer: str = "An answer [Page 1].") -> str:
    return json.dumps({"answer": answer, "follow_up_questions": []})


@pytest.mark.anyio
async def test_tutor_system_prompt_includes_the_learner_profile_when_history_exists(
    session_factory: SessionFactory, rag_store: ChromaVectorStore
) -> None:
    embedding_provider = HashingEmbeddingProvider()
    with session_factory() as session:
        document = _tutor_style_document(session, rag_store, "doc-profile")
        document.topic_mastery = [
            TopicMastery(topic="Binary search", attempts=3, correct=0, mastery=0.2),
            TopicMastery(topic="Linear search", attempts=3, correct=3, mastery=0.9),
        ]
        session.commit()
        session.refresh(document)

        provider = MockProvider([_tutor_draft()])

        await generate_tutor_answer(
            document=document,
            provider=provider,
            store=rag_store,
            embedding_provider=embedding_provider,
            message="Can you help me study?",
            level="intermediate",
            language="en",
            session=session,
        )

        system_prompt = provider.calls[0].system or ""
        assert "Learner profile" in system_prompt
        assert "Binary search" in system_prompt
        assert "Linear search" in system_prompt


@pytest.mark.anyio
async def test_tutor_system_prompt_omits_the_profile_with_no_quiz_history(
    session_factory: SessionFactory, rag_store: ChromaVectorStore
) -> None:
    embedding_provider = HashingEmbeddingProvider()
    with session_factory() as session:
        document = _tutor_style_document(session, rag_store, "doc-no-profile")
        provider = MockProvider([_tutor_draft()])

        await generate_tutor_answer(
            document=document,
            provider=provider,
            store=rag_store,
            embedding_provider=embedding_provider,
            message="Can you help me study?",
            level="intermediate",
            language="en",
            session=session,
        )

        assert "Learner profile" not in (provider.calls[0].system or "")


def test_render_learner_profile_is_empty_with_no_weak_or_strong_topics() -> None:
    entries = [TopicMastery(topic="Balanced", attempts=2, correct=1, mastery=0.6)]

    assert render_learner_profile(level=Level.INTERMEDIATE, topic_entries=entries) == ""


def test_render_learner_profile_defaults_match_settings_defaults() -> None:
    # Sanity check that the module-level defaults used across mastery/profile helpers agree.
    assert DEFAULT_WEAK_THRESHOLD == 0.5
    assert DEFAULT_DEVELOPING_THRESHOLD == 0.75
