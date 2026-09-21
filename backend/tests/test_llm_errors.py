"""Provider failures reaching the API are reported in the standard error format."""

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.llm import (
    LLMAuthError,
    LLMContentBlockedError,
    LLMError,
    LLMInvalidOutputError,
    LLMNotConfiguredError,
    LLMProvider,
    LLMRateLimitError,
    LLMRequestError,
    LLMTimeoutError,
    LLMUnavailableError,
    MockProvider,
    get_llm_provider,
)
from app.main import create_app


@pytest.mark.parametrize(
    ("error", "status", "code", "details"),
    [
        (LLMRateLimitError(retry_after=3.0), 429, "llm_rate_limited", {"retry_after_seconds": 3.0}),
        (LLMRateLimitError(), 429, "llm_rate_limited", {}),
        (LLMTimeoutError(), 504, "llm_timeout", {}),
        (LLMUnavailableError(), 503, "llm_unavailable", {}),
        (LLMAuthError(), 502, "llm_auth_failed", {}),
        (LLMContentBlockedError(), 422, "llm_content_blocked", {}),
        (
            LLMInvalidOutputError(details={"attempts": 3}),
            502,
            "llm_invalid_output",
            {"attempts": 3},
        ),
        (LLMRequestError(), 502, "llm_request_failed", {}),
        (LLMNotConfiguredError("gemini"), 503, "llm_not_configured", {"provider": "gemini"}),
    ],
)
def test_llm_errors_use_the_standard_error_format(
    app: FastAPI, error: LLMError, status: int, code: str, details: dict[str, object]
) -> None:
    @app.get("/api/_test/fail")
    async def fail() -> None:
        raise error

    response = TestClient(app).get("/api/_test/fail")

    assert response.status_code == status
    assert response.json() == {
        "error": {"code": code, "message_key": f"errors.{code}", "details": details}
    }


@pytest.mark.anyio
async def test_a_provider_failure_surfaces_as_an_llm_error_after_retries_are_exhausted() -> None:
    provider = MockProvider([LLMUnavailableError()] * 4)

    with pytest.raises(LLMUnavailableError) as caught:
        await provider.generate("hello")

    assert len(provider.calls) == 4
    assert caught.value.status_code == 503


def test_the_provider_dependency_returns_the_configured_provider_once(app: FastAPI) -> None:
    seen: list[LLMProvider] = []

    @app.get("/api/_test/provider")
    async def provider_name(provider: LLMProvider = Depends(get_llm_provider)) -> dict[str, str]:
        seen.append(provider)
        return {"name": provider.name}

    client = TestClient(app)

    assert client.get("/api/_test/provider").json() == {"name": "mock"}
    assert client.get("/api/_test/provider").json() == {"name": "mock"}
    assert seen[0] is seen[1]


def test_a_missing_api_key_only_fails_requests_that_need_the_provider() -> None:
    app = create_app(Settings(_env_file=None, llm_provider="gemini", database_url="sqlite://"))

    @app.get("/api/_test/provider")
    async def needs_provider(provider: LLMProvider = Depends(get_llm_provider)) -> dict[str, str]:
        return {"name": provider.name}

    client = TestClient(app)
    response = client.get("/api/_test/provider")

    assert client.get("/api/health").status_code == 200
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "llm_not_configured"
