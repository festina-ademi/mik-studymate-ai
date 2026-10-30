"""Tests for Explainer Mode: sectioning, script generation, and caching.

Server-side TTS has its own test module, ``tests/test_tts.py``, now that it is a peer service
(``app/tts/``) rather than part of Explainer Mode's own endpoints.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import Chunk, Document, SourceFormat
from app.db.session import SessionFactory
from app.domain import ContentType, Language
from app.errors import AppError
from app.llm.mock import MockProvider
from app.main import create_app
from app.rag.embeddings import HashingEmbeddingProvider
from app.rag.indexer import index_document
from app.rag.store import ChromaVectorStore
from app.services.cache import ContentCache
from app.services.explainer_mode import (
    generate_overview,
    generate_section_script,
    plan_sections,
    split_into_captions,
)

# --- sectioning (no LLM) ---------------------------------------------------------------------


def _lecture_document(num_pages: int, words_per_page: int = 100) -> Document:
    document = Document(
        id="doc-lecture",
        filename="lecture.pdf",
        content_hash="a" * 64,
        content_type=ContentType.LECTURE,
        source_format=SourceFormat.PDF,
        detected_language=Language.EN,
        size_bytes=1,
        page_count=num_pages,
    )
    document.chunks = [
        Chunk(
            id=index + 1,
            document_id="doc-lecture",
            ordinal=index,
            text=" ".join(f"word{index}-{i}" for i in range(words_per_page)),
            heading=f"Page {index + 1}",
            page_start=index + 1,
            page_end=index + 1,
        )
        for index in range(num_pages)
    ]
    return document


def _code_document(files: dict[str, list[int]]) -> Document:
    """A code document from ``{source_name: [word_count_per_chunk, ...]}``."""
    document = Document(
        id="doc-code",
        filename="bundle.zip",
        content_hash="b" * 64,
        content_type=ContentType.CODE,
        source_format=SourceFormat.CODE,
        size_bytes=1,
    )
    chunks = []
    chunk_id = 1
    ordinal = 0
    for name, chunk_word_counts in files.items():
        line = 1
        for words in chunk_word_counts:
            chunks.append(
                Chunk(
                    id=chunk_id,
                    document_id="doc-code",
                    ordinal=ordinal,
                    text=" ".join(f"tok{chunk_id}-{i}" for i in range(words)),
                    heading=name,
                    source_name=name,
                    line_start=line,
                    line_end=line + words - 1,
                )
            )
            chunk_id += 1
            ordinal += 1
            line += words
    document.chunks = chunks
    return document


def test_plan_sections_groups_pages_by_word_budget() -> None:
    document = _lecture_document(num_pages=6, words_per_page=100)

    # A group closes once its running total reaches the target, so 2 pages (200 words) close
    # a group against a 150-word target, and a 3rd page starts the next one.
    sections = plan_sections(document, target_words=150, max_sections=12)

    assert len(sections) == 3
    assert sections[0].chunk_ids == (1, 2)
    assert sections[0].source_reference == "Pages 1-2"
    assert [section.index for section in sections] == [0, 1, 2]


def test_plan_sections_groups_a_files_own_chunks_but_never_crosses_into_the_next_file() -> None:
    # a.py is split into three small chunks that together stay under the word budget, and
    # b.py is one big chunk. Even though a.py's running total never hits the target, moving
    # to b.py must still start a new section: a section's reference must never claim to
    # cover two different source files.
    document = _code_document({"a.py": [30, 30, 30], "b.py": [300]})

    sections = plan_sections(document, target_words=220, max_sections=12)

    assert len(sections) == 2
    assert sections[0].source_reference == "a.py:1-90"
    assert sections[0].chunk_ids == (1, 2, 3)
    assert sections[1].source_reference == "b.py:1-300"
    assert sections[1].chunk_ids == (4,)


def test_plan_sections_caps_the_section_count_by_merging_smallest_neighbors() -> None:
    document = _lecture_document(num_pages=20, words_per_page=10)

    sections = plan_sections(document, target_words=5, max_sections=4)

    assert len(sections) == 4
    # Every chunk must still be accounted for exactly once, across the merged sections.
    covered = [chunk_id for section in sections for chunk_id in section.chunk_ids]
    assert sorted(covered) == [chunk.id for chunk in document.chunks]


def test_plan_sections_rejects_an_empty_document() -> None:
    document = _lecture_document(num_pages=0)

    with pytest.raises(AppError):
        plan_sections(document)


def test_section_title_is_the_dominant_chunks_heading() -> None:
    document = _lecture_document(num_pages=2, words_per_page=5)
    document.chunks[1].text = " ".join(f"big{i}" for i in range(500))  # by far the largest

    sections = plan_sections(document, target_words=10_000, max_sections=1)

    assert sections[0].title == "Page 2"


# --- caption splitting -------------------------------------------------------------------


def test_split_into_captions_splits_on_sentence_boundaries() -> None:
    text = "Let's start simple. Now let's look at loops. They repeat a step."

    captions = split_into_captions(text)

    assert captions == [
        "Let's start simple.",
        "Now let's look at loops.",
        "They repeat a step.",
    ]


def test_split_into_captions_falls_back_to_the_whole_text_when_it_cannot_split() -> None:
    assert split_into_captions("one long sentence with no terminal punctuation") == [
        "one long sentence with no terminal punctuation"
    ]
    assert split_into_captions("   ") == []


# --- overview / section script generation -------------------------------------------------


@pytest.fixture
def rag_store(tmp_path: Path) -> ChromaVectorStore:
    return ChromaVectorStore(tmp_path / "chroma")


def _seed_document(session: Session, store: ChromaVectorStore, document_id: str) -> Document:
    document = Document(
        id=document_id,
        filename="lecture.pdf",
        content_hash=f"{document_id}-hash",
        content_type=ContentType.LECTURE,
        source_format=SourceFormat.PDF,
        detected_language=Language.EN,
        size_bytes=64,
        page_count=2,
    )
    session.add(document)
    session.add_all(
        [
            Chunk(
                document_id=document_id,
                ordinal=1,
                text="Sorting puts values in order for faster lookup.",
                heading="Page 1",
                page_start=1,
                page_end=1,
            ),
            Chunk(
                document_id=document_id,
                ordinal=2,
                text="Binary search requires sorted data and works in logarithmic time.",
                heading="Page 2",
                page_start=2,
                page_end=2,
            ),
        ]
    )
    session.commit()
    session.refresh(document)
    index_document(document, store=store, embedding_provider=HashingEmbeddingProvider())
    return document


def _script_draft(text: str) -> str:
    return json.dumps({"text": text})


def _mc_question(
    question: str = "Which operation arranges values in order?",
    correct: str = "Sort",
    topic: str = "Sorting",
    source_reference: str = "Page 1",
) -> dict:
    return {
        "kind": "multiple_choice",
        "topic": topic,
        "difficulty": "easy",
        "question": question,
        "options": ["Search", correct, "Copy", "Delete"],
        "correct_answer": correct,
        "explanation": "Sorting organizes values in order.",
        "source_reference": source_reference,
    }


def _quiz_draft(*questions: dict) -> str:
    return json.dumps({"questions": list(questions), "weak_topics": []})


@pytest.mark.anyio
async def test_generate_overview_produces_a_script_with_captions_and_is_cached(
    session_factory: SessionFactory, rag_store: ChromaVectorStore
) -> None:
    with session_factory() as session:
        document = _seed_document(session, rag_store, "doc-overview")
        provider = MockProvider(
            [_script_draft("Welcome to this lecture. Today we cover sorting and searching.")]
        )

        first = await generate_overview(
            document=document, provider=provider, level="beginner", language="en", session=session
        )
        second = await generate_overview(
            document=document, provider=provider, level="beginner", language="en", session=session
        )

        assert first.section_index == -1
        assert first.text.startswith("Welcome to this lecture.")
        assert first.captions == [
            "Welcome to this lecture.",
            "Today we cover sorting and searching.",
        ]
        assert first.metadata["cached"] is False
        assert second.metadata["cached"] is True
        assert len(provider.calls) == 1  # the second call was served from the stored row


@pytest.mark.anyio
async def test_generate_section_script_includes_a_mini_quiz_and_is_cached(
    session_factory: SessionFactory, rag_store: ChromaVectorStore
) -> None:
    with session_factory() as session:
        document = _seed_document(session, rag_store, "doc-section")
        sections = plan_sections(document, target_words=5, max_sections=12)
        cache = ContentCache(session_factory)
        provider = MockProvider(
            [
                _script_draft("Now let's look at sorting. It puts values in order."),
                _quiz_draft(
                    _mc_question(),
                    _mc_question(
                        question="Which technique needs sorted data to work efficiently?",
                        correct="Binary search",
                        topic="Searching",
                        source_reference="Page 2",
                    ),
                ),
            ]
        )

        result = await generate_section_script(
            document=document,
            provider=provider,
            cache=cache,
            store=rag_store,
            embedding_provider=HashingEmbeddingProvider(),
            section=sections[0],
            level="beginner",
            language="en",
            mini_quiz_questions=2,
            session=session,
        )

        assert result.section_index == 0
        assert result.text
        assert result.quiz is not None
        assert len(result.quiz.questions) == 2
        assert result.metadata["cached"] is False

        # A second request for the same section/level/language/simplified is a pure replay.
        replay = await generate_section_script(
            document=document,
            provider=provider,
            cache=cache,
            store=rag_store,
            embedding_provider=HashingEmbeddingProvider(),
            section=sections[0],
            level="beginner",
            language="en",
            mini_quiz_questions=2,
            session=session,
        )
        assert replay.metadata["cached"] is True
        assert replay.quiz is not None
        assert len(provider.calls) == 2  # script + quiz, once each; the replay made no calls


# --- endpoints --------------------------------------------------------------------------


def make_client(*responses: str, **settings_overrides: object) -> TestClient:
    settings = Settings(
        _env_file=None, database_url="sqlite://", llm_provider="mock", **settings_overrides
    )
    app = create_app(settings)
    app.state.llm_provider = MockProvider(list(responses))
    return TestClient(app)


def test_explainer_plan_endpoint_returns_sections_and_overview(tmp_path: Path) -> None:
    client = make_client(_script_draft("Welcome. This document covers two short ideas."))
    client.app.state.embedding_provider = HashingEmbeddingProvider()
    client.app.state.vector_store = ChromaVectorStore(tmp_path / "chroma")
    with client.app.state.session_factory() as session:
        _seed_document(session, client.app.state.vector_store, "doc-plan")

    response = client.post(
        "/api/documents/doc-plan/explainer/plan", json={"level": "beginner", "language": "en"}
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["document_id"] == "doc-plan"
    assert len(payload["sections"]) >= 1
    assert payload["overview"]["section_index"] == -1
    assert payload["overview"]["text"].startswith("Welcome.")


def test_explainer_section_endpoint_returns_script_and_quiz(tmp_path: Path) -> None:
    client = make_client(
        _script_draft("Now let's look at sorting. It puts values in order."),
        _quiz_draft(
            _mc_question(),
            _mc_question(
                question="Which technique needs sorted data to work efficiently?",
                correct="Binary search",
                topic="Searching",
                source_reference="Page 2",
            ),
        ),
        explainer_mini_quiz_questions=2,
    )
    client.app.state.embedding_provider = HashingEmbeddingProvider()
    client.app.state.vector_store = ChromaVectorStore(tmp_path / "chroma")
    with client.app.state.session_factory() as session:
        _seed_document(session, client.app.state.vector_store, "doc-section-api")

    response = client.get(
        "/api/documents/doc-section-api/explainer/sections/0",
        params={"level": "beginner", "language": "en"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["section_index"] == 0
    assert payload["quiz"]["questions"]
    assert payload["captions"]


def test_explainer_section_endpoint_404s_for_an_out_of_range_index(tmp_path: Path) -> None:
    client = make_client()
    client.app.state.embedding_provider = HashingEmbeddingProvider()
    client.app.state.vector_store = ChromaVectorStore(tmp_path / "chroma")
    with client.app.state.session_factory() as session:
        _seed_document(session, client.app.state.vector_store, "doc-oob")

    response = client.get("/api/documents/doc-oob/explainer/sections/999")

    assert response.status_code == 404


def test_explainer_plan_endpoint_404s_for_an_unknown_document() -> None:
    client = make_client()

    response = client.post(
        "/api/documents/does-not-exist/explainer/plan", json={"level": "beginner", "language": "en"}
    )

    assert response.status_code == 404


def test_saving_the_same_script_twice_reuses_the_existing_row(tmp_path: Path) -> None:
    """A double-fired request must not fail with a unique-constraint 500."""
    from app.db.models import ExplainerScript
    from app.db.session import create_engine, create_session_factory, init_db
    from app.services.explainer_mode import _save_script

    engine = create_engine("sqlite://")
    init_db(engine)
    factory = create_session_factory(engine)

    def make() -> ExplainerScript:
        return ExplainerScript(
            document_id="doc",
            section_index=-1,
            title="Overview",
            language="en",
            level="intermediate",
            simplified=False,
            script="text",
            captions=["text"],
            model="m",
            prompt_version="9",
        )

    with factory() as session:
        session.add(
            Document(
                id="doc",
                filename="a.pdf",
                content_hash="h",
                content_type="lecture",
                source_format=SourceFormat.PDF,
                size_bytes=1,
            )
        )
        session.commit()
        first = _save_script(session, make())
        second = _save_script(session, make())

    assert first.id == second.id
