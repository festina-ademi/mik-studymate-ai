"""FastAPI application factory.

Run with ``uvicorn app.main:app --reload`` from the ``backend/`` folder.
"""

import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.router import api_router
from app.config import Settings, get_settings
from app.db.session import create_engine, create_session_factory, init_db
from app.errors import register_exception_handlers
from app.logging_config import configure_logging
from app.middleware import RateLimitMiddleware, RequestSizeLimitMiddleware, SlidingWindowLimiter

request_logger = logging.getLogger("app.request")

# Room for multipart boundaries and form fields on top of the largest allowed file.
MULTIPART_OVERHEAD_BYTES = 1024 * 1024


async def log_requests(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Log each request with a fresh request id. Client addresses are never recorded."""
    request_id = uuid.uuid4().hex
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        request_logger.exception(
            "request_failed",
            extra={"request_id": request_id, "method": request.method, "path": request.url.path},
        )
        raise
    duration_ms = round((time.perf_counter() - started) * 1000, 1)
    response.headers["X-Request-ID"] = request_id
    request_logger.info(
        "request_completed",
        extra={
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "duration_ms": duration_ms,
        },
    )
    return response


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the FastAPI application.

    Args:
        settings: Configuration to use; loaded from the environment when omitted.
    """
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    engine = create_engine(settings.database_url)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        init_db(engine)
        yield
        engine.dispose()

    app = FastAPI(title="StudyMate AI", version=__version__, lifespan=lifespan)
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = create_session_factory(engine)
    app.state.llm_provider = None  # built on first use, see app.llm.factory.get_llm_provider

    register_exception_handlers(app)

    # Middleware runs outermost-first, i.e. in reverse order of registration: logging, then
    # CORS (so that even 429/413 responses carry CORS headers), then the request protections.
    app.add_middleware(
        RequestSizeLimitMiddleware,
        json_limit=settings.max_json_body_bytes,
        upload_limit=settings.max_upload_bytes + MULTIPART_OVERHEAD_BYTES,
    )
    if settings.rate_limit_enabled:
        app.add_middleware(
            RateLimitMiddleware,
            limiter=SlidingWindowLimiter(
                settings.rate_limit_requests, settings.rate_limit_window_seconds
            ),
        )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.middleware("http")(log_requests)
    app.include_router(api_router)
    return app


app = create_app()
