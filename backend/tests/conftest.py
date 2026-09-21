from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from app.config import Settings
from app.db.session import SessionFactory, create_engine, create_session_factory, init_db
from app.llm import MockProvider, RetryPolicy
from app.main import create_app


@pytest.fixture
def anyio_backend() -> str:
    """Run async tests on asyncio only."""
    return "asyncio"


@pytest.fixture
def settings() -> Settings:
    """Settings that ignore any local .env file and use an in-memory database."""
    return Settings(_env_file=None, app_env="test", llm_provider="mock", database_url="sqlite://")


@pytest.fixture
def app(settings: Settings) -> FastAPI:
    return create_app(settings)


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


@pytest.fixture
def engine() -> Iterator[Engine]:
    """A fresh in-memory database with all tables created."""
    engine = create_engine("sqlite://")
    init_db(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def session_factory(engine: Engine) -> SessionFactory:
    return create_session_factory(engine)


@pytest.fixture
def mock_provider() -> MockProvider:
    """Mock provider with deterministic, jitter-free retries and no real waiting."""
    return MockProvider(retry_policy=RetryPolicy(max_retries=3, base_delay=1.0, jitter=False))
