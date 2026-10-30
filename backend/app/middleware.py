"""Request protection: in-memory rate limiting, request-size limits and the daily quotas.

All are plain ASGI middleware. The rate limiter keeps its state in process memory, so with
several worker processes each one enforces the limit separately, and a restart resets it. The
quotas are stored in the database, so it survives restarts and is shared by workers.
"""

import hashlib
import hmac
import json
import logging
import math
import re
import secrets
import time
from collections import deque
from collections.abc import Callable
from datetime import UTC, datetime

from fastapi.responses import JSONResponse
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.db.session import SessionFactory
from app.errors import AppError, error_response
from app.services.quota import (
    AI_CALL_ACTION,
    CLIENT_ID_HEADER,
    TIMEZONE_HEADER,
    UPLOAD_ACTION,
    DayWindow,
    QuotaContext,
    count_usage,
    current_day,
    quota_context,
    record_usage,
    resolve_client_id,
    resolve_timezone,
)

logger = logging.getLogger(__name__)

DEFAULT_EXEMPT_PATHS = frozenset({"/api/health"})
# Endpoints that create a document and therefore count toward the daily upload quota.
UPLOAD_ROUTES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("POST", re.compile(r"^/api/documents(/code)?$")),
)
# Endpoints that may call the LLM. Study Mode's test scoring is deliberately absent: a
# participant's test must never be blocked mid-experiment.
AI_ROUTES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("POST", re.compile(r"^/api/documents/[^/]+/(summary|explanation|quiz|tutor)$")),
    ("POST", re.compile(r"^/api/documents/[^/]+/topics/.+/reexplain$")),
    ("POST", re.compile(r"^/api/documents/[^/]+/explainer/plan$")),
    ("GET", re.compile(r"^/api/documents/[^/]+/explainer/sections/[^/]+$")),
    ("POST", re.compile(r"^/api/quiz/[^/]+/answer$")),
)


class SlidingWindowLimiter:
    """Allows at most ``limit`` calls per key within any ``window_seconds`` window."""

    def __init__(
        self,
        limit: int,
        window_seconds: float,
        *,
        clock: Callable[[], float] = time.monotonic,
        max_keys: int = 10_000,
    ) -> None:
        """Configure the limiter.

        Args:
            limit: Calls allowed per window.
            window_seconds: Window length.
            clock: Monotonic time source; replaced in tests.
            max_keys: Upper bound on tracked keys, to keep memory bounded.
        """
        self._limit = limit
        self._window = window_seconds
        self._clock = clock
        self._max_keys = max_keys
        self._hits: dict[str, deque[float]] = {}

    def check(self, key: str) -> float | None:
        """Record a call for ``key``.

        Returns:
            ``None`` if the call is allowed, otherwise the seconds until it may be retried.
        """
        now = self._clock()
        hits = self._hits.setdefault(key, deque())
        while hits and hits[0] <= now - self._window:
            hits.popleft()
        if len(hits) >= self._limit:
            return max(hits[0] + self._window - now, 0.0)
        hits.append(now)
        if len(self._hits) > self._max_keys:
            self._evict(now)
        return None

    def _evict(self, now: float) -> None:
        stale = [
            key for key, hits in self._hits.items() if not hits or hits[-1] <= now - self._window
        ]
        for key in stale:
            del self._hits[key]
        while len(self._hits) > self._max_keys:
            del self._hits[next(iter(self._hits))]


