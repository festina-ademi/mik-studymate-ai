"""CSV/JSON export of Study Mode results, for analysis in SPSS, Excel or R.

One row per participant (including withdrawn ones, whose score fields are simply empty, so
attrition is visible in the export too). No personal data is ever included — only the
participant's own anonymous code, group, language, scores, durations, questionnaire answers
and usage counts.
"""

from __future__ import annotations

import csv
import io
import json
from dataclasses import asdict, dataclass, fields

from app.study.models import Participant, StudyPhase, UsageEventType

_UTF8_BOM = b"\xef\xbb\xbf"


@dataclass(frozen=True)
class ParticipantExportRow:
    """One participant's exported record."""

    code: str
    group: str
    language: str
    consented_at: str
    withdrawn: bool
    immediate_score: float | None
    immediate_max_score: float | None
    immediate_duration_seconds: float | None
    retention_score: float | None
    retention_max_score: float | None
    retention_duration_seconds: float | None
    perceived_usefulness: int | None
    ease_of_understanding: int | None
    open_comment: str | None
    tab_view_count: int
    quiz_attempt_count: int


def _submission(participant: Participant, phase: StudyPhase):  # noqa: ANN202 - local helper
    return next((s for s in participant.submissions if s.phase == phase), None)


def build_export_rows(participants: list[Participant]) -> list[ParticipantExportRow]:
    """Flatten each participant (and their related rows) into one export row."""
    rows = []
    for participant in participants:
        immediate = _submission(participant, StudyPhase.IMMEDIATE)
        retention = _submission(participant, StudyPhase.RETENTION)
        questionnaire = participant.questionnaire
        tab_views = sum(
            1 for event in participant.usage_events if event.event_type == UsageEventType.TAB_VIEW
        )
        quiz_attempts = sum(
            1
            for event in participant.usage_events
            if event.event_type == UsageEventType.QUIZ_ATTEMPT
        )
        rows.append(
            ParticipantExportRow(
                code=participant.code,
                group=participant.group.value,
                language=participant.language.value,
                consented_at=participant.consented_at.isoformat(),
                withdrawn=participant.withdrawn,
                immediate_score=immediate.total_score if immediate else None,
                immediate_max_score=immediate.max_possible_score if immediate else None,
                immediate_duration_seconds=immediate.duration_seconds if immediate else None,
                retention_score=retention.total_score if retention else None,
                retention_max_score=retention.max_possible_score if retention else None,
                retention_duration_seconds=retention.duration_seconds if retention else None,
                perceived_usefulness=(
                    questionnaire.perceived_usefulness if questionnaire else None
                ),
                ease_of_understanding=(
                    questionnaire.ease_of_understanding if questionnaire else None
                ),
                open_comment=questionnaire.open_comment if questionnaire else None,
                tab_view_count=tab_views,
                quiz_attempt_count=quiz_attempts,
            )
        )
    return rows


def rows_to_csv(rows: list[ParticipantExportRow]) -> bytes:
    """UTF-8 with a BOM, so Excel (including on Windows) opens accented text correctly."""
    buffer = io.StringIO()
    fieldnames = [field.name for field in fields(ParticipantExportRow)]
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, lineterminator="\r\n")
    writer.writeheader()
    for row in rows:
        writer.writerow(asdict(row))
    return _UTF8_BOM + buffer.getvalue().encode("utf-8")


def rows_to_json(rows: list[ParticipantExportRow]) -> str:
    """Pretty-printed JSON array of export rows, UTF-8, no ASCII-escaping."""
    return json.dumps([asdict(row) for row in rows], ensure_ascii=False, indent=2)
