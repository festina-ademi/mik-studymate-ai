"""Caps how many LLM calls run at once, across the whole process.

A small deployment (a single low-RAM instance, see docs/DEPLOYMENT.md) can receive several
students' summary/explanation/quiz/tutor requests at nearly the same time. Without a cap, every
one of them fires its outbound call to the model provider immediately, which can exhaust the
provider's own per-minute rate limit in one burst (turning otherwise-fine traffic into a wave of
retries) and, for a self-hosted embedding/TTS model sharing the same process, spike memory. This
wraps any :class:`~app.llm.base.LLMProvider` so extra callers simply wait their turn instead.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from pydantic import BaseModel

from app.llm.base import LLMProvider, LLMRequest


class ConcurrencyLimitedProvider(LLMProvider):
    """Delegates every call to ``inner``, allowing at most ``max_concurrent`` in flight at once.

    The limit is enforced around each individual attempt (not just the outer call), so a slot is
    held only while a request is actually in progress — a retry's backoff sleep does not hold a
    slot, letting other queued callers run during that wait.
    """

    def __init__(self, inner: LLMProvider, max_concurrent: int) -> None:
        """Wrap ``inner``; ``max_concurrent`` must be at least 1."""
        super().__init__(
            inner.model,
            temperature=inner.temperature,
            max_tokens=inner.max_tokens,
            timeout=inner.timeout,
            retry_policy=inner.retry_policy,
            sleep=inner._sleep,  # noqa: SLF001 - copying the inner provider's own configuration
        )
        self.name = inner.name
        self._inner = inner
        self._semaphore = asyncio.Semaphore(max_concurrent)

    async def _generate(self, request: LLMRequest) -> str:
        async with self._semaphore:
            return await self._inner._generate(request)  # noqa: SLF001 - same reason as above

    async def _stream(self, request: LLMRequest) -> AsyncIterator[str]:
        async with self._semaphore:
            async for chunk in self._inner._stream(request):  # noqa: SLF001
                yield chunk

    async def _generate_json_text(self, request: LLMRequest, schema: type[BaseModel]) -> str:
        async with self._semaphore:
            return await self._inner._generate_json_text(request, schema)  # noqa: SLF001
