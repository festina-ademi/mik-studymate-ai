"""Tests for the RAG retriever (cross-lingual, MMR) and the grounded tutor service.

Retrieval tests use :class:`HashingEmbeddingProvider` or a small hand-built bilingual fake
embedding provider instead of the real sentence-transformers model, the same way
:class:`app.llm.mock.MockProvider` stands in for a real chat model elsewhere in this suite:
they exercise the actual retrieval plumbing (Chroma storage, top-k, MMR re-ranking,
cross-lingual pass-through) without depending on a downloaded model or network access. The
real model's multilingual quality is a property of that pretrained model, not of this code.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.models import Chunk, Document, MessageRole, SourceFormat, TutorMessage
from app.db.session import SessionFactory
from app.domain import ContentType, Language
from app.llm.mock import MockProvider
from app.rag.embeddings import EmbeddingProvider, HashingEmbeddingProvider
from app.rag.indexer import index_document
from app.rag.retriever import DocumentRetriever, mmr_select
from app.rag.store import Candidate, ChromaVectorStore, IndexedChunk
from app.services.tutor import TutorCitation, generate_tutor_answer, list_tutor_history

# --- a small fake multilingual embedding provider for cross-lingual tests ------------------

_WORD_RE = re.compile(r"[a-zA-ZëÇç]+")

_BILINGUAL_AXES = {
    "sort": 0,
    "sorting": 0,
    "renditja": 0,
    "search": 1,
    "kërkimi": 1,
    "garden": 2,
    "plants": 2,
}


class _BilingualFakeEmbeddingProvider(EmbeddingProvider):
    """Maps a handful of English/Albanian synonym pairs onto the same 3 axes.

    Sorting-related words (English "sort"/"sorting", Albanian "renditja") land on axis 0,
    search-related words (English "search", Albanian "kërkimi") on axis 1, and an unrelated
    topic (gardening) on axis 2 — so a query in one language can only end up close to a chunk
    in the other language by genuine (faked) cross-lingual alignment, not shared vocabulary.
    """

    def embed(self, text: str) -> list[float]:
        vector = [0.0, 0.0, 0.0]
        for word in _WORD_RE.findall(text.lower()):
            axis = _BILINGUAL_AXES.get(word)
            if axis is not None:
                vector[axis] += 1.0
        norm = math.sqrt(sum(value * value for value in vector))
        return [value / norm for value in vector] if norm else vector


def test_retrieval_is_cross_lingual(tmp_path: Path) -> None:
    store = ChromaVectorStore(tmp_path / "chroma")
    provider = _BilingualFakeEmbeddingProvider()
    chunks = [
        IndexedChunk(
            id="c1",
            # Mentions "search" too, so this chunk's embedding is *not* purely on the sorting
            # axis: it must end up less similar to a pure-sorting query than the pure-axis "c4".
            text="Sorting puts values in order before a search for faster lookup.",
            metadata={"heading": "Page 1"},
        ),
        IndexedChunk(
            id="c2", text="Binary search requires sorted data.", metadata={"heading": "Page 2"}
        ),
        IndexedChunk(
            id="c3",
            text="Plants need water and sunlight to grow in a garden.",
            metadata={"heading": "Page 3"},
        ),
        IndexedChunk(
            id="c4",
            text="Renditja i vë vlerat në rend për kërkim më të shpejtë.",
            metadata={"heading": "Faqja 4"},
        ),
    ]
    store.index_document("doc-1", chunks, provider.embed_many([chunk.text for chunk in chunks]))
    retriever = DocumentRetriever(store, provider, top_k=1, fetch_k=4)

    albanian_hits = retriever.search("doc-1", "Si funksionon kërkimi binar?")
    assert albanian_hits[0].id == "c2"  # an Albanian question retrieves the English "search" chunk

    english_hits = retriever.search("doc-1", "How do I sort these values?")
    assert english_hits[0].id == "c4"  # an English question retrieves the Albanian "sorting" chunk


def test_mmr_prefers_diverse_results_over_a_near_duplicate() -> None:
    query = [1.0, 0.0]
    candidates = [
        Candidate(id="a", text="a", metadata={}, embedding=[1.0, 0.0], distance=0.0),
        # "b" is a near-duplicate of "a"; "c" is a different, less relevant topic.
        Candidate(id="b", text="b", metadata={}, embedding=[0.99, 0.01], distance=0.01),
        Candidate(id="c", text="c", metadata={}, embedding=[0.0, 1.0], distance=0.5),
    ]

    diverse = mmr_select(query, candidates, top_k=2, lambda_mult=0.3)
    assert [c.id for c in diverse] == ["a", "c"]

    relevance_only = mmr_select(query, candidates, top_k=2, lambda_mult=1.0)
    assert [c.id for c in relevance_only] == ["a", "b"]


def test_index_document_reindex_replaces_stale_chunks(tmp_path: Path) -> None:
    store = ChromaVectorStore(tmp_path / "chroma")
    provider = HashingEmbeddingProvider(dimension=16)

    first = [IndexedChunk(id="c1", text="alpha beta", metadata={"heading": "Section 1"})]
    store.index_document("doc-x", first, provider.embed_many([c.text for c in first]))
    assert {hit.id for hit in store.query("doc-x", provider.embed("alpha"), fetch_k=5)} == {"c1"}

    second = [IndexedChunk(id="c2", text="gamma delta", metadata={"heading": "Section 2"})]
    store.index_document("doc-x", second, provider.embed_many([c.text for c in second]))
    assert {hit.id for hit in store.query("doc-x", provider.embed("alpha"), fetch_k=5)} == {"c2"}


def test_vector_store_persists_across_client_instances(tmp_path: Path) -> None:
    directory = tmp_path / "chroma"
    provider = HashingEmbeddingProvider(dimension=16)
    chunks = [IndexedChunk(id="c1", text="alpha beta", metadata={"heading": "Page 1"})]
    ChromaVectorStore(directory).index_document(
        "doc-y", chunks, provider.embed_many([c.text for c in chunks])
    )

    reopened = ChromaVectorStore(directory)
    hits = reopened.query("doc-y", provider.embed("alpha"), fetch_k=5)

    assert hits and hits[0].id == "c1"


# --- tutor service -------------------------------------------------------------------------


def _make_indexed_document(
    session: Session,
    store: ChromaVectorStore,
    embedding_provider: EmbeddingProvider,
    *,
    document_id: str,
) -> Document:
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
    index_document(document, store=store, embedding_provider=embedding_provider)
    return document


@pytest.fixture
def rag_store(tmp_path: Path) -> ChromaVectorStore:
    return ChromaVectorStore(tmp_path / "chroma")


@pytest.fixture
def embedding_provider() -> HashingEmbeddingProvider:
    return HashingEmbeddingProvider()


def _tutor_draft(answer: str, follow_ups: list[str] | None = None) -> str:
    return json.dumps({"answer": answer, "follow_up_questions": follow_ups or []})


@pytest.mark.anyio
async def test_tutor_answer_includes_citations_and_follow_up_questions(
    session_factory: SessionFactory,
    rag_store: ChromaVectorStore,
    embedding_provider: HashingEmbeddingProvider,
) -> None:
    with session_factory() as session:
        document = _make_indexed_document(
            session, rag_store, embedding_provider, document_id="doc-a"
        )
        provider = MockProvider(
            [
                _tutor_draft(
                    "Binary search halves the range each time [Page 1].",
                    ["Why does halving matter?", "What if the data is not sorted?"],
                )
            ]
        )

        result = await generate_tutor_answer(
            document=document,
            provider=provider,
            store=rag_store,
            embedding_provider=embedding_provider,
            message="How does binary search narrow down the range?",
            level="intermediate",
            language="en",
            session=session,
        )

        assert result.citations == [TutorCitation(reference="Page 1", snippet="Page 1")]
        assert result.follow_up_questions == [
            "Why does halving matter?",
            "What if the data is not sorted?",
        ]
        assert result.conversation_id


@pytest.mark.anyio
async def test_tutor_extracts_localized_albanian_citations(
    session_factory: SessionFactory,
    rag_store: ChromaVectorStore,
    embedding_provider: HashingEmbeddingProvider,
) -> None:
    """The Albanian page/slide citation labels (``Faqja``/``Slajdi``) are extracted the same
    way as their English counterparts; which label the model uses is governed by the
    language system prompt (see ``tests/test_prompts.py``), not by this extraction logic."""
    with session_factory() as session:
        document = _make_indexed_document(
            session, rag_store, embedding_provider, document_id="doc-sq"
        )
        provider = MockProvider([_tutor_draft("Kërkimi binar përgjysmon intervalin [Faqja 1].")])

        result = await generate_tutor_answer(
            document=document,
            provider=provider,
            store=rag_store,
            embedding_provider=embedding_provider,
            message="Si funksionon kërkimi binar?",
            level="intermediate",
            language="sq",
            session=session,
        )

        assert result.citations == [TutorCitation(reference="Faqja 1", snippet="Faqja 1")]


@pytest.mark.anyio
async def test_tutor_answers_in_the_question_language_not_the_interface_language(
    session_factory: SessionFactory,
    rag_store: ChromaVectorStore,
    embedding_provider: HashingEmbeddingProvider,
) -> None:
    """Regression test: a learner whose interface is set to English but who asks a question in
    Albanian must get an Albanian system prompt (and the reverse), not a mismatched one that
    makes the model insist on the interface language regardless of what was actually asked."""
    with session_factory() as session:
        document = _make_indexed_document(
            session, rag_store, embedding_provider, document_id="doc-lang-en-iface"
        )
        provider = MockProvider([_tutor_draft("Kërkimi binar përgjysmon intervalin [Faqja 1].")])

        result = await generate_tutor_answer(
            document=document,
            provider=provider,
            store=rag_store,
            embedding_provider=embedding_provider,
            message="A mundesh te ma shpjegosh shqip si funksionon kërkimi binar?",
            level="intermediate",
            language="en",  # the interface is English; the question itself is Albanian
            session=session,
        )

        sent_system = provider.calls[0].system
        assert sent_system is not None
        assert "## Output language: Albanian (shqip)" in sent_system
        assert "## Output language: English" not in sent_system
        assert result.metadata["language"] == "sq"

    with session_factory() as session:
        document = _make_indexed_document(
            session, rag_store, embedding_provider, document_id="doc-lang-sq-iface"
        )
        provider = MockProvider([_tutor_draft("Binary search halves the range [Page 1].")])

        result = await generate_tutor_answer(
            document=document,
            provider=provider,
            store=rag_store,
            embedding_provider=embedding_provider,
            message="Can you explain how binary search works?",
            level="intermediate",
            language="sq",  # the interface is Albanian; the question itself is English
            session=session,
        )

        sent_system = provider.calls[0].system
        assert sent_system is not None
        assert "## Output language: English" in sent_system
        assert "## Output language: Albanian (shqip)" not in sent_system
        assert result.metadata["language"] == "en"


@pytest.mark.anyio
async def test_tutor_alternates_language_per_turn_within_one_conversation(
    session_factory: SessionFactory,
    rag_store: ChromaVectorStore,
    embedding_provider: HashingEmbeddingProvider,
) -> None:
    """Regression test for Phase 9.3: each turn of the *same* conversation must get the system
    prompt for *that turn's own* question language, even though the conversation history (fed
    back into the user prompt) already contains turns in the other language -- the history must
    never cause the language choice itself to "stick"."""
    with session_factory() as session:
        document = _make_indexed_document(
            session, rag_store, embedding_provider, document_id="doc-alternating"
        )
        provider = MockProvider([_tutor_draft("Binary search halves the range [Page 1].")])
        first = await generate_tutor_answer(
            document=document,
            provider=provider,
            store=rag_store,
            embedding_provider=embedding_provider,
            message="Can you explain how binary search works?",
            level="intermediate",
            language="en",
            session=session,
        )
        assert "## Output language: English" in (provider.calls[0].system or "")
        assert first.metadata["language"] == "en"

        session.refresh(document)
        provider.enqueue(_tutor_draft("Kërkimi binar përgjysmon intervalin [Faqja 1]."))
        second = await generate_tutor_answer(
            document=document,
            provider=provider,
            store=rag_store,
            embedding_provider=embedding_provider,
            message="Po a mundesh ta shpjegosh shqip?",
            level="intermediate",
            language="en",  # interface language is still English; this question is Albanian
            conversation_id=first.conversation_id,
            session=session,
        )
        assert "## Output language: Albanian (shqip)" in (provider.calls[1].system or "")
        assert "## Output language: English" not in (provider.calls[1].system or "")
        assert second.metadata["language"] == "sq"

        session.refresh(document)
        provider.enqueue(_tutor_draft("Thanks, that's clear now [Page 1]."))
        third = await generate_tutor_answer(
            document=document,
            provider=provider,
            store=rag_store,
            embedding_provider=embedding_provider,
            message="Got it, thanks!",
            level="intermediate",
            language="en",
            conversation_id=first.conversation_id,
            session=session,
        )
        assert "## Output language: English" in (provider.calls[2].system or "")
        assert "## Output language: Albanian (shqip)" not in (provider.calls[2].system or "")
        assert third.metadata["language"] == "en"


@pytest.mark.anyio
async def test_tutor_context_carries_an_explicit_citation_allow_list(
    session_factory: SessionFactory,
    rag_store: ChromaVectorStore,
    embedding_provider: HashingEmbeddingProvider,
) -> None:
    """Phase 9.2: the retrieved context names exactly which locations may be cited, so the
    "don't cite a page you weren't shown" rule in the tutor task templates is mechanically
    checkable rather than merely implied by the shape of the chunks."""
    with session_factory() as session:
        document = _make_indexed_document(
            session, rag_store, embedding_provider, document_id="doc-allow-list"
        )
        provider = MockProvider([_tutor_draft("Binary search halves the range [Page 1].")])

        await generate_tutor_answer(
            document=document,
            provider=provider,
            store=rag_store,
            embedding_provider=embedding_provider,
            message="How does binary search work?",
            level="intermediate",
            language="en",
            session=session,
        )

        sent_prompt = provider.calls[0].prompt
        assert "Locations retrieved for this question (the only ones you may cite): [Page 1]" in (
            sent_prompt or ""
        )


@pytest.mark.anyio
async def test_tutor_conversation_history_is_available_to_stay_consistent_in_a_later_turn(
    session_factory: SessionFactory,
    rag_store: ChromaVectorStore,
    embedding_provider: HashingEmbeddingProvider,
) -> None:
    """Phase 9.2 regression test. There is no way to unit-test an actual LLM's judgment about
    *not* contradicting itself (`MockProvider` just returns whatever canned answer the test
    gives it, regardless of the question), so this instead verifies the two things the fix
    actually controls: (1) an earlier turn's exact answer is still present, verbatim, in the
    conversation history handed to the model on a later, unrelated turn, so it has the means to
    stay consistent; and (2) the system prompt for that later turn still carries the
    "do not contradict or retract" rule. Together these are the testable guarantee behind the
    real fix (the model's own adherence to that rule is not something a scripted mock can prove
    one way or the other)."""
    with session_factory() as session:
        document = _make_indexed_document(
            session, rag_store, embedding_provider, document_id="doc-consistency"
        )
        provider = MockProvider([_tutor_draft("The project budget is 25,000€ [Page 1].")])
        first = await generate_tutor_answer(
            document=document,
            provider=provider,
            store=rag_store,
            embedding_provider=embedding_provider,
            message="What is the cost of the project?",
            level="intermediate",
            language="en",
            session=session,
        )

        session.refresh(document)
        provider.enqueue(_tutor_draft("Binary search halves the range [Page 1]."))
        await generate_tutor_answer(
            document=document,
            provider=provider,
            store=rag_store,
            embedding_provider=embedding_provider,
            message="Unrelated: how does binary search work?",
            level="intermediate",
            language="en",
            conversation_id=first.conversation_id,
            session=session,
        )

        session.refresh(document)
        provider.enqueue(_tutor_draft("The project budget is 25,000€ [Page 1]."))
        third_system_before = len(provider.calls)
        await generate_tutor_answer(
            document=document,
            provider=provider,
            store=rag_store,
            embedding_provider=embedding_provider,
            message="Going back to it, what was the budget again?",
            level="intermediate",
            language="en",
            conversation_id=first.conversation_id,
            history_limit=10,
            session=session,
        )

        third_call = provider.calls[third_system_before]
        assert "The project budget is 25,000€ [Page 1]." in (third_call.prompt or "")
        assert "do not contradict or retract" in (third_call.system or "")


@pytest.mark.anyio
async def test_tutor_says_when_the_material_does_not_cover_the_question(
    session_factory: SessionFactory,
    rag_store: ChromaVectorStore,
    embedding_provider: HashingEmbeddingProvider,
) -> None:
    with session_factory() as session:
        document = _make_indexed_document(
            session, rag_store, embedding_provider, document_id="doc-b"
        )
        not_covered = (
            "This is not covered in the uploaded material. As general knowledge (not from your "
            "document), quicksort has average time complexity O(n log n)."
        )
        provider = MockProvider([_tutor_draft(not_covered)])

        result = await generate_tutor_answer(
            document=document,
            provider=provider,
            store=rag_store,
            embedding_provider=embedding_provider,
            message="What is the average time complexity of quicksort?",
            level="intermediate",
            language="en",
            session=session,
        )

        assert "not covered in the uploaded material" in result.answer
        assert "general knowledge" in result.answer


@pytest.mark.anyio
async def test_tutor_conversation_memory_is_truncated_to_the_configured_limit(
    session_factory: SessionFactory,
    rag_store: ChromaVectorStore,
    embedding_provider: HashingEmbeddingProvider,
) -> None:
    with session_factory() as session:
        document = _make_indexed_document(
            session, rag_store, embedding_provider, document_id="doc-c"
        )
        conversation_id = "conv-1"
        # Six prior messages (3 exchanges); only the last 3 should be replayed as memory.
        for index in range(3):
            session.add_all(
                [
                    TutorMessage(
                        document_id="doc-c",
                        conversation_id=conversation_id,
                        role=MessageRole.USER,
                        content=f"old question {index}",
                        language=Language.EN,
                    ),
                    TutorMessage(
                        document_id="doc-c",
                        conversation_id=conversation_id,
                        role=MessageRole.ASSISTANT,
                        content=f"old answer {index}",
                        language=Language.EN,
                    ),
                ]
            )
        session.commit()
        session.refresh(document)

        provider = MockProvider([_tutor_draft("A fresh answer [Page 1].")])
        await generate_tutor_answer(
            document=document,
            provider=provider,
            store=rag_store,
            embedding_provider=embedding_provider,
            message="Follow-up question",
            level="intermediate",
            language="en",
            conversation_id=conversation_id,
            history_limit=3,
            session=session,
        )

        sent_prompt = provider.calls[0].prompt
        # limit=3 keeps only the last 3 of the 6 prior messages: "old answer 1",
        # "old question 2", "old answer 2" — a boundary that splits exchange 1 in two,
        # showing the limit counts individual messages, not whole exchanges.
        assert "old answer 2" in sent_prompt
        assert "old question 2" in sent_prompt
        assert "old answer 1" in sent_prompt
        assert "old question 1" not in sent_prompt
        assert "old answer 0" not in sent_prompt
        assert "old question 0" not in sent_prompt


@pytest.mark.anyio
async def test_tutor_continues_the_latest_conversation_when_none_is_given(
    session_factory: SessionFactory,
    rag_store: ChromaVectorStore,
    embedding_provider: HashingEmbeddingProvider,
) -> None:
    with session_factory() as session:
        document = _make_indexed_document(
            session, rag_store, embedding_provider, document_id="doc-d"
        )
        provider = MockProvider([_tutor_draft("First answer [Page 1].")])
        first = await generate_tutor_answer(
            document=document,
            provider=provider,
            store=rag_store,
            embedding_provider=embedding_provider,
            message="First question",
            level="intermediate",
            language="en",
            session=session,
        )

        session.refresh(document)
        provider.enqueue(_tutor_draft("Second answer [Page 1]."))
        second = await generate_tutor_answer(
            document=document,
            provider=provider,
            store=rag_store,
            embedding_provider=embedding_provider,
            message="Second question, no conversation id given",
            level="intermediate",
            language="en",
            session=session,
        )

        assert second.conversation_id == first.conversation_id
        session.refresh(document)
        history = list_tutor_history(document)
        assert [entry.content for entry in history] == [
            "First question",
            "First answer [Page 1].",
            "Second question, no conversation id given",
            "Second answer [Page 1].",
        ]


def test_tutor_history_endpoint_and_clear(client: TestClient, rag_store: ChromaVectorStore) -> None:
    embedding_provider = HashingEmbeddingProvider()
    # Use the client's own session factory (not the `session_factory` fixture, a separate
    # in-memory database): the API only sees documents created through this one.
    with client.app.state.session_factory() as session:
        _make_indexed_document(session, rag_store, embedding_provider, document_id="doc-e")

    client.app.state.embedding_provider = embedding_provider
    client.app.state.vector_store = rag_store
    client.app.state.llm_provider = MockProvider(
        [_tutor_draft("Grounded answer [Page 1].", ["Next question?"])]
    )

    response = client.post(
        "/api/documents/doc-e/tutor",
        json={"message": "How does binary search work?", "level": "beginner", "language": "en"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["answer"] == "Grounded answer [Page 1]."
    assert payload["citations"] == [{"reference": "Page 1", "snippet": "Page 1"}]
    assert payload["follow_up_questions"] == ["Next question?"]
    assert payload["conversation_id"]

    history = client.get("/api/documents/doc-e/tutor/history").json()
    assert [entry["role"] for entry in history] == ["user", "assistant"]
    assert history[1]["follow_up_questions"] == ["Next question?"]

    delete_response = client.delete("/api/documents/doc-e/tutor/history")
    assert delete_response.status_code == 204
    assert client.get("/api/documents/doc-e/tutor/history").json() == []


def test_upload_indexes_the_document_and_reindex_rebuilds_it(
    client: TestClient, rag_store: ChromaVectorStore
) -> None:
    embedding_provider = HashingEmbeddingProvider()
    client.app.state.embedding_provider = embedding_provider
    client.app.state.vector_store = rag_store

    upload = client.post(
        "/api/documents",
        files=[("files", ("notes.py", b"def add(a, b):\n    return a + b\n"))],
    )
    assert upload.status_code == 201
    document_id = upload.json()["document"]["id"]

    # The upload endpoint indexes the document automatically, with no extra call needed.
    hits = rag_store.query(document_id, embedding_provider.embed("add"), fetch_k=5)
    assert hits

    reindex = client.post(f"/api/documents/{document_id}/reindex")
    assert reindex.status_code == 200
    assert reindex.json()["indexed_chunks"] >= 1

    hits_after_reindex = rag_store.query(document_id, embedding_provider.embed("add"), fetch_k=5)
    assert {hit.id for hit in hits_after_reindex} == {hit.id for hit in hits}


def test_missing_local_embedding_package_raises_a_clear_configuration_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Without sentence-transformers the API must say so, not return an opaque 500."""
    import builtins

    from app.errors import AppError
    from app.rag.embeddings import SentenceTransformerEmbeddingProvider

    real_import = builtins.__import__

    def fake_import(name: str, *args: object, **kwargs: object) -> object:
        if name == "sentence_transformers":
            raise ImportError(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)

    with pytest.raises(AppError) as caught:
        SentenceTransformerEmbeddingProvider("any-model").embed("hello")

    assert caught.value.code == "embedding_not_configured"
    assert caught.value.details == {"provider": "local"}
