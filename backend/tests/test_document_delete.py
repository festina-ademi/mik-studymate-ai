"""Tests for ``DELETE /api/documents/{id}``: database rows, vector index, and stored file."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.config import Settings
from app.db.models import Chunk, Document
from app.main import create_app

CODE = "def double(x):\n    return x * 2\n\nprint(double(3))\n"


def make_client(tmp_path: Path) -> TestClient:
    settings = Settings(
        _env_file=None,
        database_url="sqlite://",
        llm_provider="mock",
        embedding_provider="hash",
        chroma_dir=tmp_path / "chroma",
        upload_dir=tmp_path / "uploads",
        rate_limit_enabled=False,
    )
    return TestClient(create_app(settings))


def upload(client: TestClient) -> str:
    response = client.post("/api/documents/code", json={"code": CODE, "language": "python"})
    assert response.status_code == 201
    return str(response.json()["document"]["id"])


def collection_names(client: TestClient) -> set[str]:
    store_client = client.app.state.vector_store._get_client()
    return {getattr(c, "name", c) for c in store_client.list_collections()}


def set_storage_path(client: TestClient, document_id: str, path: Path) -> None:
    with client.app.state.session_factory() as session:
        document = session.get(Document, document_id)
        assert document is not None
        document.storage_path = str(path)
        session.commit()


def test_delete_removes_rows_vectors_and_returns_204(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    document_id = upload(client)
    client.post(f"/api/documents/{document_id}/summary", json={})
    assert any(document_id in name for name in collection_names(client))

    response = client.delete(f"/api/documents/{document_id}")

    assert response.status_code == 204
    assert response.content == b""
    with client.app.state.session_factory() as session:
        assert session.get(Document, document_id) is None
        chunk_count = session.scalar(
            select(func.count(Chunk.id)).where(Chunk.document_id == document_id)
        )
        assert chunk_count == 0
    assert not any(document_id in name for name in collection_names(client))
    assert client.get(f"/api/documents/{document_id}").status_code == 404


def test_delete_removes_stored_file(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    document_id = upload(client)
    stored = tmp_path / "uploads" / f"{document_id}.py"
    stored.parent.mkdir(parents=True)
    stored.write_text(CODE)
    set_storage_path(client, document_id, stored)

    assert client.delete(f"/api/documents/{document_id}").status_code == 204
    assert not stored.exists()


def test_delete_never_removes_files_outside_upload_dir(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    document_id = upload(client)
    outside = tmp_path / "keep.txt"
    outside.write_text("keep")
    set_storage_path(client, document_id, outside)

    assert client.delete(f"/api/documents/{document_id}").status_code == 204
    assert outside.exists()


def test_delete_unknown_document_returns_404(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    response = client.delete("/api/documents/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
