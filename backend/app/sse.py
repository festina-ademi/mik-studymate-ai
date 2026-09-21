"""Server-Sent Events helpers for streaming model output.

Event types: ``token`` (``{"text": "..."}``), ``done`` (``{}``) and ``error`` (the standard
error envelope). Every ``data`` payload is a single line of JSON.
"""

import asyncio
import contextlib
import json
import logging
from collections.abc import AsyncIterator

from fastapi.responses import StreamingResponse

from app.errors import AppError, ErrorBody, ErrorResponse

logger = logging.getLogger(__name__)

SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",  # stop nginx from buffering the stream
}
_END = object()


def format_sse(event: str, data: object) -> str:
    """Format one SSE message."""
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


def _error_event(code: str, message_key: str, details: dict[str, object]) -> str:
    body = ErrorResponse(error=ErrorBody(code=code, message_key=message_key, details=details))
    return format_sse("error", body.model_dump())


async def _next_or_end(iterator: AsyncIterator[str]) -> object:
    try:
        return await anext(iterator)
    except StopAsyncIteration:
        return _END


async def sse_stream(
    chunks: AsyncIterator[str], *, heartbeat_seconds: float = 15.0
) -> AsyncIterator[str]:
    """Turn a stream of text pieces into SSE messages.

    A failure while producing text ends the stream with an ``error`` event (the HTTP status
    has already been sent by then). A comment line is emitted every ``heartbeat_seconds`` of
    silence so proxies do not close an idle connection.
    """
    iterator = chunks.__aiter__()
    pending: asyncio.Task[object] | None = None
    try:
        while True:
            if pending is None:
                pending = asyncio.create_task(_next_or_end(iterator))
            done, _ = await asyncio.wait({pending}, timeout=heartbeat_seconds)
            if not done:
                yield ": keep-alive\n\n"
                continue
            piece, pending = pending.result(), None
            if piece is _END:
                break
            yield format_sse("token", {"text": piece})
    except AppError as error:
        yield _error_event(error.code, error.message_key, error.details)
        return
    except Exception:
        logger.exception("sse_stream_failed")
        yield _error_event("internal_error", "errors.internal_error", {})
        return
    finally:
        if pending is not None:
            pending.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await pending
        aclose = getattr(iterator, "aclose", None)
        if aclose is not None:
            await aclose()
    yield format_sse("done", {})


def sse_response(
    chunks: AsyncIterator[str], *, heartbeat_seconds: float = 15.0
) -> StreamingResponse:
    """Wrap a stream of text pieces in a ``text/event-stream`` response."""
    return StreamingResponse(
        sse_stream(chunks, heartbeat_seconds=heartbeat_seconds),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )
