"""Tests for server-side TTS: the MMS provider, the disk cache, and the API routes."""

from __future__ import annotations

import sys
import wave
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.tts.cache import cache_key, get_or_synthesize
from app.tts.mms_provider import MmsTtsProvider

# --- test doubles --------------------------------------------------------------------------


class _FakeTokenizer:
    """Duck-types `transformers.AutoTokenizer`'s call signature, no download needed."""

    def __call__(self, text: str, return_tensors: str = "pt") -> dict[str, object]:
        import torch

        length = max(1, min(len(text), 32))
        return {"input_ids": torch.zeros((1, length), dtype=torch.long)}


class _FakeModelConfig:
    sampling_rate = 16_000


class _FakeModelOutput:
    def __init__(self, waveform: object) -> None:
        self.waveform = waveform


class _FakeVitsModel:
    """Duck-types `transformers.VitsModel`: a deterministic, silent, short waveform."""

    config = _FakeModelConfig()

    def eval(self) -> None:
        return None

    def __call__(self, **kwargs: object) -> _FakeModelOutput:
        import torch

        return _FakeModelOutput(torch.zeros((1, 1, 1600)))  # 0.1s of silence at 16kHz


def _install_fake_models(provider: MmsTtsProvider, monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Make `provider._load` return the fakes above instead of downloading anything.

    Mirrors the real `_load`'s own memoization (checking/populating `provider._loaded`) so
    `is_model_loaded` and the "loaded once per language" behavior are exercised faithfully,
    not just bypassed.
    """
    calls: list[str] = []

    def fake_load(model_name: str) -> tuple[object, object]:
        if model_name not in provider._loaded:  # noqa: SLF001 - test double mirrors the real method
            calls.append(model_name)
            provider._loaded[model_name] = (_FakeTokenizer(), _FakeVitsModel())  # noqa: SLF001
        return provider._loaded[model_name]  # noqa: SLF001

    monkeypatch.setattr(provider, "_load", fake_load)
    return calls


class FakeTtsProvider:
    """A minimal `synthesize`/`is_available`/`is_model_loaded` double for API-level tests."""

    def __init__(self, *, available: bool = True) -> None:
        self.available = available
        self.calls: list[tuple[str, str]] = []
        self._loaded: set[str] = set()

    def synthesize(self, text: str, language: str) -> bytes:
        self.calls.append((text, language))
        self._loaded.add(language)
        return _tiny_wav_bytes()

    def is_available(self) -> bool:
        return self.available

    def is_model_loaded(self, language: str) -> bool:
        return language in self._loaded


def _tiny_wav_bytes() -> bytes:
    buffer = BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16_000)
        wav_file.writeframes(b"\x00\x00" * 100)
    return buffer.getvalue()


def make_client(**overrides: object) -> TestClient:
    overrides.setdefault("feature_server_tts", True)
    settings = Settings(
        _env_file=None,
        database_url="sqlite://",
        llm_provider="mock",
        **overrides,
    )
    return TestClient(create_app(settings))


# --- MmsTtsProvider --------------------------------------------------------------------------


def test_is_available_true_when_the_ml_stack_can_be_imported() -> None:
    # transformers/torch are real dependencies of this test environment, so this exercises the
    # actual import check without needing to fake anything.
    provider = MmsTtsProvider(model_sq="facebook/mms-tts-sqi", model_en="facebook/mms-tts-eng")

    assert provider.is_available() is True


def test_is_available_false_when_transformers_cannot_be_imported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setitem(sys.modules, "transformers", None)
    provider = MmsTtsProvider(model_sq="facebook/mms-tts-sqi", model_en="facebook/mms-tts-eng")

    assert provider.is_available() is False


def test_is_available_never_loads_a_model(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = MmsTtsProvider(model_sq="facebook/mms-tts-sqi", model_en="facebook/mms-tts-eng")
    calls = _install_fake_models(provider, monkeypatch)

    provider.is_available()

    assert calls == []
    assert provider.is_model_loaded("sq") is False
    assert provider.is_model_loaded("en") is False


@pytest.mark.parametrize("language", ["sq", "en"])
def test_synthesize_returns_non_empty_wav_bytes(
    language: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    provider = MmsTtsProvider(model_sq="facebook/mms-tts-sqi", model_en="facebook/mms-tts-eng")
    _install_fake_models(provider, monkeypatch)

    audio = provider.synthesize("Hello there.", language)  # type: ignore[arg-type]

    assert len(audio) > 0
    assert audio[:4] == b"RIFF"  # a real WAV header, confirming soundfile actually encoded it
    assert provider.is_model_loaded(language) is True  # type: ignore[arg-type]


def test_synthesize_loads_each_language_model_once(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = MmsTtsProvider(model_sq="facebook/mms-tts-sqi", model_en="facebook/mms-tts-eng")
    calls = _install_fake_models(provider, monkeypatch)

    provider.synthesize("First.", "en")
    provider.synthesize("Second.", "en")
    provider.synthesize("Third.", "sq")

    assert calls == ["facebook/mms-tts-eng", "facebook/mms-tts-sqi"]  # loaded once per language


# --- disk cache -------------------------------------------------------------------------------


def test_get_or_synthesize_hits_the_provider_once_then_serves_from_cache(tmp_path: Path) -> None:
    provider = FakeTtsProvider()

    first = get_or_synthesize(
        "Hello there.", "en", provider, cache_dir=tmp_path, max_bytes=10_000_000
    )
    second = get_or_synthesize(
        "Hello there.", "en", provider, cache_dir=tmp_path, max_bytes=10_000_000
    )

    assert first == second
    assert provider.calls == [("Hello there.", "en")]  # the second call never reached synthesize
    assert len(list(tmp_path.glob("*.wav"))) == 1


def test_cache_key_differs_by_text_language_and_model_version() -> None:
    base = cache_key("Hello.", "en")

    assert cache_key("Goodbye.", "en") != base
    assert cache_key("Hello.", "sq") != base
    assert cache_key("Hello.", "en", model_version="mms_v2") != base
    assert cache_key("Hello.", "en") == base  # deterministic


def test_cache_writes_are_atomic_no_tmp_files_left_behind(tmp_path: Path) -> None:
    provider = FakeTtsProvider()

    get_or_synthesize("Hello there.", "en", provider, cache_dir=tmp_path, max_bytes=10_000_000)

    leftovers = list(tmp_path.glob("*.tmp"))
    assert leftovers == []


def test_cache_eviction_deletes_oldest_files_once_over_the_cap(tmp_path: Path) -> None:
    provider = FakeTtsProvider()
    # Each synthesized file here is a few hundred bytes; a tiny cap forces eviction almost
    # immediately, and mtime (set by `_atomic_write`'s rename, in creation order) gives a
    # reliable oldest-first order to assert on.
    max_bytes = 900

    get_or_synthesize("one", "en", provider, cache_dir=tmp_path, max_bytes=max_bytes)
    first_file = next(iter(tmp_path.glob("*.wav")))
    get_or_synthesize("two", "en", provider, cache_dir=tmp_path, max_bytes=max_bytes)
    get_or_synthesize("three", "en", provider, cache_dir=tmp_path, max_bytes=max_bytes)
    get_or_synthesize("four", "en", provider, cache_dir=tmp_path, max_bytes=max_bytes)

    remaining = list(tmp_path.glob("*.wav"))
    total = sum(entry.stat().st_size for entry in remaining)
    assert total <= max_bytes
    assert not first_file.exists()  # the oldest entry was the one evicted


def test_a_cache_hit_refreshes_mtime_so_it_is_not_the_next_eviction_target(
    tmp_path: Path,
) -> None:
    provider = FakeTtsProvider()
    get_or_synthesize("keep me warm", "en", provider, cache_dir=tmp_path, max_bytes=10_000_000)
    warm_path = next(iter(tmp_path.glob("*.wav")))
    old_mtime = warm_path.stat().st_mtime - 1000
    import os

    os.utime(warm_path, (old_mtime, old_mtime))

    # A cache *hit* on the same text/language should touch it, not re-synthesize.
    get_or_synthesize("keep me warm", "en", provider, cache_dir=tmp_path, max_bytes=10_000_000)

    assert warm_path.stat().st_mtime > old_mtime
    assert provider.calls == [("keep me warm", "en")]  # only the original miss hit the provider


# --- API: POST /api/tts/synthesize -----------------------------------------------------------


def test_synthesize_endpoint_returns_200_audio_wav_for_valid_input(tmp_path: Path) -> None:
    client = make_client(tts_cache_dir=tmp_path)
    client.app.state.tts_provider = FakeTtsProvider()

    response = client.post("/api/tts/synthesize", json={"text": "Hello there.", "language": "en"})

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert len(response.content) > 0


def test_synthesize_endpoint_rejects_an_invalid_language(tmp_path: Path) -> None:
    client = make_client(tts_cache_dir=tmp_path)
    client.app.state.tts_provider = FakeTtsProvider()

    response = client.post("/api/tts/synthesize", json={"text": "Hello there.", "language": "fr"})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"


def test_synthesize_endpoint_rejects_empty_text(tmp_path: Path) -> None:
    client = make_client(tts_cache_dir=tmp_path)
    client.app.state.tts_provider = FakeTtsProvider()

    response = client.post("/api/tts/synthesize", json={"text": "   ", "language": "en"})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "EMPTY_DOCUMENT"


def test_synthesize_endpoint_is_disabled_when_the_feature_flag_is_off(tmp_path: Path) -> None:
    client = make_client(tts_cache_dir=tmp_path, feature_server_tts=False)
    client.app.state.tts_provider = FakeTtsProvider()

    response = client.post("/api/tts/synthesize", json={"text": "Hello there.", "language": "en"})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "tts_disabled"


def test_synthesize_endpoint_reports_a_clear_error_when_the_ml_stack_is_unavailable(
    tmp_path: Path,
) -> None:
    client = make_client(tts_cache_dir=tmp_path)
    client.app.state.tts_provider = FakeTtsProvider(available=False)

    response = client.post("/api/tts/synthesize", json={"text": "Hello there.", "language": "en"})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "tts_not_installed"


def test_synthesize_endpoint_second_call_is_a_cache_hit(tmp_path: Path) -> None:
    client = make_client(tts_cache_dir=tmp_path)
    fake = FakeTtsProvider()
    client.app.state.tts_provider = fake

    first = client.post("/api/tts/synthesize", json={"text": "Repeat me.", "language": "en"})
    second = client.post("/api/tts/synthesize", json={"text": "Repeat me.", "language": "en"})

    assert first.content == second.content
    assert fake.calls == [("Repeat me.", "en")]


# --- API: GET /api/tts/health -----------------------------------------------------------------


def test_health_endpoint_shape_when_available(tmp_path: Path) -> None:
    client = make_client(tts_cache_dir=tmp_path)
    fake = FakeTtsProvider()
    client.app.state.tts_provider = fake
    client.post("/api/tts/synthesize", json={"text": "Warm me up.", "language": "sq"})

    response = client.get("/api/tts/health")

    assert response.status_code == 200
    assert response.json() == {"available": True, "models_loaded": {"sq": True, "en": False}}


def test_health_endpoint_shape_when_unavailable(tmp_path: Path) -> None:
    client = make_client(tts_cache_dir=tmp_path)
    client.app.state.tts_provider = FakeTtsProvider(available=False)

    response = client.get("/api/tts/health")

    assert response.json() == {"available": False, "models_loaded": {"sq": False, "en": False}}


def test_health_endpoint_reports_unavailable_when_the_feature_flag_is_off(tmp_path: Path) -> None:
    client = make_client(tts_cache_dir=tmp_path, feature_server_tts=False)
    client.app.state.tts_provider = FakeTtsProvider(available=True)

    response = client.get("/api/tts/health")

    assert response.json()["available"] is False


def test_health_endpoint_never_triggers_a_real_model_load(tmp_path: Path) -> None:
    """A real `MmsTtsProvider` (no fake): calling /health must stay fast and not download."""
    client = make_client(tts_cache_dir=tmp_path)

    response = client.get("/api/tts/health")

    assert response.status_code == 200
    body = response.json()
    assert body["available"] is True  # transformers/torch really are importable here
    assert body["models_loaded"] == {"sq": False, "en": False}  # but nothing was loaded
