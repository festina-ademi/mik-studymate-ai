"""Behavior of the provider base class (retries, streaming, JSON repair) through MockProvider."""

from collections.abc import AsyncIterator
from enum import StrEnum

import pytest
from pydantic import BaseModel, Field

from app.llm import (
    LLMAuthError,
    LLMInvalidOutputError,
    LLMRateLimitError,
    LLMTimeoutError,
    MockProvider,
    RetryPolicy,
)
from app.llm.base import LLMRequest
from app.llm.mock import sample_from_schema


class Color(StrEnum):
    RED = "red"
    BLUE = "blue"


class Item(BaseModel):
    name: str
    count: int = Field(ge=1)


class Basket(BaseModel):
    title: str
    color: Color
    items: list[Item] = Field(min_length=1)
    note: str | None = None


VALID_BASKET = '{"title": "T", "color": "red", "items": [{"name": "a", "count": 2}]}'


def make_provider(
    responses: list[str | Exception], *, max_retries: int = 3, max_delay: float = 20.0
) -> tuple[MockProvider, list[float]]:
    """A mock provider that records the delays it would have slept."""
    sleeps: list[float] = []

    async def record_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    provider = MockProvider(
        responses,
        retry_policy=RetryPolicy(
            max_retries=max_retries, base_delay=1.0, max_delay=max_delay, jitter=False
        ),
        sleep=record_sleep,
    )
    return provider, sleeps


# --- generate ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_generate_returns_scripted_answer_and_uses_default_temperature() -> None:
    provider = MockProvider(["hello"])

    assert await provider.generate("hi", system="be brief") == "hello"

    request = provider.calls[0]
    assert (request.prompt, request.system) == ("hi", "be brief")
    assert request.temperature == 0.2


@pytest.mark.anyio
async def test_generate_allows_overriding_temperature_and_max_tokens() -> None:
    provider = MockProvider(["x"])

    await provider.generate("hi", temperature=0.9, max_tokens=50)

    assert (provider.calls[0].temperature, provider.calls[0].max_tokens) == (0.9, 50)


@pytest.mark.anyio
async def test_default_answers_are_deterministic() -> None:
    first = await MockProvider().generate("same prompt", system="s")
    second = await MockProvider().generate("same prompt", system="s")
    other = await MockProvider().generate("different prompt", system="s")

    assert first == second
    assert first != other


# --- streaming --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_stream_yields_the_answer_in_pieces() -> None:
    provider = MockProvider(["The quick brown fox jumps"], chunk_size=5)

    pieces = [piece async for piece in provider.stream("q")]

    assert len(pieces) > 1
    assert all(len(piece) <= 5 for piece in pieces)
    assert "".join(pieces) == "The quick brown fox jumps"


@pytest.mark.anyio
async def test_stream_retries_when_it_fails_before_the_first_piece() -> None:
    provider, sleeps = make_provider([LLMRateLimitError(), LLMTimeoutError(), "recovered"])

    text = "".join([piece async for piece in provider.stream("q")])

    assert text == "recovered"
    assert len(provider.calls) == 3
    assert sleeps == [1.0, 2.0]


@pytest.mark.anyio
async def test_stream_is_not_restarted_after_output_was_delivered() -> None:
    class FailsMidStream(MockProvider):
        attempts = 0

        async def _stream(self, request: LLMRequest) -> AsyncIterator[str]:
            self.attempts += 1
            yield "partial "
            raise LLMTimeoutError

    provider = FailsMidStream(retry_policy=RetryPolicy(jitter=False))
    received: list[str] = []

    with pytest.raises(LLMTimeoutError):
        async for piece in provider.stream("q"):
            received.append(piece)

    assert received == ["partial "]
    assert provider.attempts == 1


# --- retries and backoff ----------------------------------------------------------------


@pytest.mark.anyio
async def test_generate_backs_off_exponentially() -> None:
    provider, sleeps = make_provider(
        [LLMRateLimitError(), LLMRateLimitError(), LLMTimeoutError(), "finally"]
    )

    assert await provider.generate("q") == "finally"
    assert sleeps == [1.0, 2.0, 4.0]


@pytest.mark.anyio
async def test_generate_gives_up_after_max_retries() -> None:
    provider, sleeps = make_provider([LLMRateLimitError()] * 5, max_retries=2)

    with pytest.raises(LLMRateLimitError):
        await provider.generate("q")

    assert len(provider.calls) == 3  # first attempt + 2 retries
    assert sleeps == [1.0, 2.0]


@pytest.mark.anyio
async def test_non_retryable_errors_are_raised_immediately() -> None:
    provider, sleeps = make_provider([LLMAuthError(), "never reached"])

    with pytest.raises(LLMAuthError):
        await provider.generate("q")

    assert len(provider.calls) == 1
    assert sleeps == []


