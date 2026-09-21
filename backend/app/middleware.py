"""Request protection: in-memory rate limiting and request-size limits.

Both are plain ASGI middleware. The rate limiter keeps its state in process memory, so with
several worker processes each one enforces the limit separately, and a restart resets it.
"""

import hashlib
import hmac
import logging
import math
import secrets
import time
from collections import deque
from collections.abc import Callable

from starlette.datastructures import Headers
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.errors import error_response

logger = logging.getLogger(__name__)

DEFAULT_EXEMPT_PATHS = frozenset({"/api/health"})


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
    ) -> None:
        """Wrap ``app``; ``exempt_paths`` (e.g. the health check) are never limited."""
        self.app = app
        self._limiter = limiter
        self._exempt_paths = exempt_paths
        # Client addresses are only ever used as keys after hashing with a per-process secret,
        # so they are neither stored in readable form nor logged.
        self._salt = secrets.token_bytes(16)

    def _client_key(self, scope: Scope) -> str:
        client = scope.get("client")
        host = client[0] if client else "unknown"
        return hmac.new(self._salt, host.encode(), hashlib.sha256).hexdigest()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Apply the limit to HTTP requests."""
        if (
            scope["type"] != "http"
            or scope["method"] == "OPTIONS"
            or scope["path"] in self._exempt_paths
        ):
            await self.app(scope, receive, send)
            return
        retry_after = self._limiter.check(self._client_key(scope))
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
                    # HTTPException passes through FastAPI's body parsing (which would turn
                    # other errors into a 400) and is rendered by the app's error handler.
                    raise HTTPException(status_code=413)
            return message

        await self.app(scope, limited_receive, send)
