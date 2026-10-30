"""Tests for pasted/typed source code ingestion (Phase 11): the auto-detect heuristic and the
``POST /api/documents/code`` endpoint."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db.models import Document
from app.ingestion.code import detect_programming_language
from app.main import create_app

PYTHON_SNIPPET = """
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)
""".strip()

JAVASCRIPT_SNIPPET = """
function greet(name) {
    console.log("Hello, " + name);
}
const add = (a, b) => a + b;
""".strip()

JAVA_SNIPPET = """
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
""".strip()

CPP_SNIPPET = """
#include <iostream>
using namespace std;
int main() {
    cout << "Hello, World!" << endl;
    return 0;
}
""".strip()

AMBIGUOUS_SNIPPET = "just some plain notes about an algorithm, no real code here at all"


def make_client() -> TestClient:
    # "hash" avoids depending on the real (slow, model-download-requiring) embedding provider
    # for the RAG-indexing step the endpoint triggers after ingestion.
    settings = Settings(
        _env_file=None,
        database_url="sqlite://",
        llm_provider="mock",
        embedding_provider="hash",
    )
    return TestClient(create_app(settings))


# --- detect_programming_language ---------------------------------------------------------


@pytest.mark.parametrize(
    ("snippet", "expected"),
    [
        (PYTHON_SNIPPET, "python"),
        (JAVASCRIPT_SNIPPET, "javascript"),
        (JAVA_SNIPPET, "java"),
        (CPP_SNIPPET, "cpp"),
    ],
)
def test_detect_programming_language_identifies_obvious_snippets(
    snippet: str, expected: str
) -> None:
    assert detect_programming_language(snippet) == expected


def test_detect_programming_language_returns_none_when_ambiguous() -> None:
    assert detect_programming_language(AMBIGUOUS_SNIPPET) is None
    assert detect_programming_language("") is None


# --- POST /api/documents/code -------------------------------------------------------------


def test_upload_code_with_an_explicit_language_creates_a_code_document() -> None:
    client = make_client()

    response = client.post(
        "/api/documents/code",
        json={"code": PYTHON_SNIPPET, "language": "python", "filename": "fib.py"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["document"]["content_type"] == "code"
    assert body["document"]["filename"] == "fib.py"
    assert body["detected_programming_language"] == "python"
    assert body["language_detected_automatically"] is False
    assert len(body["chunks"]) >= 1
    assert "fibonacci" in body["chunks"][0]["text"]


def test_upload_code_auto_detects_the_language() -> None:
    client = make_client()

    response = client.post(
        "/api/documents/code",
        json={"code": JAVASCRIPT_SNIPPET, "language": "auto"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["detected_programming_language"] == "javascript"
    assert body["language_detected_automatically"] is True
    assert body["document"]["filename"].endswith(".js")


def test_upload_code_falls_back_to_plain_text_when_auto_detect_is_ambiguous() -> None:
    client = make_client()

    response = client.post(
        "/api/documents/code",
        json={"code": AMBIGUOUS_SNIPPET + " " * 5, "language": "auto"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["detected_programming_language"] is None
    assert body["language_detected_automatically"] is True
    assert body["document"]["content_type"] == "code"


def test_upload_code_rejects_fewer_than_ten_characters() -> None:
    client = make_client()

    response = client.post("/api/documents/code", json={"code": "x = 1", "language": "python"})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "EMPTY_DOCUMENT"


def test_upload_code_generates_a_dated_filename_when_none_is_given() -> None:
    client = make_client()

    response = client.post(
        "/api/documents/code",
        json={"code": JAVA_SNIPPET, "language": "java"},
    )

    assert response.status_code == 201
    filename = response.json()["document"]["filename"]
    assert filename.startswith("pasted_code_")
    assert filename.endswith(".java")


def test_upload_code_document_is_persisted_and_indexed_for_the_tutor() -> None:
    client = make_client()

    response = client.post(
        "/api/documents/code",
        json={"code": CPP_SNIPPET, "language": "cpp", "filename": "hello.cpp"},
    )
    document_id = response.json()["document"]["id"]

    with client.app.state.session_factory() as session:
        document = session.get(Document, document_id)
        assert document is not None
        assert document.content_type.value == "code"
        assert len(document.chunks) >= 1

    # Indexed (not just persisted): a grounded tutor question should find real context instead
    # of the "nothing indexed" EMPTY_DOCUMENT error.
    tutor_response = client.post(
        f"/api/documents/{document_id}/tutor",
        json={"message": "What does this code print?", "level": "intermediate", "language": "en"},
    )
    assert tutor_response.status_code == 200
