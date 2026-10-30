"""Explainer Mode API: sectioning plan and per-section spoken scripts.

Server-side TTS used to live here too; it is now ``app/api/tts.py`` (``/api/tts/synthesize``,
``/api/tts/health``), since Phase 4c grew it into its own peer service with a disk cache and a
health check, not something specific to Explainer Mode's own endpoints.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.models import Document
from app.db.session import get_session
from app.errors import AppError
from app.llm.factory import get_llm_provider
from app.rag.factory import get_embedding_provider, get_vector_store
from app.services.cache import ContentCache
from app.services.explainer_mode import (
    ExplainerPlanResponse,
    ExplainerScriptResponse,
    generate_plan,
    generate_section_script,
    plan_sections,
)

router = APIRouter(tags=["explainer"])


class ExplainerPlanRequest(BaseModel):
    """Request payload for planning Explainer Mode sections and the overview script."""

    level: str = "intermediate"
    language: str = "en"


@router.post("/documents/{document_id}/explainer/plan", response_model=ExplainerPlanResponse)
async def post_explainer_plan(
    document_id: str,
    request: Request,
    payload: ExplainerPlanRequest,
    session: Session = Depends(get_session),
) -> ExplainerPlanResponse:
    """Plan sections for a document and eagerly generate its overview script."""
    document = session.get(Document, document_id)
    if document is None:
        raise AppError(404, "not_found")
    settings = request.app.state.settings
    provider = get_llm_provider(request)
    return await generate_plan(
        document=document,
        provider=provider,
        level=payload.level,
        language=payload.language,
        target_words=settings.explainer_target_words_per_section,
        max_sections=settings.explainer_max_sections,
        session=session,
    )


@router.get("/documents/{document_id}/explainer/sections/{section_index}", response_model=None)
async def get_explainer_section(
    document_id: str,
    section_index: int,
    request: Request,
    level: str = "intermediate",
    language: str = "en",
    simplified: bool = False,
    stream: bool = False,
    session: Session = Depends(get_session),
) -> ExplainerScriptResponse | StreamingResponse:
    """Return one section's spoken script and mini-quiz, generating and caching it if needed.

    Sections are cheap and deterministic to (re)plan from the document's chunks, so this does
    not depend on a prior call to ``/explainer/plan``: the frontend can prefetch section
    ``n + 1`` while section ``n`` plays by simply requesting it early.
    """
    document = session.get(Document, document_id)
    if document is None:
        raise AppError(404, "not_found")
    settings = request.app.state.settings
    sections = plan_sections(
        document,
        target_words=settings.explainer_target_words_per_section,
        max_sections=settings.explainer_max_sections,
    )
    if section_index < 0 or section_index >= len(sections):
        raise AppError(404, "not_found")

    provider = get_llm_provider(request)
    cache = ContentCache(request.app.state.session_factory)
    result = await generate_section_script(
        document=document,
        provider=provider,
        cache=cache,
        store=get_vector_store(request),
        embedding_provider=get_embedding_provider(request),
        section=sections[section_index],
        level=level,
        language=language,
        simplified=simplified,
        mini_quiz_questions=settings.explainer_mini_quiz_questions,
        session=session,
    )
    if stream:
        return await result.stream_response()
    return result