class RateLimitMiddleware:
    """Rejects clients that exceed the limit with ``429`` in the standard error format."""

    def __init__(
        self,
        app: ASGIApp,
        limiter: SlidingWindowLimiter,
        exempt_paths: frozenset[str] = DEFAULT_EXEMPT_PATHS,
        path_limiters: dict[str, SlidingWindowLimiter] | None = None,
    ) -> None:
        """Wrap ``app``; ``exempt_paths`` (e.g. the health check) are never limited.

        ``path_limiters`` applies an *additional*, stricter limit to specific paths (exact
        match), on top of the general ``limiter`` — a request to one of those paths is rejected
        if it exceeds either limit. Everything not listed is governed by ``limiter`` alone, so
        this is purely additive and does not change behavior for any existing route.
        """
        self.app = app
        self._limiter = limiter
        self._exempt_paths = exempt_paths
        self._path_limiters = path_limiters or {}
        # Client addresses are only ever used as keys after hashing with a per-process secret,
        # so they are neither stored in readable form nor logged.
        self._salt = secrets.token_bytes(16)

    def _client_key(self, scope: Scope) -> str:
        client = scope.get("client")
        host = client[0] if client else "unknown"
        return hmac.new(self._salt, host.encode(), hashlib.sha256).hexdigest()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Apply the limit to HTTP requests."""
        path = scope.get("path", "")
        if scope["type"] != "http" or scope["method"] == "OPTIONS" or path in self._exempt_paths:
            await self.app(scope, receive, send)
            return
        key = self._client_key(scope)
        retry_after = self._limiter.check(key)
        path_limiter = self._path_limiters.get(path)
        if retry_after is None and path_limiter is not None:
            retry_after = path_limiter.check(key)
        if retry_after is None:
            await self.app(scope, receive, send)
            return
        seconds = max(1, math.ceil(retry_after))
        logger.info("rate_limited", extra={"path": scope["path"]})
        response = error_response(
            429,
            "rate_limited",
            details={"retry_after_seconds": seconds},
            headers={"Retry-After": str(seconds)},
        )
        await response(scope, receive, send)


class RequestSizeLimitMiddleware:
    """Rejects oversized request bodies with ``413`` in the standard error format.

    ``multipart/form-data`` requests (file uploads) may be up to ``upload_limit`` bytes; every
    other body up to ``json_limit``. A declared ``Content-Length`` is checked up front; the
    bytes actually received are counted as well, which also covers chunked bodies.
    """

    def __init__(self, app: ASGIApp, json_limit: int, upload_limit: int) -> None:
        """Wrap ``app`` with the two limits (bytes)."""
        self.app = app
        self._json_limit = json_limit
        self._upload_limit = upload_limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Enforce the limit on HTTP requests."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        is_upload = headers.get("content-type", "").lower().startswith("multipart/form-data")
        limit = self._upload_limit if is_upload else self._json_limit

        declared = headers.get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > limit:
            if is_upload:
                response = error_response(413, "FILE_TOO_LARGE", details={"max_bytes": limit})
            else:
                response = error_response(413, "payload_too_large", details={"max_bytes": limit})
            await response(scope, receive, send)
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    if is_upload:
                        raise AppError(413, "FILE_TOO_LARGE", details={"max_bytes": limit})
                    raise HTTPException(status_code=413)
            return message

        try:
            await self.app(scope, limited_receive, send)
        except AppError as exc:
            response = error_response(exc.status_code, exc.code, exc.message_key, exc.details)
            await response(scope, receive, send)


class QuotaMiddleware:
    """Enforces the daily AI-call and upload quotas per client with ``429``.

    Before a matching request runs, :meth:`check_quota` rejects it if that quota is used up.
    Uploads are counted here once they succeed (``2xx``); AI calls are counted where they happen,
    one per successful call to the provider (see :class:`app.llm.usage.UsageTrackingProvider`),
    for the client this middleware binds to the request.
    """

    def __init__(
        self,
        app: ASGIApp,
        session_factory: SessionFactory,
        daily_ai_requests: int,
        daily_uploads: int,
    ) -> None:
        """Wrap ``app``; a limit of 0 disables that quota."""
        self.app = app
        self._session_factory = session_factory
        self._limits = {AI_CALL_ACTION: daily_ai_requests, UPLOAD_ACTION: daily_uploads}

    def _action_for(self, method: str, path: str) -> str | None:
        for action, routes in ((UPLOAD_ACTION, UPLOAD_ROUTES), (AI_CALL_ACTION, AI_ROUTES)):
            if self._limits[action] > 0 and any(
                method == route_method and pattern.match(path) for route_method, pattern in routes
            ):
                return action
        return None

    def check_quota(self, user_id: str, action: str, day: DayWindow) -> JSONResponse | None:
        """The ``429`` response if ``user_id`` has used up today's ``action`` quota, else None."""
        with self._session_factory() as session:
            used = count_usage(session, user_id, action, day.start)
        limit = self._limits[action]
        if used < limit:
            return None
        logger.info("quota_exceeded", extra={"action_type": action})
        reset_at = day.reset_at.isoformat()
        hours_remaining = day.hours_remaining()
        envelope = error_response(
            429,
            "quota_exceeded",
            details={
                "quota": action,
                "used": used,
                "limit": limit,
                "reset_at": reset_at,
                "hours_remaining": hours_remaining,
            },
        ).body
        # The reset time is repeated at the top level for clients that read it directly.
        return JSONResponse(
            {**json.loads(envelope), "reset_at": reset_at, "hours_remaining": hours_remaining},
            status_code=429,
            headers={"Retry-After": str(_seconds_until(day.reset_at))},
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Enforce the quotas on matching HTTP requests."""
        action = (
            self._action_for(scope["method"], scope.get("path", ""))
            if scope["type"] == "http"
            else None
        )
        if action is None:
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        user_id = resolve_client_id(headers.get(CLIENT_ID_HEADER))
        day = current_day(resolve_timezone(headers.get(TIMEZONE_HEADER)))
        rejection = self.check_quota(user_id, action, day)
        if rejection is not None:
            await rejection(scope, receive, send)
            return

        if action == AI_CALL_ACTION:
            with quota_context(QuotaContext(user_id, self._session_factory)):
                await self.app(scope, receive, send)
            return

        succeeded = False

        async def tracking_send(message: Message) -> None:
            nonlocal succeeded
            if message["type"] == "http.response.start":
                succeeded = 200 <= message["status"] < 300
            await send(message)

        await self.app(scope, receive, tracking_send)
        if succeeded:
            with self._session_factory() as session:
                record_usage(session, user_id, UPLOAD_ACTION)


def _seconds_until(moment: datetime) -> int:
    """Whole seconds from now until ``moment``, at least 1."""
    return max(1, math.ceil((moment - datetime.now(UTC)).total_seconds()))
