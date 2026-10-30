"""End-to-end tests for the Study Mode participant and admin APIs."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings
from app.db.models import ContentType, Document, SourceFormat
from app.db.session import SessionFactory
from app.main import create_app
from app.rag.embeddings import HashingEmbeddingProvider
from app.rag.store import ChromaVectorStore
from app.study import service
from app.study.admin_auth import reset_login_limiter_for_tests
from app.study.models import Participant, StudyGroup, StudyMaterial, StudyTest, TestSubmission


@pytest.fixture(autouse=True)
def _fresh_login_limiter() -> Iterator[None]:
    # Each test in this file logs in as admin at least once; the login rate limiter is a
    # process-wide singleton, so without resetting it between tests, the later tests in this
    # file would start failing with 429s from the earlier ones' attempts.
    reset_login_limiter_for_tests()
    yield
    reset_login_limiter_for_tests()


TEST_JSON = {
    "name": "Sample Test",
    "items": [
        {
            "kind": "multiple_choice",
            "topic": "Sorting",
            "question": {"en": "Which operation orders values?", "sq": "Cili operacion rendit?"},
            "options": {
                "en": ["Sort", "Copy", "Delete", "Move"],
                "sq": ["Rendit", "Kopjo", "Fshi", "Zhvendos"],
            },
            "correct_answer": {"en": "Sort", "sq": "Rendit"},
            "max_score": 1.0,
        },
        {
            "kind": "short_answer",
            "topic": "Searching",
            "question": {
                "en": "Explain why binary search needs sorted data.",
                "sq": "Shpjego pse kerkimi binar ka nevoje per te dhena te renditura.",
            },
            "correct_answer": {
                "en": "It halves the search range each step.",
                "sq": "Pergjysmon intervalin e kerkimit ne cdo hap.",
            },
            "rubric_keywords": {
                "en": ["sorted", "half"],
                "sq": ["renditura", "pergjysmon"],
            },
            "max_score": 2.0,
        },
    ],
}


def make_client(tmp_path: Path, **settings_overrides: object) -> TestClient:
    settings = Settings(
        _env_file=None,
        database_url="sqlite://",
        llm_provider="mock",
        **settings_overrides,
    )
    app = create_app(settings)
    app.state.embedding_provider = HashingEmbeddingProvider()
    app.state.vector_store = ChromaVectorStore(tmp_path / "chroma")
    return TestClient(app)


def admin_login(client: TestClient, password: str = "secret") -> None:
    response = client.post("/api/admin/login", json={"password": password})
    assert response.status_code == 200, response.text


def setup_active_material_and_test(client: TestClient) -> None:
    """Log in, import and activate a material and a test, ready for participants."""
    admin_login(client)
    test_response = client.post("/api/admin/tests", json=TEST_JSON)
    assert test_response.status_code == 201, test_response.text
    test_id = test_response.json()["id"]
    activate_test = client.post(f"/api/admin/tests/{test_id}/activate")
    assert activate_test.status_code == 200

    material_response = client.post(
        "/api/admin/materials",
        data={"name": "Week 1"},
        files=[
            (
                "files",
                (
                    "lecture.py",
                    b"def binary_search(values, target):\n    return -1\n",
                    "text/plain",
                ),
            )
        ],
    )
    assert material_response.status_code == 201, material_response.text
    material_id = material_response.json()["id"]
    activate_material = client.post(f"/api/admin/materials/{material_id}/activate")
    assert activate_material.status_code == 200


def create_participant(client: TestClient, language: str = "en") -> dict:
    response = client.post("/api/study/participants", json={"language": language, "consent": True})
    assert response.status_code == 200, response.text
    return response.json()


# --- participant creation -------------------------------------------------------------------


def test_creating_a_participant_without_configured_material_fails_clearly(tmp_path: Path) -> None:
    client = make_client(tmp_path, admin_password="secret")
    response = client.post("/api/study/participants", json={"language": "en", "consent": True})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "study_not_configured"


def test_creating_a_participant_without_consent_is_rejected(tmp_path: Path) -> None:
    client = make_client(tmp_path, admin_password="secret")
    setup_active_material_and_test(client)

    response = client.post("/api/study/participants", json={"language": "en", "consent": False})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "consent_required"


def test_creating_a_participant_returns_a_code_group_and_material(tmp_path: Path) -> None:
    client = make_client(tmp_path, admin_password="secret")
    setup_active_material_and_test(client)

    participant = create_participant(client)

    assert participant["code"].startswith("P-")
    assert participant["group"] in {"experimental", "control"}
    assert participant["language"] == "en"
    assert participant["document_id"]
    assert participant["material_name"] == "Week 1"
    assert participant["withdrawn"] is False
    assert participant["immediate_submitted"] is False


def test_fetching_a_participant_by_an_unknown_code_404s(tmp_path: Path) -> None:
    client = make_client(tmp_path, admin_password="secret")
    setup_active_material_and_test(client)

    response = client.get("/api/study/participants/P-0000")

    assert response.status_code == 404


# --- timer -----------------------------------------------------------------------------------


def test_timer_starts_once_and_reports_remaining_time(tmp_path: Path) -> None:
    client = make_client(tmp_path, admin_password="secret", study_session_minutes=20)
    setup_active_material_and_test(client)
    code = create_participant(client)["code"]

    start = client.post(f"/api/study/participants/{code}/timer/start")
    assert start.status_code == 200
    body = start.json()
    assert body["started"] is True
    assert body["duration_seconds"] == 20 * 60
    assert body["remaining_seconds"] == body["remaining_seconds"]  # not NaN
    assert body["expired"] is False

    status = client.get(f"/api/study/participants/{code}/timer")
    assert status.status_code == 200
    assert status.json()["started"] is True

    # Starting again does not reset the timer (duration stays what it was first set to).
    second_start = client.post(f"/api/study/participants/{code}/timer/start")
    assert second_start.json()["duration_seconds"] == body["duration_seconds"]


# --- immediate test ----------------------------------------------------------------------------


def test_full_immediate_test_flow_scores_and_hides_the_answer_key(tmp_path: Path) -> None:
    client = make_client(tmp_path, admin_password="secret")
    setup_active_material_and_test(client)
    code = create_participant(client)["code"]
    client.post(f"/api/study/participants/{code}/timer/start")

    items_response = client.get(f"/api/study/participants/{code}/test")
    assert items_response.status_code == 200
    items = items_response.json()["items"]
    assert len(items) == 2
    for item in items:
        assert "correct_answer" not in item
        assert "rubric_keywords" not in item
    mc_item = next(item for item in items if item["kind"] == "multiple_choice")
    sa_item = next(item for item in items if item["kind"] == "short_answer")

    submit = client.post(
        f"/api/study/participants/{code}/test/immediate",
        json={
            "answers": [
                {"item_id": mc_item["id"], "answer": "Sort"},
                {"item_id": sa_item["id"], "answer": "The data must be sorted so it can half."},
            ]
        },
    )
    assert submit.status_code == 200, submit.text
    body = submit.json()
    assert body["phase"] == "immediate"
    assert body["max_possible_score"] == 3.0
    assert body["total_score"] == 3.0  # both correct: 1.0 MC + full 2.0 rubric match


def test_immediate_test_can_only_be_submitted_once(tmp_path: Path) -> None:
    client = make_client(tmp_path, admin_password="secret")
    setup_active_material_and_test(client)
    code = create_participant(client)["code"]
    client.post(f"/api/study/participants/{code}/timer/start")
    items = client.get(f"/api/study/participants/{code}/test").json()["items"]
    answers = [{"item_id": item["id"], "answer": "Sort"} for item in items]

    first = client.post(f"/api/study/participants/{code}/test/immediate", json={"answers": answers})
    assert first.status_code == 200

    second = client.post(
        f"/api/study/participants/{code}/test/immediate", json={"answers": answers}
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "already_submitted"


# --- questionnaire -----------------------------------------------------------------------------


def test_questionnaire_is_accepted_for_experimental_and_rejected_for_control(
    tmp_path: Path,
) -> None:
    client = make_client(tmp_path, admin_password="secret", study_block_size=2)
    setup_active_material_and_test(client)
    codes_by_group: dict[str, str] = {}
    for _ in range(4):
        participant = create_participant(client)
        codes_by_group.setdefault(participant["group"], participant["code"])
        if len(codes_by_group) == 2:
            break

    experimental_code = codes_by_group["experimental"]
    control_code = codes_by_group["control"]

    experimental_response = client.post(
        f"/api/study/participants/{experimental_code}/questionnaire",
        json={"perceived_usefulness": 5, "ease_of_understanding": 4, "open_comment": "Great"},
    )
    assert experimental_response.status_code == 204

    control_response = client.post(
        f"/api/study/participants/{control_code}/questionnaire",
        json={"perceived_usefulness": 5, "ease_of_understanding": 4},
    )
    assert control_response.status_code == 403
    assert control_response.json()["error"]["code"] == "control_group_no_questionnaire"


# --- retention -----------------------------------------------------------------------------------


def test_retention_test_is_locked_until_the_delay_has_passed(tmp_path: Path) -> None:
    client = make_client(tmp_path, admin_password="secret", study_retention_delay_dev_minutes=60)
    setup_active_material_and_test(client)
    code = create_participant(client)["code"]
    client.post(f"/api/study/participants/{code}/timer/start")
    items = client.get(f"/api/study/participants/{code}/test").json()["items"]
    client.post(
        f"/api/study/participants/{code}/test/immediate",
        json={"answers": [{"item_id": item["id"], "answer": "x"} for item in items]},
    )

    status = client.get(f"/api/study/participants/{code}/retention")
    assert status.status_code == 200
    body = status.json()
    assert body["unlocked"] is False
    assert body["test"] is None

    locked_submit = client.post(
        f"/api/study/participants/{code}/test/retention", json={"answers": []}
    )
    assert locked_submit.status_code == 403
    assert locked_submit.json()["error"]["code"] == "retention_locked"


def test_retention_test_unlocks_and_can_be_submitted_once(tmp_path: Path) -> None:
    client = make_client(tmp_path, admin_password="secret", study_retention_delay_dev_minutes=60)
    setup_active_material_and_test(client)
    code = create_participant(client)["code"]
    client.post(f"/api/study/participants/{code}/timer/start")
    items = client.get(f"/api/study/participants/{code}/test").json()["items"]
    client.post(
        f"/api/study/participants/{code}/test/immediate",
        json={"answers": [{"item_id": item["id"], "answer": "x"} for item in items]},
    )

    # Simulate the retention delay having passed by moving the immediate submission's
    # timestamp into the past, instead of sleeping in the test. Uses the running app's own
    # session factory, not a separate database, so the change is visible to later requests.
    with client.app.state.session_factory() as session:
        submission = session.scalar(
            select(TestSubmission).where(TestSubmission.phase == "immediate")
        )
        submission.submitted_at = datetime.now(UTC) - timedelta(hours=2)
        session.commit()

    status = client.get(f"/api/study/participants/{code}/retention")
    assert status.status_code == 200
    body = status.json()
    assert body["unlocked"] is True
    assert body["already_submitted"] is False
    assert len(body["test"]["items"]) == 2

    mc_item = next(item for item in body["test"]["items"] if item["kind"] == "multiple_choice")
    submit = client.post(
        f"/api/study/participants/{code}/test/retention",
        json={"answers": [{"item_id": mc_item["id"], "answer": "Sort"}]},
    )
    assert submit.status_code == 200
    assert submit.json()["phase"] == "retention"

    resubmit = client.post(f"/api/study/participants/{code}/test/retention", json={"answers": []})
    assert resubmit.status_code == 409


# --- usage events ------------------------------------------------------------------------------


def test_usage_events_are_only_logged_for_experimental_participants(tmp_path: Path) -> None:
    client = make_client(tmp_path, admin_password="secret", study_block_size=2)
    setup_active_material_and_test(client)
    codes_by_group: dict[str, str] = {}
    for _ in range(4):
        participant = create_participant(client)
        codes_by_group.setdefault(participant["group"], participant["code"])
        if len(codes_by_group) == 2:
            break

    for code in codes_by_group.values():
        response = client.post(
            f"/api/study/participants/{code}/usage-events",
            json={"event_type": "tab_view", "detail": "summary"},
        )
        assert response.status_code == 204


# --- withdrawal ---------------------------------------------------------------------------------


def test_withdrawal_deletes_data_but_keeps_the_participant_bookkeeping(tmp_path: Path) -> None:
    client = make_client(tmp_path, admin_password="secret")
    setup_active_material_and_test(client)
    code = create_participant(client)["code"]
    client.post(f"/api/study/participants/{code}/timer/start")
    items = client.get(f"/api/study/participants/{code}/test").json()["items"]
    client.post(
        f"/api/study/participants/{code}/test/immediate",
        json={"answers": [{"item_id": item["id"], "answer": "x"} for item in items]},
    )
    client.post(
        f"/api/study/participants/{code}/usage-events",
        json={"event_type": "tab_view", "detail": "summary"},
    )

    response = client.post(f"/api/study/participants/{code}/withdraw")
    assert response.status_code == 200
    assert response.json()["withdrawn"] is True

    state = client.get(f"/api/study/participants/{code}")
    assert state.status_code == 200
    body = state.json()
    assert body["withdrawn"] is True
    assert body["immediate_submitted"] is False  # the submission was deleted

    # Submitting again after withdrawal is refused, not silently accepted.
    resubmit = client.post(f"/api/study/participants/{code}/test/immediate", json={"answers": []})
    assert resubmit.status_code == 410


# --- admin: overview, results, statistics, export ------------------------------------------------


def test_admin_endpoints_require_a_valid_session(tmp_path: Path) -> None:
    client = make_client(tmp_path, admin_password="secret")
    response = client.get("/api/admin/overview")
    assert response.status_code == 401


def test_admin_overview_reflects_created_and_completed_participants(tmp_path: Path) -> None:
    client = make_client(tmp_path, admin_password="secret", study_block_size=2)
    setup_active_material_and_test(client)
    for _ in range(2):
        code = create_participant(client)["code"]
        client.post(f"/api/study/participants/{code}/timer/start")

    overview = client.get("/api/admin/overview")
    assert overview.status_code == 200
    body = overview.json()
    assert body["total_participants"] == 2
    assert sum(group["total"] for group in body["groups"]) == 2
    assert body["active_material"] == "Week 1"
    assert body["active_test"] == "Sample Test"


def test_admin_results_and_statistics_reflect_submitted_scores(tmp_path: Path) -> None:
    client = make_client(tmp_path, admin_password="secret", study_block_size=2)
    setup_active_material_and_test(client)
    for _ in range(4):
        participant = create_participant(client)
        code = participant["code"]
        client.post(f"/api/study/participants/{code}/timer/start")
        items = client.get(f"/api/study/participants/{code}/test").json()["items"]
        client.post(
            f"/api/study/participants/{code}/test/immediate",
            json={"answers": [{"item_id": item["id"], "answer": "Sort"} for item in items]},
        )

    results = client.get("/api/admin/results")
    assert results.status_code == 200
    assert len(results.json()) == 4
    assert all(row["immediate_score"] is not None for row in results.json())

    statistics = client.get("/api/admin/statistics")
    assert statistics.status_code == 200
    body = statistics.json()
    assert body["participant_count"] == 4
    assert "immediate_score" in body
    assert body["immediate_score"]["recommended_test"] in {
        "student_t",
        "welch_t",
        "mann_whitney",
        "insufficient_data",
    }


def test_admin_csv_export_has_utf8_bom_and_one_row_per_participant(tmp_path: Path) -> None:
    client = make_client(tmp_path, admin_password="secret")
    setup_active_material_and_test(client)
    create_participant(client)
    create_participant(client)

    response = client.get("/api/admin/export.csv")

    assert response.status_code == 200
    assert response.content.startswith(b"\xef\xbb\xbf")
    text = response.content.decode("utf-8-sig")
    lines = [line for line in text.splitlines() if line.strip()]
    assert len(lines) == 3  # header + 2 participants


def test_admin_json_export_round_trips_participant_codes(tmp_path: Path) -> None:
    client = make_client(tmp_path, admin_password="secret")
    setup_active_material_and_test(client)
    code = create_participant(client)["code"]

    response = client.get("/api/admin/export.json")

    assert response.status_code == 200
    codes = [row["code"] for row in response.json()]
    assert code in codes


def test_delete_all_data_requires_the_confirmation_phrase(tmp_path: Path) -> None:
    client = make_client(tmp_path, admin_password="secret")
    setup_active_material_and_test(client)
    create_participant(client)

    response = client.post("/api/admin/delete-all-data", json={"confirm": "please"})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "confirmation_required"


def test_delete_all_data_removes_participants_but_keeps_materials_and_tests(
    tmp_path: Path,
) -> None:
    client = make_client(tmp_path, admin_password="secret")
    setup_active_material_and_test(client)
    create_participant(client)
    create_participant(client)

    response = client.post("/api/admin/delete-all-data", json={"confirm": "DELETE"})

    assert response.status_code == 200
    assert response.json()["deleted_participants"] == 2

    overview = client.get("/api/admin/overview")
    assert overview.json()["total_participants"] == 0
    assert overview.json()["active_material"] == "Week 1"
    assert overview.json()["active_test"] == "Sample Test"


# --- randomization balance through the real service+DB path --------------------------------------


def test_randomization_stays_balanced_across_many_participants_created_through_the_service(
    session_factory: SessionFactory,
) -> None:
    with session_factory() as session:
        # A material needs a real Document row to satisfy the foreign key.
        session.add(
            Document(
                id="doc-1",
                filename="f.pdf",
                content_hash="a" * 64,
                content_type=ContentType.LECTURE,
                source_format=SourceFormat.PDF,
                size_bytes=1,
            )
        )
        session.flush()
        session.add(StudyMaterial(document_id="doc-1", name="M", is_active=True))
        session.add(StudyTest(id="test-1", name="T", is_active=True))
        session.commit()

        for _ in range(40):
            service.create_participant(session, language="en", consent=True, block_size=4)

        groups = session.scalars(select(Participant.group)).all()
        assert groups.count(StudyGroup.EXPERIMENTAL) == 20
        assert groups.count(StudyGroup.CONTROL) == 20
