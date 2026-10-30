"""Build or refresh a document's vector index, after ingestion or on explicit reindex."""

from __future__ import annotations

from app.db.models import Document
from app.rag.citations import chunk_reference
from app.rag.embeddings import EmbeddingProvider
from app.rag.store import ChromaVectorStore, IndexedChunk


def index_document(
    document: Document, *, store: ChromaVectorStore, embedding_provider: EmbeddingProvider
) -> int:
    """(Re)build the vector index for ``document`` from its current chunks.

    Replaces whatever was previously indexed for this document, so it is safe to call again
    after re-ingestion or a chunking change. Returns the number of chunks indexed.
    """
    chunks = [
        IndexedChunk(
            id=f"chunk-{chunk.id}",
            text=chunk.text.strip(),
            metadata={
                "heading": chunk.heading or chunk_reference(chunk),
                "page_start": chunk.page_start,
                "page_end": chunk.page_end,
                "line_start": chunk.line_start,
                "line_end": chunk.line_end,
            },
        )
        for chunk in document.chunks
        if chunk.text.strip()
    ]
    if not chunks:
        store.index_document(document.id, [], [])
        return 0

    embeddings = embedding_provider.embed_many([chunk.text for chunk in chunks])
    store.index_document(document.id, chunks, embeddings)
    return len(chunks)
