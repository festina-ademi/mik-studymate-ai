"""Cache for generated content.

Entries are keyed by ``(document hash, task, level, language, model, prompt version)``, so a
change in any of them (including a new prompt version) produces a fresh generation. The cache
opens a short database session per operation, so it is safe to use from streaming responses.
"""

import asyncio
import hashlib
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db.models import GeneratedContent
from app.db.session import SessionFactory
from app.domain import Language, Level, Task
from app.prompts.version import PROMPT_VERSION

_REPLAY_CHUNK_CHARS = 64


@dataclass(frozen=True)
class CacheKey:
    """Everything that determines a generated answer."""

    document_hash: str
    task: Task
    level: Level
    language: Language
    model: str
    prompt_version: str = PROMPT_VERSION

    def digest(self) -> str:
        """Stable SHA-256 of the key parts (joined with a separator that cannot occur in them)."""
        parts = (
            self.document_hash,
            self.task.value,
            self.level.value,
            self.language.value,
            self.model,
            self.prompt_version,
        )
        return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()


@dataclass(frozen=True)
class CachedResult:
    """Result of :meth:`ContentCache.get_or_generate`."""

    content: str
    hit: bool


class ContentCache:
    """Database-backed cache of generated text."""

    def __init__(self, session_factory: SessionFactory) -> None:
        """Use ``session_factory`` to talk to the database."""
        self._session_factory = session_factory

    def get(self, key: CacheKey) -> str | None:
        """Return the cached text for ``key``, or ``None`` on a miss."""
        with self._session_factory() as session:
            return session.scalar(
                select(GeneratedContent.content).where(GeneratedContent.cache_key == key.digest())
            )

    def put(self, key: CacheKey, content: str) -> None:
        """Store ``content`` under ``key``, replacing any existing entry. Blank text is skipped."""
        if not content.strip():
            return
        try:
            self._upsert(key, content)
        except IntegrityError:
            # Another request stored the same key between our lookup and insert.
            self._upsert(key, content)

    def _upsert(self, key: CacheKey, content: str) -> None:
        with self._session_factory() as session:
            entry = session.scalar(
                select(GeneratedContent).where(GeneratedContent.cache_key == key.digest())
            )
            if entry is None:
                session.add(
                    GeneratedContent(
                        cache_key=key.digest(),
                        document_hash=key.document_hash,
                        task=key.task,
                        level=key.level,
                        language=key.language,
                        model=key.model,
                        prompt_version=key.prompt_version,
                        content=content,
                    )
                )
            else:
                entry.content = content
            session.commit()

    async def get_or_generate(
        self, key: CacheKey, generate: Callable[[], Awaitable[str]]
    ) -> CachedResult:
        """Return cached text, or call ``generate`` on a miss and cache its result."""
        cached = self.get(key)
        if cached is not None:
            return CachedResult(cached, hit=True)
        content = await generate()
        self.put(key, content)
        return CachedResult(content, hit=False)

    async def stream(
        self, key: CacheKey, produce: Callable[[], AsyncIterator[str]]
    ) -> AsyncIterator[str]:
        """Yield cached text in pieces, or stream ``produce()`` and cache it once complete.

        A generation that fails or is abandoned part-way (for example because the client
        disconnected) is not cached.
        """
        cached = self.get(key)
        if cached is not None:
            for start in range(0, len(cached), _REPLAY_CHUNK_CHARS):
                yield cached[start : start + _REPLAY_CHUNK_CHARS]
                await asyncio.sleep(0)
            return
        pieces: list[str] = []
        async for piece in produce():
            pieces.append(piece)
            yield piece
        self.put(key, "".join(pieces))
