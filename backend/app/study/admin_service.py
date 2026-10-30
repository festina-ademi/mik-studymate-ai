"""Admin-facing Study Mode business logic.

Material/test import and validation, the overview dashboard, results, statistics, export, and
the "delete all study data" action.

"Delete all study data" removes every participant and everything that cascades from them
(submissions, questionnaire responses, usage events) — the actual collected research data —
but deliberately leaves the admin's configured materials and tests alone, so the study can be
re-run without the admin having to re-import them.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import Document, QuestionKind
from app.errors import AppError
from app.ingestion.pipeline import ingest_upload
from app.rag.embeddings import EmbeddingProvider
from app.rag.indexer import index_document
from app.rag.store import ChromaVectorStore
from app.study.export import ParticipantExportRow, build_export_rows, rows_to_csv, rows_to_json
from app.study.models import (
    Participant,
    QuestionnaireResponse,
    StudyGroup,
    StudyMaterial,
    StudyPhase,
    StudyTest,
    TestItem,
    TestSubmission,
    UsageEvent,
)
from app.study.stats import ParticipantScoreRow, StudyStatisticsReport, build_statistics_report

_STUDY_LANGUAGES = ("en", "sq")


def _submission(participant: Participant, phase: StudyPhase) -> TestSubmission | None:
    return next((s for s in participant.submissions if s.phase == phase), None)


# --- materials --------------------------------------------------------------------------------


class MaterialSummary(BaseModel):
    """One imported study material, for the admin's material list."""

    id: str
    name: str
    document_id: str
    filename: str
    is_active: bool


def _material_summary(material: StudyMaterial) -> MaterialSummary:
    return MaterialSummary(
        id=material.id,
        name=material.name,
        document_id=material.document_id,
        filename=material.document.filename,
        is_active=material.is_active,
    )


def list_materials(session: Session) -> list[MaterialSummary]:
    """Every imported study material, oldest first."""
    materials = session.scalars(select(StudyMaterial).order_by(StudyMaterial.created_at)).all()
    return [_material_summary(material) for material in materials]


def import_material(
    session: Session,
    *,
    name: str,
    files: list[dict[str, Any]],
    session_factory: sessionmaker[Session],
    store: ChromaVectorStore,
    embedding_provider: EmbeddingProvider,
    max_upload_bytes: int,
) -> MaterialSummary:
    """Ingest ``files`` through the normal upload pipeline and register them as study material."""
    result = ingest_upload(
        files, session_factory=session_factory, max_upload_bytes=max_upload_bytes
    )
    document_id = result["document"]["id"]
    document = session.get(Document, document_id)
    if document is None:  # pragma: no cover - ingest_upload always persists the document
        raise AppError(500, "internal_error")
    index_document(document, store=store, embedding_provider=embedding_provider)

    material = StudyMaterial(
        document_id=document_id, name=name.strip() or document.filename, is_active=False
    )
    session.add(material)
    session.commit()
    return _material_summary(material)


def activate_material(session: Session, material_id: str) -> MaterialSummary:
    """Make ``material_id`` the one assigned to new participants (deactivating any other)."""
    material = session.get(StudyMaterial, material_id)
    if material is None:
        raise AppError(404, "not_found")
    session.execute(update(StudyMaterial).values(is_active=False))
    material.is_active = True
    session.commit()
    return _material_summary(material)


# --- tests: import and validation --------------------------------------------------------------


class TestItemImport(BaseModel):
    """One test item as given in the admin's import JSON."""

    __test__ = False  # not a pytest test class; its name just starts with "Test"

    kind: str
    topic: str = "General"
    question: dict[str, str] = Field(default_factory=dict)
    options: dict[str, list[str]] | None = None
    correct_answer: dict[str, str] = Field(default_factory=dict)
    rubric_keywords: dict[str, list[str]] | None = None
    max_score: float = Field(default=1.0, gt=0)


class TestImportRequest(BaseModel):
    """The admin's test import JSON."""

    __test__ = False  # not a pytest test class; its name just starts with "Test"

    name: str
    items: list[TestItemImport] = Field(default_factory=list)


@dataclass(frozen=True)
class ImportIssue:
    """One validation problem found in a test import, machine-readable for translation."""

    item_index: int  # -1 for a test-level issue
    code: str
    language: str | None = None


