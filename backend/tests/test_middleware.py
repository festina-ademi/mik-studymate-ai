from collections.abc import Iterator

from fastapi import Request
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.middleware import SlidingWindowLimiter

ORIGIN = "http://localhost:5173"


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def make_client(**overrides: object) -> TestClient:
    settings = Settings(_env_file=None, database_url="sqlite://", llm_provider="mock", **overrides)
    app = create_app(settings)

    @app.get("/api/_test/ping")
    async def ping() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/api/_test/size")
    async def size(request: Request) -> dict[str, int]:
        return {"bytes": len(await request.body())}

    return TestClient(app)


# --- limiter ----------------------------------------------------------------------------


def test_limiter_allows_up_to_the_limit_then_reports_when_to_retry() -> None:
    clock = FakeClock()
    limiter = SlidingWindowLimiter(3, 60.0, clock=clock)

    assert [limiter.check("a") for _ in range(3)] == [None, None, None]
    clock.now += 10
    assert limiter.check("a") == 50.0


def test_limiter_window_slides() -> None:
    clock = FakeClock()
    limiter = SlidingWindowLimiter(2, 60.0, clock=clock)

    assert limiter.check("a") is None  # t=0
    clock.now += 30
    assert limiter.check("a") is None  # t=30
    assert limiter.check("a") == 30.0  # blocked until the t=0 call ages out
    clock.now += 31
    assert limiter.check("a") is None  # t=61: the first call has left the window
    assert limiter.check("a") == 29.0  # t=30 and t=61 are still inside


def test_limiter_tracks_keys_independently() -> None:
    limiter = SlidingWindowLimiter(1, 60.0, clock=FakeClock())

    assert limiter.check("a") is None
    assert limiter.check("b") is None
    assert limiter.check("a") is not None


def test_limiter_memory_stays_bounded() -> None:
    clock = FakeClock()
    limiter = SlidingWindowLimiter(5, 60.0, clock=clock, max_keys=50)

    for index in range(500):
        limiter.check(f"client-{index}")

    assert len(limiter._hits) <= 50  # noqa: SLF001


# --- rate limiting in the app -----------------------------------------------------------


def test_requests_over_the_limit_get_429_in_the_standard_format() -> None:
    client = make_client(rate_limit_requests=3, rate_limit_window_seconds=60)

    statuses = [client.get("/api/_test/ping").status_code for _ in range(5)]
    blocked = client.get("/api/_test/ping")

    assert statuses == [200, 200, 200, 429, 429]
    assert blocked.json() == {
        "error": {
            "code": "rate_limited",
            "message_key": "errors.rate_limited",
            "details": {"retry_after_seconds": int(blocked.headers["retry-after"])},
        }
    }
    assert 1 <= int(blocked.headers["retry-after"]) <= 60


def test_the_health_check_and_preflight_requests_are_never_limited() -> None:
    client = make_client(rate_limit_requests=1)

    client.get("/api/_test/ping")
    assert client.get("/api/_test/ping").status_code == 429

    assert [client.get("/api/health").status_code for _ in range(5)] == [200] * 5
    preflight = {"Origin": ORIGIN, "Access-Control-Request-Method": "GET"}
    assert [client.options("/api/_test/ping", headers=preflight).status_code for _ in range(5)] == [
        200
    ] * 5


def test_429_responses_still_carry_cors_headers() -> None:
    client = make_client(rate_limit_requests=1)

    client.get("/api/_test/ping")
    blocked = client.get("/api/_test/ping", headers={"Origin": ORIGIN})

    assert blocked.status_code == 429
    assert blocked.headers["access-control-allow-origin"] == ORIGIN


def test_rate_limiting_can_be_disabled() -> None:
    client = make_client(rate_limit_enabled=False, rate_limit_requests=1)

    assert [client.get("/api/_test/ping").status_code for _ in range(5)] == [200] * 5


def test_path_limiters_are_wired_up_for_the_real_tts_synthesize_endpoint() -> None:
    """Integration test: `app.main.create_app` actually applies a tighter limit to
    `/api/tts/synthesize` than the general one, on top of it rather than instead of it."""
    from app.api.tts import TTS_SYNTHESIZE_RATE_LIMIT_PER_MINUTE

    client = make_client(
        rate_limit_requests=1000,  # generous, so only the path-specific limit can trip here
        feature_server_tts=False,  # synthesize fast-fails with 503 before any model is touched
    )

    payload = {"text": "Hello.", "language": "en"}
    statuses = [
        client.post("/api/tts/synthesize", json=payload).status_code
        for _ in range(TTS_SYNTHESIZE_RATE_LIMIT_PER_MINUTE + 1)
    ]

    assert statuses[:-1] == [503] * TTS_SYNTHESIZE_RATE_LIMIT_PER_MINUTE
    assert statuses[-1] == 429
    # A different, unrelated route is still governed only by the general (much higher) limit.
    assert client.get("/api/_test/ping").status_code == 200


# --- request size -----------------------------------------------------------------------


def test_a_small_body_passes() -> None:
    client = make_client()

    response = client.post("/api/_test/size", content=b"x" * 100)

    assert response.json() == {"bytes": 100}


def test_a_body_over_the_limit_is_rejected_from_its_declared_length() -> None:
    client = make_client(max_json_body_kb=1)

    response = client.post("/api/_test/size", content=b"x" * 2048, headers={"Origin": ORIGIN})

    assert response.status_code == 413
    assert response.json() == {
        "error": {
            "code": "payload_too_large",
            "message_key": "errors.payload_too_large",
            "details": {"max_bytes": 1024},
        }
    }
    assert response.headers["access-control-allow-origin"] == ORIGIN


def test_a_chunked_body_without_content_length_is_still_limited() -> None:
    client = make_client(max_json_body_kb=1)

    def chunks() -> Iterator[bytes]:
        for _ in range(10):
            yield b"x" * 512

    response = client.post("/api/_test/size", content=chunks())

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


def test_uploads_get_a_larger_limit_than_json_bodies() -> None:
    client = make_client(max_json_body_kb=1, max_upload_mb=1)
    multipart = {"content-type": "multipart/form-data; boundary=x"}

    ok = client.post("/api/_test/size", content=b"x" * 200_000, headers=multipart)
    too_big = client.post("/api/_test/size", content=b"x" * (3 * 1024 * 1024), headers=multipart)
    json_too_big = client.post("/api/_test/size", content=b"x" * 200_000)

    assert ok.status_code == 200
    assert too_big.status_code == 413
    assert json_too_big.status_code == 413
