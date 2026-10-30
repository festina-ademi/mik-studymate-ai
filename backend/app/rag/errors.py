"""Errors raised by the RAG layer, reported in the standard API error format."""

from app.errors import AppError


class RagNotConfiguredError(AppError):
    """The selected embedding provider is unusable: no API key, or the local package is missing."""

    def __init__(self, provider: str) -> None:
        """Create the error for ``provider``."""
        super().__init__(503, "embedding_not_configured", details={"provider": provider})
