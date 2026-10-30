"""Phase 12: code chunks sent to the model carry real absolute line numbers, so Explanation's
line-by-line breakdown and the tutor's answers can cite an exact line instead of guessing one."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.db.models import Chunk, Document, SourceFormat
from app.db.session import SessionFactory
from app.domain import ContentType, Language, Level
from app.llm.mock import MockProvider
from app.rag.citations import numbered_code_lines
from app.rag.embeddings import HashingEmbeddingProvider
from app.rag.indexer import index_document
from app.rag.store import ChromaVectorStore
from app.services.cache import ContentCache
from app.services.summary import generate_explanation, generate_summary
from app.services.tutor import generate_tutor_answer

# --- numbered_code_lines -------------------------------------------------------------------


def test_numbered_code_lines_prefixes_each_line_with_its_absolute_number() -> None:
    text = "def foo():\n    return 1"

    assert numbered_code_lines(text, 5) == "5: def foo():\n6:     return 1"


def test_numbered_code_lines_right_aligns_wider_numbers() -> None:
    text = "a\nb\nc"

    result = numbered_code_lines(text, 8)

    assert result.splitlines() == [" 8: a", " 9: b", "10: c"]


def test_numbered_code_lines_returns_text_unchanged_when_line_start_is_unknown() -> None:
    assert numbered_code_lines("def foo():\n    return 1", None) == "def foo():\n    return 1"


def test_numbered_code_lines_handles_empty_text() -> None:
    assert numbered_code_lines("", 1) == ""


# --- summary/explanation: code chunks reach the model with numbered lines ------------------


def _code_document(document_id: str = "code-doc") -> Document:
    return Document(
        id=document_id,
        filename="validators.py",
        content_hash=f"{document_id}-hash",
        content_type=ContentType.CODE,
        source_format=SourceFormat.CODE,
        detected_language=Language.EN,
        size_bytes=64,
        page_count=None,
        chunks=[
            Chunk(
                document_id=document_id,
                ordinal=1,
                text="def validate_password(password):\n    return len(password) >= 8",
                heading="validate_password",
                source_name="validators.py",
                line_start=5,
                line_end=6,
            )
        ],
    )


@pytest.mark.anyio
async def test_generate_explanation_sends_numbered_code_lines_to_the_model(
    session_factory: SessionFactory,
) -> None:
    document = _code_document()
    draft = {"sections": [], "confidence_notes": []}
    provider = MockProvider([json.dumps(draft), json.dumps(draft)])
    cache = ContentCache(session_factory)

    await generate_explanation(
        document=document,
        provider=provider,
        cache=cache,
        level=Level.INTERMEDIATE,
        language=Language.EN,
    )

    map_stage_prompt = provider.calls[0].prompt
    assert "5: def validate_password(password):" in map_stage_prompt
    assert "6:     return len(password) >= 8" in map_stage_prompt


@pytest.mark.anyio
async def test_generate_summary_sends_numbered_code_lines_to_the_model(
    session_factory: SessionFactory,
) -> None:
    document = _code_document("code-doc-2")
    section_summary = {"summary": "Checks password length.", "references": ["validate_password"]}
    summary_draft = {
        "overview": "Checks password length.",
        "key_concepts": [],
        "takeaways": [],
        "confidence_notes": [],
    }
    provider = MockProvider([json.dumps(section_summary), json.dumps(summary_draft)])
    cache = ContentCache(session_factory)

    await generate_summary(
        document=document,
        provider=provider,
        cache=cache,
        level=Level.INTERMEDIATE,
        language=Language.EN,
    )

    map_stage_prompt = provider.calls[0].prompt
    assert "5: def validate_password(password):" in map_stage_prompt
    assert "6:     return len(password) >= 8" in map_stage_prompt


# --- tutor: retrieved code context reaches the model with numbered lines -------------------


@pytest.mark.anyio
async def test_tutor_context_includes_numbered_code_lines(
    session_factory: SessionFactory, tmp_path: Path
) -> None:
    store = ChromaVectorStore(tmp_path / "chroma")
    embedding_provider = HashingEmbeddingProvider()

    with session_factory() as session:
        document = _code_document("code-doc-tutor")
        session.add(document)
        session.commit()
        session.refresh(document)
        index_document(document, store=store, embedding_provider=embedding_provider)

        answer_draft = {
            "answer": "It checks the length [validate_password].",
            "follow_up_questions": [],
        }
        provider = MockProvider([json.dumps(answer_draft)])

        await generate_tutor_answer(
            document=document,
            provider=provider,
            store=store,
            embedding_provider=embedding_provider,
            message="What does line 6 do?",
            level="intermediate",
            language="en",
            session=session,
        )

        prompt = provider.calls[0].prompt
        assert "5: def validate_password(password):" in prompt
        assert "6:     return len(password) >= 8" in prompt
