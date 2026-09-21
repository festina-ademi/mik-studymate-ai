"""Gemini and OpenAI providers: error translation and behavior against fake SDK clients."""

import asyncio
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any

import httpx
import httpx2
import openai
import pytest
from google.genai import errors as genai_errors
from pydantic import BaseModel

from app.config import Settings
from app.llm import (
    LLMAuthError,
    LLMContentBlockedError,
    LLMError,
    LLMInvalidOutputError,
    LLMNotConfiguredError,
    LLMRateLimitError,
    LLMRequestError,
    LLMTimeoutError,
    LLMUnavailableError,
    MockProvider,
    RetryPolicy,
    create_provider,
)
from app.llm.gemini import GeminiProvider, translate_gemini_error
from app.llm.openai_provider import OpenAIProvider, translate_openai_error

# --- Gemini: error translation ----------------------------------------------------------


def gemini_error(code: int, status: str, message: str = "boom", **extra: Any) -> Exception:
    body = {"error": {"code": code, "status": status, "message": message, **extra}}
    return genai_errors.APIError(code, body)


def test_gemini_rate_limit_carries_the_retry_hint() -> None:
    error = gemini_error(
        429,
        "RESOURCE_EXHAUSTED",
        details=[{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "7s"}],
    )

    translated = translate_gemini_error(error)

    assert isinstance(translated, LLMRateLimitError)
    assert translated.retryable
    assert translated.retry_after == 7.0
    assert (translated.status_code, translated.code) == (429, "llm_rate_limited")


