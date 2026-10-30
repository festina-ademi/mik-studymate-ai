"""Daily quota status for the calling client, mounted at ``/api/quota``."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.services.quota import (
    AI_CALL_ACTION,
    CLIENT_ID_HEADER,
    TIMEZONE_HEADER,
    UPLOAD_ACTION,
    QuotaOverview,
    get_quota_status,
    resolve_client_id,
    resolve_timezone,
)

router = APIRouter(tags=["quota"])


@router.get("/quota", response_model=QuotaOverview)
async def get_quota(request: Request, session: Session = Depends(get_session)) -> QuotaOverview:
    """Today's AI-request and upload usage of the calling client, the limits, and the reset."""
    settings = request.app.state.settings
    user_id = resolve_client_id(request.headers.get(CLIENT_ID_HEADER))
    zone = resolve_timezone(request.headers.get(TIMEZONE_HEADER))
    return QuotaOverview(
        ai_requests=get_quota_status(
            session, user_id, zone, settings.quota_daily_gemini_requests, AI_CALL_ACTION
        ),
        uploads=get_quota_status(
            session, user_id, zone, settings.quota_daily_uploads, UPLOAD_ACTION
        ),
    )
