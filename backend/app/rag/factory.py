"""Build the embedding provider and vector store from configuration."""

from fastapi import Request

from app.config import Settings
from app.rag.embeddings import (
    EmbeddingProvider,
    GeminiEmbeddingProvider,
    HashingEmbeddingProvider,
    OpenAIEmbeddingProvider,
    SentenceTransformerEmbeddingProvider,
)
from app.rag.errors import RagNotConfiguredError
from app.rag.store import ChromaVectorStore


def create_embedding_provider(settings: Settings) -> EmbeddingProvider:
    """Build the embedding provider selected by ``EMBEDDING_PROVIDER``.

    Raises:
        RagNotConfiguredError: An API-based provider was selected but has no API key.
    """
    match settings.embedding_provider:
        case "local":
            return SentenceTransformerEmbeddingProvider(settings.embedding_model)
        case "gemini":
            if settings.gemini_api_key is None:
                raise RagNotConfiguredError("gemini")
            return GeminiEmbeddingProvider(
                settings.gemini_api_key.get_secret_value(), settings.gemini_embedding_model
            )
        case "openai":
            if settings.openai_api_key is None:
                raise RagNotConfiguredError("openai")
            return OpenAIEmbeddingProvider(
                settings.openai_api_key.get_secret_value(), settings.openai_embedding_model
            )
        case "hash":
            return HashingEmbeddingProvider()


def get_embedding_provider(request: Request) -> EmbeddingProvider:
    """FastAPI dependency: the application's embedding provider, built on first use."""
    provider: EmbeddingProvider | None = getattr(request.app.state, "embedding_provider", None)
    if provider is None:
        provider = create_embedding_provider(request.app.state.settings)
        request.app.state.embedding_provider = provider
    return provider


def get_vector_store(request: Request) -> ChromaVectorStore:
    """FastAPI dependency: the application's persistent vector store, built on first use."""
    store: ChromaVectorStore | None = getattr(request.app.state, "vector_store", None)
    if store is None:
        store = ChromaVectorStore(request.app.state.settings.chroma_dir)
        request.app.state.vector_store = store
    return store
