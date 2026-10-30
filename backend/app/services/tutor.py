"""Grounded tutor answers: RAG retrieval, conversation memory, and follow-up questions."""

from __future__ import annotations

import re
from collections.abc import AsyncIterator

from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.models import Document, MessageRole, TutorMessage, new_id
from app.domain import ContentType, Language, Level, Task
from app.errors import AppError
from app.llm.base import LLMProvider
from app.prompts import PromptBuilder, resolve_question_language
from app.prompts.version import PROMPT_VERSION
from app.rag.citations import numbered_code_lines
from app.rag.embeddings import EmbeddingProvider
from app.rag.retriever import DocumentRetriever
from app.rag.store import ChromaVectorStore
from app.services.adaptive import (
    DEFAULT_DEVELOPING_THRESHOLD,
    DEFAULT_WEAK_THRESHOLD,
    render_learner_profile,
)
from app.services.explanation import fix_token_format
from app.sse import SSE_HEADERS, format_sse

DEFAULT_HISTORY_MESSAGES = 6
RETRIEVAL_TOP_K = 4
STREAM_CHUNK_CHARS = 24


class TutorRequest(BaseModel):
    """One turn sent to the tutor."""

    message: str
    level: str = "intermediate"
    language: str = "en"
    conversation_id: str | None = None
    stream: bool = False


class TutorCitation(BaseModel):
    """One source reference for an answer."""

    reference: str
    snippet: str | None = None


class TutorHistoryEntry(BaseModel):
    """A saved tutor turn, including citations and follow-ups when available."""

    id: int | None = None
    role: str
    content: str
    language: str
    citations: list[TutorCitation] = Field(default_factory=list)
    follow_up_questions: list[str] = Field(default_factory=list)


class TutorResponse(BaseModel):
    """Reply from the tutor: a grounded answer plus citations and follow-up questions."""

    answer: str
    citations: list[TutorCitation] = Field(default_factory=list)
    follow_up_questions: list[str] = Field(default_factory=list)
    conversation_id: str
    metadata: dict[str, object] = Field(default_factory=dict)

    async def stream_response(self) -> StreamingResponse:
        """Stream the answer as prose tokens, then one ``result`` event with the rest.

        Citations and follow-up questions are only meaningful once the whole answer is known,
        so they travel in a final ``result`` event (parsed by the frontend) rather than being
        guessed from partial text.
        """

        async def iterator() -> AsyncIterator[str]:
            for start in range(0, len(self.answer), STREAM_CHUNK_CHARS):
                yield format_sse("token", {"text": self.answer[start : start + STREAM_CHUNK_CHARS]})
            yield format_sse("result", self.model_dump())
            yield format_sse("done", {})

        return StreamingResponse(iterator(), media_type="text/event-stream", headers=SSE_HEADERS)


class _TutorAnswerDraft(BaseModel):
    """Structured answer requested from the model."""

    answer: str = ""
    follow_up_questions: list[str] = Field(default_factory=list)


def _coerce_level(value: str) -> Level:
    try:
        return Level(value)
    except ValueError as exc:  # pragma: no cover - validation on endpoint input
        raise AppError(422, "validation_error", details={"field": "level", "value": value}) from exc


def _coerce_language(value: str) -> Language:
    try:
        return Language(value)
    except ValueError as exc:  # pragma: no cover - validation on endpoint input
        raise AppError(
            422, "validation_error", details={"field": "language", "value": value}
        ) from exc


def _render_context(
    retriever: DocumentRetriever, document_id: str, question: str, content_type: ContentType
) -> str:
    hits = retriever.search(document_id, question, top_k=RETRIEVAL_TOP_K)
    if not hits:
        raise AppError(400, "EMPTY_DOCUMENT")
    sections: list[str] = []
    references: list[str] = []
    for hit in hits:
        heading = str(hit.metadata.get("heading") or "Document section")
        if heading not in references:
            references.append(heading)
        # Real absolute line numbers (from the index metadata) let the tutor point at an exact
        # line when asked -- e.g. "line 5" -- instead of guessing one (see Phase 12).
        body = hit.text.strip()
        if content_type == ContentType.CODE:
            body = numbered_code_lines(body, hit.metadata.get("line_start"))
        sections.append(f"[{heading}]\n{body}")
    # An explicit allow-list, so "only cite a location actually retrieved" (see the tutor task
    # templates) is something the model can check mechanically rather than infer from the shape
    # of the chunks below.
    allowed = ", ".join(f"[{reference}]" for reference in references)
    return (
        f"Locations retrieved for this question (the only ones you may cite): {allowed}\n\n"
        + "\n\n".join(sections)
    )


def _resolve_conversation_id(document: Document, conversation_id: str | None) -> str:
    """The conversation to continue: the one given, the document's latest, or a new one."""
    if conversation_id:
        return conversation_id
    if document.tutor_messages:
        return document.tutor_messages[-1].conversation_id
    return new_id()


def _conversation_history(
    document: Document, conversation_id: str, *, limit: int
) -> list[TutorMessage]:
    """The last ``limit`` messages of ``conversation_id``, oldest first."""
    turns = [
        message for message in document.tutor_messages if message.conversation_id == conversation_id
    ]
    return turns[-limit:] if limit > 0 else []


