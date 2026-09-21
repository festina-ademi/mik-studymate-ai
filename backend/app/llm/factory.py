"""Choose and build the LLM provider from configuration."""

from fastapi import Request

from app.config import Settings
from app.llm.base import LLMProvider
from app.llm.errors import LLMNotConfiguredError
from app.llm.gemini import GeminiProvider
from app.llm.mock import MockProvider
from app.llm.openai_provider import OpenAIProvider
from app.llm.retry import RetryPolicy


def create_provider(settings: Settings) -> LLMProvider:
    """Build the provider selected by ``LLM_PROVIDER``.

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
            return GeminiProvider(
                settings.gemini_api_key.get_secret_value(), settings.gemini_model, **options
            )
        case "openai":
            if settings.openai_api_key is None:
                raise LLMNotConfiguredError("openai")
            return OpenAIProvider(
                settings.openai_api_key.get_secret_value(), settings.openai_model, **options
            )
        case "mock":
            return MockProvider(**options)


def get_llm_provider(request: Request) -> LLMProvider:
    """FastAPI dependency: the application's provider, built on first use.

    Building lazily keeps the app (and ``/api/health``) usable when no API key is configured.
    """
    provider: LLMProvider | None = request.app.state.llm_provider
    if provider is None:
        provider = create_provider(request.app.state.settings)
        request.app.state.llm_provider = provider
    return provider
