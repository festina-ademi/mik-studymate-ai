"""Reports every successful call to the model provider, for the daily AI quota."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable

from pydantic import BaseModel

from app.llm.base import LLMProvider, LLMRequest


class UsageTrackingProvider(LLMProvider):
    """Delegates every call to ``inner`` and calls ``on_call`` once per successful attempt.

    Counting happens per attempt (not per outer call), so retries and JSON repairs each count:
    every one of them is a separate request against the provider's own daily limit. A streamed
    answer counts as soon as its first piece arrives.
    """

    def __init__(self, inner: LLMProvider, on_call: Callable[[], None]) -> None:
        """Wrap ``inner``; ``on_call`` is invoked after each attempt that got an answer."""
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
        self._on_call = on_call

    async def _generate(self, request: LLMRequest) -> str:
        result = await self._inner._generate(request)  # noqa: SLF001 - same reason as above
        self._on_call()
        return result

    async def _stream(self, request: LLMRequest) -> AsyncIterator[str]:
        counted = False
        async for chunk in self._inner._stream(request):  # noqa: SLF001
            if not counted:
                self._on_call()
                counted = True
            yield chunk

    async def _generate_json_text(self, request: LLMRequest, schema: type[BaseModel]) -> str:
        result = await self._inner._generate_json_text(request, schema)  # noqa: SLF001
        self._on_call()
        return result
