"""Persistent vector store: one ChromaDB collection per document.

The ``chromadb`` SDK is imported lazily (inside :meth:`ChromaVectorStore._get_client`), so
importing this module never requires the package to be installed or touches disk.
"""

from __future__ import annotations

import contextlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def _collection_name(document_id: str) -> str:
    return f"doc_{document_id}"


def _clean_metadata(metadata: dict[str, Any]) -> dict[str, str | int | float | bool]:
    """Drop ``None`` values: Chroma's metadata only accepts str/int/float/bool."""
    return {key: value for key, value in metadata.items() if value is not None}


@dataclass(frozen=True)
class IndexedChunk:
    """One chunk to store: its id, text and citation metadata."""

    id: str
    text: str
    metadata: dict[str, Any]


@dataclass(frozen=True)
class Candidate:
    """One retrieval candidate, with its embedding so the retriever can apply MMR."""

    id: str
    text: str
    metadata: dict[str, Any]
    embedding: list[float]
    distance: float


class ChromaVectorStore:
    """A persistent Chroma client with one cosine-similarity collection per document."""

    def __init__(self, persist_directory: Path) -> None:
        """Persist collections under ``persist_directory`` (created lazily, on first use)."""
        self._persist_directory = persist_directory
        self._client: Any | None = None  # noqa: ANN401 - the chromadb Client type is optional

    def _get_client(self) -> Any:  # noqa: ANN401 - chromadb.Client, imported lazily
        if self._client is None:
            import chromadb  # noqa: PLC0415

            self._persist_directory.mkdir(parents=True, exist_ok=True)
            self._client = chromadb.PersistentClient(path=str(self._persist_directory))
        return self._client

    def index_document(
        self,
        document_id: str,
        chunks: list[IndexedChunk],
        embeddings: list[list[float]],
    ) -> None:
        """Replace whatever is indexed for ``document_id`` with ``chunks``/``embeddings``."""
        client = self._get_client()
        name = _collection_name(document_id)
        # "no such collection yet" (a fresh document) is the expected common case here.
        with contextlib.suppress(Exception):
            client.delete_collection(name=name)
        if not chunks:
            return
        collection = client.create_collection(name=name, metadata={"hnsw:space": "cosine"})
        collection.add(
            ids=[chunk.id for chunk in chunks],
            documents=[chunk.text for chunk in chunks],
            # Chroma's metadata values must be str/int/float/bool: drop any None entries
            # (e.g. a chunk with no line range) rather than send an unsupported null.
            metadatas=[_clean_metadata(chunk.metadata) for chunk in chunks],
            embeddings=embeddings,
        )

    def query(
        self, document_id: str, query_embedding: list[float], *, fetch_k: int
    ) -> list[Candidate]:
        """Return up to ``fetch_k`` nearest chunks to ``query_embedding``, closest first."""
        client = self._get_client()
        try:
            collection = client.get_collection(name=_collection_name(document_id))
        except Exception:  # noqa: BLE001 - not indexed (yet) is a normal, handled state
            return []

        result = collection.query(
            query_embeddings=[query_embedding],
            n_results=fetch_k,
            include=["documents", "metadatas", "distances", "embeddings"],
        )
        ids = (result.get("ids") or [[]])[0]
        documents = (result.get("documents") or [[]])[0]
        metadatas = (result.get("metadatas") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]
        embeddings = (result.get("embeddings") or [[]])[0]
        return [
            Candidate(
                id=id_,
                text=text or "",
                metadata=dict(meta or {}),
                embedding=list(vector),
                distance=distance,
            )
            for id_, text, meta, distance, vector in zip(
                ids, documents, metadatas, distances, embeddings, strict=True
            )
        ]

    def delete_document(self, document_id: str) -> None:
        """Drop the collection for ``document_id``, if any."""
        client = self._get_client()
        with contextlib.suppress(Exception):  # already absent is a normal, handled state
            client.delete_collection(name=_collection_name(document_id))
