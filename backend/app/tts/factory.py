"""Build the process-wide ``MmsTtsProvider`` from configuration."""

from fastapi import Request

from app.tts.mms_provider import MmsTtsProvider


def get_tts_provider(request: Request) -> MmsTtsProvider:
    """FastAPI dependency: the application's TTS provider, built on first use.

    Building the provider itself is cheap (it just records the two model names); the actual
    model weights are loaded later, lazily, inside ``MmsTtsProvider.synthesize`` — never here
    and never at startup.
    """
    provider: MmsTtsProvider | None = getattr(request.app.state, "tts_provider", None)
    if provider is None:
        settings = request.app.state.settings
        provider = MmsTtsProvider(model_sq=settings.tts_model_sq, model_en=settings.tts_model_en)
        request.app.state.tts_provider = provider
    return provider
