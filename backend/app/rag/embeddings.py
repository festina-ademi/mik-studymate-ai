"""Embedding abstractions: a deterministic offline fallback plus the real providers.

``HashingEmbeddingProvider`` needs no model and no network; it is used by tests and as a
last-resort fallback, the same role :class:`app.llm.mock.MockProvider` plays for chat
generation. The real providers (:class:`SentenceTransformerEmbeddingProvider`,
:class:`GeminiEmbeddingProvider`, :class:`OpenAIEmbeddingProvider`) import their SDKs lazily,
inside the method that needs them, so importing this module — and starting the app — never
requires those packages to be installed, downloads a model, or makes a network call.
"""

from __future__ import annotations

import logging
import math
import re
import threading
from collections import Counter
from collections.abc import Iterable

from app.rag.errors import RagNotConfiguredError

logger = logging.getLogger(__name__)

_TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_\-]*")


class EmbeddingProvider:
    """Convert text into a vector representation for retrieval."""

    def embed(self, text: str) -> list[float]:
        """Return the embedding vector for ``text``."""
        raise NotImplementedError

    def embed_many(self, texts: Iterable[str]) -> list[list[float]]:
        """Return the embedding vector for each of ``texts``, in order."""
        return [self.embed(text) for text in texts]


class HashingEmbeddingProvider(EmbeddingProvider):
    """A lightweight, deterministic embedding stand-in for tests and offline development.

    The implementation is intentionally simple: it tokenizes the text, counts token frequency,
    and hashes each token into a fixed-size vector. This keeps retrieval stable without requiring
    external packages, but it has no real cross-lingual or semantic understanding — it is not a
    substitute for a real embedding model in production.
    """

    def __init__(self, dimension: int = 128) -> None:
        """Use a hashed bag-of-tokens vector of size ``dimension``."""
        self.dimension = dimension

    def embed(self, text: str) -> list[float]:
        """Hash each token of ``text`` into a fixed-size, L2-normalized vector."""
        tokens = [token.lower() for token in _TOKEN_RE.findall(text or "")]
        counts = Counter(tokens)
        vector = [0.0] * self.dimension
        if not counts:
            return vector

        for token, count in counts.items():
            index = abs(hash(token)) % self.dimension
            vector[index] += float(count)

        norm = math.sqrt(sum(value * value for value in vector))
        if norm > 0:
            vector = [value / norm for value in vector]
        return vector


class SentenceTransformerEmbeddingProvider(EmbeddingProvider):
    """The default local, multilingual embedding model (runs on CPU, no API key needed).

    The model is loaded lazily on first use, not at construction, so creating this object (and
    starting the app) is instant. The first embedding call downloads the model to the local
    Hugging Face cache if it is not already there (a few hundred MB) and logs progress; every
    later call, in this process or a new one, reuses the cached weights.
    """

    _model: object | None
    _lock: threading.Lock

    def __init__(self, model_name: str) -> None:
        """Use the sentence-transformers model named ``model_name`` (e.g. a multilingual MiniLM)."""
        self.model_name = model_name
        self._model = None
        self._lock = threading.Lock()

    def _get_model(self) -> object:
        if self._model is None:
            with self._lock:
                if self._model is None:
                    logger.info(
                        "embedding_model_loading",
                        extra={"model": self.model_name},
                    )
                    try:
                        from sentence_transformers import SentenceTransformer  # noqa: PLC0415
                    except ImportError as exc:
                        # Without this the person sees an opaque 500; the frontend turns this
                        # into "install the package or switch EMBEDDING_PROVIDER".
                        raise RagNotConfiguredError("local") from exc

                    self._model = SentenceTransformer(self.model_name)
                    logger.info("embedding_model_ready", extra={"model": self.model_name})
        return self._model

    def embed(self, text: str) -> list[float]:
        """Embed one text; prefer :meth:`embed_many` for batches, it is far faster."""
        return self.embed_many([text])[0]

    def embed_many(self, texts: Iterable[str]) -> list[list[float]]:
        """Embed a batch of texts in one forward pass."""
        model = self._get_model()
        vectors = model.encode(list(texts), convert_to_numpy=True, show_progress_bar=False)  # type: ignore[attr-defined]
        return [vector.tolist() for vector in vectors]


class GeminiEmbeddingProvider(EmbeddingProvider):
    """Embeddings from the Gemini API, for deployments that would rather not host a model."""

    def __init__(self, api_key: str, model: str) -> None:
        """Use Gemini's ``model`` embedding endpoint, authenticated with ``api_key``."""
        self.model = model
        self._api_key = api_key
        self._client: object | None = None

    def _get_client(self) -> object:
        if self._client is None:
            from google import genai  # noqa: PLC0415

            self._client = genai.Client(api_key=self._api_key)
        return self._client

    def embed(self, text: str) -> list[float]:
        """Embed one text."""
        return self.embed_many([text])[0]

    def embed_many(self, texts: Iterable[str]) -> list[list[float]]:
        """Embed a batch of texts in one request."""
        client = self._get_client()
        response = client.models.embed_content(model=self.model, contents=list(texts))  # type: ignore[attr-defined]
        return [list(embedding.values or []) for embedding in response.embeddings or []]


class OpenAIEmbeddingProvider(EmbeddingProvider):
    """Embeddings from the OpenAI API, for deployments that would rather not host a model."""

    def __init__(self, api_key: str, model: str) -> None:
        """Use OpenAI's ``model`` embedding endpoint, authenticated with ``api_key``."""
        self.model = model
        self._api_key = api_key
        self._client: object | None = None

    def _get_client(self) -> object:
        if self._client is None:
            from openai import OpenAI  # noqa: PLC0415

            self._client = OpenAI(api_key=self._api_key)
        return self._client

    def embed(self, text: str) -> list[float]:
        """Embed one text."""
        return self.embed_many([text])[0]

    def embed_many(self, texts: Iterable[str]) -> list[list[float]]:
        """Embed a batch of texts in one request."""
        client = self._get_client()
        response = client.embeddings.create(model=self.model, input=list(texts))  # type: ignore[attr-defined]
        return [item.embedding for item in response.data]
