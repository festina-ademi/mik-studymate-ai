"""Provider-independent LLM interface.

Subclasses implement the one-shot primitives :meth:`LLMProvider._generate` and
:meth:`LLMProvider._stream` (and translate SDK exceptions into :class:`LLMError`). The public
methods add exponential-backoff retries and, for ``generate_json``, validation with
retry-and-repair.
"""

import asyncio
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import ClassVar, TypeVar

from pydantic import BaseModel, ValidationError

from app.llm.errors import LLMInvalidOutputError, LLMTimeoutError
from app.llm.json_output import json_instructions, parse_json_output, repair_prompt
from app.llm.retry import RetryPolicy, Sleep, call_with_retry, stream_with_retry

M = TypeVar("M", bound=BaseModel)

MAX_JSON_REPAIRS = 2
DEFAULT_TEMPERATURE = 0.2
DEFAULT_MAX_TOKENS = 4096
DEFAULT_TIMEOUT_SECONDS = 60.0


@dataclass(frozen=True)
class LLMRequest:
    """A fully resolved request handed to a provider primitive."""

    prompt: str
    system: str | None
    temperature: float
    max_tokens: int


async def iterate_with_timeout(source: AsyncIterator[str], timeout: float) -> AsyncIterator[str]:
    """Re-yield ``source``, raising :class:`LLMTimeoutError` if a chunk takes too long."""
    iterator = source.__aiter__()
    try:
        while True:
            try:
                async with asyncio.timeout(timeout):
                    chunk = await anext(iterator)
            except StopAsyncIteration:
                return
            except TimeoutError as error:
                raise LLMTimeoutError from error
            yield chunk
    finally:
        aclose = getattr(iterator, "aclose", None)
        if aclose is not None:
            await aclose()


class LLMProvider(ABC):
    """Abstract chat-model provider."""

    name: ClassVar[str]

    def __init__(
        self,
        model: str,
        *,
        temperature: float = DEFAULT_TEMPERATURE,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        retry_policy: RetryPolicy | None = None,
        sleep: Sleep = asyncio.sleep,
    ) -> None:
        """Configure the provider.

        Args:
            model: Model name (comes from an environment variable).
            temperature: Default sampling temperature.
            max_tokens: Default cap on generated tokens.
            timeout: Seconds to wait for a response (per chunk when streaming).
            retry_policy: Backoff settings for transient failures.
            sleep: Awaitable sleep function; replaced in tests.
        """
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout = timeout
        self.retry_policy = retry_policy or RetryPolicy()
        self._sleep = sleep

    async def generate(
        self,
        prompt: str,
        *,
        system: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        """Return the complete answer to ``prompt``.

        Raises:
            LLMError: The provider failed and retries (if any) were exhausted.
        """
        request = self._request(prompt, system, temperature, max_tokens)
        return await call_with_retry(
            lambda: self._generate(request), self.retry_policy, self._sleep
        )

    def stream(
        self,
        prompt: str,
        *,
        system: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        """Yield the answer to ``prompt`` piece by piece.

        The call is retried only if it fails before the first piece arrives.

        Raises:
            LLMError: The provider failed and retries (if any) were exhausted.
        """
        request = self._request(prompt, system, temperature, max_tokens)
        return stream_with_retry(lambda: self._stream(request), self.retry_policy, self._sleep)

    async def generate_json(
        self,
        prompt: str,
        schema: type[M],
        *,
        system: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        max_repairs: int = MAX_JSON_REPAIRS,
    ) -> M:
        """Return the answer to ``prompt`` parsed and validated as ``schema``.

        When the answer is not valid JSON for ``schema`` the model is asked to repair it, up to
        ``max_repairs`` times.

        Raises:
            LLMInvalidOutputError: Still invalid after all repair attempts.
            LLMError: The provider failed and retries (if any) were exhausted.
        """
        request = self._request(
            f"{prompt}\n\n{json_instructions(schema)}", system, temperature, max_tokens
        )
        raw = await self._json_text_with_retry(request, schema)
        for repair_number in range(max_repairs + 1):
            try:
                return parse_json_output(raw, schema)
            except ValidationError as error:
                if repair_number == max_repairs:
                    break
                request = self._request(
                    repair_prompt(schema, raw, error), system, temperature, max_tokens
                )
                raw = await self._json_text_with_retry(request, schema)
        raise LLMInvalidOutputError(details={"attempts": max_repairs + 1})

    async def _json_text_with_retry(self, request: LLMRequest, schema: type[BaseModel]) -> str:
        return await call_with_retry(
            lambda: self._generate_json_text(request, schema), self.retry_policy, self._sleep
        )

    def _request(
        self, prompt: str, system: str | None, temperature: float | None, max_tokens: int | None
    ) -> LLMRequest:
        return LLMRequest(
            prompt=prompt,
            system=system,
            temperature=self.temperature if temperature is None else temperature,
            max_tokens=self.max_tokens if max_tokens is None else max_tokens,
        )

    @abstractmethod
    async def _generate(self, request: LLMRequest) -> str:
        """One attempt at a complete answer. Must raise :class:`LLMError` on failure."""

    @abstractmethod
    def _stream(self, request: LLMRequest) -> AsyncIterator[str]:
        """One attempt at a streamed answer. Must raise :class:`LLMError` on failure."""

    async def _generate_json_text(self, request: LLMRequest, schema: type[BaseModel]) -> str:
        """One attempt at an answer that should be JSON; providers may enable native JSON mode."""
        return await self._generate(request)
