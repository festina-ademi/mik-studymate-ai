"""Disk cache for synthesized TTS audio, content-addressed by text + language + model version.

A cache hit never touches the (slow, lazily-loaded) model at all. Writes are atomic (temp file
then rename) so a crash or concurrent request never leaves a corrupt half-written ``.wav`` that
a later read would serve. The cache has a size cap: once it exceeds ``max_bytes``, the oldest
files (by modification time) are deleted until it is back under 80% of the cap, and every cache
*hit* refreshes its file's mtime so frequently replayed sections are the least likely to be
evicted — a simple LRU approximation, not a strict one.
"""

from __future__ import annotations

import hashlib
import os
import uuid
from pathlib import Path
from typing import Protocol

# Bumped whenever the model or synthesis pipeline changes in a way that should invalidate
# previously cached audio (e.g. swapping MMS-TTS for a newer model); included in the cache key
# so old files simply stop being matched rather than needing an explicit migration/flush.
MODEL_VERSION = "mms_v1"

_EVICTION_TARGET_RATIO = 0.8


class SynthesizeFn(Protocol):
    """Anything with a ``synthesize(text, language) -> bytes`` method, e.g. ``MmsTtsProvider``."""

    def synthesize(self, text: str, language: str) -> bytes:
        """Return WAV audio bytes for ``text`` spoken in ``language``."""
        ...


def cache_key(text: str, language: str, *, model_version: str = MODEL_VERSION) -> str:
    """The content-addressed cache key for ``(text, language, model_version)``."""
    digest = hashlib.sha256()
    digest.update(text.encode("utf-8"))
    digest.update(b"\x1f")
    digest.update(language.encode("utf-8"))
    digest.update(b"\x1f")
    digest.update(model_version.encode("utf-8"))
    return digest.hexdigest()


def _cache_path(cache_dir: Path, text: str, language: str) -> Path:
    return cache_dir / f"{cache_key(text, language)}.wav"


def get_or_synthesize(
    text: str,
    language: str,
    provider: SynthesizeFn,
    *,
    cache_dir: Path,
    max_bytes: int,
) -> bytes:
    """Return cached audio for ``(text, language)``, synthesizing and caching it on a miss."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = _cache_path(cache_dir, text, language)
    if path.is_file():
        path.touch()  # mark as recently used, so eviction prefers to keep it
        return path.read_bytes()

    audio = provider.synthesize(text, language)
    _atomic_write(path, audio)
    _evict_if_needed(cache_dir, max_bytes=max_bytes)
    return audio


def _atomic_write(path: Path, data: bytes) -> None:
    tmp_path = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    tmp_path.write_bytes(data)
    os.replace(tmp_path, path)  # atomic on the same filesystem, on every platform this runs on


def _evict_if_needed(cache_dir: Path, *, max_bytes: int) -> None:
    """Delete the oldest ``*.wav`` files until the cache is back under the eviction target."""
    files = [(entry, entry.stat()) for entry in cache_dir.glob("*.wav") if entry.is_file()]
    total = sum(stat.st_size for _, stat in files)
    if total <= max_bytes:
        return

    target = int(max_bytes * _EVICTION_TARGET_RATIO)
    for entry, stat in sorted(files, key=lambda item: item[1].st_mtime):
        if total <= target:
            break
        entry.unlink(missing_ok=True)
        total -= stat.st_size
