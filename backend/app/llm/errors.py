"""Errors raised by the LLM layer.

All of them are :class:`~app.errors.AppError` subclasses, so any of them that reaches the API
is reported in the standard error format. Provider messages are never forwarded to the client:
they are logged server-side instead.
"""

from typing import Any

from app.errors import AppError


class LLMError(AppError):
    """Base class for provider failures. ``retryable`` marks transient conditions."""

    def __init__(
        self,
        status_code: int,
        code: str,
        *,
        retryable: bool = False,
        retry_after: float | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        """Create an error.

        Args:
            status_code: HTTP status reported to the client.
            code: Stable machine-readable code (``llm_*``).
            retryable: Whether repeating the same call may succeed.
            retry_after: Seconds the provider asked us to wait, if it said so.
            details: Extra machine-readable context.
        """
        merged = dict(details or {})
        if retry_after is not None:
            merged["retry_after_seconds"] = retry_after
        super().__init__(status_code, code, details=merged)
        self.retryable = retryable
        self.retry_after = retry_after


class LLMNotConfiguredError(LLMError):
    """The selected provider has no API key."""

    def __init__(self, provider: str) -> None:
        """Create the error for ``provider``."""
        super().__init__(503, "llm_not_configured", details={"provider": provider})


class LLMAuthError(LLMError):
    """The provider rejected our credentials."""

    def __init__(self) -> None:
        """Create the error."""
        super().__init__(502, "llm_auth_failed")


class LLMRateLimitError(LLMError):
    """The provider's rate limit or quota was hit."""

    def __init__(self, *, retryable: bool = True, retry_after: float | None = None) -> None:
        """Create the error; quota exhaustion is reported with ``retryable=False``."""
        super().__init__(429, "llm_rate_limited", retryable=retryable, retry_after=retry_after)


class LLMTimeoutError(LLMError):
    """The provider did not answer in time."""

    def __init__(self) -> None:
        """Create the error."""
        super().__init__(504, "llm_timeout", retryable=True)


class LLMUnavailableError(LLMError):
    """The provider is unreachable or reported a server error."""

    def __init__(self) -> None:
        """Create the error."""
        super().__init__(503, "llm_unavailable", retryable=True)


class LLMContentBlockedError(LLMError):
    """The provider's safety filter blocked the request or the answer."""

    def __init__(self) -> None:
        """Create the error."""
        super().__init__(422, "llm_content_blocked")


class LLMRequestError(LLMError):
    """The provider refused the request for a reason that retrying will not fix."""

    def __init__(self) -> None:
        """Create the error."""
        super().__init__(502, "llm_request_failed")


class LLMInvalidOutputError(LLMError):
    """The model's answer was empty or did not match the expected structure."""

    def __init__(self, *, details: dict[str, Any] | None = None) -> None:
        """Create the error."""
        super().__init__(502, "llm_invalid_output", details=details)
