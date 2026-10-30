"""Tests for admin authentication: password check, session lifecycle, brute-force protection."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest

from app.config import Settings
from app.db.session import SessionFactory
from app.errors import AppError
from app.study.admin_auth import (
    check_login_rate_limit,
    create_session,
    destroy_session,
    get_valid_session,
    require_admin_session,
    reset_login_limiter_for_tests,
    verify_password,
)
from app.study.models import AdminSession


@pytest.fixture(autouse=True)
def _fresh_login_limiter() -> Iterator[None]:
    reset_login_limiter_for_tests()
    yield
    reset_login_limiter_for_tests()


def _settings(**overrides: object) -> Settings:
    return Settings(_env_file=None, database_url="sqlite://", llm_provider="mock", **overrides)


def test_verify_password_accepts_the_configured_password() -> None:
    settings = _settings(admin_password="correct-horse")
    assert verify_password(settings, "correct-horse") is True


def test_verify_password_rejects_a_wrong_password() -> None:
    settings = _settings(admin_password="correct-horse")
    assert verify_password(settings, "wrong") is False


def test_verify_password_raises_when_no_password_is_configured() -> None:
    settings = _settings()
    with pytest.raises(AppError) as excinfo:
        verify_password(settings, "anything")
    assert excinfo.value.status_code == 503
    assert excinfo.value.code == "admin_disabled"


def test_check_login_rate_limit_allows_attempts_under_the_limit() -> None:
    for _ in range(9):
        check_login_rate_limit()  # must not raise


def test_check_login_rate_limit_blocks_after_too_many_attempts() -> None:
    for _ in range(10):
        check_login_rate_limit()
    with pytest.raises(AppError) as excinfo:
        check_login_rate_limit()
    assert excinfo.value.status_code == 429
    assert "retry_after_seconds" in excinfo.value.details


def test_session_lifecycle_create_validate_destroy(session_factory: SessionFactory) -> None:
    settings = _settings(admin_password="secret", admin_session_hours=8)
    with session_factory() as session:
        record = create_session(session, settings)
        assert record.token

        valid = get_valid_session(session, record.token)
        assert valid is not None
        assert valid.token == record.token

        destroy_session(session, record.token)
        assert get_valid_session(session, record.token) is None


def test_get_valid_session_returns_none_for_an_unknown_token(
    session_factory: SessionFactory,
) -> None:
    with session_factory() as session:
        assert get_valid_session(session, "not-a-real-token") is None


def test_get_valid_session_returns_none_for_a_missing_token(
    session_factory: SessionFactory,
) -> None:
    with session_factory() as session:
        assert get_valid_session(session, None) is None
        assert get_valid_session(session, "") is None


def test_get_valid_session_expires_an_old_session(session_factory: SessionFactory) -> None:
    with session_factory() as session:
        session.add(
            AdminSession(token="expired-token", expires_at=datetime.now(UTC) - timedelta(hours=1))
        )
        session.commit()

        assert get_valid_session(session, "expired-token") is None
        # The expired row is cleaned up, not just ignored.
        assert session.get(AdminSession, "expired-token") is None


def test_require_admin_session_raises_unauthorized_without_a_valid_session(
    session_factory: SessionFactory,
) -> None:
    with session_factory() as session:
        with pytest.raises(AppError) as excinfo:
            require_admin_session(session, None)
        assert excinfo.value.status_code == 401


def test_require_admin_session_returns_the_record_when_valid(
    session_factory: SessionFactory,
) -> None:
    settings = _settings(admin_password="secret")
    with session_factory() as session:
        record = create_session(session, settings)
        found = require_admin_session(session, record.token)
        assert found.token == record.token


def test_destroy_session_on_an_unknown_token_is_a_no_op(session_factory: SessionFactory) -> None:
    with session_factory() as session:
        destroy_session(session, "does-not-exist")  # must not raise
        destroy_session(session, None)
