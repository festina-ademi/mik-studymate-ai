"""Admin API, mounted at ``/api/admin``.

Login, material/test management, results, statistics and export for the researcher running
Study Mode. Every endpoint except ``/login`` requires a valid admin session cookie (see
``app.study.admin_auth``); ``require_admin`` is the shared dependency that enforces it.
"""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.errors import AppError
from app.rag.factory import get_embedding_provider, get_vector_store
from app.study import admin_service
from app.study.admin_auth import (
    ADMIN_SESSION_COOKIE,
    check_login_rate_limit,
    create_session,
    destroy_session,
    get_valid_session,
    require_admin_session,
    verify_password,
)
from app.study.admin_service import (
    AdminOverview,
    MaterialSummary,
    ParticipantResult,
    TestImportRequest,
    TestSummary,
)

router = APIRouter(prefix="/admin", tags=["admin"])


def require_admin(request: Request, session: Session = Depends(get_session)) -> None:
    """FastAPI dependency: raise ``AppError(401, ...)`` unless the admin session is valid."""
    token = request.cookies.get(ADMIN_SESSION_COOKIE)
    require_admin_session(session, token)


def _set_admin_cookie(response: Response, request: Request, token: str) -> None:
    settings = request.app.state.settings
    response.set_cookie(
        ADMIN_SESSION_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        secure=settings.app_env == "production",
        max_age=settings.admin_session_hours * 3600,
    )


# --- auth ---------------------------------------------------------------------------------------


class LoginRequest(BaseModel):
    """The admin login form."""

    password: str


class SessionStatus(BaseModel):
    """Whether the caller currently holds a valid admin session."""

    signed_in: bool


@router.post("/login", response_model=SessionStatus)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> SessionStatus:
    """Check the admin password and start a session on success."""
    check_login_rate_limit()
    settings = request.app.state.settings
    if not verify_password(settings, payload.password):
        raise AppError(401, "invalid_admin_password")
    record = create_session(session, settings)
    _set_admin_cookie(response, request, record.token)
    return SessionStatus(signed_in=True)


@router.post("/logout", status_code=204)
async def logout(
    request: Request, response: Response, session: Session = Depends(get_session)
) -> None:
    """End the current admin session."""
    destroy_session(session, request.cookies.get(ADMIN_SESSION_COOKIE))
    response.delete_cookie(ADMIN_SESSION_COOKIE)


@router.get("/me", response_model=SessionStatus)
async def me(request: Request, session: Session = Depends(get_session)) -> SessionStatus:
    """Whether the caller is currently signed in, for the admin app to restore its state."""
    token = request.cookies.get(ADMIN_SESSION_COOKIE)
    return SessionStatus(signed_in=get_valid_session(session, token) is not None)


# --- overview -----------------------------------------------------------------------------------


@router.get("/overview", response_model=AdminOverview)
async def get_overview(
    _admin: None = Depends(require_admin), session: Session = Depends(get_session)
) -> AdminOverview:
    """Participant counts and completion, per group."""
    return admin_service.build_overview(session)


# --- materials ------------------------------------------------------------------------------------


@router.get("/materials", response_model=list[MaterialSummary])
async def list_materials(
    _admin: None = Depends(require_admin), session: Session = Depends(get_session)
) -> list[MaterialSummary]:
    """Every imported study material."""
    return admin_service.list_materials(session)


