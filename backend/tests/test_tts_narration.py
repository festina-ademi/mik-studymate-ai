"""Avatar narration makes many sequential synthesize calls; they must not throttle or stall.

One call per sentence-sized caption (plus a one-ahead prefetch) used to trip the old 30/min
cap, and synthesis ran on the event loop, so every other request waited behind it.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path

import anyio
import httpx
import pytest

from tests.test_tts import FakeTtsProvider, make_client


class SlowTtsProvider(FakeTtsProvider):
    """Takes ``delay`` seconds per synthesis, like real CPU-bound model inference."""

    def __init__(self, delay: float) -> None:
        super().__init__()
        self.delay = delay
        self.threads: list[str] = []

    def synthesize(self, text: str, language: str) -> bytes:
        self.threads.append(threading.current_thread().name)
        time.sleep(self.delay)  # blocking on purpose: real inference does not yield either
        return super().synthesize(text, language)


def test_ten_rapid_narration_calls_all_succeed(tmp_path: Path) -> None:
    client = make_client(tts_cache_dir=tmp_path)
    client.app.state.tts_provider = FakeTtsProvider()

    statuses = [
        client.post(
            "/api/tts/synthesize", json={"text": f"Caption number {n}.", "language": "sq"}
        ).status_code
        for n in range(10)
    ]

    assert statuses == [200] * 10


def test_a_long_narration_minute_is_not_rate_limited(tmp_path: Path) -> None:
    # 40 captions in one minute: above the old 30/min cap, typical for a replayed long section.
    client = make_client(tts_cache_dir=tmp_path)
    client.app.state.tts_provider = FakeTtsProvider()

    statuses = [
        client.post(
            "/api/tts/synthesize", json={"text": f"Caption number {n}.", "language": "sq"}
        ).status_code
        for n in range(40)
    ]

    assert 429 not in statuses


@pytest.mark.anyio
async def test_synthesis_does_not_block_other_requests(tmp_path: Path) -> None:
    app = make_client(tts_cache_dir=tmp_path).app
    provider = SlowTtsProvider(delay=1.0)
    app.state.tts_provider = provider
    finished: dict[str, float] = {}

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        start = time.perf_counter()

        async def synthesize() -> None:
            response = await client.post(
                "/api/tts/synthesize", json={"text": "A slow caption.", "language": "sq"}
            )
            assert response.status_code == 200
            finished["synthesize"] = time.perf_counter() - start

        async def health() -> None:
            await anyio.sleep(0.1)  # let the synthesis start first
            response = await client.get("/api/health")
            assert response.status_code == 200
            finished["health"] = time.perf_counter() - start

        async with anyio.create_task_group() as group:
            group.start_soon(synthesize)
            group.start_soon(health)

    # The health check answered while the one-second synthesis was still running.
    assert finished["health"] < 0.5 < finished["synthesize"]
    assert provider.threads and provider.threads[0] != threading.main_thread().name
