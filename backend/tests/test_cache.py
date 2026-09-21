from collections.abc import AsyncIterator
from dataclasses import replace

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.db.models import GeneratedContent
from app.db.session import SessionFactory
from app.domain import Language, Level, Task
from app.llm import LLMTimeoutError, MockProvider, RetryPolicy
from app.prompts import PROMPT_VERSION
from app.services.cache import CacheKey, ContentCache

KEY = CacheKey(
    document_hash="a" * 64,
    task=Task.SUMMARY,
    level=Level.BEGINNER,
    language=Language.EN,
    model="mock-model",
    prompt_version="1",
)


def entry_count(session_factory: SessionFactory) -> int:
    with session_factory() as session:
        return session.scalar(select(func.count()).select_from(GeneratedContent)) or 0


# --- key --------------------------------------------------------------------------------


def test_digest_is_stable_and_hex() -> None:
    assert KEY.digest() == replace(KEY).digest()
    assert len(KEY.digest()) == 64
    int(KEY.digest(), 16)


@pytest.mark.parametrize(
    "change",
    [
        {"document_hash": "b" * 64},
        {"task": Task.EXPLANATION},
        {"level": Level.ADVANCED},
        {"language": Language.SQ},
        {"model": "other-model"},
        {"prompt_version": "2"},
    ],
)
def test_every_key_part_changes_the_digest(change: dict[str, object]) -> None:
    assert replace(KEY, **change).digest() != KEY.digest()


def test_key_uses_the_current_prompt_version_by_default() -> None:
    key = CacheKey("h", Task.SUMMARY, Level.BEGINNER, Language.EN, "m")

    assert key.prompt_version == PROMPT_VERSION


def test_parts_cannot_be_shifted_between_fields() -> None:
    first = CacheKey("ab", Task.SUMMARY, Level.BEGINNER, Language.EN, "c")
    second = CacheKey("a", Task.SUMMARY, Level.BEGINNER, Language.EN, "bc")

    assert first.digest() != second.digest()


# --- get / put --------------------------------------------------------------------------


def test_miss_then_hit(session_factory: SessionFactory) -> None:
    cache = ContentCache(session_factory)

    assert cache.get(KEY) is None
    cache.put(KEY, "cached text")
    assert cache.get(KEY) == "cached text"


def test_entries_are_shared_between_cache_instances(session_factory: SessionFactory) -> None:
    ContentCache(session_factory).put(KEY, "shared")

    assert ContentCache(session_factory).get(KEY) == "shared"


def test_put_replaces_an_existing_entry(session_factory: SessionFactory) -> None:
    cache = ContentCache(session_factory)

    cache.put(KEY, "old")
    cache.put(KEY, "new")

    assert cache.get(KEY) == "new"
    assert entry_count(session_factory) == 1


def test_key_fields_are_stored_with_the_entry(session_factory: SessionFactory) -> None:
    ContentCache(session_factory).put(KEY, "text")

    with session_factory() as session:
        entry = session.scalars(select(GeneratedContent)).one()

    assert (entry.document_hash, entry.task, entry.level, entry.language) == (
        KEY.document_hash,
        Task.SUMMARY,
        Level.BEGINNER,
        Language.EN,
    )
    assert (entry.model, entry.prompt_version) == ("mock-model", "1")


def test_blank_content_is_not_cached(session_factory: SessionFactory) -> None:
    cache = ContentCache(session_factory)

    cache.put(KEY, "   \n")

    assert cache.get(KEY) is None


@pytest.mark.parametrize(
    "change",
    [
        {"level": Level.INTERMEDIATE},
        {"language": Language.SQ},
        {"task": Task.EXPLANATION},
        {"model": "another-model"},
        {"prompt_version": "2"},
        {"document_hash": "c" * 64},
    ],
)
def test_a_different_key_is_a_miss(
    session_factory: SessionFactory, change: dict[str, object]
) -> None:
    cache = ContentCache(session_factory)
    cache.put(KEY, "text")

    assert cache.get(replace(KEY, **change)) is None


