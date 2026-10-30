"""Structured summary and explanation generation for uploaded documents."""

from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.db.models import Chunk, Document
from app.domain import ContentType, ExplanationDepth, Language, Level, Task
from app.errors import AppError
from app.llm.base import LLMProvider
from app.prompts import PromptBuilder
from app.prompts.version import PROMPT_VERSION
from app.rag.citations import numbered_code_lines
from app.services.cache import CacheKey, ContentCache
from app.services.explanation import fix_token_format
from app.sse import sse_response


class SummaryRequest(BaseModel):
    """Request payload for the summary/explanation endpoints."""

    level: str = "intermediate"
    language: str = "en"
    stream: bool = False


class ExplanationRequest(SummaryRequest):
    """Request payload for the explanation endpoint; ``depth`` only matters for code."""

    depth: ExplanationDepth = ExplanationDepth.LINE_BY_LINE


# A full token-by-token breakdown of every line easily outgrows the default output cap, and a
# cut-off JSON answer loses everything after the cut (Phase 15's truncation bug), so line-by-line
# code explanations are allowed a larger budget. Never lowers a cap configured higher than this.
LINE_BY_LINE_MAX_TOKENS = 16384


class KeyConcept(BaseModel):
    """One concept from a lecture summary."""

    term: str
    definition: str
    references: list[str] = Field(default_factory=list)


class Takeaway(BaseModel):
    """One takeaway from a summary."""

    title: str
    text: str
    references: list[str] = Field(default_factory=list)


class GenerationMetadata(BaseModel):
    """Metadata that makes the result auditable and cacheable."""

    document_id: str
    content_type: str
    task: str
    level: str
    language: str
    depth: str | None = None
    chunks_used: int
    prompt_version: str = PROMPT_VERSION
    model: str
    cached: bool = False


class SummaryResponse(BaseModel):
    """Structured lecture/code summary response."""

    overview: str = ""
    purpose: str | None = None
    inputs_outputs: list[str] = Field(default_factory=list)
    main_components: list[str] = Field(default_factory=list)
    key_concepts: list[KeyConcept] = Field(default_factory=list)
    takeaways: list[Takeaway] = Field(default_factory=list)
    confidence_notes: list[str] = Field(default_factory=list)
    metadata: GenerationMetadata

    async def stream_response(self) -> StreamingResponse:
        """Stream the JSON payload as SSE tokens."""

        async def iterator() -> AsyncIterator[str]:
            payload = self.model_dump_json(ensure_ascii=False)
            for index in range(0, len(payload), 32):
                yield payload[index : index + 32]

        return sse_response(iterator())


class ExplanationSection(BaseModel):
    """One explanation section with references."""

    title: str
    content: str
    references: list[str] = Field(default_factory=list)


class ExplanationResponse(BaseModel):
    """Structured explanation response."""

    sections: list[ExplanationSection] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    architecture: str | None = None
    walkthrough: list[str] = Field(default_factory=list)
    confidence_notes: list[str] = Field(default_factory=list)
    metadata: GenerationMetadata

    async def stream_response(self) -> StreamingResponse:
        """Stream the JSON payload as SSE tokens."""

        async def iterator() -> AsyncIterator[str]:
            payload = self.model_dump_json(ensure_ascii=False)
            for index in range(0, len(payload), 32):
                yield payload[index : index + 32]

        return sse_response(iterator())


class _SectionSummary(BaseModel):
    summary: str
    references: list[str] = Field(default_factory=list)


class _SummaryDraft(BaseModel):
    overview: str
    key_concepts: list[KeyConcept]
    takeaways: list[Takeaway]
    confidence_notes: list[str] = Field(default_factory=list)


class _ExplanationDraft(BaseModel):
    sections: list[ExplanationSection]
    confidence_notes: list[str] = Field(default_factory=list)


def _level_from_value(value: str) -> Level:
    try:
        return Level(value)
    except ValueError as exc:  # pragma: no cover - validation on endpoint input
        raise AppError(
            422,
            "validation_error",
            details={"field": "level", "value": value},
        ) from exc


def _language_from_value(value: str) -> Language:
    try:
        return Language(value)
    except ValueError as exc:  # pragma: no cover - validation on endpoint input
        raise AppError(
            422,
            "validation_error",
            details={"field": "language", "value": value},
        ) from exc