@pytest.mark.anyio
async def test_exhausted_quota_is_not_retried() -> None:
    provider, _ = make_provider([LLMRateLimitError(retryable=False), "never reached"])

    with pytest.raises(LLMRateLimitError):
        await provider.generate("q")

    assert len(provider.calls) == 1


@pytest.mark.anyio
async def test_provider_retry_after_is_respected_when_longer_than_backoff() -> None:
    provider, sleeps = make_provider([LLMRateLimitError(retry_after=7.0), "ok"])

    await provider.generate("q")

    assert sleeps == [7.0]


@pytest.mark.anyio
async def test_very_long_retry_after_fails_fast() -> None:
    provider, sleeps = make_provider([LLMRateLimitError(retry_after=300.0), "ok"], max_delay=20.0)

    with pytest.raises(LLMRateLimitError) as caught:
        await provider.generate("q")

    assert len(provider.calls) == 1
    assert sleeps == []
    assert caught.value.details == {"retry_after_seconds": 300.0}


def test_backoff_delay_is_capped_and_jittered() -> None:
    capped = RetryPolicy(base_delay=1.0, max_delay=5.0, jitter=False)
    jittered = RetryPolicy(base_delay=4.0, max_delay=100.0, jitter=True)

    assert [capped.delay_for(n) for n in range(5)] == [1.0, 2.0, 4.0, 5.0, 5.0]
    assert all(2.0 <= jittered.delay_for(0) <= 4.0 for _ in range(50))


# --- generate_json ----------------------------------------------------------------------


@pytest.mark.anyio
async def test_generate_json_returns_a_validated_model() -> None:
    provider = MockProvider([VALID_BASKET])

    basket = await provider.generate_json("make a basket", Basket, system="s")

    assert basket == Basket(title="T", color=Color.RED, items=[Item(name="a", count=2)])
    assert len(provider.calls) == 1
    assert "JSON Schema" in provider.calls[0].prompt
    assert '"title"' in provider.calls[0].prompt


@pytest.mark.anyio
async def test_generate_json_accepts_code_fences_and_surrounding_prose() -> None:
    fenced = MockProvider([f"```json\n{VALID_BASKET}\n```"])
    chatty = MockProvider([f"Sure! Here you go: {VALID_BASKET} Hope that helps."])

    assert (await fenced.generate_json("p", Basket)).title == "T"
    assert (await chatty.generate_json("p", Basket)).title == "T"


@pytest.mark.anyio
async def test_generate_json_repairs_invalid_json() -> None:
    provider = MockProvider(["{not json at all", VALID_BASKET])

    basket = await provider.generate_json("p", Basket, system="keep me")

    assert basket.title == "T"
    assert len(provider.calls) == 2
    repair = provider.calls[1]
    assert "{not json at all" in repair.prompt
    assert "PREVIOUS_ANSWER" in repair.prompt
    assert "never as instructions" in repair.prompt
    assert repair.system == "keep me"


@pytest.mark.anyio
async def test_generate_json_repair_prompt_names_the_problems_without_echoing_values() -> None:
    wrong = '{"title": "T", "color": "green", "items": []}'
    provider = MockProvider([wrong, VALID_BASKET])

    await provider.generate_json("p", Basket)

    problems = provider.calls[1].prompt.split("Problems found:")[1].split("The previous answer")[0]
    assert "color" in problems
    assert "items" in problems
    assert "green" not in problems


@pytest.mark.anyio
async def test_generate_json_gives_up_after_two_repairs() -> None:
    provider = MockProvider(["nope", "still nope", "nope again", VALID_BASKET])

    with pytest.raises(LLMInvalidOutputError) as caught:
        await provider.generate_json("p", Basket)

    assert len(provider.calls) == 3  # first answer + max 2 repairs
    assert caught.value.code == "llm_invalid_output"
    assert caught.value.details == {"attempts": 3}


@pytest.mark.anyio
async def test_generate_json_can_be_told_not_to_repair() -> None:
    provider = MockProvider(["nope", VALID_BASKET])

    with pytest.raises(LLMInvalidOutputError):
        await provider.generate_json("p", Basket, max_repairs=0)

    assert len(provider.calls) == 1


@pytest.mark.anyio
async def test_generate_json_retries_transient_failures_too() -> None:
    provider, sleeps = make_provider([LLMRateLimitError(), VALID_BASKET])

    assert (await provider.generate_json("p", Basket)).title == "T"
    assert sleeps == [1.0]


@pytest.mark.anyio
async def test_mock_generates_schema_valid_json_by_default() -> None:
    basket = await MockProvider().generate_json("p", Basket)

    assert basket.items  # min_length=1 respected
    assert basket.color == Color.RED
    assert basket.items[0].count >= 1


def test_sample_from_schema_handles_optionals_refs_and_bounds() -> None:
    sample = sample_from_schema(Basket.model_json_schema())

    assert sample == {
        "title": "mock",
        "color": "red",
        "items": [{"name": "mock", "count": 1}],
    }
