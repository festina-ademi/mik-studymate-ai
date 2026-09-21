"""Engine and session management.

Tables are created on application start-up with :func:`init_db` (``create_all``). This adds
missing tables but never alters existing ones: when a later phase changes the columns of an
existing table, delete the development database (or introduce Alembic migrations).
"""

from collections.abc import Iterator
from pathlib import Path

from fastapi import Request
from sqlalchemy import Engine, event
from sqlalchemy import create_engine as sa_create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.models import Base

SessionFactory = sessionmaker[Session]


def create_engine(database_url: str) -> Engine:
    """Create an engine for ``database_url`` (SQLite by default, PostgreSQL supported).

    SQLite gets foreign-key enforcement switched on and may be used from worker threads.
    In-memory SQLite databases share one connection so every session sees the same data.
    """
    url = make_url(database_url)
    if url.get_backend_name() != "sqlite":
        return sa_create_engine(url, pool_pre_ping=True)

    kwargs: dict[str, object] = {"connect_args": {"check_same_thread": False}}
    if url.database in (None, "", ":memory:"):
        kwargs["poolclass"] = StaticPool
    engine = sa_create_engine(url, **kwargs)

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection: object, _record: object) -> None:
        cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


def create_session_factory(engine: Engine) -> SessionFactory:
    """Create a session factory bound to ``engine``."""
    return sessionmaker(bind=engine, expire_on_commit=False)


def init_db(engine: Engine) -> None:
    """Create any missing tables. For file-based SQLite the parent folder is created first."""
    url = engine.url
    if url.get_backend_name() == "sqlite" and url.database not in (None, "", ":memory:"):
        Path(url.database).parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(engine)


def get_session(request: Request) -> Iterator[Session]:
    """FastAPI dependency yielding a session that is closed after the request."""
    session_factory: SessionFactory = request.app.state.session_factory
    with session_factory() as session:
        yield session