@router.post("/materials", response_model=MaterialSummary, status_code=201)
async def upload_material(
    request: Request,
    name: Annotated[str, Form()],
    files: Annotated[list[UploadFile], File()],
    _admin: None = Depends(require_admin),
    session: Session = Depends(get_session),
) -> MaterialSummary:
    """Import a fixed study material set through the normal ingestion pipeline."""
    if not files:
        raise AppError(400, "EMPTY_DOCUMENT")
    settings = request.app.state.settings
    items = []
    for upload in files:
        filename = upload.filename
        if filename is None:
            raise AppError(400, "UNSUPPORTED_TYPE")
        content = await upload.read()
        if len(content) > settings.max_upload_bytes:
            raise AppError(413, "FILE_TOO_LARGE", details={"max_bytes": settings.max_upload_bytes})
        if not content:
            raise AppError(400, "EMPTY_DOCUMENT")
        items.append(
            {
                "filename": Path(filename).name,
                "content": content,
                "content_type": upload.content_type,
            }
        )
    return admin_service.import_material(
        session,
        name=name,
        files=items,
        session_factory=request.app.state.session_factory,
        store=get_vector_store(request),
        embedding_provider=get_embedding_provider(request),
        max_upload_bytes=settings.max_upload_bytes,
    )


@router.post("/materials/{material_id}/activate", response_model=MaterialSummary)
async def activate_material(
    material_id: str,
    _admin: None = Depends(require_admin),
    session: Session = Depends(get_session),
) -> MaterialSummary:
    """Make ``material_id`` the material assigned to new participants."""
    return admin_service.activate_material(session, material_id)


# --- tests ----------------------------------------------------------------------------------------


@router.get("/tests", response_model=list[TestSummary])
async def list_tests(
    _admin: None = Depends(require_admin), session: Session = Depends(get_session)
) -> list[TestSummary]:
    """Every imported study test."""
    return admin_service.list_tests(session)


@router.post("/tests", response_model=TestSummary, status_code=201)
async def import_test(
    payload: TestImportRequest,
    _admin: None = Depends(require_admin),
    session: Session = Depends(get_session),
) -> TestSummary:
    """Import a researcher-authored test from JSON (never AI-generated)."""
    return admin_service.import_test(session, payload)


@router.post("/tests/{test_id}/activate", response_model=TestSummary)
async def activate_test(
    test_id: str, _admin: None = Depends(require_admin), session: Session = Depends(get_session)
) -> TestSummary:
    """Make ``test_id`` the test given to new sittings."""
    return admin_service.activate_test(session, test_id)


# --- results, statistics, export --------------------------------------------------------


@router.get("/results", response_model=list[ParticipantResult])
async def get_results(
    _admin: None = Depends(require_admin), session: Session = Depends(get_session)
) -> list[ParticipantResult]:
    """Raw per-participant scores, for the results charts."""
    return admin_service.build_results(session)


@router.get("/statistics", response_model=None)
async def get_statistics(
    _admin: None = Depends(require_admin), session: Session = Depends(get_session)
) -> dict[str, object]:
    """The full group-comparison statistics report."""
    return asdict(admin_service.build_statistics(session))


@router.get("/export.csv")
async def export_csv(
    _admin: None = Depends(require_admin), session: Session = Depends(get_session)
) -> Response:
    """The full study export as UTF-8-with-BOM CSV, ready for SPSS/Excel."""
    content = admin_service.export_csv(session)
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=study_export.csv"},
    )


@router.get("/export.json")
async def export_json(
    _admin: None = Depends(require_admin), session: Session = Depends(get_session)
) -> Response:
    """The full study export as JSON."""
    content = admin_service.export_json(session)
    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=study_export.json"},
    )


# --- delete all data ------------------------------------------------------------------------------


class DeleteAllDataRequest(BaseModel):
    """Delete-all-data must be confirmed with the literal text ``DELETE``."""

    confirm: str


class DeleteAllDataResponse(BaseModel):
    """How many participants were removed."""

    deleted_participants: int


@router.post("/delete-all-data", response_model=DeleteAllDataResponse)
async def delete_all_data(
    payload: DeleteAllDataRequest,
    _admin: None = Depends(require_admin),
    session: Session = Depends(get_session),
) -> DeleteAllDataResponse:
    """Permanently delete every participant and their data. Materials and tests are kept."""
    if payload.confirm != "DELETE":
        raise AppError(400, "confirmation_required")
    deleted = admin_service.delete_all_study_data(session)
    return DeleteAllDataResponse(deleted_participants=deleted)
