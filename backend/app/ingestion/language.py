"""Language detection for Albanian and English text and comments."""

from __future__ import annotations

import re

from lingua import Language, LanguageDetectorBuilder

_LANGUAGE_MAP = {Language.ENGLISH: "en", Language.ALBANIAN: "sq"}
_ALBANIAN_HINTS = {
    "q",
    "gj",
    "dh",
    "sh",
    "zh",
    "th",
    "në",
    "të",
    "me",
    "pa",
    "nga",
    "kan",
    "sht",
    "për",
    "si",
}


def _normalize_text(text: str) -> str:
    """Normalize text before language detection."""
    if not text:
        return ""
    text = text.replace("\u00a0", " ")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return re.sub(r"\s+", " ", text).strip()


def detect_language(text: str) -> tuple[str, float]:
    """Detect Albanian vs English and return the language code plus confidence."""
    normalized = _normalize_text(text)
    if not normalized:
        return "en", 0.0

    detector = (
        LanguageDetectorBuilder.from_languages(Language.ENGLISH, Language.ALBANIAN)
        .with_preloaded_language_models()
        .build()
    )
    detected = detector.detect_language_of(normalized)
    if detected in _LANGUAGE_MAP:
        confidence = 0.0
        for item in detector.compute_language_confidence_values(normalized):
            if item.language == detected:
                confidence = float(item.value)
                break
        return _LANGUAGE_MAP[detected], max(confidence, 0.0)

    lowered = normalized.lower()
    if any(token in lowered for token in _ALBANIAN_HINTS):
        return "sq", 0.4
    return "en", 0.3


def detect_code_language(
    code_text: str,
    *,
    extension: str | None = None,
) -> tuple[str, float] | None:
    """Detect the language of comments/docstrings only when they are informative enough."""
    text = _normalize_text(code_text)
    if not text:
        return None

    comment_text = re.sub(r"\s*#+|//+|/\*+|\*+/|--+", " ", text)
    comment_text = re.sub(r"\s+", " ", comment_text).strip()
    if len(comment_text) < 40:
        return None

    language, confidence = detect_language(comment_text)
    if confidence < 0.25:
        return None
    if extension and extension.lower() in {".py", ".js", ".ts", ".jsx", ".tsx", ".java"}:
        return language, confidence
    return (language, confidence) if language in {"en", "sq"} else None
