"""Exponential backoff for transient provider failures."""

import asyncio
import random
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import TypeVar

from app.llm.errors import LLMError

T = TypeVar("T")
Sleep = Callable[[float], Awaitable[None]]


@dataclass(frozen=True)
class RetryPolicy:
    """How often and how long to wait before repeating a failed provider call."""

    max_retries: int = 3
    base_delay: float = 1.0
    max_delay: float = 20.0
    jitter: bool = True

    def delay_for(self, attempt: int) -> float:
        """Delay before retry number ``attempt + 1``: base * 2**attempt, capped, with jitter."""
        delay = min(self.max_delay, self.base_delay * (2**attempt))
        if self.jitter:
            delay *= 0.5 + random.random() / 2  # noqa: S311 - not security related
        return delay

    def should_retry(self, error: LLMError, attempt: int) -> bool:
        """Whether to retry after ``error`` on the given (zero-based) attempt.

        A provider that asks for a longer pause than ``max_delay`` is not waited for: an HTTP
        request should fail fast instead.
        """
        if not error.retryable or attempt >= self.max_retries:
            return False
        return error.retry_after is None or error.retry_after <= self.max_delay

    def wait_time(self, error: LLMError, attempt: int) -> float:
        """Seconds to sleep: our backoff, or the provider's requested pause if longer."""
        return max(self.delay_for(attempt), error.retry_after or 0.0)


async def call_with_retry(
    operation: Callable[[], Awaitable[T]], policy: RetryPolicy, sleep: Sleep = asyncio.sleep
) -> T:
    """Await ``operation()``, repeating it on retryable :class:`LLMError` failures."""
    attempt = 0
    while True:
        try:
            return await operation()
        except LLMError as error:
            if not policy.should_retry(error, attempt):
                raise
            await sleep(policy.wait_time(error, attempt))
            attempt += 1


async def stream_with_retry(
    open_stream: Callable[[], AsyncIterator[str]], policy: RetryPolicy, sleep: Sleep = asyncio.sleep
) -> AsyncIterator[str]:
    """Yield chunks from ``open_stream()``, restarting only if it fails before any output.

    Once a chunk has been delivered the stream cannot be restarted without duplicating text,
    so later failures propagate to the caller.
    """
    attempt = 0
    while True:
        delivered = False
        try:
            async for chunk in open_stream():
                delivered = True
                yield chunk
            return
        except LLMError as error:
            if delivered or not policy.should_retry(error, attempt):
                raise
            await sleep(policy.wait_time(error, attempt))
            attempt += 1
