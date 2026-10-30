"""Deterministic provider for tests and offline demos (``LLM_PROVIDER=mock``)."""

import asyncio
import hashlib
import json
from collections import deque
from collections.abc import AsyncIterator, Callable, Iterable
from typing import Any

from pydantic import BaseModel

from app.llm.base import LLMProvider, LLMRequest


async def _no_sleep(_seconds: float) -> None:
    """Skip real waiting so retry tests run instantly."""


def sample_from_schema(schema: dict[str, Any], root: dict[str, Any] | None = None) -> object:
    """Build a minimal value that satisfies a (Pydantic-generated) JSON Schema."""
    root = root or schema
    if "$ref" in schema:
        return sample_from_schema(root["$defs"][schema["$ref"].rsplit("/", 1)[-1]], root)
    for keyword in ("const", "default"):
        if keyword in schema:
            return schema[keyword]
    if "enum" in schema:
        return schema["enum"][0]
    for keyword in ("anyOf", "oneOf"):
        if keyword in schema:
            options = [option for option in schema[keyword] if option.get("type") != "null"]
            return sample_from_schema(options[0], root) if options else None
    match schema.get("type"):
        case "object":
            required = set(schema.get("required", []))
            return {
                name: sample_from_schema(prop, root)
                for name, prop in schema.get("properties", {}).items()
                if name in required
            }
        case "array":
            item_schema = schema.get("items", {})
            return [sample_from_schema(item_schema, root) for _ in range(schema.get("minItems", 0))]
        case "string":
            return "mock".ljust(schema.get("minLength", 0), "x")
        case "integer":
            return max(0, schema.get("minimum", 0))
        case "number":
            return float(max(0, schema.get("minimum", 0)))
        case "boolean":
            return False
        case _:
            return None


class MockProvider(LLMProvider):
    """Returns scripted answers, or deterministic ones when the script is empty.

    Every attempt (including retries) is recorded in :attr:`calls`. Put an exception in the
    script to make that attempt fail, e.g. ``MockProvider([LLMRateLimitError(), "ok"])``.
    """

    name = "mock"

    def __init__(
        self,
        responses: Iterable[str | Exception] = (),
        *,
        model: str = "mock-model",
        chunk_size: int = 16,
        schema_responses: dict[str, str] | None = None,
        **kwargs: Any,  # noqa: ANN401 - forwarded to LLMProvider
    ) -> None:
        """Create the provider.

        Args:
            responses: Answers (or exceptions to raise) consumed one per attempt, in order.
            model: Model name reported by the provider.
            chunk_size: Characters per streamed piece.
            schema_responses: Optional ``{schema class name: raw JSON text}`` map, checked before
                ``responses``/the default sampler on every ``generate_json`` call. Unlike
                ``responses``, it is keyed by the requested schema rather than call order, so it
                stays correct across a whole realistic multi-step flow (e.g. the Playwright e2e
                test, wired up via ``MOCK_LLM_FIXTURES_PATH``) regardless of exactly how many
                times each schema is requested or in what order — a request for a schema with no
                entry here falls through to ``responses``/the default sampler as usual.
            **kwargs: Forwarded to :class:`LLMProvider`; ``sleep`` defaults to a no-op.
        """
        kwargs.setdefault("sleep", _no_sleep)
        super().__init__(model, **kwargs)
        self._script: deque[str | Exception] = deque(responses)
        self._chunk_size = chunk_size
        self._schema_responses = schema_responses or {}
        self.calls: list[LLMRequest] = []

    def enqueue(self, *responses: str | Exception) -> None:
        """Append more scripted answers."""
        self._script.extend(responses)

    async def _generate(self, request: LLMRequest) -> str:
        return self._next(request, lambda: _default_text(request))

    async def _stream(self, request: LLMRequest) -> AsyncIterator[str]:
        text = self._next(request, lambda: _default_text(request))
        for start in range(0, len(text), self._chunk_size):
            await asyncio.sleep(0)
            yield text[start : start + self._chunk_size]

    async def _generate_json_text(self, request: LLMRequest, schema: type[BaseModel]) -> str:
        if schema.__name__ in self._schema_responses:
            self.calls.append(request)
            return self._schema_responses[schema.__name__]
        return self._next(
            request, lambda: json.dumps(sample_from_schema(schema.model_json_schema()))
        )

    def _next(self, request: LLMRequest, default: Callable[[], str]) -> str:
        self.calls.append(request)
        if not self._script:
            return default()
        item = self._script.popleft()
        if isinstance(item, Exception):
            raise item
        return item


def _default_text(request: LLMRequest) -> str:
    digest = hashlib.sha256(f"{request.system}\n{request.prompt}".encode()).hexdigest()[:8]
    return f"[mock:{digest}] {request.prompt[:80]}"
