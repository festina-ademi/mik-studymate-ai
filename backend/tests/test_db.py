from datetime import datetime
from pathlib import Path

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import (
    AdaptationAction,
    AdaptationEvent,
    Chunk,
    Document,
    ExplainerScript,
    GeneratedContent,
    MessageRole,
    QuestionKind,
    QuizAttempt,
    QuizQuestion,
    QuizSet,
    SourceFormat,
    TopicMastery,
    TutorMessage,
)
from app.db.session import SessionFactory, create_engine, get_session, init_db
from app.domain import ContentType, Difficulty, Language, Level, Task
from app.main import create_app

EXPECTED_TABLES = {
    "documents",
    "chunks",
    "generated_content",
    "quiz_sets",
    "quiz_questions",
    "quiz_attempts",
    "topic_mastery",
    "adaptation_events",
    "tutor_messages",
    "explainer_scripts",
    "user_quota_usage",
    # Study Mode (see app.study.models), sharing this same Base/metadata.
    "study_materials",
    "study_tests",
    "test_items",
    "participants",
    "test_submissions",
    "questionnaire_responses",
    "usage_events",
    "admin_sessions",
}


def make_document() -> Document:
    return Document(
        filename="lecture.pdf",
        content_hash="f" * 64,
        content_type=ContentType.LECTURE,
        source_format=SourceFormat.PDF,
        detected_language=Language.EN,
        size_bytes=1234,
        page_count=3,
    )


def count(session: Session, model: type) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def test_exactly_the_expected_tables_exist(engine: Engine) -> None:
    tables = set(inspect(engine).get_table_names())

    assert tables == EXPECTED_TABLES


def test_a_full_object_graph_round_trips(session_factory: SessionFactory) -> None:
    with session_factory() as session:
        document = make_document()
        document.chunks = [
            Chunk(ordinal=0, text="Intro", page_start=1, page_end=1),
            Chunk(ordinal=1, text="def f(): ...", line_start=45, line_end=60, heading="f"),
        ]
        quiz = QuizSet(level=Level.BEGINNER, language=Language.SQ, model="m", prompt_version="1")
        quiz.questions = [
            QuizQuestion(
                ordinal=0,
                kind=QuestionKind.MULTIPLE_CHOICE,
                topic="Search",
                difficulty=Difficulty.MEDIUM,
                language=Language.SQ,
                question="What is binary search?",
                options=["a", "b", "c"],
                correct_answer="b",
                explanation="Because.",
                source_reference="Faqja 1",
            )
        ]
        quiz.questions[0].attempts = [QuizAttempt(answer="b", is_correct=True)]
        document.quiz_sets = [quiz]
        document.topic_mastery = [TopicMastery(topic="Search", attempts=1, correct=1, mastery=1.0)]
        document.adaptation_events = [
            AdaptationEvent(
                topic="Search",
                mastery_before=0.4,
                mastery_after=1.0,
                action=AdaptationAction.QUIZ_ANSWER,
            )
        ]
        document.tutor_messages = [
            TutorMessage(role=MessageRole.USER, content="Pse?", language=Language.SQ),
            TutorMessage(
                role=MessageRole.ASSISTANT,
                content="Sepse [Faqja 1]",
                language=Language.SQ,
                citations=[{"page": 1}],
            ),
        ]
        document.explainer_scripts = [
            ExplainerScript(
                section_index=0,
                title="Overview",
                language=Language.EN,
                level=Level.ADVANCED,
                script="Welcome.",
                model="m",
                prompt_version="1",
            )
        ]
        session.add(document)
        session.commit()
        document_id = document.id

    with session_factory() as session:
        loaded = session.get(Document, document_id)
        assert loaded is not None
        assert len(loaded.id) == 32
        assert isinstance(loaded.created_at, datetime)
        assert loaded.content_type is ContentType.LECTURE
        assert loaded.detected_language is Language.EN
        assert [chunk.ordinal for chunk in loaded.chunks] == [0, 1]
        assert loaded.chunks[1].line_end == 60
        question = loaded.quiz_sets[0].questions[0]
        assert question.options == ["a", "b", "c"]
        assert question.attempts[0].is_correct is True
        assert loaded.topic_mastery[0].mastery == 1.0
        assert loaded.adaptation_events[0].action is AdaptationAction.QUIZ_ANSWER
        assert loaded.adaptation_events[0].mastery_before == 0.4
        assert [m.role for m in loaded.tutor_messages] == [MessageRole.USER, MessageRole.ASSISTANT]
        assert loaded.tutor_messages[1].citations == [{"page": 1}]
        assert loaded.explainer_scripts[0].simplified is False


