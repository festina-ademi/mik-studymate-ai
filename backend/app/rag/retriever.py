"""Retriever: embed the query, fetch nearest chunks, then re-rank with MMR for diversity."""

from __future__ import annotations

import math
from typing import Any

from pydantic import BaseModel, Field

from app.rag.embeddings import EmbeddingProvider
from app.rag.store import Candidate, ChromaVectorStore

DEFAULT_TOP_K = 4
DEFAULT_FETCH_K = 12
DEFAULT_LAMBDA_MULT = 0.5


class ChunkHit(BaseModel):
    """One matched document chunk with a retrieval score (higher is more relevant)."""

    id: str
    text: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    score: float


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right, strict=True))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (left_norm * right_norm)


def mmr_select(
    query_embedding: list[float],
    candidates: list[Candidate],
    *,
    top_k: int,
    lambda_mult: float,
) -> list[Candidate]:
    """Greedily pick ``top_k`` candidates balancing relevance and diversity.

    Standard Maximal Marginal Relevance: at each step, pick the candidate maximizing
    ``lambda_mult * relevance(candidate) - (1 - lambda_mult) * max_similarity(candidate, S)``,
    where ``S`` is the set already selected. ``lambda_mult=1.0`` ignores diversity (pure
    relevance ranking); ``lambda_mult=0.0`` ignores relevance beyond the first pick.
    """
    if not candidates:
        return []

    relevance = {
        candidate.id: _cosine_similarity(query_embedding, candidate.embedding)
        for candidate in candidates
    }
    selected: list[Candidate] = []
    remaining = list(candidates)

    while remaining and len(selected) < top_k:

        def mmr_score(candidate: Candidate) -> float:
            if not selected:
                return relevance[candidate.id]
            diversity_penalty = max(
                _cosine_similarity(candidate.embedding, other.embedding) for other in selected
            )
            return lambda_mult * relevance[candidate.id] - (1 - lambda_mult) * diversity_penalty

        best = max(remaining, key=mmr_score)
        selected.append(best)
        remaining.remove(best)

    return selected


class DocumentRetriever:
    """Look up the most relevant, diverse chunks of one document for a tutor question."""

    def __init__(
        self,
        store: ChromaVectorStore,
        embedding_provider: EmbeddingProvider,
        *,
        top_k: int = DEFAULT_TOP_K,
        fetch_k: int = DEFAULT_FETCH_K,
        lambda_mult: float = DEFAULT_LAMBDA_MULT,
    ) -> None:
        """Retrieve from ``store`` using ``embedding_provider``, with MMR-re-ranking defaults."""
        self.store = store
        self.embedding_provider = embedding_provider
        self.top_k = top_k
        self.fetch_k = fetch_k
        self.lambda_mult = lambda_mult

    def search(
        self,
        document_id: str,
        query: str,
        *,
        top_k: int | None = None,
        fetch_k: int | None = None,
    ) -> list[ChunkHit]:
        """Return the ``top_k`` chunks of ``document_id`` most relevant to ``query``.

        Retrieval is cross-lingual by construction: the query and the chunks are embedded with
        the same multilingual model, so an Albanian question can retrieve English chunks and
        vice versa purely from semantic (not lexical) similarity.
        """
        if not query:
            return []

        query_embedding = self.embedding_provider.embed(query)
        candidates = self.store.query(document_id, query_embedding, fetch_k=fetch_k or self.fetch_k)
        if not candidates:
            return []

        selected = mmr_select(
            query_embedding, candidates, top_k=top_k or self.top_k, lambda_mult=self.lambda_mult
        )
        return [
            ChunkHit(id=c.id, text=c.text, metadata=c.metadata, score=1.0 - c.distance)
            for c in selected
        ]
