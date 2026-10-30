"""Daily per-client quotas: AI (LLM) calls and uploads.

A "day" is the client's local calendar day: usage counts from the client's last local midnight
and resets at the next one. The client identifies itself with a random id it generated (there
are no accounts) and reports its IANA time zone; both are untrusted, so these are fair-use limits
that keep the deployment within the AI provider's free tier, not a security boundary.

Usage rows are never deleted automatically; they are kept for usage analysis.
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import UserQuotaUsage, utc_now
from app.db.session import SessionFactory

UPLOAD_ACTION = "upload"
# Counted for every call to the configured LLM provider (Gemini by default), whatever it is.
AI_CALL_ACTION = "gemini_call"
CLIENT_ID_HEADER = "x-client-id"
TIMEZONE_HEADER = "x-timezone"
# Used when the client sends no (or an invalid) id: everyone without one shares this bucket.
ANONYMOUS_CLIENT_ID = "anonymous"

_CLIENT_ID_PATTERN = re.compile(r"^[A-Za-z0-9-]{8,64}$")


class QuotaStatus(BaseModel):
    """A client's usage of one daily quota."""

    used: int
    limit: int
    reset_at: datetime


class QuotaOverview(BaseModel):
    """Both daily quotas of a client, as returned by ``GET /api/quota``."""

    ai_requests: QuotaStatus
    uploads: QuotaStatus


@dataclass(frozen=True)
class DayWindow:
    """The current local day of a client, as UTC instants."""

    start: datetime
    reset_at: datetime

    def hours_remaining(self, now: datetime | None = None) -> int:
        """Whole hours until the reset, rounded up and at least 1."""
        seconds = (self.reset_at - (now or utc_now())).total_seconds()
        return max(1, math.ceil(seconds / 3600))


@dataclass(frozen=True)
class QuotaContext:
    """Who the current request's AI calls are counted for."""

    user_id: str
    session_factory: SessionFactory


_current_context: ContextVar[QuotaContext | None] = ContextVar("quota_context", default=None)


def resolve_client_id(raw: str | None) -> str:
    """The client's id if it is well-formed, otherwise the shared anonymous bucket."""
    if raw and _CLIENT_ID_PATTERN.fullmatch(raw):
        return raw
    return ANONYMOUS_CLIENT_ID


def resolve_timezone(raw: str | None) -> tzinfo:
    """The client's IANA time zone if valid, otherwise the server's local time zone."""
    if raw:
        try:
            return ZoneInfo(raw)
        except (ZoneInfoNotFoundError, ValueError):
            pass
    local = datetime.now().astimezone().tzinfo
    return local if local is not None else UTC


def current_day(zone: tzinfo, now: datetime | None = None) -> DayWindow:
    """The local calendar day containing ``now`` in ``zone``: [last midnight, next midnight)."""
    local_now = (now or utc_now()).astimezone(zone)
    start = datetime.combine(local_now.date(), time.min, tzinfo=zone)
    reset_at = datetime.combine(local_now.date() + timedelta(days=1), time.min, tzinfo=zone)
    return DayWindow(start=start.astimezone(UTC), reset_at=reset_at)


def count_usage(session: Session, user_id: str, action_type: str, since: datetime) -> int:
    """How many ``action_type`` actions ``user_id`` performed at or after ``since``."""
    statement = select(func.count(UserQuotaUsage.id)).where(
        UserQuotaUsage.user_id == user_id,
        UserQuotaUsage.action_type == action_type,
        UserQuotaUsage.timestamp >= since,
    )
    return session.scalar(statement) or 0


def record_usage(session: Session, user_id: str, action_type: str) -> None:
    """Count one ``action_type`` action for ``user_id`` now."""
    session.add(UserQuotaUsage(user_id=user_id, action_type=action_type))
    session.commit()


def get_quota_status(
    session: Session, user_id: str, zone: tzinfo, limit: int, action_type: str
) -> QuotaStatus:
    """``user_id``'s usage of the daily ``action_type`` quota in their local day."""
    day = current_day(zone)
    used = count_usage(session, user_id, action_type, day.start)
    return QuotaStatus(used=used, limit=limit, reset_at=day.reset_at)


@contextmanager
def quota_context(context: QuotaContext) -> Iterator[None]:
    """Count AI calls made while this block runs (i.e. during one request) for ``context``."""
    token = _current_context.set(context)
    try:
        yield
    finally:
        _current_context.reset(token)


def record_ai_call() -> None:
    """Count one AI call for the current request's client; a no-op outside a request."""
    context = _current_context.get()
    if context is None:
        return
    with context.session_factory() as session:
        record_usage(session, context.user_id, AI_CALL_ACTION)
