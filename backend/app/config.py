"""Application settings loaded from environment variables and an optional ``.env`` file."""

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
_BYTES_PER_MB = 1024 * 1024


class Settings(BaseSettings):
    """All runtime configuration. Every value can be overridden through the environment."""

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: Literal["development", "production", "test"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"

    llm_provider: Literal["gemini", "openai", "mock"] = "gemini"
    gemini_api_key: SecretStr | None = None
    openai_api_key: SecretStr | None = None
    gemini_model: str = "gemini-2.5-flash"
    openai_model: str = "gpt-4.1-mini"
    llm_temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    llm_max_output_tokens: int = Field(default=4096, gt=0)
    llm_timeout_seconds: float = Field(default=60.0, gt=0)
    llm_max_retries: int = Field(default=3, ge=0)
    llm_retry_base_delay_seconds: float = Field(default=1.0, ge=0)

    embedding_provider: Literal["local", "gemini", "openai"] = "local"
    embedding_model: str = "paraphrase-multilingual-MiniLM-L12-v2"

    database_url: str = "sqlite:///./data/studymate.db"
    chroma_dir: Path = Path("./data/chroma")
    upload_dir: Path = Path("./data/uploads")
    max_upload_mb: int = Field(default=25, gt=0)
    max_json_body_kb: int = Field(default=1024, gt=0)

    rate_limit_enabled: bool = True
    rate_limit_requests: int = Field(default=120, gt=0)
    rate_limit_window_seconds: float = Field(default=60.0, gt=0)

    admin_password: SecretStr | None = None
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )

    feature_server_tts: bool = False
    feature_study_mode: bool = True
    feature_explainer_mode: bool = True

    @field_validator("log_level", mode="before")
    @classmethod
    def _normalize_log_level(cls, value: object) -> object:
        """Accept log levels in any letter case."""
        return value.upper() if isinstance(value, str) else value

    @field_validator("gemini_api_key", "openai_api_key", "admin_password", mode="before")
    @classmethod
    def _blank_secret_is_unset(cls, value: object) -> object:
        """Treat an empty value in ``.env`` (``KEY=``) as not configured."""
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_cors_origins(cls, value: object) -> object:
        """Allow ``CORS_ORIGINS`` to be a comma-separated string."""
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @property
    def max_upload_bytes(self) -> int:
        """Maximum upload size in bytes."""
        return self.max_upload_mb * _BYTES_PER_MB

    @property
    def max_json_body_bytes(self) -> int:
        """Maximum size of a non-upload request body in bytes."""
        return self.max_json_body_kb * 1024


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings instance."""
    return Settings()
