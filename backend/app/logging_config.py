"""Structured (JSON) logging.

Log records are written to stdout as one JSON object per line. Fields passed through
``extra=`` are included. Never log personal data (names, emails, IP addresses).
"""

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

_STANDARD_ATTRIBUTES = frozenset(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {
    "message",
    "asctime",
    "color_message",  # added by uvicorn: the same message with ANSI colour codes
}
_HANDLER_MARKER = "_studymate_handler"


class JsonFormatter(logging.Formatter):
    """Format log records as single-line JSON."""

    def format(self, record: logging.LogRecord) -> str:
        """Serialise ``record`` together with any ``extra`` fields."""
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _STANDARD_ATTRIBUTES:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: str) -> None:
    """Send all logs, including uvicorn's, through the JSON formatter.

    Safe to call more than once: only the handler installed by this function is replaced.
    """
    root = logging.getLogger()
    for handler in list(root.handlers):
        if getattr(handler, _HANDLER_MARKER, False):
            root.removeHandler(handler)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    setattr(handler, _HANDLER_MARKER, True)
    root.addHandler(handler)
    root.setLevel(level)

    # Uvicorn's own handlers would duplicate output; requests are logged by the app middleware.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
