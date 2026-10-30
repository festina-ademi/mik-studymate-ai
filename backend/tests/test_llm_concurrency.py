"""ConcurrencyLimitedProvider: caps how many calls to the wrapped provider run at once."""

import asyncio
from collections.abc import AsyncIterator

import pytest

from app.llm.base import LLMProvider, LLMRequest
from app.llm.concurrency import ConcurrencyLimitedProvider
from app.llm.retry import RetryPolicy


class _TrackingProvider(LLMProvider):
    """Records the highest number of calls that were ever in flight at once."""

    name = "tracking"

    def __init__(self) -> None:
        super().__init__("tracking-model", retry_policy=RetryPolicy(max_retries=0))
        self.in_flight = 0
        self.max_in_flight = 0

    async def _enter(self) -> None:
        self.in_flight += 1
        self.max_in_flight = max(self.max_in_flight, self.in_flight)
        await asyncio.sleep(0.01)

    async def _generate(self, request: LLMRequest) -> str:
        await self._enter()
        try:
            return "ok"
        finally:
            self.in_flight -= 1

    async def _stream(self, request: LLMRequest) -> AsyncIterator[str]:
        await self._enter()
        try:
            yield "ok"
        finally:
            self.in_flight -= 1


@pytest.mark.anyio
async def test_limits_concurrent_generate_calls() -> None:
    inner = _TrackingProvider()
    limited = ConcurrencyLimitedProvider(inner, max_concurrent=2)

    await asyncio.gather(*[limited.generate("hi") for _ in range(6)])

    assert inner.max_in_flight == 2


@pytest.mark.anyio
async def test_limits_concurrent_stream_calls() -> None:
    inner = _TrackingProvider()
    limited = ConcurrencyLimitedProvider(inner, max_concurrent=1)

    async def drain() -> None:
        async for _ in limited.stream("hi"):
            pass

    await asyncio.gather(*[drain() for _ in range(4)])

    assert inner.max_in_flight == 1


@pytest.mark.anyio
async def test_delegates_configuration_and_name() -> None:
    inner = _TrackingProvider()
    limited = ConcurrencyLimitedProvider(inner, max_concurrent=3)

    assert limited.model == inner.model
    assert limited.name == inner.name
    assert limited.temperature == inner.temperature