def test_put_recovers_when_another_request_inserted_the_same_key(
    session_factory: SessionFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    cache = ContentCache(session_factory)
    real_upsert = cache._upsert  # noqa: SLF001
    attempts: list[str] = []

    def racing_upsert(key: CacheKey, content: str) -> None:
        attempts.append(content)
        if len(attempts) == 1:
            real_upsert(key, "written by the other request")
            raise IntegrityError("INSERT", {}, Exception("unique constraint"))
        real_upsert(key, content)

    monkeypatch.setattr(cache, "_upsert", racing_upsert)

    cache.put(KEY, "mine")

    assert cache.get(KEY) == "mine"
    assert entry_count(session_factory) == 1


# --- get_or_generate --------------------------------------------------------------------


@pytest.mark.anyio
async def test_get_or_generate_calls_the_model_once_then_hits(
    session_factory: SessionFactory,
) -> None:
    provider = MockProvider(["generated summary"])
    cache = ContentCache(session_factory)

    async def generate() -> str:
        return await provider.generate("summarize")

    first = await cache.get_or_generate(KEY, generate)
    second = await cache.get_or_generate(KEY, generate)

    assert (first.content, first.hit) == ("generated summary", False)
    assert (second.content, second.hit) == ("generated summary", True)
    assert len(provider.calls) == 1


@pytest.mark.anyio
async def test_changing_level_or_language_generates_again(session_factory: SessionFactory) -> None:
    provider = MockProvider(["for beginners", "for advanced", "in Albanian"])
    cache = ContentCache(session_factory)

    async def generate() -> str:
        return await provider.generate("summarize")

    beginner = await cache.get_or_generate(KEY, generate)
    advanced = await cache.get_or_generate(replace(KEY, level=Level.ADVANCED), generate)
    albanian = await cache.get_or_generate(replace(KEY, language=Language.SQ), generate)
    beginner_again = await cache.get_or_generate(KEY, generate)

    assert [r.hit for r in (beginner, advanced, albanian, beginner_again)] == [
        False,
        False,
        False,
        True,
    ]
    assert beginner_again.content == "for beginners"
    assert len(provider.calls) == 3


@pytest.mark.anyio
async def test_a_failed_generation_is_not_cached(session_factory: SessionFactory) -> None:
    provider = MockProvider([LLMTimeoutError()], retry_policy=RetryPolicy(max_retries=0))
    cache = ContentCache(session_factory)

    async def generate() -> str:
        return await provider.generate("summarize")

    with pytest.raises(LLMTimeoutError):
        await cache.get_or_generate(KEY, generate)

    assert cache.get(KEY) is None


# --- streaming --------------------------------------------------------------------------


async def collect(stream: AsyncIterator[str]) -> str:
    return "".join([piece async for piece in stream])


@pytest.mark.anyio
async def test_stream_miss_streams_and_caches_then_hit_replays(
    session_factory: SessionFactory,
) -> None:
    text = "A long enough summary to be split into several replayed pieces. " * 4
    provider = MockProvider([text], chunk_size=10)
    cache = ContentCache(session_factory)

    first = await collect(cache.stream(KEY, lambda: provider.stream("summarize")))
    replay_pieces = [piece async for piece in cache.stream(KEY, lambda: provider.stream("x"))]

    assert first == text
    assert "".join(replay_pieces) == text
    assert len(replay_pieces) > 1
    assert len(provider.calls) == 1  # the replay did not call the model


@pytest.mark.anyio
async def test_stream_that_fails_midway_is_not_cached(session_factory: SessionFactory) -> None:
    async def broken() -> AsyncIterator[str]:
        yield "partial"
        raise LLMTimeoutError

    cache = ContentCache(session_factory)

    with pytest.raises(LLMTimeoutError):
        await collect(cache.stream(KEY, broken))

    assert cache.get(KEY) is None


@pytest.mark.anyio
async def test_abandoned_stream_is_not_cached(session_factory: SessionFactory) -> None:
    provider = MockProvider(["some text that will be abandoned"], chunk_size=4)
    cache = ContentCache(session_factory)

    stream = cache.stream(KEY, lambda: provider.stream("summarize"))
    assert await anext(stream)  # the client reads one piece, then disconnects
    await stream.aclose()  # type: ignore[attr-defined]

    assert cache.get(KEY) is None
