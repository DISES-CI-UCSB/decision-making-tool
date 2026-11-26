from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app import runtime_bootstrap
from app.artifacts import get_artifact_state
from app.config import get_settings
from app.main import app
from app.runtime_bootstrap import (
    BootstrapStatus,
    BootstrapTask,
    current_bootstrap_status,
    planned_tasks,
    run_bootstrap,
    safe_status_line,
    start_runtime_bootstrap,
    task_needed,
)
from tests.conftest import TINY_ARTIFACT_DIR, clear_artifact_env
from tests.test_health_ready import QueueAvailability


@pytest.fixture(autouse=True)
def reset_bootstrap_status():
    runtime_bootstrap._publish(BootstrapStatus(status="disabled"), status_path=None)
    yield
    runtime_bootstrap._publish(BootstrapStatus(status="disabled"), status_path=None)


def _empty_artifact_env(tmp_path: Path) -> None:
    clear_artifact_env()
    os.environ["DMT_ARTIFACT_REQUIRED"] = "true"
    os.environ["DMT_ARTIFACT_DIR"] = str(tmp_path)
    os.environ["DMT_ARTIFACT_MANIFEST"] = str(tmp_path / "manifest.json")
    os.environ["DMT_SIRAP_ARTIFACT_ROOT"] = str(tmp_path / "sirap")


def _write_all_outputs(tmp_path: Path, catalog_path: Path) -> None:
    for path in [
        catalog_path,
        tmp_path / "manifest.json",
        tmp_path / "sirap" / "eje-cafetero" / "manifest.json",
        tmp_path / "sirap" / "orinoquia" / "manifest.json",
    ]:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{}", encoding="utf-8")


def test_bootstrap_plans_every_output_and_runs_only_missing_ones(tmp_path: Path) -> None:
    _empty_artifact_env(tmp_path)
    catalog_path = tmp_path / "download-catalog.json"
    catalog_path.write_text("{}", encoding="utf-8")

    tasks = planned_tasks(get_settings(), str(catalog_path))

    assert [task.name for task in tasks] == [
        "download_catalog",
        "national_artifact",
        "sirap_eje-cafetero",
        "sirap_orinoquia",
    ]
    assert [task_needed(task) for task in tasks] == [False, True, True, True]


def test_bootstrap_skips_the_registry_when_no_catalog_path_is_set(tmp_path: Path) -> None:
    _empty_artifact_env(tmp_path)

    catalog_task = planned_tasks(get_settings(), None)[0]

    assert catalog_task.skip_reason == "DMT_DOWNLOAD_CATALOG_PATH is not set."
    assert task_needed(catalog_task) is False


def test_bootstrap_does_not_start_when_disabled(tmp_path: Path, monkeypatch) -> None:
    _empty_artifact_env(tmp_path)
    monkeypatch.delenv("DMT_AUTO_HYDRATE", raising=False)

    thread = start_runtime_bootstrap(get_settings(), str(tmp_path / "download-catalog.json"))

    assert thread is None
    assert current_bootstrap_status().status == "disabled"
    assert not (tmp_path / "bootstrap-status.json").exists()


def test_bootstrap_does_not_start_when_every_output_exists(tmp_path: Path, monkeypatch) -> None:
    _empty_artifact_env(tmp_path)
    monkeypatch.setenv("DMT_AUTO_HYDRATE", "true")
    catalog_path = tmp_path / "download-catalog.json"
    _write_all_outputs(tmp_path, catalog_path)

    thread = start_runtime_bootstrap(get_settings(), str(catalog_path))

    assert thread is None
    written = json.loads((tmp_path / "bootstrap-status.json").read_text(encoding="utf-8"))
    assert written["status"] == "not_needed"
    assert {step["status"] for step in written["steps"]} == {"already_present"}


def test_bootstrap_runs_missing_tasks_and_records_status_file(tmp_path: Path) -> None:
    catalog = tmp_path / "download-catalog.json"
    manifest = tmp_path / "manifest.json"
    tasks = [
        BootstrapTask(name="download_catalog", output=catalog, command=["catalog"]),
        BootstrapTask(name="national_artifact", output=manifest, command=["national"]),
    ]
    status_path = tmp_path / "bootstrap-status.json"
    runtime_bootstrap._publish(
        BootstrapStatus(status="running", steps=runtime_bootstrap.initial_steps(tasks)),
        status_path,
    )
    ran: list[str] = []

    def fake_runner(command, on_line):
        ran.append(command[0])
        if command[0] == "catalog":
            catalog.write_text("{}", encoding="utf-8")
            on_line("wrote catalog")
            return 0, "wrote catalog"
        on_line("[hydrate] 2/8 downloading https://host.test/ref.tif?token=secret-value")
        return 1, "Could not fetch https://host.test/ref.tif?token=secret-value"

    result = run_bootstrap(tasks, status_path, fake_runner)

    assert ran == ["catalog", "national"]
    assert result.status == "failed"
    assert [step.status for step in result.steps] == ["succeeded", "failed"]
    written_text = status_path.read_text(encoding="utf-8")
    assert "secret-value" not in written_text
    written = json.loads(written_text)
    assert written["status"] == "failed"
    assert written["error_summary"].startswith("national_artifact exit code 1:")
    assert "https://host.test/ref.tif" in written["error_summary"]
    assert written["finished_at"] is not None


def test_safe_status_line_drops_url_queries_and_trims() -> None:
    line = safe_status_line("GET https://a.test/x?X-Goog-Signature=abc&b=1 failed\nnext " + "y" * 400)

    assert "X-Goog-Signature" not in line
    assert "https://a.test/x failed next" in line
    assert len(line) == runtime_bootstrap.MAX_STATUS_LINE_CHARS


def test_ready_reports_running_bootstrap_while_artifacts_are_missing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _empty_artifact_env(tmp_path)
    monkeypatch.setattr(main_module, "_DETAILED_SPECIES_QUEUE", QueueAvailability())
    runtime_bootstrap._publish(
        BootstrapStatus(
            status="running",
            step="national_artifact",
            progress="[hydrate] 2/8 downloading reference raster",
            started_at="2026-11-26T18:00:00Z",
        ),
        status_path=None,
    )
    client = TestClient(app)

    response = client.get("/ready")

    assert response.status_code == 503
    bootstrap = response.json()["detail"]["bootstrap"]
    assert bootstrap["status"] == "running"
    assert bootstrap["step"] == "national_artifact"
    assert bootstrap["progress"] == "[hydrate] 2/8 downloading reference raster"
    assert bootstrap["started_at"] == "2026-11-26T18:00:00Z"


def test_warmup_recovers_when_the_manifest_appears_after_a_failed_start(tmp_path: Path) -> None:
    artifact_dir = tmp_path / "runtime-artifacts"
    artifact_dir.mkdir()
    _empty_artifact_env(artifact_dir)
    settings = get_settings()

    missing = get_artifact_state(settings)
    shutil.copytree(TINY_ARTIFACT_DIR, artifact_dir, dirs_exist_ok=True)
    recovered = get_artifact_state(settings)

    assert missing.available is False
    assert missing.message == "Artifact manifest is missing."
    assert recovered.available is True
    assert recovered.artifact_version == "tiny-area-fixture-v1"
