"""Tests for the study data export (CSV/JSON)."""

from __future__ import annotations

import csv
import io
import json
from datetime import UTC, datetime

from app.domain import Language
from app.study.export import build_export_rows, rows_to_csv, rows_to_json
from app.study.models import (
    Participant,
    QuestionnaireResponse,
    StudyGroup,
    StudyPhase,
    TestSubmission,
    UsageEvent,
    UsageEventType,
)


def _participant(**overrides: object) -> Participant:
    defaults: dict[str, object] = dict(
        id="p1",
        code="P-7K2M",
        group=StudyGroup.EXPERIMENTAL,
        language=Language.EN,
        withdrawn=False,
        consented_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    defaults.update(overrides)
    return Participant(**defaults)


def test_build_export_rows_flattens_a_fully_completed_participant() -> None:
    participant = _participant()
    participant.submissions = [
        TestSubmission(
            phase=StudyPhase.IMMEDIATE,
            test_id="t1",
            answers=[],
            total_score=8.0,
            max_possible_score=10.0,
            duration_seconds=120.0,
        ),
        TestSubmission(
            phase=StudyPhase.RETENTION,
            test_id="t1",
            answers=[],
            total_score=6.0,
            max_possible_score=10.0,
            duration_seconds=90.0,
        ),
    ]
    participant.questionnaire = QuestionnaireResponse(
        perceived_usefulness=4, ease_of_understanding=5, open_comment="Helpful!"
    )
    participant.usage_events = [
        UsageEvent(event_type=UsageEventType.TAB_VIEW, detail="summary"),
        UsageEvent(event_type=UsageEventType.TAB_VIEW, detail="quiz"),
        UsageEvent(event_type=UsageEventType.QUIZ_ATTEMPT, detail=None),
    ]

    rows = build_export_rows([participant])

    assert len(rows) == 1
    row = rows[0]
    assert row.code == "P-7K2M"
    assert row.group == "experimental"
    assert row.language == "en"
    assert row.withdrawn is False
    assert row.immediate_score == 8.0
    assert row.immediate_max_score == 10.0
    assert row.immediate_duration_seconds == 120.0
    assert row.retention_score == 6.0
    assert row.retention_max_score == 10.0
    assert row.perceived_usefulness == 4
    assert row.ease_of_understanding == 5
    assert row.open_comment == "Helpful!"
    assert row.tab_view_count == 2
    assert row.quiz_attempt_count == 1


def test_build_export_rows_handles_a_participant_with_nothing_submitted_yet() -> None:
    participant = _participant(code="P-9999")
    participant.submissions = []
    participant.questionnaire = None
    participant.usage_events = []

    rows = build_export_rows([participant])

    row = rows[0]
    assert row.immediate_score is None
    assert row.retention_score is None
    assert row.perceived_usefulness is None
    assert row.tab_view_count == 0
    assert row.quiz_attempt_count == 0


def test_build_export_rows_includes_withdrawn_participants_with_no_score_fields() -> None:
    participant = _participant(code="P-0000", withdrawn=True)
    participant.submissions = []
    participant.questionnaire = None
    participant.usage_events = []

    rows = build_export_rows([participant])

    assert rows[0].withdrawn is True
    assert rows[0].immediate_score is None


def test_csv_export_starts_with_a_utf8_bom() -> None:
    participant = _participant()
    participant.submissions = []
    participant.questionnaire = None
    participant.usage_events = []

    content = rows_to_csv(build_export_rows([participant]))

    assert content.startswith(b"\xef\xbb\xbf")


def test_csv_export_has_one_data_row_per_participant_and_the_expected_columns() -> None:
    participants = [_participant(code="P-AAAA"), _participant(code="P-BBBB", id="p2")]
    for participant in participants:
        participant.submissions = []
        participant.questionnaire = None
        participant.usage_events = []

    content = rows_to_csv(build_export_rows(participants))
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)

    assert len(rows) == 2
    assert {row["code"] for row in rows} == {"P-AAAA", "P-BBBB"}
    assert "immediate_score" in reader.fieldnames
    assert "retention_score" in reader.fieldnames
    assert "tab_view_count" in reader.fieldnames


def test_csv_export_round_trips_non_ascii_text_correctly() -> None:
    participant = _participant()
    participant.submissions = []
    participant.questionnaire = QuestionnaireResponse(
        perceived_usefulness=5,
        ease_of_understanding=5,
        open_comment="Shumë e dobishme, faleminderit!",
    )
    participant.usage_events = []

    content = rows_to_csv(build_export_rows([participant]))
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    row = next(reader)

    assert row["open_comment"] == "Shumë e dobishme, faleminderit!"


def test_json_export_is_a_list_of_objects_with_ascii_disabled() -> None:
    participant = _participant()
    participant.submissions = []
    participant.questionnaire = QuestionnaireResponse(
        perceived_usefulness=3, ease_of_understanding=3, open_comment="Kërkim binar"
    )
    participant.usage_events = []

    text = rows_to_json(build_export_rows([participant]))
    parsed = json.loads(text)

    assert isinstance(parsed, list)
    assert parsed[0]["code"] == "P-7K2M"
    assert parsed[0]["open_comment"] == "Kërkim binar"
    assert "Kërkim binar" in text  # not \u-escaped
