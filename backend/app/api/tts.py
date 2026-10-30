"""Server-side TTS API: ``POST /api/tts/synthesize`` and ``GET /api/tts/health``.

The old single ``POST /api/tts`` route (Explainer Mode's original, opt-in server voice) has
been superseded by this router; see ``app/tts/`` for the synthesis provider and disk cache.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.errors import AppError
from app.tts.cache import get_or_synthesize
from app.tts.factory import get_tts_provider
from app.tts.mms_provider import MmsTtsProvider
from app.tts.text_utils import strip_citations_for_tts

router = APIRouter(prefix="/tts", tags=["tts"])

# Content-addressed by (text, language, model version): identical input always produces
# identical output, so the browser/CDN may cache it forever.
_IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable"

# Synthesis is comparatively expensive (CPU-bound model inference on a cache miss), so
# `/synthesize` gets its own per-IP limit; wired into `RateLimitMiddleware`'s `path_limiters` in
# `app.main.create_app`, in addition to the app's general rate limit. Avatar narration makes one
# call per sentence-sized caption (plus a one-ahead prefetch, and again on every replay), so the
# cap must sit well above that: the old 30/min cut long narrations over to the browser voice.
TTS_SYNTHESIZE_RATE_LIMIT_PER_MINUTE = 120


class TtsSynthesizeRequest(BaseModel):
    """Request payload for server-side speech synthesis."""

    text: str
    language: str


def _validate_language(value: str) -> Literal["sq", "en"]:
    if value not in ("sq", "en"):
        # Deliberately 400, not this API's usual 422 validation_error: the Phase 4c brief tests
        # for 400 specifically on this endpoint.
        raise AppError(400, "validation_error", details={"field": "language", "value": value})
    return value


@router.post("/synthesize")
async def post_tts_synthesize(payload: TtsSynthesizeRequest, request: Request) -> Response:
    """Synthesize speech for ``text`` with the MMS-TTS model for ``language``.

    Falls back to the frontend's browser voice (never attempted here) if ``FEATURE_SERVER_TTS``
    is off, the ML stack is not installed, or synthesis fails for any other reason — those are
    all reported as an error response; the frontend's `src/lib/tts.ts` is what actually performs
    the fallback.
    """
    settings = request.app.state.settings
    if not settings.feature_server_tts:
        raise AppError(503, "tts_disabled")

    language = _validate_language(payload.language)
    # Citation markers stay in the on-screen script but are never read aloud; stripping before
    # the cache lookup also means "x [Page 1]" and "x [Page 2]" share one cached clip.
    text = strip_citations_for_tts(payload.text)
    if not text:
        raise AppError(400, "EMPTY_DOCUMENT")

    provider = get_tts_provider(request)
    if not provider.is_available():
        raise AppError(
            503, "tts_not_installed", details={"hint": "pip install -r requirements.txt"}
        )

    try:
        # Model inference is CPU-bound and takes seconds: run it off the event loop, or every
        # other request (the next caption's prefetch, script loading, health checks) stalls
        # behind it -- long enough, in a queue of them, to hit the frontend's synthesis timeout.
        audio = await run_in_threadpool(
            get_or_synthesize,
            text,
            language,
            provider,
            cache_dir=settings.tts_cache_dir,
            max_bytes=settings.tts_cache_max_bytes,
        )
    except AppError:
        raise
    except Exception as exc:  # pragma: no cover - depends on the ML runtime, not exercised here
        raise AppError(502, "tts_failed") from exc

    return Response(
        content=audio,
        media_type="audio/wav",
        headers={"Cache-Control": _IMMUTABLE_CACHE_CONTROL},
    )


@router.get("/health")
async def get_tts_health(
    request: Request, provider: MmsTtsProvider = Depends(get_tts_provider)
) -> dict[str, object]:
    """Whether server TTS is worth attempting, and which language models are already warm.

    Cheap and side-effect-free: never loads a model (see ``MmsTtsProvider.is_available``), so
    the frontend can call this once per session on mount without risking the multi-minute
    first-download latency a real synthesis call can have.
    """
    settings = request.app.state.settings
    available = settings.feature_server_tts and provider.is_available()
    return {
        "available": available,
        "models_loaded": {
            "sq": provider.is_model_loaded("sq"),
            "en": provider.is_model_loaded("en"),
        },
    }
