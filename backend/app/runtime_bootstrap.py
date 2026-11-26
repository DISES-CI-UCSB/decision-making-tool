"""Prepare missing runtime files in the background when the container starts.

A fresh container has an empty runtime-artifacts folder. With DMT_AUTO_HYDRATE on,
startup builds whatever is missing, one subprocess per output, while the API keeps
serving /health:

1. download_catalog: the Signable File Registry (scripts.build_download_catalog)
2. national_artifact: the national runtime artifact (scripts.build_runtime_artifact)
3. sirap_<id>: each regional SIRAP kit (scripts.build_sirap_runtime_artifact)

An output that already exists is never rebuilt. Progress is kept in memory for
/ready and copied to bootstrap-status.json in the artifact folder, because some
hosts give no log access. The status holds step names, timestamps, and single
lines with URL query strings removed: no secrets, signed URLs, or stack traces.
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Lock, Thread
from typing import Callable, Literal

from pydantic import BaseModel, Field

from .artifacts import warmup_artifacts
from .config import SIRAP_SOLUTION_ID_PREFIXES, Settings, _env_bool

LOGGER = logging.getLogger(__name__)

AUTO_HYDRATE_ENV = "DMT_AUTO_HYDRATE"
STATUS_FILE_NAME = "bootstrap-status.json"
BACKEND_ROOT = Path(__file__).resolve().parents[1]
STATUS_FILE_WRITE_INTERVAL_SECONDS = 5.0
MAX_STATUS_LINE_CHARS = 300
# Query strings and fragments are where tokens and signatures live.
_URL_QUERY = re.compile(r"(https?://[^\s?#'\"]+)[?#][^\s'\"]*")

BootstrapState = Literal["disabled", "not_needed", "running", "succeeded", "failed"]
StepState = Literal["already_present", "skipped", "pending", "running", "succeeded", "failed"]


class BootstrapStep(BaseModel):
    name: str
    status: StepState
    detail: str | None = None
    started_at: str | None = None
    finished_at: str | None = None


class BootstrapStatus(BaseModel):
    status: BootstrapState
    step: str | None = None
    progress: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    error_summary: str | None = None
    steps: list[BootstrapStep] = Field(default_factory=list)


@dataclass(frozen=True)
class BootstrapTask:
    name: str
    output: Path | None
    command: list[str]
    skip_reason: str | None = None


# (command, on_line) -> (exit code, last output line)
CommandRunner = Callable[[list[str], Callable[[str], None]], tuple[int, str]]

_STATUS_LOCK = Lock()
_STATUS = BootstrapStatus(status="disabled")


def current_bootstrap_status() -> BootstrapStatus:
    with _STATUS_LOCK:
        return _STATUS.model_copy(deep=True)


def bootstrap_status_path(settings: Settings) -> Path:
    return settings.artifact_dir / STATUS_FILE_NAME


def safe_status_line(text: str) -> str:
    """One trimmed line with URL query strings removed."""
    line = " ".join(_URL_QUERY.sub(r"\1", text).split())
    if len(line) > MAX_STATUS_LINE_CHARS:
        return line[: MAX_STATUS_LINE_CHARS - 3] + "..."
    return line


def planned_tasks(settings: Settings, catalog_path: str | None) -> list[BootstrapTask]:
    """Every output a ready container needs, in build order. The registry is first because it takes seconds."""
    from scripts.hydrate import prepend_default_args

    python = sys.executable
    tasks = [
        BootstrapTask(
            name="download_catalog",
            output=Path(catalog_path) if catalog_path else None,
            command=[python, "-m", "scripts.build_download_catalog", "--output", str(catalog_path)],
            skip_reason=None if catalog_path else "DMT_DOWNLOAD_CATALOG_PATH is not set.",
        ),
        BootstrapTask(
            name="national_artifact",
            output=settings.artifact_manifest_path,
            command=[
                python,
                "-m",
                "scripts.build_runtime_artifact",
                *prepend_default_args(["--artifact-dir", str(settings.artifact_dir)]),
            ],
        ),
    ]
    for sirap_id in dict.fromkeys(sirap_id for _, sirap_id in SIRAP_SOLUTION_ID_PREFIXES):
        tasks.append(
            BootstrapTask(
                name=f"sirap_{sirap_id}",
                output=settings.sirap_artifact_root / sirap_id / "manifest.json",
                command=[
                    python,
                    "-m",
                    "scripts.build_sirap_runtime_artifact",
                    "--sirap-id",
                    sirap_id,
                    "--artifact-dir",
                    str(settings.sirap_artifact_root),
                ],
            )
        )
    return tasks


def task_needed(task: BootstrapTask) -> bool:
    return task.skip_reason is None and task.output is not None and not task.output.is_file()


def initial_steps(tasks: list[BootstrapTask]) -> list[BootstrapStep]:
    steps = []
    for task in tasks:
        if task.skip_reason is not None:
            steps.append(BootstrapStep(name=task.name, status="skipped", detail=task.skip_reason))
        elif task_needed(task):
            steps.append(BootstrapStep(name=task.name, status="pending"))
        else:
            steps.append(BootstrapStep(name=task.name, status="already_present"))
    return steps


def start_runtime_bootstrap(settings: Settings, catalog_path: str | None) -> Thread | None:
    """Start building missing outputs in a daemon thread. Returns None when nothing runs."""
    if not _env_bool(AUTO_HYDRATE_ENV, default=False):
        _publish(BootstrapStatus(status="disabled"), status_path=None)
        return None

    tasks = planned_tasks(settings, catalog_path)
    steps = initial_steps(tasks)
    status_path = bootstrap_status_path(settings)
    if not any(task_needed(task) for task in tasks):
        _publish(
            BootstrapStatus(status="not_needed", finished_at=_utc_now(), steps=steps),
            status_path,
        )
        return None

    # Published before the thread starts, so the first /ready already reads "running".
    _publish(BootstrapStatus(status="running", started_at=_utc_now(), steps=steps), status_path)
    thread = Thread(
        target=_bootstrap_then_warm,
        args=(settings, tasks, status_path),
        name="runtime-bootstrap",
        daemon=True,
    )
    thread.start()
    return thread


def run_bootstrap(
    tasks: list[BootstrapTask],
    status_path: Path | None,
    run_command: CommandRunner | None = None,
) -> BootstrapStatus:
    """Run every needed task in order. A failed task does not stop the ones after it."""
    runner = run_command or _run_command
    failures: list[str] = []
    for index, task in enumerate(tasks):
        if not task_needed(task):
            continue
        _update_step(index, status="running", started_at=_utc_now())
        _update(step=task.name, progress=None)
        _write_status_file(status_path)
        last_write = time.monotonic()

        def on_line(line: str) -> None:
            nonlocal last_write
            _update(progress=safe_status_line(line))
            if time.monotonic() - last_write >= STATUS_FILE_WRITE_INTERVAL_SECONDS:
                _write_status_file(status_path)
                last_write = time.monotonic()

        try:
            exit_code, last_line = runner(task.command, on_line)
        except OSError as exc:
            exit_code, last_line = 1, type(exc).__name__
        if exit_code == 0 and task.output is not None and task.output.is_file():
            _update_step(index, status="succeeded", finished_at=_utc_now())
        else:
            detail = safe_status_line(f"exit code {exit_code}: {last_line}")
            _update_step(index, status="failed", detail=detail, finished_at=_utc_now())
            failures.append(f"{task.name} {detail}")
        _write_status_file(status_path)

    _update(
        status="failed" if failures else "succeeded",
        step=None,
        finished_at=_utc_now(),
        error_summary=safe_status_line("; ".join(failures)) if failures else None,
    )
    _write_status_file(status_path)
    return current_bootstrap_status()


def _bootstrap_then_warm(settings: Settings, tasks: list[BootstrapTask], status_path: Path) -> None:
    try:
        result = run_bootstrap(tasks, status_path)
        LOGGER.info("Runtime bootstrap finished", extra={"bootstrap_status": result.status})
    except Exception as exc:
        _update(
            status="failed",
            step=None,
            finished_at=_utc_now(),
            error_summary=f"Bootstrap stopped unexpectedly ({type(exc).__name__}).",
        )
        _write_status_file(status_path)
        LOGGER.exception("Runtime bootstrap stopped unexpectedly")
    # Load the new artifacts now instead of on the next request.
    warmup_artifacts(settings)


def _run_command(command: list[str], on_line: Callable[[str], None]) -> tuple[int, str]:
    """Run a build script, copying its output to the container log line by line."""
    process = subprocess.Popen(
        command,
        cwd=BACKEND_ROOT,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    last_line = ""
    assert process.stdout is not None
    for line in process.stdout:
        print(line, end="", flush=True)
        if line.strip():
            last_line = line.strip()
            on_line(last_line)
    return process.wait(), last_line


def _publish(status: BootstrapStatus, status_path: Path | None) -> None:
    global _STATUS
    with _STATUS_LOCK:
        _STATUS = status
    _write_status_file(status_path)


def _update(**fields: object) -> None:
    global _STATUS
    with _STATUS_LOCK:
        _STATUS = _STATUS.model_copy(update=fields)


def _update_step(index: int, **fields: object) -> None:
    global _STATUS
    with _STATUS_LOCK:
        steps = list(_STATUS.steps)
        steps[index] = steps[index].model_copy(update=fields)
        _STATUS = _STATUS.model_copy(update={"steps": steps})


def _write_status_file(status_path: Path | None) -> None:
    if status_path is None:
        return
    document = current_bootstrap_status().model_dump_json(indent=1) + "\n"
    try:
        status_path.parent.mkdir(parents=True, exist_ok=True)
        # /ready readers and humans may open it mid-write, so replace it in one step.
        temporary = status_path.with_name(f".{status_path.name}.tmp")
        temporary.write_text(document, encoding="utf-8")
        os.replace(temporary, status_path)
    except OSError:
        LOGGER.warning("Could not write the bootstrap status file", exc_info=True)


def _utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
