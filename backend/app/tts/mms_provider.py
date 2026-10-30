"""Meta MMS-TTS speech synthesis (``facebook/mms-tts-sqi`` / ``facebook/mms-tts-eng``).

Importing this module never requires ``transformers``/``torch`` to actually run anything: the
heavy ``from transformers import ...`` happens lazily, inside :meth:`MmsTtsProvider._load`, the
first time a given language is actually needed. That keeps FastAPI startup fast (no model load
on deploy) and lets the rest of the app import this module even in an environment where the ML
stack is not installed — ``synthesize`` then simply raises, and the caller (the frontend, via
``/api/tts/synthesize``) falls back to the browser's own voice.
"""

from __future__ import annotations

import io
import logging
import threading
from typing import Literal

logger = logging.getLogger(__name__)

Language = Literal["sq", "en"]
_FALLBACK_SAMPLE_RATE = 16_000


class MmsTtsProvider:
    """Loads and runs MMS-TTS models for Albanian and English, keeping each warm once loaded."""

    def __init__(self, *, model_sq: str, model_en: str) -> None:
        """Configure the two model names; nothing is loaded yet."""
        self._model_names: dict[Language, str] = {"sq": model_sq, "en": model_en}
        # Synthesis runs in worker threads (see ``app.api.tts``): one inference at a time, so
        # concurrent requests never load a model twice or split the CPU between two inferences
        # (each would finish later than if they ran back to back).
        self._lock = threading.Lock()
        # model name -> (tokenizer, model). Untyped (object, not the real transformers classes)
        # so this module's own type checking never requires transformers to be installed.
        self._loaded: dict[str, tuple[object, object]] = {}

    def _model_name(self, language: Language) -> str:
        return self._model_names[language]

    def is_model_loaded(self, language: Language) -> bool:
        """Whether ``language``'s model is already warm in memory (never forces a load)."""
        return self._model_name(language) in self._loaded

    def is_available(self) -> bool:
        """Quick health check: can the ML stack this provider needs actually be imported?

        Deliberately does *not* load a model — a first-time MMS-TTS download can take several
        minutes (see module docstring), and the frontend calls this once per session on mount
        to decide whether to attempt server TTS at all, so it needs to answer quickly rather
        than pay that cost just to report health. A model that merely fails to download or
        load is instead reported by ``synthesize`` raising, at which point the frontend's
        fallback to the browser voice applies.
        """
        try:
            import torch  # noqa: F401, PLC0415
            import transformers  # noqa: F401, PLC0415
        except ImportError:
            return False
        return True

    def _load(self, model_name: str) -> tuple[object, object]:
        """Lazily load and keep ``model_name``'s tokenizer+model warm in memory."""
        if model_name not in self._loaded:
            logger.info("tts_model_loading model=%s hint=first_use_may_download_200mb", model_name)
            from transformers import AutoTokenizer, VitsModel  # noqa: PLC0415

            tokenizer = AutoTokenizer.from_pretrained(model_name)
            model = VitsModel.from_pretrained(model_name)
            model.eval()
            self._loaded[model_name] = (tokenizer, model)
            logger.info("tts_model_ready model=%s", model_name)
        return self._loaded[model_name]

    def synthesize(self, text: str, language: Language) -> bytes:
        """Synthesize ``text`` in ``language`` and return 16 kHz mono WAV bytes.

        Raises whatever the underlying import/model/inference step raises (``ImportError`` if
        ``transformers``/``torch`` are missing, or any exception from the model itself); the
        caller is responsible for turning that into the documented ``tts_*`` error codes.
        """
        import torch  # noqa: PLC0415

        with self._lock:
            tokenizer, model = self._load(self._model_name(language))
            inputs = tokenizer(text, return_tensors="pt")
            with torch.no_grad():
                waveform = model(**inputs).waveform.squeeze().cpu().numpy()
        sample_rate = getattr(model.config, "sampling_rate", _FALLBACK_SAMPLE_RATE)
        return _encode_wav(waveform, sample_rate)


def _encode_wav(waveform: object, sample_rate: int) -> bytes:
    """Encode a float32 waveform in [-1, 1] as 16-bit PCM WAV bytes via ``soundfile``."""
    import numpy as np  # noqa: PLC0415 - already a transitive dependency of chromadb
    import soundfile as sf  # noqa: PLC0415

    clipped = np.clip(waveform, -1.0, 1.0).astype(np.float32)
    buffer = io.BytesIO()
    sf.write(buffer, clipped, sample_rate, format="WAV", subtype="PCM_16")
    return buffer.getvalue()
