"""Admin authentication: password check, opaque session token, brute-force protection.

The session cookie carries a random, high-entropy token (``secrets.token_urlsafe``) that is
looked up in the ``admin_sessions`` table — the same "opaque session id" pattern most web
frameworks use, which needs no signing since the token encodes nothing by itself. There is
effectively one admin (a researcher), so brute-force protection is a single global sliding
window rather than a per-account one: it exists to blunt an automated password-guessing
script, not to rate-limit legitimate concurrent staff.
"""

from __future__ import annotations

import hmac
import secrets
from datetime import timedelta

from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import as_utc, utc_now
from app.errors import AppError
from app.middleware import SlidingWindowLimiter
from app.study.models import AdminSession

ADMIN_SESSION_COOKIE = "studymate_admin_session"
_TOKEN_BYTES = 32
_LOGIN_ATTEMPT_LIMIT = 10
_LOGIN_ATTEMPT_WINDOW_SECONDS = 15 * 60

_login_limiter = SlidingWindowLimiter(_LOGIN_ATTEMPT_LIMIT, _LOGIN_ATTEMPT_WINDOW_SECONDS)


def reset_login_limiter_for_tests() -> None:
    """Replace the module-level limiter with a fresh one; test-only, keeps tests isolated."""
    global _login_limiter  # noqa: PLW0603 - the simplest way to reset shared limiter state in tests
    _login_limiter = SlidingWindowLimiter(_LOGIN_ATTEMPT_LIMIT, _LOGIN_ATTEMPT_WINDOW_SECONDS)


def check_login_rate_limit() -> None:
    """Raise ``AppError(429, ...)`` once too many login attempts have been made recently."""
    retry_after = _login_limiter.check("admin-login")
    if retry_after is not None:
        raise AppError(
            429, "rate_limited", details={"retry_after_seconds": round(retry_after) or 1}
        )


def verify_password(settings: Settings, password: str) -> bool:
    """Constant-time comparison against the configured admin password.

    Raises ``AppError(503, "admin_disabled")`` when no password is configured at all — the
    admin area is intentionally unreachable until an operator sets one.
    """
    if settings.admin_password is None:
        raise AppError(503, "admin_disabled")
    expected = settings.admin_password.get_secret_value()
    return hmac.compare_digest(password, expected)


def create_session(session: Session, settings: Settings) -> AdminSession:
    """Start a new admin session and persist it."""
    token = secrets.token_urlsafe(_TOKEN_BYTES)
    record = AdminSession(
        token=token, expires_at=utc_now() + timedelta(hours=settings.admin_session_hours)
    )
    session.add(record)
    session.commit()
    return record


def get_valid_session(session: Session, token: str | None) -> AdminSession | None:
    """The live session for ``token``, or ``None`` if missing, unknown or expired.

    An expired session row is deleted on the way out, so the table does not grow unbounded.
    """
    if not token:
        return None
    record = session.get(AdminSession, token)
    if record is None:
        return None
    if as_utc(record.expires_at) < utc_now():
        session.delete(record)
        session.commit()
        return None
    return record


def destroy_session(session: Session, token: str | None) -> None:
    """End one admin session (logout); a no-op if it does not exist."""
    if not token:
        return
    record = session.get(AdminSession, token)
    if record is not None:
        session.delete(record)
        session.commit()


def require_admin_session(session: Session, token: str | None) -> AdminSession:
    """The live session for ``token``, or raise ``AppError(401, "unauthorized")``."""
    record = get_valid_session(session, token)
    if record is None:
        raise AppError(401, "unauthorized")
    return record
