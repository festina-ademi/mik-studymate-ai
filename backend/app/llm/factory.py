"""Choose and build the LLM provider from configuration."""

import json

from fastapi import Request

from app.config import Settings
from app.llm.base import LLMProvider
from app.llm.concurrency import ConcurrencyLimitedProvider
from app.llm.errors import LLMNotConfiguredError
from app.llm.gemini import GeminiProvider
from app.llm.mock import MockProvider
from app.llm.openai_provider import OpenAIProvider
from app.llm.retry import RetryPolicy
from app.llm.usage import UsageTrackingProvider
from app.services.quota import record_ai_call


def _load_mock_schema_responses(settings: Settings) -> dict[str, str]:
    """Read ``mock_llm_fixtures_path`` (a JSON object mapping schema name to response object)."""
    if settings.mock_llm_fixtures_path is None:
        return {}
    raw = json.loads(settings.mock_llm_fixtures_path.read_text(encoding="utf-8"))
    return {name: json.dumps(value) for name, value in raw.items()}


def create_provider(settings: Settings) -> LLMProvider:
    """Build the provider selected by ``LLM_PROVIDER``, with a concurrency cap and usage counting.

    Raises:
        LLMNotConfiguredError: The selected provider needs an API key that is not set.
    """
    options = {
        "temperature": settings.llm_temperature,
        "max_tokens": settings.llm_max_output_tokens,
        "timeout": settings.llm_timeout_seconds,
        "retry_policy": RetryPolicy(
            max_retries=settings.llm_max_retries,
            base_delay=settings.llm_retry_base_delay_seconds,
        ),
    }
    match settings.llm_provider:
        case "gemini":
            if settings.gemini_api_key is None:
                raise LLMNotConfiguredError("gemini")
            provider: LLMProvider = GeminiProvider(
                settings.gemini_api_key.get_secret_value(), settings.gemini_model, **options
            )
        case "openai":
            if settings.openai_api_key is None:
                raise LLMNotConfiguredError("openai")
            provider = OpenAIProvider(
                settings.openai_api_key.get_secret_value(), settings.openai_model, **options
            )
        case "mock":
            provider = MockProvider(
                schema_responses=_load_mock_schema_responses(settings), **options
            )
    limited = ConcurrencyLimitedProvider(provider, settings.llm_max_concurrent_requests)
    return UsageTrackingProvider(limited, record_ai_call)


def get_llm_provider(request: Request) -> LLMProvider:
    """FastAPI dependency: the application's provider, built on first use.

    Building lazily keeps the app (and ``/api/health``) usable when no API key is configured.
    """
    provider: LLMProvider | None = request.app.state.llm_provider
    if provider is None:
        provider = create_provider(request.app.state.settings)
        request.app.state.llm_provider = provider
    return provider
