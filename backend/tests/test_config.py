from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.main import create_app


def test_defaults_match_spec() -> None:
    settings = Settings(_env_file=None)

    assert settings.llm_provider == "gemini"
    assert settings.llm_temperature == 0.2
    assert settings.max_upload_mb == 25
    assert settings.max_upload_bytes == 25 * 1024 * 1024
    assert settings.gemini_api_key is None


def test_cors_origins_accept_comma_separated_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "https://a.example, https://b.example,")

    settings = Settings(_env_file=None)

    assert settings.cors_origins == ["https://a.example", "https://b.example"]


def test_blank_secrets_are_treated_as_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("ADMIN_PASSWORD", "  ")

    settings = Settings(_env_file=None)

    assert settings.gemini_api_key is None
    assert settings.admin_password is None


def test_secrets_are_masked_in_repr(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-very-secret")

    settings = Settings(_env_file=None)

    assert "sk-very-secret" not in repr(settings)
    assert settings.openai_api_key is not None
    assert settings.openai_api_key.get_secret_value() == "sk-very-secret"


def test_env_file_is_read(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("LLM_PROVIDER=openai\nLOG_LEVEL=debug\nFEATURE_SERVER_TTS=true\n")

    settings = Settings(_env_file=env_file)

    assert settings.llm_provider == "openai"
    assert settings.log_level == "DEBUG"
    assert settings.feature_server_tts is True


def test_invalid_provider_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, llm_provider="not-a-provider")  # type: ignore[arg-type]


def test_cors_allows_configured_origin_only() -> None:
    from fastapi.testclient import TestClient

    settings = Settings(_env_file=None, cors_origins=["http://localhost:5173"])
    client = TestClient(create_app(settings))

    allowed = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    denied = client.get("/api/health", headers={"Origin": "http://evil.example"})

    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "access-control-allow-origin" not in denied.headers
