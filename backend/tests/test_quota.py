"""Tests for the daily quotas: day windows, ``QuotaMiddleware`` (AI calls and uploads), AI-call
counting at the provider, and ``GET /api/quota``."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.config import Settings
from app.db.models import UserQuotaUsage
from app.db.session import SessionFactory
from app.llm import MockProvider
from app.llm.usage import UsageTrackingProvider
from app.main import create_app
from app.middleware import QuotaMiddleware
from app.services.quota import (
    AI_CALL_ACTION,
    ANONYMOUS_CLIENT_ID,
    UPLOAD_ACTION,
    current_day,
    record_ai_call,
    resolve_client_id,
    resolve_timezone,
)

CODE = "def double(x):\n    return x * 2\n\nprint(double(3))\n"
TIRANA = ZoneInfo("Europe/Tirane")
CLIENT_A = {"X-Client-Id": "client-aaaa-1111", "X-Timezone": "Europe/Tirane"}
CLIENT_B = {"X-Client-Id": "client-bbbb-2222", "X-Timezone": "Europe/Tirane"}


def make_client(tmp_path: Path, *, ai_requests: int = 50, uploads: int = 5) -> TestClient:
    settings = Settings(
        _env_file=None,
        database_url="sqlite://",
        llm_provider="mock",
        embedding_provider="hash",
        chroma_dir=tmp_path / "chroma",
        rate_limit_enabled=False,
        quota_daily_gemini_requests=ai_requests,
        quota_daily_uploads=uploads,
    )
    return TestClient(create_app(settings))


def upload_code(client: TestClient, headers: dict[str, str] = CLIENT_A) -> str:
    response = client.post("/api/documents/code", json={"code": CODE}, headers=headers)
    assert response.status_code == 201, response.text
    return str(response.json()["document"]["id"])


def usage_count(client: TestClient, user_id: str, action: str) -> int:
    with client.app.state.session_factory() as session:
        statement = select(func.count(UserQuotaUsage.id)).where(
            UserQuotaUsage.user_id == user_id, UserQuotaUsage.action_type == action
        )
        return session.scalar(statement) or 0


def provider_calls(client: TestClient) -> int:
    """How many calls reached the mock model behind the app's wrapped provider."""
    provider = client.app.state.llm_provider
    while not isinstance(provider, MockProvider):
        provider = provider._inner
    return len(provider.calls)


def add_usage(client: TestClient, action: str, count: int, *, at: datetime | None = None) -> None:
    with client.app.state.session_factory() as session:
        for _ in range(count):
            row = UserQuotaUsage(user_id=CLIENT_A["X-Client-Id"], action_type=action)
            if at is not None:
                row.timestamp = at
            session.add(row)
        session.commit()


# --- day window ---------------------------------------------------------------------------


def test_current_day_uses_local_midnight() -> None:
    # 23:30 UTC on Oct 20 is already 01:30 on Oct 21 in Tirana (UTC+2 in summer time).
    day = current_day(TIRANA, now=datetime(2026, 10, 20, 23, 30, tzinfo=UTC))
    assert day.start == datetime(2026, 10, 20, 22, 0, tzinfo=UTC)
    assert day.reset_at.isoformat() == "2026-10-22T00:00:00+02:00"


def test_current_day_across_dst_change() -> None:
    # Clocks go back on Oct 25 2026, so that local day is 25 hours long.
    day = current_day(TIRANA, now=datetime(2026, 10, 25, 12, 0, tzinfo=UTC))
    assert day.reset_at.astimezone(UTC) - day.start == timedelta(hours=25)


def test_hours_remaining_rounds_up_and_is_at_least_one() -> None:
    now = datetime(2026, 10, 21, 18, 30, tzinfo=UTC)  # 20:30 in Tirana
    day = current_day(TIRANA, now=now)
    assert day.hours_remaining(now) == 4  # 3.5 hours until midnight
    assert day.hours_remaining(day.reset_at - timedelta(minutes=5)) == 1


def test_resolve_client_id_rejects_malformed_ids() -> None:
    assert resolve_client_id("client-aaaa-1111") == "client-aaaa-1111"
    assert resolve_client_id("study-P-7K2M") == "study-P-7K2M"
    assert resolve_client_id(None) == ANONYMOUS_CLIENT_ID
    assert resolve_client_id("short") == ANONYMOUS_CLIENT_ID
    assert resolve_client_id("bad id; drop table") == ANONYMOUS_CLIENT_ID


