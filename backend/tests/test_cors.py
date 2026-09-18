from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from starlette.middleware.cors import CORSMiddleware as StarletteCORSMiddleware

from app.main import app, cors_origins


def _preflight(client: TestClient, origin: str):
    return client.options(
        "/health",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
    )


def _app_with_current_cors() -> FastAPI:
    test_app = FastAPI()
    test_app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins(),
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    @test_app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return test_app


def test_localhost_origin_is_allowed() -> None:
    response = _preflight(TestClient(app), "http://localhost:4300")

    assert response.headers.get("access-control-allow-origin") == "http://localhost:4300"


def test_unlisted_vercel_preview_origin_is_rejected() -> None:
    origin = "https://evil-preview.vercel.app"
    response = _preflight(TestClient(app), origin)

    assert response.headers.get("access-control-allow-origin") != origin


def test_dmt_cors_origins_are_allowed(monkeypatch) -> None:
    extra = "https://decision-making-tool-tau.vercel.app"
    monkeypatch.setenv("DMT_CORS_ORIGINS", extra)
    response = _preflight(TestClient(_app_with_current_cors()), extra)

    assert response.headers.get("access-control-allow-origin") == extra


def test_cors_middleware_has_no_origin_regex() -> None:
    cors = next(
        middleware
        for middleware in app.user_middleware
        if middleware.cls is StarletteCORSMiddleware
    )

    assert cors.kwargs.get("allow_origin_regex") is None
