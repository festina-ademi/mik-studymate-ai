"""Server-side text-to-speech: Meta MMS-TTS synthesis, disk caching, and the FastAPI routes."""

from app.tts.mms_provider import MmsTtsProvider

__all__ = ["MmsTtsProvider"]