def _build_reference(chunk: Chunk) -> str:
    if chunk.page_start is not None and chunk.page_end is not None:
        if chunk.page_start == chunk.page_end:
            if chunk.heading and "page" in chunk.heading.lower():
                return chunk.heading
            return f"Page {chunk.page_start}"
        return f"Pages {chunk.page_start}-{chunk.page_end}"
    if chunk.heading:
        return chunk.heading
    return "Document section"


def _chunk_body(document: Document, chunk: Chunk) -> str:
    """The chunk's text as sent to the model: line-numbered for code, verbatim otherwise.

    Real absolute line numbers (from ``chunk.line_start``) let the explanation/summary cite an
    exact line instead of guessing one from the chunk's own content (see Phase 12).
    """
    text = chunk.text.strip()
    if document.content_type != ContentType.CODE:
        return text
    return numbered_code_lines(text, chunk.line_start)


def _chunk_groups(chunks: list[Chunk], *, size: int = 4) -> list[list[Chunk]]:
    return [chunks[index : index + size] for index in range(0, len(chunks), size)]


def _render_chunk_text(document: Document) -> str:
    if not document.chunks:
        raise AppError(400, "EMPTY_DOCUMENT")
    sections: list[str] = []
    for chunk in document.chunks:
        ref = _build_reference(chunk)
        sections.append(f"[{ref}]\n{chunk.text.strip()}")
    return "\n\n".join(sections)


async def _map_reduce_summary(
    document: Document,
    provider: LLMProvider,
    *,
    level: Level,
    language: Language,
) -> _SummaryDraft:
    chunks = list(document.chunks)
    if not chunks:
        raise AppError(400, "EMPTY_DOCUMENT")

    groups = _chunk_groups(chunks)
    section_summaries: list[_SectionSummary] = []
    for group in groups:
        piece = "\n\n".join(
            f"[{_build_reference(chunk)}]\n{_chunk_body(document, chunk)}" for chunk in group
        )
        builder = PromptBuilder()
        prompt = builder.build(
            task=Task.SUMMARY,
            content_type=ContentType(document.content_type.value),
            level=level,
            language=language,
            document_text=piece,
        )
        section = await provider.generate_json(
            prompt.user,
            _SectionSummary,
            system=prompt.system,
        )
        section_summaries.append(section)

    combined = "\n\n".join(
        f"[{item.references[0] if item.references else 'Document section'}]\n{item.summary}"
        for item in section_summaries
    )
    builder = PromptBuilder()
    final_prompt = builder.build(
        task=Task.SUMMARY,
        content_type=ContentType(document.content_type.value),
        level=level,
        language=language,
        document_text=combined,
    )
    draft = await provider.generate_json(
        final_prompt.user,
        _SummaryDraft,
        system=final_prompt.system,
    )
    return draft


async def _map_reduce_explanation(
    document: Document,
    provider: LLMProvider,
    *,
    level: Level,
    language: Language,
    depth: ExplanationDepth,
) -> _ExplanationDraft:
    chunks = list(document.chunks)
    if not chunks:
        raise AppError(400, "EMPTY_DOCUMENT")

    is_code = document.content_type == ContentType.CODE
    max_tokens = (
        max(provider.max_tokens, LINE_BY_LINE_MAX_TOKENS)
        if is_code and depth == ExplanationDepth.LINE_BY_LINE
        else None
    )
    groups = _chunk_groups(chunks)
    code_draft = _ExplanationDraft(sections=[])
    section_texts: list[str] = []
    for group in groups:
        piece = "\n\n".join(
            f"[{_build_reference(chunk)}]\n{_chunk_body(document, chunk)}" for chunk in group
        )
        builder = PromptBuilder()
        prompt = builder.build(
            task=Task.EXPLANATION,
            content_type=ContentType(document.content_type.value),
            level=level,
            language=language,
            document_text=piece,
            depth=depth,
        )
        section = await provider.generate_json(
            prompt.user,
            _ExplanationDraft,
            system=prompt.system,
            max_tokens=max_tokens,
        )
        if is_code:
            # Code sections are already one per function, so they are kept as-is: re-explaining
            # the explanation in a final "reduce" pass compressed it and dropped most code groups.
            code_draft.sections.extend(section.sections)
            code_draft.confidence_notes.extend(section.confidence_notes)
            continue
        if section.sections:
            section_texts.extend(
                (
                    f"[{entry.references[0] if entry.references else 'Document section'}]"
                    f"\n{entry.title}\n{entry.content}"
                )
                for entry in section.sections
            )

    if is_code:
        return code_draft

    combined = "\n\n".join(section_texts)
    builder = PromptBuilder()
    final_prompt = builder.build(
        task=Task.EXPLANATION,
        content_type=ContentType(document.content_type.value),
        level=level,
        language=language,
        document_text=combined,
    )
    draft = await provider.generate_json(
        final_prompt.user,
        _ExplanationDraft,
        system=final_prompt.system,
    )
    return draft


