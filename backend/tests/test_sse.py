import asyncio
import json
from collections.abc import AsyncIterator

import pytest
from fastapi import Depends, FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from app.domain import Language, Level, Task
from app.llm import LLMProvider, LLMTimeoutError, MockProvider, get_llm_provider
from app.services.cache import CacheKey, ContentCache
from app.sse import format_sse, sse_response, sse_stream


def parse_events(text: str) -> list[tuple[str, dict[str, object]]]:
    """Parse SSE text into (event, data) pairs, ignoring comment lines."""
    events = []
    for block in text.strip().split("\n\n"):
        lines = [line for line in block.split("\n") if not line.startswith(":")]
        if not lines:
            continue
        event = next(line[7:] for line in lines if line.startswith("event: "))
        data = next(line[6:] for line in lines if line.startswith("data: "))
        events.append((event, json.loads(data)))
    return events


async def collect(stream: AsyncIterator[str]) -> str:
    return "".join([message async for message in stream])


async def source(*pieces: str) -> AsyncIterator[str]:
    for piece in pieces:
        yield piece


# --- formatting -------------------------------------------------------------------------


def test_format_sse_is_one_data_line_of_json() -> None:
    message = format_sse("token", {"text": "line one\nline two"})

    assert message == 'event: token\ndata: {"text":"line one\\nline two"}\n\n'
    assert message.count("\ndata: ") == 1


def test_format_sse_keeps_albanian_characters_readable() -> None:
    assert "përshëndetje, çfarë" in format_sse("token", {"text": "përshëndetje, çfarë"})


# --- stream -----------------------------------------------------------------------------


@pytest.mark.anyio
async def test_stream_emits_token_events_then_done() -> None:
    events = parse_events(await collect(sse_stream(source("Hel", "lo"))))

    assert events == [("token", {"text": "Hel"}), ("token", {"text": "lo"}), ("done", {})]


@pytest.mark.anyio
async def test_a_failure_midway_ends_with_an_error_event_in_the_standard_format() -> None:
    async def failing() -> AsyncIterator[str]:
        yield "partial"
        raise LLMTimeoutError

    events = parse_events(await collect(sse_stream(failing())))

    assert events[0] == ("token", {"text": "partial"})
    assert events[1] == (
        "error",
        {"error": {"code": "llm_timeout", "message_key": "errors.llm_timeout", "details": {}}},
    )
    assert [name for name, _ in events] == ["token", "error"]  # no "done" after an error


@pytest.mark.anyio
async def test_unexpected_failures_are_reported_without_internal_details() -> None:
    async def failing() -> AsyncIterator[str]:
        yield "x"
        raise RuntimeError("secret internal detail")

    text = await collect(sse_stream(failing()))

    assert "internal_error" in text
    assert "secret internal detail" not in text


@pytest.mark.anyio
async def test_idle_streams_send_keep_alive_comments() -> None:
    async def slow() -> AsyncIterator[str]:
        await asyncio.sleep(0.15)
        yield "late"

    text = await collect(sse_stream(slow(), heartbeat_seconds=0.03))

    assert text.count(": keep-alive\n\n") >= 2
    assert parse_events(text) == [("token", {"text": "late"}), ("done", {})]


@pytest.mark.anyio
async def test_closing_the_stream_closes_the_source() -> None:
    closed = asyncio.Event()

    async def endless() -> AsyncIterator[str]:
        try:
            while True:
                yield "x"
                await asyncio.sleep(0)
        finally:
            closed.set()

    stream = sse_stream(endless())
    assert await anext(stream)  # the client reads one message, then disconnects
    await stream.aclose()  # type: ignore[attr-defined]

    assert closed.is_set()


# --- HTTP endpoint ----------------------------------------------------------------------


def add_stream_routes(app: FastAPI) -> None:
    @app.get("/api/_test/stream")
    async def stream(provider: LLMProvider = Depends(get_llm_provider)) -> StreamingResponse:
        return sse_response(provider.stream("say hello", system="s"))

    @app.get("/api/_test/cached-stream")
    async def cached_stream(
        request: Request, provider: LLMProvider = Depends(get_llm_provider)
    ) -> StreamingResponse:
        cache = ContentCache(request.app.state.session_factory)
        key = CacheKey("h" * 64, Task.SUMMARY, Level.BEGINNER, Language.SQ, provider.model)
        return sse_response(cache.stream(key, lambda: provider.stream("summarize")))


def test_endpoint_streams_events_with_the_right_headers(app: FastAPI) -> None:
    app.state.llm_provider = MockProvider(["Përshëndetje botë"], chunk_size=6)
    add_stream_routes(app)

    with TestClient(app) as client, client.stream("GET", "/api/_test/stream") as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache, no-transform"
    assert response.headers["x-accel-buffering"] == "no"
    events = parse_events(body)
    assert "".join(str(data["text"]) for name, data in events if name == "token") == (
        "Përshëndetje botë"
    )
    assert events[-1] == ("done", {})


def test_endpoint_with_cache_calls_the_model_only_once(app: FastAPI) -> None:
    provider = MockProvider(["cached summary text"], chunk_size=5)
    app.state.llm_provider = provider
    add_stream_routes(app)

    def read(client: TestClient) -> str:
        with client.stream("GET", "/api/_test/cached-stream") as response:
            events = parse_events("".join(response.iter_text()))
        return "".join(str(data["text"]) for name, data in events if name == "token")

    with TestClient(app) as client:
        first = read(client)
        second = read(client)

    assert first == second == "cached summary text"
    assert len(provider.calls) == 1