def validate_test_import(payload: TestImportRequest) -> list[ImportIssue]:
    """Validate an imported test, returning every problem found (empty list means it's valid)."""
    issues: list[ImportIssue] = []
    if not payload.name.strip():
        issues.append(ImportIssue(item_index=-1, code="missing_name"))
    if not payload.items:
        issues.append(ImportIssue(item_index=-1, code="empty_test"))

    for index, item in enumerate(payload.items):
        if item.kind not in {"multiple_choice", "short_answer"}:
            issues.append(ImportIssue(item_index=index, code="invalid_kind"))
            continue
        for language in _STUDY_LANGUAGES:
            if not item.question.get(language, "").strip():
                issues.append(
                    ImportIssue(item_index=index, code="missing_question", language=language)
                )
        if item.kind == "multiple_choice":
            issues.extend(_validate_multiple_choice(index, item))
        else:
            issues.extend(_validate_short_answer(index, item))
    return issues


def _validate_multiple_choice(index: int, item: TestItemImport) -> list[ImportIssue]:
    issues: list[ImportIssue] = []
    if not item.options:
        issues.append(ImportIssue(item_index=index, code="missing_options"))
        return issues
    for language in _STUDY_LANGUAGES:
        options = item.options.get(language, [])
        if len(options) < 2:
            issues.append(
                ImportIssue(item_index=index, code="insufficient_options", language=language)
            )
        correct = item.correct_answer.get(language, "")
        if not correct or correct not in options:
            issues.append(
                ImportIssue(
                    item_index=index, code="correct_answer_not_in_options", language=language
                )
            )
    return issues


def _validate_short_answer(index: int, item: TestItemImport) -> list[ImportIssue]:
    issues: list[ImportIssue] = []
    if not item.rubric_keywords:
        issues.append(ImportIssue(item_index=index, code="missing_rubric_keywords"))
        return issues
    for language in _STUDY_LANGUAGES:
        if not item.rubric_keywords.get(language):
            issues.append(
                ImportIssue(item_index=index, code="missing_rubric_keywords", language=language)
            )
    return issues


class TestSummary(BaseModel):
    """One imported study test, for the admin's test list."""

    __test__ = False  # not a pytest test class; its name just starts with "Test"

    id: str
    name: str
    item_count: int
    is_active: bool


def _test_summary(test: StudyTest) -> TestSummary:
    return TestSummary(
        id=test.id, name=test.name, item_count=len(test.items), is_active=test.is_active
    )


def list_tests(session: Session) -> list[TestSummary]:
    """Every imported study test, oldest first."""
    tests = session.scalars(select(StudyTest).order_by(StudyTest.created_at)).all()
    return [_test_summary(test) for test in tests]


def import_test(session: Session, payload: TestImportRequest) -> TestSummary:
    """Validate and store an imported test.

    Raises ``AppError(422, "test_import_invalid")`` with every issue found (nothing is saved)
    when validation fails.
    """
    issues = validate_test_import(payload)
    if issues:
        raise AppError(
            422,
            "test_import_invalid",
            details={
                "issues": [
                    {
                        "item_index": issue.item_index,
                        "code": issue.code,
                        "language": issue.language,
                    }
                    for issue in issues
                ]
            },
        )

    test = StudyTest(name=payload.name.strip(), is_active=False)
    session.add(test)
    session.flush()
    for ordinal, item in enumerate(payload.items, start=1):
        session.add(
            TestItem(
                test_id=test.id,
                ordinal=ordinal,
                kind=QuestionKind(item.kind),
                topic=item.topic.strip() or "General",
                question=item.question,
                options=item.options,
                correct_answer=item.correct_answer,
                rubric_keywords=item.rubric_keywords,
                max_score=item.max_score,
            )
        )
    session.commit()
    return _test_summary(test)


def activate_test(session: Session, test_id: str) -> TestSummary:
    """Make ``test_id`` the one given to new sittings (deactivating any other)."""
    test = session.get(StudyTest, test_id)
    if test is None:
        raise AppError(404, "not_found")
    session.execute(update(StudyTest).values(is_active=False))
    test.is_active = True
    session.commit()
    return _test_summary(test)


# --- overview -------------------------------------------------------------------------------


class GroupOverview(BaseModel):
    """Completion counts for one study group."""

    group: str
    total: int
    withdrawn: int
    immediate_completed: int
    questionnaire_completed: int
    retention_completed: int


class AdminOverview(BaseModel):
    """The admin dashboard's summary cards."""

    total_participants: int
    groups: list[GroupOverview]
    active_material: str | None
    active_test: str | None