async def generate_summary(
    *,
    document: Document,
    provider: LLMProvider,
    cache: ContentCache,
    level: Level,
    language: Language,
) -> SummaryResponse:
    """Generate a structured summary for the document and cache it."""
    level = _level_from_value(level.value if isinstance(level, Level) else level)
    language = _language_from_value(language.value if isinstance(language, Language) else language)
    key = CacheKey(
        document_hash=document.content_hash,
        task=Task.SUMMARY,
        level=level,
        language=language,
        model=provider.model,
    )

    async def build() -> str:
        draft = await _map_reduce_summary(document, provider, level=level, language=language)
        payload = SummaryResponse(
            overview=draft.overview,
            key_concepts=draft.key_concepts,
            takeaways=draft.takeaways,
            confidence_notes=draft.confidence_notes,
            metadata=GenerationMetadata(
                document_id=document.id,
                content_type=document.content_type.value,
                task=Task.SUMMARY.value,
                level=level.value,
                language=language.value,
                chunks_used=len(document.chunks),
                prompt_version=PROMPT_VERSION,
                model=provider.model,
            ),
        )
        return payload.model_dump_json(ensure_ascii=False)

    cached = await cache.get_or_generate(key, build)
    payload = SummaryResponse.model_validate_json(cached.content)
    payload.metadata.cached = cached.hit
    return payload


async def generate_explanation(
    *,
    document: Document,
    provider: LLMProvider,
    cache: ContentCache,
    level: Level,
    language: Language,
    depth: ExplanationDepth = ExplanationDepth.LINE_BY_LINE,
) -> ExplanationResponse:
    """Generate a structured explanation for the document and cache it.

    ``depth`` picks the line-by-line or block-level template for code and is part of the cache
    key there; lectures ignore it, so both depths share one cached lecture explanation.
    """
    level = _level_from_value(level.value if isinstance(level, Level) else level)
    language = _language_from_value(language.value if isinstance(language, Language) else language)
    is_code = document.content_type == ContentType.CODE
    key = CacheKey(
        document_hash=document.content_hash,
        task=Task.EXPLANATION,
        level=level,
        language=language,
        model=provider.model,
        extra=f"depth={depth.value}" if is_code else "",
    )

    async def build() -> str:
        draft = await _map_reduce_explanation(
            document, provider, level=level, language=language, depth=depth
        )
        payload = ExplanationResponse(
            sections=draft.sections,
            confidence_notes=draft.confidence_notes,
            metadata=GenerationMetadata(
                document_id=document.id,
                content_type=document.content_type.value,
                task=Task.EXPLANATION.value,
                level=level.value,
                language=language.value,
                depth=depth.value if is_code else None,
                chunks_used=len(document.chunks),
                prompt_version=PROMPT_VERSION,
                model=provider.model,
            ),
        )
        return payload.model_dump_json(ensure_ascii=False)

    cached = await cache.get_or_generate(key, build)
    payload = ExplanationResponse.model_validate_json(cached.content)
    if is_code:
        # Repaired on every read rather than before caching, so entries cached before a fix to
        # the repair itself are served corrected too (it is cheap and idempotent).
        payload.sections = [
            section.model_copy(update={"content": fix_token_format(section.content)})
            for section in payload.sections
        ]
    payload.metadata.cached = cached.hit
    return payload