@pytest.mark.parametrize(
    ("error", "expected", "retryable"),
    [
        (
            gemini_error(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid key."),
            LLMAuthError,
            False,
        ),
        (gemini_error(401, "UNAUTHENTICATED"), LLMAuthError, False),
        (gemini_error(403, "PERMISSION_DENIED"), LLMAuthError, False),
        (gemini_error(504, "DEADLINE_EXCEEDED"), LLMTimeoutError, True),
        (gemini_error(500, "INTERNAL"), LLMUnavailableError, True),
        (gemini_error(503, "UNAVAILABLE"), LLMUnavailableError, True),
        (gemini_error(404, "NOT_FOUND"), LLMRequestError, False),
        (gemini_error(400, "INVALID_ARGUMENT", "bad schema"), LLMRequestError, False),
        (httpx.ReadTimeout("slow"), LLMTimeoutError, True),
        (TimeoutError(), LLMTimeoutError, True),
        (httpx.ConnectError("no route"), LLMUnavailableError, True),
        (RuntimeError("bug"), LLMRequestError, False),
    ],
)
def test_gemini_errors_are_translated(
    error: Exception, expected: type[LLMError], retryable: bool
) -> None:
    translated = translate_gemini_error(error)

    assert type(translated) is expected
    assert translated.retryable is retryable


def test_translated_errors_never_expose_provider_messages() -> None:
    translated = translate_gemini_error(gemini_error(500, "INTERNAL", "secret-internal-detail"))

    assert "secret-internal-detail" not in str(translated.details)
    assert "secret-internal-detail" not in translated.message_key


# --- Gemini: provider with a fake client ------------------------------------------------


def gemini_response(
    text: str | None, *, block_reason: str | None = None, finish: str | None = None
) -> SimpleNamespace:
    feedback = SimpleNamespace(block_reason=block_reason) if block_reason else None
    candidates = [SimpleNamespace(finish_reason=SimpleNamespace(name=finish) if finish else None)]
    return SimpleNamespace(text=text, prompt_feedback=feedback, candidates=candidates)


class FakeGeminiModels:
    def __init__(self, script: list[Any]) -> None:
        self.script = script
        self.calls: list[dict[str, Any]] = []

    async def generate_content(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    async def generate_content_stream(self, **kwargs: Any) -> AsyncIterator[Any]:
        self.calls.append(kwargs)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item

        async def chunks() -> AsyncIterator[Any]:
            for chunk in item:
                yield chunk

        return chunks()


def gemini_provider(script: list[Any]) -> tuple[GeminiProvider, FakeGeminiModels, list[float]]:
    models = FakeGeminiModels(script)
    sleeps: list[float] = []

    async def record_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    provider = GeminiProvider(
        "key",
        "gemini-test",
        client=SimpleNamespace(aio=SimpleNamespace(models=models)),  # type: ignore[arg-type]
        retry_policy=RetryPolicy(jitter=False),
        sleep=record_sleep,
    )
    return provider, models, sleeps


@pytest.mark.anyio
async def test_gemini_generate_sends_configuration_and_returns_text() -> None:
    provider, models, _ = gemini_provider([gemini_response("Hello")])

    assert await provider.generate("hi", system="be kind", max_tokens=99) == "Hello"

    call = models.calls[0]
    assert call["model"] == "gemini-test"
    assert call["contents"] == "hi"
    assert call["config"].system_instruction == "be kind"
    assert call["config"].temperature == 0.2
    assert call["config"].max_output_tokens == 99
    assert call["config"].response_mime_type is None


@pytest.mark.anyio
async def test_gemini_retries_rate_limits_with_backoff() -> None:
    provider, models, sleeps = gemini_provider(
        [gemini_error(429, "RESOURCE_EXHAUSTED"), gemini_response("ok")]
    )

    assert await provider.generate("hi") == "ok"
    assert len(models.calls) == 2
    assert sleeps == [1.0]


@pytest.mark.anyio
async def test_gemini_json_mode_sets_the_json_mime_type() -> None:
    class Answer(BaseModel):
        value: int

    provider, models, _ = gemini_provider([gemini_response('{"value": 3}')])

    assert (await provider.generate_json("p", Answer)).value == 3
    assert models.calls[0]["config"].response_mime_type == "application/json"


@pytest.mark.anyio
async def test_gemini_reports_blocked_prompts_and_answers() -> None:
    provider, _, _ = gemini_provider(
        [gemini_response(None, block_reason="SAFETY"), gemini_response(None, finish="SAFETY")]
    )

    with pytest.raises(LLMContentBlockedError):
        await provider.generate("hi")
    with pytest.raises(LLMContentBlockedError):
        await provider.generate("hi")


@pytest.mark.anyio
async def test_gemini_empty_answer_is_an_invalid_output_error() -> None:
    provider, _, _ = gemini_provider([gemini_response(None, finish="MAX_TOKENS")])

    with pytest.raises(LLMInvalidOutputError) as caught:
        await provider.generate("hi")

    assert caught.value.details == {"reason": "empty_response", "finish_reason": "MAX_TOKENS"}


@pytest.mark.anyio
async def test_gemini_stream_yields_text_and_skips_empty_chunks() -> None:
    chunks = [gemini_response("Hel"), gemini_response(None), gemini_response("lo")]
    provider, _, _ = gemini_provider([chunks])

    assert "".join([piece async for piece in provider.stream("hi")]) == "Hello"


@pytest.mark.anyio
async def test_gemini_stream_retries_a_failed_start() -> None:
    provider, models, sleeps = gemini_provider(
        [gemini_error(503, "UNAVAILABLE"), [gemini_response("fine")]]
    )

    assert "".join([piece async for piece in provider.stream("hi")]) == "fine"
    assert len(models.calls) == 2
    assert sleeps == [1.0]


@pytest.mark.anyio
async def test_gemini_stream_times_out_when_a_chunk_stalls() -> None:
    async def stalled() -> AsyncIterator[Any]:
        yield gemini_response("start")
        await asyncio.sleep(5)
        yield gemini_response("never")

    class StallingModels(FakeGeminiModels):
        async def generate_content_stream(self, **kwargs: Any) -> AsyncIterator[Any]:
            return stalled()

    provider = GeminiProvider(
        "key",
        "gemini-test",
        client=SimpleNamespace(aio=SimpleNamespace(models=StallingModels([]))),  # type: ignore[arg-type]
        timeout=0.05,
        retry_policy=RetryPolicy(max_retries=0),
    )
    received: list[str] = []

    with pytest.raises(LLMTimeoutError):
        async for piece in provider.stream("hi"):
            received.append(piece)

    assert received == ["start"]


# --- OpenAI: error translation ----------------------------------------------------------

REQUEST = httpx2.Request("POST", "https://api.openai.com/v1/responses")


def openai_status_error(
    error_class: type[openai.APIStatusError],
    status: int,
    *,
    code: str | None = None,
    headers: dict[str, str] | None = None,
    message: str = "boom",
) -> openai.APIStatusError:
    response = httpx2.Response(status, headers=headers, request=REQUEST)
    return error_class(message, response=response, body={"code": code, "message": message})


@pytest.mark.parametrize(
    ("error", "expected", "retryable"),
    [
        (openai_status_error(openai.RateLimitError, 429), LLMRateLimitError, True),
        (
            openai_status_error(openai.RateLimitError, 429, code="insufficient_quota"),
            LLMRateLimitError,
            False,
        ),
        (openai_status_error(openai.AuthenticationError, 401), LLMAuthError, False),
        (openai_status_error(openai.PermissionDeniedError, 403), LLMAuthError, False),
        (openai_status_error(openai.InternalServerError, 500), LLMUnavailableError, True),
        (openai.APITimeoutError(request=REQUEST), LLMTimeoutError, True),
        (openai.APIConnectionError(request=REQUEST), LLMUnavailableError, True),
        (openai_status_error(openai.BadRequestError, 400), LLMRequestError, False),
        (
            openai_status_error(openai.BadRequestError, 400, code="content_policy_violation"),
            LLMContentBlockedError,
            False,
        ),
        (RuntimeError("bug"), LLMRequestError, False),
    ],
)
def test_openai_errors_are_translated(
    error: Exception, expected: type[LLMError], retryable: bool
) -> None:
    translated = translate_openai_error(error)

    assert type(translated) is expected
    assert translated.retryable is retryable


def test_openai_rate_limit_reads_retry_after_headers() -> None:
    seconds = translate_openai_error(
        openai_status_error(openai.RateLimitError, 429, headers={"retry-after": "3"})
    )
    millis = translate_openai_error(
        openai_status_error(openai.RateLimitError, 429, headers={"retry-after-ms": "1500"})
    )

    assert isinstance(seconds, LLMRateLimitError)
    assert seconds.retry_after == 3.0
    assert isinstance(millis, LLMRateLimitError)
    assert millis.retry_after == 1.5


# --- OpenAI: provider with a fake client ------------------------------------------------


def openai_response(text: str, *, status: str = "completed", reason: str | None = None) -> Any:
    details = SimpleNamespace(reason=reason) if reason else None
    return SimpleNamespace(status=status, output_text=text, error=None, incomplete_details=details)


class FakeOpenAIStream:
    def __init__(self, events: list[Any]) -> None:
        self._events = events
        self.closed = False

    def __aiter__(self) -> AsyncIterator[Any]:
        async def iterate() -> AsyncIterator[Any]:
            for event in self._events:
                yield event

        return iterate()

    async def close(self) -> None:
        self.closed = True


class FakeResponses:
    def __init__(self, script: list[Any]) -> None:
        self.script = script
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def openai_provider(script: list[Any]) -> tuple[OpenAIProvider, FakeResponses, list[float]]:
    responses = FakeResponses(script)
    sleeps: list[float] = []

    async def record_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    provider = OpenAIProvider(
        "key",
        "gpt-test",
        client=SimpleNamespace(responses=responses),  # type: ignore[arg-type]
        retry_policy=RetryPolicy(jitter=False),
        sleep=record_sleep,
    )
    return provider, responses, sleeps


@pytest.mark.anyio
async def test_openai_generate_sends_configuration_and_does_not_store_the_request() -> None:
    provider, responses, _ = openai_provider([openai_response("Hello")])

    assert await provider.generate("hi", system="be kind", max_tokens=99) == "Hello"

    assert responses.calls[0] == {
        "model": "gpt-test",
        "input": "hi",
        "instructions": "be kind",
        "temperature": 0.2,
        "max_output_tokens": 99,
        "store": False,
    }


@pytest.mark.anyio
async def test_openai_retries_rate_limits_with_backoff() -> None:
    provider, responses, sleeps = openai_provider(
        [openai_status_error(openai.RateLimitError, 429), openai_response("ok")]
    )

    assert await provider.generate("hi") == "ok"
    assert len(responses.calls) == 2
    assert sleeps == [1.0]


@pytest.mark.anyio
async def test_openai_json_mode_uses_the_json_object_format() -> None:
    class Answer(BaseModel):
        value: int

    provider, responses, _ = openai_provider([openai_response('{"value": 4}')])

    assert (await provider.generate_json("p", Answer)).value == 4
    assert responses.calls[0]["text"] == {"format": {"type": "json_object"}}


@pytest.mark.anyio
async def test_openai_drops_temperature_for_models_that_reject_it() -> None:
    rejected = openai_status_error(
        openai.BadRequestError,
        400,
        message="Unsupported parameter: 'temperature' is not supported with this model.",
    )
    provider, responses, _ = openai_provider(
        [rejected, openai_response("one"), openai_response("two")]
    )

    assert await provider.generate("hi") == "one"
    assert await provider.generate("again") == "two"

    assert "temperature" in responses.calls[0]
    assert "temperature" not in responses.calls[1]  # the retry
    assert "temperature" not in responses.calls[2]  # remembered for later calls


@pytest.mark.anyio
async def test_openai_reports_filtered_and_empty_answers() -> None:
    provider, _, _ = openai_provider(
        [
            openai_response("cut", status="incomplete", reason="content_filter"),
            openai_response(""),
        ]
    )

    with pytest.raises(LLMContentBlockedError):
        await provider.generate("hi")
    with pytest.raises(LLMInvalidOutputError):
        await provider.generate("hi")


@pytest.mark.anyio
async def test_openai_stream_yields_deltas_and_closes_the_stream() -> None:
    delta = "response.output_text.delta"
    stream = FakeOpenAIStream(
        [
            SimpleNamespace(type="response.created"),
            SimpleNamespace(type=delta, delta="Hel"),
            SimpleNamespace(type=delta, delta="lo"),
            SimpleNamespace(type="response.completed"),
        ]
    )
    provider, responses, _ = openai_provider([stream])

    assert "".join([piece async for piece in provider.stream("hi")]) == "Hello"
    assert responses.calls[0]["stream"] is True
    assert stream.closed


@pytest.mark.anyio
async def test_openai_stream_retries_a_failed_start() -> None:
    delta = SimpleNamespace(type="response.output_text.delta", delta="fine")
    provider, responses, sleeps = openai_provider(
        [openai_status_error(openai.InternalServerError, 500), FakeOpenAIStream([delta])]
    )

    assert "".join([piece async for piece in provider.stream("hi")]) == "fine"
    assert len(responses.calls) == 2
    assert sleeps == [1.0]


# --- Factory ----------------------------------------------------------------------------


def settings_for(**overrides: Any) -> Settings:
    return Settings(_env_file=None, **overrides)


def test_factory_builds_the_configured_provider_with_model_names_from_settings() -> None:
    gemini = create_provider(
        settings_for(llm_provider="gemini", gemini_api_key="k", gemini_model="g-model")
    )
    chat = create_provider(
        settings_for(llm_provider="openai", openai_api_key="k", openai_model="o-model")
    )
    mock = create_provider(settings_for(llm_provider="mock"))

    assert (type(gemini), gemini.model) == (GeminiProvider, "g-model")
    assert (type(chat), chat.model) == (OpenAIProvider, "o-model")
    assert isinstance(mock, MockProvider)


def test_factory_passes_llm_settings_to_the_provider() -> None:
    provider = create_provider(
        settings_for(
            llm_provider="mock",
            llm_temperature=0.5,
            llm_max_output_tokens=123,
            llm_timeout_seconds=9,
            llm_max_retries=1,
            llm_retry_base_delay_seconds=0.25,
        )
    )

    assert provider.temperature == 0.5
    assert provider.max_tokens == 123
    assert provider.timeout == 9
    assert provider.retry_policy.max_retries == 1
    assert provider.retry_policy.base_delay == 0.25


@pytest.mark.parametrize("name", ["gemini", "openai"])
def test_factory_requires_an_api_key_for_real_providers(name: str) -> None:
    with pytest.raises(LLMNotConfiguredError) as caught:
        create_provider(settings_for(llm_provider=name))

    assert caught.value.status_code == 503
    assert caught.value.details == {"provider": name}


def test_default_temperature_is_low() -> None:
    assert create_provider(settings_for(llm_provider="mock")).temperature == 0.2
