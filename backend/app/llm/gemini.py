"""Google Gemini provider (``google-genai`` SDK)."""

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
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

_BLOCKED_FINISH_REASONS = frozenset(
    {"SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY"}
)


def _retry_delay(error: genai_errors.APIError) -> float | None:
    """Read the ``RetryInfo.retryDelay`` hint (e.g. ``"34s"``) from a Gemini error body."""
    body = error.details
    if not isinstance(body, dict):
        return None
    inner = body.get("error", body)
    for detail in inner.get("details", []) if isinstance(inner, dict) else []:
        delay = detail.get("retryDelay") if isinstance(detail, dict) else None
        if isinstance(delay, str) and delay.endswith("s"):
            try:
                return float(delay[:-1])
            except ValueError:
                return None
    return None


def translate_gemini_error(error: BaseException) -> LLMError:
    """Map an SDK or transport exception to the app's :class:`LLMError` hierarchy."""
    if isinstance(error, LLMError):
        return error
    if isinstance(error, TimeoutError | httpx.TimeoutException):
        return LLMTimeoutError()
    if isinstance(error, genai_errors.APIError):
        code = error.code
        status = (error.status or "").upper()
        message = (error.message or "").lower()
        logger.warning("gemini_api_error", extra={"code": code, "status": status})
        if code == 429 or status == "RESOURCE_EXHAUSTED":
            return LLMRateLimitError(retry_after=_retry_delay(error))
        if (
            code in (401, 403)
            or status in ("UNAUTHENTICATED", "PERMISSION_DENIED")
            or (code == 400 and "api key" in message)
        ):
            return LLMAuthError()
        if code in (408, 504) or status == "DEADLINE_EXCEEDED":
            return LLMTimeoutError()
        if code >= 500:
            return LLMUnavailableError()
        return LLMRequestError()
    if isinstance(error, httpx.TransportError):
        return LLMUnavailableError()
    logger.error("gemini_unexpected_error", exc_info=error)
    return LLMRequestError()


def _finish_reason_name(response: types.GenerateContentResponse) -> str | None:
    if not response.candidates:
        return None
    finish = response.candidates[0].finish_reason
    return None if finish is None else str(getattr(finish, "name", finish))


def _raise_if_blocked(response: types.GenerateContentResponse) -> None:
    feedback = response.prompt_feedback
    if feedback is not None and feedback.block_reason is not None:
        raise LLMContentBlockedError
    if _finish_reason_name(response) in _BLOCKED_FINISH_REASONS:
        raise LLMContentBlockedError


def _empty_output_error(last: types.GenerateContentResponse | None) -> LLMError:
    """Error for an answer without text; a blocked answer is reported as such."""
    if last is not None:
        _raise_if_blocked(last)
    reason = _finish_reason_name(last) if last is not None else None
    return LLMInvalidOutputError(details={"reason": "empty_response", "finish_reason": reason})


class GeminiProvider(LLMProvider):
    """Gemini models through the Gemini Developer API."""

    name = "gemini"

    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        client: genai.Client | None = None,
        **kwargs: Any,  # noqa: ANN401 - forwarded to LLMProvider
    ) -> None:
        """Create the provider.

        Args:
            api_key: Gemini API key.
            model: Model name, e.g. from ``GEMINI_MODEL``.
            client: Pre-built SDK client (tests); created from ``api_key`` when omitted.
            **kwargs: Forwarded to :class:`LLMProvider`.
        """
        super().__init__(model, **kwargs)
        self._client = client or genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=int(self.timeout * 1000)),
        )

    def _config(
        self, request: LLMRequest, *, json_mode: bool = False
    ) -> types.GenerateContentConfig:
        return types.GenerateContentConfig(
            system_instruction=request.system,
            temperature=request.temperature,
            max_output_tokens=request.max_tokens,
            response_mime_type="application/json" if json_mode else None,
        )

    async def _call(self, request: LLMRequest, *, json_mode: bool) -> str:
        try:
            async with asyncio.timeout(self.timeout):
                response = await self._client.aio.models.generate_content(
                    model=self.model,
                    contents=request.prompt,
                    config=self._config(request, json_mode=json_mode),
                )
        except LLMError:
            raise
        except Exception as error:
            raise translate_gemini_error(error) from error
        _raise_if_blocked(response)
        if not response.text:
            raise _empty_output_error(response)
        return response.text

    async def _generate(self, request: LLMRequest) -> str:
        return await self._call(request, json_mode=False)

    async def _generate_json_text(self, request: LLMRequest, schema: type[BaseModel]) -> str:
        # JSON mode only: the schema is in the prompt and validated by generate_json, which is
        # more forgiving across model versions than sending a response schema to the API.
        return await self._call(request, json_mode=True)

    def _stream(self, request: LLMRequest) -> AsyncIterator[str]:
        return iterate_with_timeout(self._stream_chunks(request), self.timeout)

    async def _stream_chunks(self, request: LLMRequest) -> AsyncIterator[str]:
        last: types.GenerateContentResponse | None = None
        delivered = False
        try:
            stream = await self._client.aio.models.generate_content_stream(
                model=self.model, contents=request.prompt, config=self._config(request)
            )
            async for chunk in stream:
                last = chunk
                _raise_if_blocked(chunk)
                if chunk.text:
                    delivered = True
                    yield chunk.text
        except LLMError:
            raise
        except Exception as error:
            raise translate_gemini_error(error) from error
        if not delivered:
            raise _empty_output_error(last)
