from __future__ import annotations

from app.main import cors_origins
from scripts.hydrate import prepend_default_args


def test_hydrate_adds_artifact_dir_from_env(monkeypatch) -> None:
    monkeypatch.setenv("DMT_ARTIFACT_DIR", "/tmp/runtime-artifacts")
    monkeypatch.delenv("MANIFEST_BLOB_URL", raising=False)
    monkeypatch.delenv("DMT_MANIFEST_URL", raising=False)

    assert prepend_default_args(["--force"]) == [
        "--artifact-dir",
        "/tmp/runtime-artifacts",
        "--force",
    ]


def test_hydrate_keeps_explicit_artifact_dir(monkeypatch) -> None:
    monkeypatch.setenv("DMT_ARTIFACT_DIR", "/tmp/runtime-artifacts")

    assert prepend_default_args(["--artifact-dir", "/custom", "--force"]) == [
        "--artifact-dir",
        "/custom",
        "--force",
    ]


def test_hydrate_adds_manifest_url_from_env(monkeypatch) -> None:
    monkeypatch.setenv("DMT_ARTIFACT_DIR", "/tmp/runtime-artifacts")
    monkeypatch.setenv("MANIFEST_BLOB_URL", "https://example.test/manifest.json")

    assert prepend_default_args([]) == [
        "--manifest-url",
        "https://example.test/manifest.json",
        "--artifact-dir",
        "/tmp/runtime-artifacts",
    ]


def test_cors_origins_include_docker_frontend_and_extras() -> None:
    origins = cors_origins("https://app.parques.example, https://preview.example")

    assert "http://localhost:8080" in origins
    assert "http://localhost:8084" in origins
    assert "http://127.0.0.1:8080" in origins
    assert "http://127.0.0.1:8084" in origins
    assert "https://app.parques.example" in origins
    assert "https://preview.example" in origins


def test_hydrate_progress_helpers() -> None:
    from scripts.build_runtime_artifact import _format_bytes, _progress_bar

    assert _format_bytes(512) == "512 B"
    assert _format_bytes(2048) == "2 KB"
    assert _format_bytes(5 * 1024 * 1024) == "5.0 MB"
    assert _progress_bar(0.0) == "-" * 20
    assert _progress_bar(1.0) == "#" * 20
    assert len(_progress_bar(0.5)) == 20