def test_resolve_timezone_falls_back_for_unknown_zones() -> None:
    assert resolve_timezone("Europe/Tirane") == TIRANA
    assert resolve_timezone("Not/AZone") is not None
    assert resolve_timezone("../../etc/passwd") is not None


# --- which requests are limited -----------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path", "expected"),
    [
        ("POST", "/api/documents", UPLOAD_ACTION),
        ("POST", "/api/documents/code", UPLOAD_ACTION),
        ("POST", "/api/documents/abc/summary", AI_CALL_ACTION),
        ("POST", "/api/documents/abc/explanation", AI_CALL_ACTION),
        ("POST", "/api/documents/abc/quiz", AI_CALL_ACTION),
        ("POST", "/api/documents/abc/tutor", AI_CALL_ACTION),
        ("POST", "/api/documents/abc/topics/Loops/reexplain", AI_CALL_ACTION),
        ("POST", "/api/documents/abc/explainer/plan", AI_CALL_ACTION),
        ("GET", "/api/documents/abc/explainer/sections/2", AI_CALL_ACTION),
        ("POST", "/api/quiz/17/answer", AI_CALL_ACTION),
        # Reading stored data, deleting, and Study Mode tests are never limited.
        ("GET", "/api/documents/abc", None),
        ("GET", "/api/documents/abc/tutor/history", None),
        ("DELETE", "/api/documents/abc", None),
        ("POST", "/api/study/participants/P-7K2M/test/immediate", None),
        ("GET", "/api/quota", None),
    ],
)
def test_limited_routes(
    method: str, path: str, expected: str | None, session_factory: SessionFactory
) -> None:
    middleware = QuotaMiddleware(
        app=lambda *_: None,  # type: ignore[arg-type,return-value]
        session_factory=session_factory,
        daily_ai_requests=50,
        daily_uploads=5,
    )
    assert middleware._action_for(method, path) == expected


def test_zero_limit_disables_that_quota(session_factory: SessionFactory) -> None:
    middleware = QuotaMiddleware(
        app=lambda *_: None,  # type: ignore[arg-type,return-value]
        session_factory=session_factory,
        daily_ai_requests=0,
        daily_uploads=5,
    )
    assert middleware._action_for("POST", "/api/documents/abc/summary") is None
    assert middleware._action_for("POST", "/api/documents") == UPLOAD_ACTION


# --- AI request quota ---------------------------------------------------------------------