def _render_history(history: list[TutorMessage]) -> str:
    if not history:
        return ""
    lines = ["Conversation so far, oldest first:"]
    for message in history:
        # "Assistant", not "Tutor": this label is read by the model itself as part of its own
        # prompt (see below), so it must never hand the model a name to call itself by.
        speaker = "Learner" if message.role == MessageRole.USER else "Assistant"
        lines.append(f"{speaker}: {message.content}")
    return "\n".join(lines) + "\n\n"


async def generate_tutor_answer(
    *,
    document: Document,
    provider: LLMProvider,
    store: ChromaVectorStore,
    embedding_provider: EmbeddingProvider,
    message: str,
    level: Level | str,
    language: Language | str,
    conversation_id: str | None = None,
    history_limit: int = DEFAULT_HISTORY_MESSAGES,
    weak_threshold: float = DEFAULT_WEAK_THRESHOLD,
    developing_threshold: float = DEFAULT_DEVELOPING_THRESHOLD,
    session: Session,
) -> TutorResponse:
    """Generate a grounded, structured answer and persist the user/assistant turns.

    Retrieval uses whatever was indexed for ``document`` (see ``app.rag.indexer``); if nothing
    was indexed yet, or nothing relevant is found, this raises ``EMPTY_DOCUMENT``. The system
    prompt is extended with a learner profile (weak/strong topics from quiz results) so the
    tutor adapts too, once there is enough quiz history to say anything useful.

    ``language`` is the interface language, used only as the fallback when the learner's message
    is too short or ambiguous to detect confidently: the answer itself always follows the
    language *this* question was asked in (see :func:`resolve_question_language`), which is why
    it is re-bound below before anything else reads it — every subsequent use of ``language`` in
    this function (the prompt, the stored message rows, the response metadata) is the resolved
    answer language, not necessarily the interface one.
    """
    level = _coerce_level(level.value if isinstance(level, Level) else level)
    language = _coerce_language(language.value if isinstance(language, Language) else language)
    prompt_message = (message or "").strip()
    if not prompt_message:
        raise AppError(400, "EMPTY_DOCUMENT")
    language = resolve_question_language(prompt_message, interface_language=language)

    retriever = DocumentRetriever(store, embedding_provider)
    context = _render_context(retriever, document.id, prompt_message, document.content_type)

    resolved_conversation_id = _resolve_conversation_id(document, conversation_id)
    history_block = _render_history(
        _conversation_history(document, resolved_conversation_id, limit=history_limit)
    )

    builder = PromptBuilder()
    prompt = builder.build(
        task=Task.TUTOR,
        content_type=document.content_type,
        level=level,
        language=language,
        document_text=context,
    )
    profile_block = render_learner_profile(
        level=level,
        topic_entries=document.topic_mastery,
        weak_threshold=weak_threshold,
        developing_threshold=developing_threshold,
    )
    system = f"{prompt.system}\n\n{profile_block}" if profile_block else prompt.system

    draft = await provider.generate_json(
        f"{prompt.user}\n\n{history_block}Question: {prompt_message}",
        _TutorAnswerDraft,
        system=system,
    )
    answer = draft.answer.strip()
    if document.content_type == ContentType.CODE:
        answer = fix_token_format(answer)
    follow_ups = [q.strip() for q in draft.follow_up_questions if q.strip()][:4]
    citations = [
        TutorCitation(reference=reference, snippet=reference)
        for reference in _extract_references(answer)
    ]

    user_message = TutorMessage(
        document_id=document.id,
        conversation_id=resolved_conversation_id,
        role=MessageRole.USER,
        content=prompt_message,
        language=language,
        citations=None,
    )
    assistant_message = TutorMessage(
        document_id=document.id,
        conversation_id=resolved_conversation_id,
        role=MessageRole.ASSISTANT,
        content=answer,
        language=language,
        citations=[citation.model_dump() for citation in citations],
        follow_up_questions=follow_ups or None,
    )
    session.add_all([user_message, assistant_message])
    session.commit()

    return TutorResponse(
        answer=answer,
        citations=citations,
        follow_up_questions=follow_ups,
        conversation_id=resolved_conversation_id,
        metadata={
            "document_id": document.id,
            "task": Task.TUTOR.value,
            "level": level.value,
            "language": language.value,
            "prompt_version": PROMPT_VERSION,
            "model": provider.model,
        },
    )


def list_tutor_history(document: Document) -> list[TutorHistoryEntry]:
    """Serialize the latest conversation's messages, in chronological order."""
    if not document.tutor_messages:
        return []
    latest_conversation_id = document.tutor_messages[-1].conversation_id
    return [
        TutorHistoryEntry(
            id=message.id,
            role=message.role.value,
            content=message.content,
            language=message.language.value,
            citations=[
                TutorCitation(
                    **(citation if isinstance(citation, dict) else {"reference": str(citation)})
                )
                for citation in (message.citations or [])
            ],
            follow_up_questions=list(message.follow_up_questions or []),
        )
        for message in document.tutor_messages
        if message.conversation_id == latest_conversation_id
    ]


def clear_tutor_history(document: Document, session: Session) -> None:
    """Remove every tutor message for a document; the next question starts a new conversation."""
    if not document.tutor_messages:
        return
    for message in list(document.tutor_messages):
        session.delete(message)
    session.commit()


def _extract_references(text: str) -> list[str]:
    references: list[str] = []
    for match in re.finditer(r"\[(.+?)\]", text):
        candidate = match.group(1).strip()
        if candidate and candidate not in references:
            references.append(candidate)
    return references[:4]
