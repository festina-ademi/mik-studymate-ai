"""Health-check endpoint."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from app import __version__

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    """Liveness information returned by ``GET /api/health``."""

    status: Literal["ok"]
    version: str


@router.get("/health", summary="Liveness check")
async def get_health() -> HealthResponse:
    """Report that the API is running."""
    return HealthResponse(status="ok", version=__version__)