def test_each_ai_call_is_recorded_for_the_client(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    document_id = upload_code(client)
    assert usage_count(client, CLIENT_A["X-Client-Id"], AI_CALL_ACTION) == 0

    response = client.post(f"/api/documents/{document_id}/summary", json={}, headers=CLIENT_A)

    assert response.status_code == 200
    calls = provider_calls(client)
    assert calls >= 1
    assert usage_count(client, CLIENT_A["X-Client-Id"], AI_CALL_ACTION) == calls
    assert usage_count(client, CLIENT_B["X-Client-Id"], AI_CALL_ACTION) == 0


def test_cached_results_do_not_count_as_ai_calls(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    document_id = upload_code(client)
    client.post(f"/api/documents/{document_id}/summary", json={}, headers=CLIENT_A)
    first_generation_calls = provider_calls(client)

    for _ in range(2):
        response = client.post(f"/api/documents/{document_id}/summary", json={}, headers=CLIENT_A)
        assert response.status_code == 200

    assert provider_calls(client) == first_generation_calls
    assert usage_count(client, CLIENT_A["X-Client-Id"], AI_CALL_ACTION) == first_generation_calls


def test_ai_request_beyond_quota_returns_429(tmp_path: Path) -> None:
    client = make_client(tmp_path, ai_requests=3)
    document_id = upload_code(client)
    add_usage(client, AI_CALL_ACTION, 3)

    response = client.post(
        f"/api/documents/{document_id}/tutor", json={"message": "Why?"}, headers=CLIENT_A
    )

    assert response.status_code == 429
    body = response.json()
    assert body["error"]["code"] == "quota_exceeded"
    assert body["error"]["message_key"] == "errors.quota_exceeded"
    details = body["error"]["details"]
    assert details == {
        "quota": AI_CALL_ACTION,
        "used": 3,
        "limit": 3,
        "reset_at": body["reset_at"],
        "hours_remaining": body["hours_remaining"],
    }
    reset_at = datetime.fromisoformat(body["reset_at"])
    assert (reset_at.hour, reset_at.minute, reset_at.second) == (0, 0, 0)
    assert reset_at.utcoffset() is not None
    assert 1 <= body["hours_remaining"] <= 25
    assert int(response.headers["Retry-After"]) > 0
    # The rejected request made no AI call.
    assert usage_count(client, CLIENT_A["X-Client-Id"], AI_CALL_ACTION) == 3


def test_requests_under_the_limit_pass(tmp_path: Path) -> None:
    client = make_client(tmp_path, ai_requests=3)
    document_id = upload_code(client)
    add_usage(client, AI_CALL_ACTION, 2)

    response = client.post(f"/api/documents/{document_id}/summary", json={}, headers=CLIENT_A)

    assert response.status_code == 200


def test_ai_quota_is_tracked_per_client(tmp_path: Path) -> None:
    client = make_client(tmp_path, ai_requests=1)
    document_id = upload_code(client)
    add_usage(client, AI_CALL_ACTION, 1)

    blocked = client.post(f"/api/documents/{document_id}/summary", json={}, headers=CLIENT_A)
    allowed = client.post(f"/api/documents/{document_id}/summary", json={}, headers=CLIENT_B)

    assert blocked.status_code == 429
    assert allowed.status_code == 200


def test_usage_resets_at_local_midnight_and_old_rows_are_kept(tmp_path: Path) -> None:
    client = make_client(tmp_path, ai_requests=1)
    document_id = upload_code(client)
    yesterday = current_day(TIRANA).start - timedelta(minutes=1)
    add_usage(client, AI_CALL_ACTION, 5, at=yesterday)

    response = client.post(f"/api/documents/{document_id}/summary", json={}, headers=CLIENT_A)

    assert response.status_code == 200
    # Yesterday's rows still exist (kept for analysis) next to today's new one.
    assert usage_count(client, CLIENT_A["X-Client-Id"], AI_CALL_ACTION) == 5 + provider_calls(
        client
    )


def test_uploads_do_not_use_the_ai_quota(tmp_path: Path) -> None:
    client = make_client(tmp_path, ai_requests=1)
    add_usage(client, AI_CALL_ACTION, 1)
    upload_code(client)


# --- upload quota -------------------------------------------------------------------------


def test_upload_beyond_quota_returns_429(tmp_path: Path) -> None:
    client = make_client(tmp_path, uploads=2)
    upload_code(client)
    upload_code(client)

    response = client.post(
        "/api/documents",
        files={"files": ("notes.py", CODE.encode(), "text/x-python")},
        headers=CLIENT_A,
    )

    assert response.status_code == 429
    body = response.json()
    assert body["error"]["code"] == "quota_exceeded"
    assert body["error"]["details"]["quota"] == UPLOAD_ACTION
    assert body["error"]["details"]["limit"] == 2


def test_failed_uploads_do_not_count(tmp_path: Path) -> None:
    client = make_client(tmp_path, uploads=1)
    rejected = client.post("/api/documents/code", json={"code": "x"}, headers=CLIENT_A)
    assert rejected.status_code == 400
    upload_code(client)


# --- provider-level counting --------------------------------------------------------------


@pytest.mark.anyio
async def test_tracking_provider_counts_each_successful_call() -> None:
    calls: list[None] = []
    provider = UsageTrackingProvider(MockProvider(), lambda: calls.append(None))

    await provider.generate("one")
    async for _ in provider.stream("two"):
        pass

    assert len(calls) == 2


def test_record_ai_call_outside_a_request_is_a_no_op() -> None:
    record_ai_call()  # must not raise without a bound client


# --- GET /api/quota -----------------------------------------------------------------------


def test_quota_endpoint_reports_both_quotas(tmp_path: Path) -> None:
    client = make_client(tmp_path, ai_requests=50, uploads=5)
    document_id = upload_code(client)
    client.post(f"/api/documents/{document_id}/summary", json={}, headers=CLIENT_A)

    body = client.get("/api/quota", headers=CLIENT_A).json()

    assert body["ai_requests"]["used"] == provider_calls(client)
    assert body["ai_requests"]["limit"] == 50
    assert body["uploads"]["used"] == 1
    assert body["uploads"]["limit"] == 5
    assert datetime.fromisoformat(body["ai_requests"]["reset_at"]) > datetime.now(UTC)
    other = client.get("/api/quota", headers=CLIENT_B).json()
    assert other["ai_requests"]["used"] == 0
