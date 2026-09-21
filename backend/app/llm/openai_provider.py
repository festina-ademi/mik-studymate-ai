"""OpenAI provider (official ``openai`` SDK, Responses API)."""

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Any

import openai
from openai import AsyncOpenAI
from pydantic import BaseModel

from app.llm.base import LLMProvider, LLMRequest, iterate_with_timeout
from app.llm.errors import (
    LLMAuthError,
    LLMContentBlockedError,
    LLMError,
    LLMInvalidOutputError,
    LLMRateLimitError,
    LLMRequestError,
    LLMTimeoutError,
    LLMUnavailableError,
)

logger = logging.getLogger(__name__)


def _retry_after(response: object) -> float | None:
    """Seconds requested through the ``retry-after-ms`` / ``retry-after`` headers."""
    headers = getattr(response, "headers", None)
    if headers is None:
        return None
    for header, scale in (("retry-after-ms", 0.001), ("retry-after", 1.0)):
        value = headers.get(header)
        if value is not None:
            try:
                return float(value) * scale
            except ValueError:
                continue
    return None


def translate_openai_error(error: BaseException) -> LLMError:
    """Map an SDK or transport exception to the app's :class:`LLMError` hierarchy."""
    if isinstance(error, LLMError):
        return error
    if isinstance(error, TimeoutError | openai.APITimeoutError):
        return LLMTimeoutError()
    if isinstance(error, openai.RateLimitError):
        if error.code == "insufficient_quota":
            return LLMRateLimitError(retryable=False)
        return LLMRateLimitError(retry_after=_retry_after(error.response))
    if isinstance(error, openai.AuthenticationError | openai.PermissionDeniedError):
        return LLMAuthError()
    if isinstance(error, openai.APIConnectionError | openai.InternalServerError):
        return LLMUnavailableError()
    if isinstance(error, openai.APIStatusError):
        logger.warning("openai_api_error", extra={"status": error.status_code, "code": error.code})
        if error.status_code == 408:
            return LLMTimeoutError()
        if error.code in ("content_filter", "content_policy_violation"):
            return LLMContentBlockedError()
        return LLMRequestError()
    logger.error("openai_unexpected_error", exc_info=error)
    return LLMRequestError()


def _check_response(response: Any) -> str:  # noqa: ANN401 - SDK response object
    """Return the text of a finished response or raise the matching :class:`LLMError`."""
    if response.status == "failed":
        code = response.error.code if response.error else None
        if code in ("server_error", "rate_limit_exceeded"):
            raise LLMUnavailableError
        raise LLMRequestError
    if response.status == "incomplete":
        details = response.incomplete_details
        if details is not None and details.reason == "content_filter":
            raise LLMContentBlockedError
    text: str = response.output_text
    if not text:
        raise LLMInvalidOutputError(details={"reason": "empty_response"})
    return text


class OpenAIProvider(LLMProvider):
    """OpenAI models through the Responses API."""

    name = "openai"

    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        client: AsyncOpenAI | None = None,
        **kwargs: Any,  # noqa: ANN401 - forwarded to LLMProvider
    ) -> None:
        """Create the provider.

        Args:
            api_key: OpenAI API key.
            model: Model name, e.g. from ``OPENAI_MODEL``.
            client: Pre-built SDK client (tests); created from ``api_key`` when omitted.
            **kwargs: Forwarded to :class:`LLMProvider`.
        """
        super().__init__(model, **kwargs)
        # SDK retries are off: backoff is handled once, by this application's retry policy.
        self._client = client or AsyncOpenAI(api_key=api_key, timeout=self.timeout, max_retries=0)
        self._send_temperature = True

    def _arguments(self, request: LLMRequest, *, json_mode: bool, stream: bool) -> dict[str, Any]:
        arguments: dict[str, Any] = {
            "model": self.model,
            "input": request.prompt,
            "max_output_tokens": request.max_tokens,
            "store": False,  # do not keep students' material on the provider's servers
        }
        if request.system:
            arguments["instructions"] = request.system
        if self._send_temperature:
            arguments["temperature"] = request.temperature
        if json_mode:
            arguments["text"] = {"format": {"type": "json_object"}}
        if stream:
            arguments["stream"] = True
        return arguments

    async def _create(self, request: LLMRequest, *, json_mode: bool, stream: bool) -> Any:  # noqa: ANN401
        """Call the API. Models that reject ``temperature`` are retried once without it."""
        arguments = self._arguments(request, json_mode=json_mode, stream=stream)
        try:
            return await self._client.responses.create(**arguments)
        except openai.BadRequestError as error:
            if not self._send_temperature or "temperature" not in str(error).lower():
                raise
            self._send_temperature = False
            del arguments["temperature"]
            return await self._client.responses.create(**arguments)

    async def _call(self, request: LLMRequest, *, json_mode: bool) -> str:
        try:
            async with asyncio.timeout(self.timeout):
                response = await self._create(request, json_mode=json_mode, stream=False)
        except LLMError:
            raise
        except Exception as error:
            raise translate_openai_error(error) from error
        return _check_response(response)

    async def _generate(self, request: LLMRequest) -> str:
        return await self._call(request, json_mode=False)

    async def _generate_json_text(self, request: LLMRequest, schema: type[BaseModel]) -> str:
        # JSON mode only: the schema is in the prompt and validated by generate_json.
        return await self._call(request, json_mode=True)

    def _stream(self, request: LLMRequest) -> AsyncIterator[str]:
        return iterate_with_timeout(self._stream_chunks(request), self.timeout)

    async def _stream_chunks(self, request: LLMRequest) -> AsyncIterator[str]:
        delivered = False
        stream = None
        try:
            stream = await self._create(request, json_mode=False, stream=True)
            async for event in stream:
                if event.type == "response.output_text.delta":
                    delivered = True
                    yield event.delta
                elif event.type == "response.failed":
                    _check_response(event.response)
                elif event.type == "response.incomplete":
                    details = event.response.incomplete_details
                    if details is not None and details.reason == "content_filter":
                        raise LLMContentBlockedError
                elif event.type == "error":
                    raise LLMUnavailableError
        except LLMError:
            raise
        except Exception as error:
            raise translate_openai_error(error) from error
        finally:
            if stream is not None:
                await stream.close()
        if not delivered:
            raise LLMInvalidOutputError(details={"reason": "empty_response"})
