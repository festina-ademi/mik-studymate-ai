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
    gemini_model: str = "gemini-flash-latest"
    openai_model: str = "gpt-4.1-mini"
    llm_temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    llm_max_output_tokens: int = Field(default=4096, gt=0)
    llm_timeout_seconds: float = Field(default=60.0, gt=0)
    llm_max_retries: int = Field(default=3, ge=0)
    llm_retry_base_delay_seconds: float = Field(default=1.0, ge=0)
    # Caps how many LLM calls run at once across the whole process (see
    # app.llm.concurrency.ConcurrencyLimitedProvider). Extra callers queue rather than all firing
    # at once, which matters most on a small single-instance deployment with a free-tier model
    # provider's own rate limit.
    llm_max_concurrent_requests: int = Field(default=4, gt=0)
    # Path to a JSON file of {schema class name: response object} used only when
    # llm_provider=mock, to give MockProvider realistic, deterministic structured answers instead
    # of its default minimal schema sample. Built for the Playwright e2e suite; never set this in
    # a real deployment. See app.llm.mock.MockProvider's `schema_responses` and
    # docs/DEPLOYMENT.md.
    mock_llm_fixtures_path: Path | None = Field(default=None)

    # "local" loads a sentence-transformers model on-device (default: free, offline once
    # downloaded, but needs the model's RAM/disk). "gemini"/"openai" call that provider's
    # embedding endpoint instead, so a small server can skip the local model entirely. "hash" is
    # a deterministic, dependency-free bag-of-tokens fallback with no real semantic understanding
    # — never use it in production, only for tests and the Playwright e2e flow (paired with
    # LLM_PROVIDER=mock), where it makes retrieval instant and reproducible without downloading
    # or calling any model.
    embedding_provider: Literal["local", "gemini", "openai", "hash"] = "local"
    embedding_model: str = "paraphrase-multilingual-MiniLM-L12-v2"
    gemini_embedding_model: str = "gemini-embedding-001"
    openai_embedding_model: str = "text-embedding-3-small"

    # Retrieval: fetch_k candidates are embedded and ranked, then MMR re-ranks down to top_k,
    # trading some pure relevance for diversity (mmr_lambda=1.0 would disable that trade-off).
    rag_top_k: int = Field(default=4, gt=0)
    rag_fetch_k: int = Field(default=12, gt=0)
    rag_mmr_lambda: float = Field(default=0.5, ge=0.0, le=1.0)
    # Number of prior tutor messages (user + assistant turns combined) kept as conversation
    # memory and replayed to the model on the next question.
    tutor_history_messages: int = Field(default=6, ge=0)

    # Topic mastery (0..1, an exponentially weighted moving average of quiz scores) is
    # classified weak/developing/strong for the mastery panel, weak-topic re-explanations,
    # and the tutor's learner profile.
    mastery_weak_threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    mastery_developing_threshold: float = Field(default=0.75, ge=0.0, le=1.0)
    mastery_ewma_alpha: float = Field(default=0.3, gt=0.0, le=1.0)

    database_url: str = "sqlite:///./data/studymate.db"
    chroma_dir: Path = Path("./data/chroma")
    upload_dir: Path = Path("./data/uploads")
    max_upload_mb: int = Field(default=25, gt=0)
    max_json_body_kb: int = Field(default=1024, gt=0)

    rate_limit_enabled: bool = True
    rate_limit_requests: int = Field(default=120, gt=0)
    rate_limit_window_seconds: float = Field(default=60.0, gt=0)

    # Daily per-client quotas, reset at the client's local midnight; 0 disables one. AI requests
    # are calls to the LLM provider (summaries, explanations, quizzes, grading, tutor, Explainer
    # Mode); the default keeps a small class well inside Gemini's free tier (1,500 requests/day).
    quota_daily_gemini_requests: int = Field(default=50, ge=0)
    quota_daily_uploads: int = Field(default=5, ge=0)

    admin_password: SecretStr | None = None
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )

    # Explainer Mode: sectioning targets ~1 minute of speech per section (roughly this many
    # words of source material feeding it) and caps how many sections a huge document gets.
    explainer_target_words_per_section: int = Field(default=220, gt=0)
    explainer_max_sections: int = Field(default=12, gt=0)
    explainer_mini_quiz_questions: int = Field(default=3, ge=2, le=3)

    # Server-side TTS (Meta MMS-TTS, Phase 4c) is the primary voice for the Avatar tab as of
    # this phase, hence the `True` default: `transformers` is now a plain (non-optional)
    # requirements.txt dependency. The frontend still falls back to the browser's
    # speechSynthesis voice automatically if a model fails to load or synthesis errors out, so
    # the app keeps working either way; this flag exists to let a deployment turn the whole
    # feature off deliberately (e.g. a host with no spare RAM for the model). Kept as
    # FEATURE_SERVER_TTS for consistency with the other FEATURE_* flags below, rather than the
    # Phase 4c brief's literal TTS_ENABLED name — the same reasoning as this file's other
    # FEATURE_* flags already documents.
    feature_server_tts: bool = True
    tts_model_sq: str = "facebook/mms-tts-sqi"
    tts_model_en: str = "facebook/mms-tts-eng"
    # Renamed from tts_audio_dir (Phase 4c): it is a content-addressed cache, not a general
    # audio folder, and TTS_CACHE_DIR now also has an eviction cap (tts_cache_max_mb).
    tts_cache_dir: Path = Path("./data/tts_cache")
    tts_cache_max_mb: int = Field(default=500, gt=0)
    # Hugging Face's own cache root (models for both TTS and the local embedding provider), set
    # here instead of left to default to the user's home directory, so a deployment's whole
    # model footprint stays inside the project tree alongside chroma_dir/upload_dir. Applied to
    # the process environment in app.main.create_app, before anything can import `transformers`
    # or `sentence-transformers` and read it.
    hf_home: Path = Path("./data/hf_cache")
    feature_study_mode: bool = True
    feature_explainer_mode: bool = True

    # Study Mode (PROJECT_SPEC.md section 9): a controlled experiment comparing an
    # AI-assisted (experimental) group against a control group that only gets the plain
    # material viewer. Block size 4 keeps the two arms within 2 of each other at every point,
    # converging on an even split (e.g. 20/20 for a 40-person study).
    study_block_size: int = Field(default=4, gt=0)
    # Length of the fixed study session before the frontend auto-transitions to the test.
    study_session_minutes: int = Field(default=20, gt=0)
    study_retention_delay_days: int = Field(default=7, gt=0)
    # Dev-only override: when set, the retention test unlocks this many MINUTES after the
    # immediate test instead of `study_retention_delay_days`. Never set this in a real study.
    study_retention_delay_dev_minutes: int | None = Field(default=None, gt=0)
    # Off by default: short-answer items are scored by the deterministic keyword rubric (see
    # app.study.scoring). Turning this on additionally asks the LLM to score short answers,
    # and that score becomes the recorded one — a deliberate methodological choice.
    study_llm_assisted_scoring: bool = False

    # How long a signed-in admin session stays valid before needing to log in again.
    admin_session_hours: int = Field(default=8, gt=0)

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

    @field_validator("study_retention_delay_dev_minutes", "mock_llm_fixtures_path", mode="before")
    @classmethod
    def _blank_optional_is_unset(cls, value: object) -> object:
        """Treat an empty value in ``.env`` (``KEY=``, as in ``.env.example``) as not set."""
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

    @property
    def tts_cache_max_bytes(self) -> int:
        """TTS disk cache eviction cap in bytes."""
        return self.tts_cache_max_mb * _BYTES_PER_MB


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings instance."""
    return Settings()
