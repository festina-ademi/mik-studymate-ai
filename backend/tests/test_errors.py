from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.errors import AppError


def _add_test_routes(app: FastAPI) -> None:
    @app.get("/api/_test/app-error")
    async def raise_app_error() -> None:
        raise AppError(400, "unsupported_file_type", details={"extension": ".exe"})

    @app.get("/api/_test/boom")
    async def raise_unexpected() -> None:
        raise RuntimeError("secret internal detail")

    @app.get("/api/_test/number")
    async def needs_number(value: int) -> dict[str, int]:
        return {"value": value}


def test_unknown_route_uses_standard_error_format(client: TestClient) -> None:
    response = client.get("/api/nope")

    assert response.status_code == 404
    assert response.json() == {
        "error": {"code": "not_found", "message_key": "errors.not_found", "details": {}}
    }


def test_wrong_method_uses_standard_error_format(client: TestClient) -> None:
    response = client.post("/api/health")

    assert response.status_code == 405
    assert response.json()["error"]["code"] == "method_not_allowed"


def test_app_error_is_serialised(app: FastAPI) -> None:
    _add_test_routes(app)

    response = TestClient(app).get("/api/_test/app-error")

    assert response.status_code == 400
    assert response.json() == {
        "error": {
            "code": "unsupported_file_type",
            "message_key": "errors.unsupported_file_type",
            "details": {"extension": ".exe"},
        }
    }


def test_validation_error_does_not_echo_input(app: FastAPI) -> None:
    _add_test_routes(app)

    response = TestClient(app).get("/api/_test/number", params={"value": "private-text"})

    body = response.json()
    assert response.status_code == 422
    assert body["error"]["code"] == "validation_error"
    assert body["error"]["details"]["errors"] == [
        {"loc": ["query", "value"], "type": "int_parsing"}
    ]
    assert "private-text" not in response.text


def test_unexpected_error_hides_internal_details(app: FastAPI) -> None:
    _add_test_routes(app)

    response = TestClient(app, raise_server_exceptions=False).get("/api/_test/boom")

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
    assert "secret internal detail" not in response.text
