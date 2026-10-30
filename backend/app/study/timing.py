"""Server-authoritative timing: the study session timer and the retention-test unlock delay.

Both are computed on the server from stored timestamps, never trusted from the client, so a
participant cannot start their retention test early (or claim a longer session) by tampering
with their browser clock.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from app.config import Settings
from app.db.models import as_utc, utc_now


def retention_delay(settings: Settings) -> timedelta:
    """The delay between the immediate test and the retention test unlocking.

    ``study_retention_delay_dev_minutes`` (unset by default) overrides the real
    ``study_retention_delay_days`` delay with a short, minutes-scale one, purely so the full
    return-and-retest flow can be exercised locally without waiting a week. It must never be
    set in a real study deployment.
    """
    if settings.study_retention_delay_dev_minutes is not None:
        return timedelta(minutes=settings.study_retention_delay_dev_minutes)
    return timedelta(days=settings.study_retention_delay_days)


def retention_unlock_at(immediate_submitted_at: datetime, settings: Settings) -> datetime:
    """The moment the retention test becomes available for one participant."""
    return as_utc(immediate_submitted_at) + retention_delay(settings)


@dataclass(frozen=True)
class TimerStatus:
    """The study session timer's current state, as the server sees it."""

    started: bool
    duration_seconds: int | None
    started_at: datetime | None
    ends_at: datetime | None
    remaining_seconds: float | None
    expired: bool


def timer_status(*, started_at: datetime | None, duration_seconds: int | None) -> TimerStatus:
    """The current status of a participant's study timer."""
    if started_at is None or duration_seconds is None:
        return TimerStatus(
            started=False,
            duration_seconds=None,
            started_at=None,
            ends_at=None,
            remaining_seconds=None,
            expired=False,
        )
    ends_at = as_utc(started_at) + timedelta(seconds=duration_seconds)
    remaining = (ends_at - utc_now()).total_seconds()
    return TimerStatus(
        started=True,
        duration_seconds=duration_seconds,
        started_at=as_utc(started_at),
        ends_at=ends_at,
        remaining_seconds=max(0.0, remaining),
        expired=remaining <= 0,
    )