def test_deleting_a_document_deletes_everything_that_belongs_to_it(
    session_factory: SessionFactory,
) -> None:
    with session_factory() as session:
        document = make_document()
        document.chunks = [Chunk(ordinal=0, text="x")]
        quiz = QuizSet(level=Level.BEGINNER, language=Language.EN, model="m", prompt_version="1")
        question = QuizQuestion(
            ordinal=0,
            kind=QuestionKind.SHORT_ANSWER,
            topic="t",
            difficulty=Difficulty.EASY,
            language=Language.EN,
            question="q",
            correct_answer="a",
        )
        question.attempts = [QuizAttempt(answer="a", is_correct=True)]
        quiz.questions = [question]
        document.quiz_sets = [quiz]
        document.topic_mastery = [TopicMastery(topic="t")]
        document.adaptation_events = [
            AdaptationEvent(
                topic="t",
                mastery_before=0.0,
                mastery_after=1.0,
                action=AdaptationAction.QUIZ_ANSWER,
            )
        ]
        document.tutor_messages = [
            TutorMessage(role=MessageRole.USER, content="?", language=Language.EN)
        ]
        session.add(document)
        session.commit()

        session.delete(document)
        session.commit()

        for model in (
            Chunk,
            QuizSet,
            QuizQuestion,
            QuizAttempt,
            TopicMastery,
            AdaptationEvent,
            TutorMessage,
        ):
            assert count(session, model) == 0, model.__name__


def test_foreign_keys_are_enforced_by_the_database(session_factory: SessionFactory) -> None:
    with session_factory() as session:
        session.add(Chunk(document_id="does-not-exist", ordinal=0, text="orphan"))
        with pytest.raises(IntegrityError):
            session.commit()


def test_topic_mastery_is_unique_per_document_and_topic(session_factory: SessionFactory) -> None:
    with session_factory() as session:
        document = make_document()
        document.topic_mastery = [TopicMastery(topic="Sorting"), TopicMastery(topic="Sorting")]
        session.add(document)
        with pytest.raises(IntegrityError):
            session.commit()


def test_cache_keys_are_unique(session_factory: SessionFactory) -> None:
    def entry() -> GeneratedContent:
        return GeneratedContent(
            cache_key="k",
            document_hash="h",
            task=Task.SUMMARY,
            level=Level.BEGINNER,
            language=Language.EN,
            model="m",
            prompt_version="1",
            content="c",
        )

    with session_factory() as session:
        session.add_all([entry(), entry()])
        with pytest.raises(IntegrityError):
            session.commit()


def test_init_db_creates_the_folder_of_a_file_database(tmp_path: Path) -> None:
    database = tmp_path / "nested" / "folder" / "app.db"
    engine = create_engine(f"sqlite:///{database.as_posix()}")

    init_db(engine)
    init_db(engine)  # idempotent

    assert database.is_file()
    assert set(inspect(engine).get_table_names()) == EXPECTED_TABLES
    engine.dispose()


def test_tables_are_created_on_application_startup(settings: Settings) -> None:
    app = create_app(settings)

    with TestClient(app):
        assert set(inspect(app.state.engine).get_table_names()) == EXPECTED_TABLES


def test_get_session_dependency_gives_a_working_session_per_request(settings: Settings) -> None:
    app = create_app(settings)

    @app.get("/api/_test/documents")
    def list_documents(session: Session = Depends(get_session)) -> dict[str, int]:
        session.add(make_document())
        session.commit()
        return {"count": count(session, Document)}

    with TestClient(app) as client:
        assert client.get("/api/_test/documents").json() == {"count": 1}
        assert client.get("/api/_test/documents").json() == {"count": 2}
