"""Consistent API error format.

Every error response has the shape::

    {"error": {"code": "...", "message_key": "...", "details": {}}}

``code`` is a stable machine-readable identifier and ``message_key`` is the i18n key the
frontend translates. The backend never sends user-facing prose.
"""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

_STATUS_CODES: dict[int, str] = {
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    413: "payload_too_large",
    429: "rate_limited",
}


class ErrorBody(BaseModel):
    """The ``error`` object of an error response."""

    code: str
    message_key: str
    details: dict[str, Any] = Field(default_factory=dict)


class ErrorResponse(BaseModel):
    """Envelope returned for every error."""

    error: ErrorBody


class AppError(Exception):
    """An expected error that is reported to the client in the standard format."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message_key: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        """Create an error.

        Args:
            status_code: HTTP status code of the response.
            code: Stable machine-readable error code, e.g. ``"unsupported_file_type"``.
            message_key: i18n key for the frontend; defaults to ``errors.<code>``.
            details: Extra machine-readable context. Must not contain personal data.
        """
        super().__init__(code)
        self.status_code = status_code
        self.code = code
        self.message_key = message_key or f"errors.{code}"
        self.details = details or {}


def error_response(
    status_code: int,
    code: str,
    message_key: str | None = None,
    details: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    """Build a JSON response in the standard error format."""
    body = ErrorResponse(
        error=ErrorBody(
            code=code,
            message_key=message_key or f"errors.{code}",
            details=details or {},
        )
    )
    return JSONResponse(status_code=status_code, content=body.model_dump(), headers=headers)


def register_exception_handlers(app: FastAPI) -> None:
    """Route every kind of failure through the standard error format."""

    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        return error_response(exc.status_code, exc.code, exc.message_key, exc.details)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _STATUS_CODES.get(exc.status_code, "http_error")
        headers = dict(exc.headers) if exc.headers else None
        return error_response(exc.status_code, code, headers=headers)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # Only locations and error types are returned; submitted values are never echoed back.
        issues = [{"loc": list(err["loc"]), "type": err["type"]} for err in exc.errors()]
        return error_response(422, "validation_error", details={"errors": issues})

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_request: Request, exc: Exception) -> JSONResponse:
        logger.error("unhandled_exception", exc_info=exc)
        return error_response(500, "internal_error")
