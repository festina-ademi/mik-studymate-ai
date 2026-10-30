import json

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db.models import Chunk, Document, SourceFormat
from app.domain import ContentType, Language
from app.llm.mock import MockProvider
from app.main import create_app


@pytest.fixture
def client() -> TestClient:
    settings = Settings(
        _env_file=None,
        database_url="sqlite://",
        llm_provider="mock",
    )
    app = create_app(settings)
    app.state.llm_provider = MockProvider(
        [
            json.dumps(
                {
                    "summary": "Chunk summary about sorting.",
                    "references": ["Page 1"],
                }
            ),
            json.dumps(
                {
                    "summary": "Section summary about sorting and scans.",
                    "references": ["Page 1", "Page 2"],
                }
            ),
            json.dumps(
                {
                    "overview": "This lecture introduces sorting and searching.",
                    "key_concepts": [
                        {
                            "term": "sorting",
                            "definition": "Putting values in order.",
                            "references": ["Page 1"],
                        }
                    ],
                    "takeaways": [
                        {
                            "title": "Main idea",
                            "text": "Order matters for efficient lookup.",
                            "references": ["Page 2"],
                        }
                    ],
                    "confidence_notes": [],
                }
            ),
        ]
    )
    return TestClient(app)


@pytest.fixture
def document_id(client: TestClient) -> str:
    with client.app.state.session_factory() as session:
        doc = Document(
            id="doc-123",
            filename="lecture.pdf",
            content_hash="abc123",
            content_type=ContentType.LECTURE,
            source_format=SourceFormat.PDF,
            detected_language=Language.EN,
            size_bytes=123,
            page_count=2,
        )
        session.add(doc)
        session.add_all(
            [
                Chunk(
                    document_id="doc-123",
                    ordinal=1,
                    text="Sorting puts values in order for faster lookup.",
                    heading="Page 1",
                    page_start=1,
                    page_end=1,
                ),
                Chunk(
                    document_id="doc-123",
                    ordinal=2,
                    text="Binary search requires sorted data.",
                    heading="Page 2",
                    page_start=2,
                    page_end=2,
                ),
            ]
        )
        session.commit()
    return "doc-123"


def test_summary_endpoint_returns_structured_response(client: TestClient, document_id: str) -> None:
    response = client.post(
        f"/api/documents/{document_id}/summary",
        json={"level": "beginner", "language": "en"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["overview"]
    assert payload["key_concepts"][0]["references"]
    assert payload["metadata"]["chunks_used"] >= 1
    assert payload["metadata"]["task"] == "summary"


def test_explanation_endpoint_supports_level_language_and_streaming(
    document_id: str,
) -> None:
    settings = Settings(
        _env_file=None,
        database_url="sqlite://",
        llm_provider="mock",
    )
    app = create_app(settings)
    app.state.llm_provider = MockProvider(
        [
            json.dumps(
                {
                    "sections": [
                        {
                            "title": "Sorting",
                            "content": "Sorting arranges values in a predictable order.",
                            "references": ["Page 1"],
                        }
                    ],
                    "confidence_notes": [],
                }
            ),
            json.dumps(
                {
                    "sections": [
                        {
                            "title": "Searching",
                            "content": (
                                "Binary search needs sorted data before it can work efficiently."
                            ),
                            "references": ["Page 2"],
                        }
                    ],
                    "confidence_notes": [],
                }
            ),
        ]
    )
    with app.state.session_factory() as session:
        doc = Document(
            id=document_id,
            filename="lecture.pdf",
            content_hash="abc123",
            content_type=ContentType.LECTURE,
            source_format=SourceFormat.PDF,
            detected_language=Language.EN,
            size_bytes=123,
            page_count=2,
        )
        session.add(doc)
        session.add_all(
            [
                Chunk(
                    document_id=document_id,
                    ordinal=1,
                    text="Sorting puts values in order for faster lookup.",
                    heading="Page 1",
                    page_start=1,
                    page_end=1,
                ),
                Chunk(
                    document_id=document_id,
                    ordinal=2,
                    text="Binary search requires sorted data.",
                    heading="Page 2",
                    page_start=2,
                    page_end=2,
                ),
            ]
        )
        session.commit()
    client = TestClient(app)
    response = client.post(
        f"/api/documents/{document_id}/explanation",
        json={"level": "advanced", "language": "sq", "stream": True},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "event: token" in response.text


def test_summary_cache_uses_document_task_level_language_key(
    client: TestClient, document_id: str
) -> None:
    first = client.post(
        f"/api/documents/{document_id}/summary",
        json={"level": "beginner", "language": "en"},
    )
    second = client.post(
        f"/api/documents/{document_id}/summary",
        json={"level": "beginner", "language": "en"},
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["metadata"]["cached"] is False
    assert second.json()["metadata"]["cached"] is True
