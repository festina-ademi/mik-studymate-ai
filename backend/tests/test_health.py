from fastapi.testclient import TestClient

from app import __version__


def test_health_returns_ok(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__}


def test_health_sets_request_id_header(client: TestClient) -> None:
    response = client.get("/api/health")

    assert len(response.headers["X-Request-ID"]) == 32
