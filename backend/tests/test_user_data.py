"""Tests for the cross-document history and full-wipe endpoints under ``/api/user``."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.db.models import (
    Document,
    GeneratedContent,
    QuestionKind,
    QuizAttempt,
    QuizQuestion,
    QuizSet,
    SourceFormat,
)
from app.domain import ContentType, Difficulty, Language, Level, Task


def seed_document(
    app: FastAPI, document_id: str, filename: str, *, created_at: datetime | None = None
) -> None:
    with app.state.session_factory() as session:
        document = Document(
            id=document_id,
            filename=filename,
            content_hash=f"hash-{document_id}",
            content_type=ContentType.LECTURE,
            source_format=SourceFormat.PDF,
            detected_language=Language.EN,
            size_bytes=123,
            page_count=2,
        )
        if created_at is not None:
            document.created_at = created_at
        session.add(document)
        session.commit()


def seed_answered_quiz(app: FastAPI, document_id: str, quiz_set_id: str) -> None:
    """A quiz set with one answered (correct) question, so it counts as "taken"."""
    with app.state.session_factory() as session:
        session.add(
            QuizSet(
                id=quiz_set_id,
                document_id=document_id,
                level=Level.INTERMEDIATE,
                language=Language.EN,
                model="mock",
                prompt_version="test",
            )
        )
        session.flush()
        question = QuizQuestion(
            quiz_set_id=quiz_set_id,
            ordinal=1,
            kind=QuestionKind.MULTIPLE_CHOICE,
            topic="Sorting",
            difficulty=Difficulty.EASY,
            language=Language.EN,
            question="Which operation arranges values in order?",
            options=["Sort", "Search", "Hash"],
            correct_answer="Sort",
            correct_option_indices=[0],
        )
        session.add(question)
        session.flush()
        session.add(QuizAttempt(question_id=question.id, answer="Sort", is_correct=True, score=1.0))
        session.commit()


def seed_unanswered_quiz(app: FastAPI, document_id: str, quiz_set_id: str) -> None:
    """A generated quiz set nobody has answered yet -- should not count as "taken"."""
    with app.state.session_factory() as session:
        session.add(
            QuizSet(
                id=quiz_set_id,
                document_id=document_id,
                level=Level.INTERMEDIATE,
                language=Language.EN,
                model="mock",
                prompt_version="test",
            )
        )
        session.flush()
        session.add(
            QuizQuestion(
                quiz_set_id=quiz_set_id,
                ordinal=1,
                kind=QuestionKind.MULTIPLE_CHOICE,
                topic="Sorting",
                difficulty=Difficulty.EASY,
                language=Language.EN,
                question="Which operation arranges values in order?",
                options=["Sort", "Search", "Hash"],
                correct_answer="Sort",
                correct_option_indices=[0],
            )
        )
        session.commit()


def seed_generated_content(app: FastAPI) -> None:
    with app.state.session_factory() as session:
        session.add(
            GeneratedContent(
                cache_key="k1",
                document_hash="hash-doc-1",
                task=Task.SUMMARY,
                level=Level.INTERMEDIATE,
                language=Language.EN,
                model="mock",
                prompt_version="test",
                content="cached summary text",
            )
        )
        session.commit()


def test_get_user_documents_lists_every_document_newest_first(client: TestClient) -> None:
    # Explicit, distinct timestamps: two inserts in the same test can otherwise land in the same
    # microsecond, making `created_at DESC` ordering between them a tie (and the test flaky).
    seed_document(client.app, "doc-1", "first.pdf", created_at=datetime(2026, 1, 1, tzinfo=UTC))
    seed_document(client.app, "doc-2", "second.pdf", created_at=datetime(2026, 1, 2, tzinfo=UTC))

    response = client.get("/api/user/documents")

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == ["doc-2", "doc-1"]
    assert body[0]["filename"] == "second.pdf"
    assert body[0]["content_type"] == "lecture"
    assert body[0]["created_at"]


def test_get_user_quiz_history_only_counts_answered_quizzes(client: TestClient) -> None:
    seed_document(client.app, "doc-1", "lecture.pdf")
    seed_answered_quiz(client.app, "doc-1", "quiz-answered")
    seed_unanswered_quiz(client.app, "doc-1", "quiz-unanswered")

    response = client.get("/api/user/quiz-history")

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    entry = body[0]
    assert entry["quiz_set_id"] == "quiz-answered"
    assert entry["document_name"] == "lecture.pdf"
    assert entry["answered_questions"] == 1
    assert entry["correct_count"] == 1
    assert entry["score"] == 1.0


def test_delete_all_user_data_wipes_documents_cache_and_tts_cache(
    client: TestClient, tmp_path: Path
) -> None:
    client.app.state.settings.tts_cache_dir = tmp_path / "tts_cache"
    tts_cache_dir = client.app.state.settings.tts_cache_dir
    tts_cache_dir.mkdir(parents=True)
    cached_audio = tts_cache_dir / "cached.wav"
    cached_audio.write_bytes(b"fake-audio")

    seed_document(client.app, "doc-1", "lecture.pdf")
    seed_answered_quiz(client.app, "doc-1", "quiz-answered")
    seed_generated_content(client.app)

    response = client.delete("/api/user/all-data")

    assert response.status_code == 200
    assert response.json() == {"deleted_documents": 1}
    assert not cached_audio.exists()

    with client.app.state.session_factory() as session:
        assert session.query(Document).count() == 0
        assert session.query(QuizSet).count() == 0
        assert session.query(QuizQuestion).count() == 0
        assert session.query(QuizAttempt).count() == 0
        assert session.query(GeneratedContent).count() == 0

    assert client.get("/api/user/documents").json() == []
    assert client.get("/api/user/quiz-history").json() == []