def build_overview(session: Session) -> AdminOverview:
    """Participant counts and completion, per group, for the admin dashboard's summary cards."""
    participants = list(session.scalars(select(Participant)).all())
    groups = []
    for group in StudyGroup:
        members = [participant for participant in participants if participant.group == group]
        groups.append(
            GroupOverview(
                group=group.value,
                total=len(members),
                withdrawn=sum(1 for participant in members if participant.withdrawn),
                immediate_completed=sum(
                    1 for participant in members if _submission(participant, StudyPhase.IMMEDIATE)
                ),
                questionnaire_completed=sum(
                    1 for participant in members if participant.questionnaire is not None
                ),
                retention_completed=sum(
                    1 for participant in members if _submission(participant, StudyPhase.RETENTION)
                ),
            )
        )
    active_material = session.scalar(select(StudyMaterial).where(StudyMaterial.is_active.is_(True)))
    active_test = session.scalar(select(StudyTest).where(StudyTest.is_active.is_(True)))
    return AdminOverview(
        total_participants=len(participants),
        groups=groups,
        active_material=active_material.name if active_material else None,
        active_test=active_test.name if active_test else None,
    )


# --- results (for charts) ---------------------------------------------------------------------


class ParticipantResult(BaseModel):
    """One (non-withdrawn) participant's scores, for the results charts."""

    code: str
    group: str
    language: str
    immediate_score: float | None
    immediate_max_score: float | None
    retention_score: float | None
    retention_max_score: float | None


def build_results(session: Session) -> list[ParticipantResult]:
    """Raw per-participant scores for the admin's histogram/boxplot charts."""
    participants = session.scalars(
        select(Participant).where(Participant.withdrawn.is_(False))
    ).all()
    results = []
    for participant in participants:
        immediate = _submission(participant, StudyPhase.IMMEDIATE)
        retention = _submission(participant, StudyPhase.RETENTION)
        results.append(
            ParticipantResult(
                code=participant.code,
                group=participant.group.value,
                language=participant.language.value,
                immediate_score=immediate.total_score if immediate else None,
                immediate_max_score=immediate.max_possible_score if immediate else None,
                retention_score=retention.total_score if retention else None,
                retention_max_score=retention.max_possible_score if retention else None,
            )
        )
    return results


# --- statistics -------------------------------------------------------------------------------


def build_statistics(session: Session) -> StudyStatisticsReport:
    """Compare groups on immediate score, retention score and retention change.

    Scores are normalized to a 0..1 fraction of the test's max possible score before
    comparison, so the numbers stay meaningful regardless of how many points the test is worth.
    Withdrawn participants contribute no data (it was deleted with them).
    """
    participants = session.scalars(
        select(Participant).where(Participant.withdrawn.is_(False))
    ).all()
    rows = []
    for participant in participants:
        immediate = _submission(participant, StudyPhase.IMMEDIATE)
        retention = _submission(participant, StudyPhase.RETENTION)
        immediate_fraction = (
            immediate.total_score / immediate.max_possible_score
            if immediate and immediate.max_possible_score
            else None
        )
        retention_fraction = (
            retention.total_score / retention.max_possible_score
            if retention and retention.max_possible_score
            else None
        )
        rows.append(
            ParticipantScoreRow(
                code=participant.code,
                group=participant.group,
                language=participant.language,
                immediate_score=immediate_fraction,
                retention_score=retention_fraction,
            )
        )
    return build_statistics_report(rows)


# --- export -------------------------------------------------------------------------------------


def _export_rows(session: Session) -> list[ParticipantExportRow]:
    participants = list(session.scalars(select(Participant)).all())
    return build_export_rows(participants)


def export_csv(session: Session) -> bytes:
    """The full study export as UTF-8-with-BOM CSV, ready for SPSS/Excel."""
    return rows_to_csv(_export_rows(session))


def export_json(session: Session) -> str:
    """The full study export as pretty-printed JSON."""
    return rows_to_json(_export_rows(session))


# --- delete all data ------------------------------------------------------------------------------


def delete_all_study_data(session: Session) -> int:
    """Delete every participant and everything that cascades from them.

    Returns how many participants were removed. Materials and tests are untouched.
    """
    participant_count = len(list(session.scalars(select(Participant.id)).all()))
    session.execute(delete(UsageEvent))
    session.execute(delete(QuestionnaireResponse))
    session.execute(delete(TestSubmission))
    session.execute(delete(Participant))
    session.commit()
    return participant_count
