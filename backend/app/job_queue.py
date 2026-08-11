from __future__ import annotations

import hashlib
import json
import logging
import os
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import Any, Callable, TypeVar


TERMINAL_STATUSES = {"complete", "failed", "cancelled"}
JobCalculator = Callable[[dict[str, Any], Callable[[], bool]], dict[str, Any]]
StorageResult = TypeVar("StorageResult")
LOGGER = logging.getLogger(__name__)


class JobQueueFullError(RuntimeError):
    pass


class _WorkerStopping(BaseException):
    pass


@dataclass(frozen=True)
class JobSnapshot:
    job_id: str
    status: str
    queue_position: int | None
    estimated_wait_seconds: float | None
    created_at: float
    started_at: float | None
    completed_at: float | None
    compute_ms: float | None
    result: dict[str, Any] | None
    error_code: str | None


class DetailedSpeciesJobQueue:
    def __init__(
        self,
        database_path: Path,
        calculator: JobCalculator,
        *,
        max_queued_jobs: int = 10,
        storage_retry_initial_seconds: float = 0.1,
        storage_retry_max_seconds: float = 5.0,
        storage_failure_unhealthy_threshold: int = 3,
    ) -> None:
        if storage_retry_initial_seconds <= 0 or storage_retry_max_seconds <= 0:
            raise ValueError("Storage retry delays must be positive.")
        if storage_failure_unhealthy_threshold < 1:
            raise ValueError("Storage failure threshold must be at least one.")
        self.database_path = database_path
        self.calculator = calculator
        self.max_queued_jobs = max_queued_jobs
        self.storage_retry_initial_seconds = storage_retry_initial_seconds
        self.storage_retry_max_seconds = storage_retry_max_seconds
        self.storage_failure_unhealthy_threshold = storage_failure_unhealthy_threshold
        self._condition = threading.Condition()
        self._stop = threading.Event()
        self._worker: threading.Thread | None = None
        self._storage_healthy = True

    def start(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize_database()
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE detailed_species_jobs
                SET status = 'queued', started_at = NULL
                WHERE status = 'running' AND cancel_requested = 0
                """
            )
            connection.execute(
                """
                UPDATE detailed_species_jobs
                SET status = 'cancelled', completed_at = ?
                WHERE status = 'running' AND cancel_requested = 1
                """,
                (time.time(),),
            )
        self._worker = threading.Thread(
            target=self._run,
            name="detailed-species-worker",
            daemon=True,
        )
        self._worker.start()

    def stop(self) -> None:
        self._stop.set()
        with self._condition:
            self._condition.notify_all()
        if self._worker is not None:
            self._worker.join(timeout=5)
            self._worker = None

    def is_available(self) -> bool:
        return self.unavailable_reason() is None

    def unavailable_reason(self) -> str | None:
        if self._worker is None or not self._worker.is_alive():
            return "worker_unavailable"
        if not self._storage_healthy:
            return "queue_storage_unavailable"
        return None

    def enqueue(self, payload: dict[str, Any]) -> tuple[JobSnapshot, bool]:
        canonical_payload = json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
        )
        work_key = hashlib.sha256(canonical_payload.encode()).hexdigest()
        now = time.time()
        with self._connect() as connection:
            existing = connection.execute(
                """
                SELECT job_id
                FROM detailed_species_jobs
                WHERE work_key = ? AND status IN ('queued', 'running', 'complete')
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (work_key,),
            ).fetchone()
            if existing is not None:
                return self.get(str(existing["job_id"])), True

            queued_count = connection.execute(
                """
                SELECT COUNT(*) AS count
                FROM detailed_species_jobs
                WHERE status = 'queued'
                """
            ).fetchone()["count"]
            if int(queued_count) >= self.max_queued_jobs:
                raise JobQueueFullError("detailed_species_queue_full")

            job_id = str(uuid.uuid4())
            connection.execute(
                """
                INSERT INTO detailed_species_jobs (
                    job_id, work_key, status, payload_json, created_at,
                    cancel_requested
                ) VALUES (?, ?, 'queued', ?, ?, 0)
                """,
                (job_id, work_key, canonical_payload, now),
            )
        with self._condition:
            self._condition.notify()
        return self.get(job_id), False

    def get(self, job_id: str) -> JobSnapshot:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM detailed_species_jobs WHERE job_id = ?",
                (job_id,),
            ).fetchone()
            if row is None:
                raise KeyError(job_id)
            position = None
            estimated_wait = None
            if row["status"] == "queued":
                position = int(
                    connection.execute(
                        """
                        SELECT COUNT(*) AS count
                        FROM detailed_species_jobs
                        WHERE status = 'queued' AND created_at < ?
                        """,
                        (row["created_at"],),
                    ).fetchone()["count"]
                ) + 1
                duration_row = connection.execute(
                    """
                    SELECT AVG(compute_ms) AS average_ms
                    FROM (
                        SELECT compute_ms
                        FROM detailed_species_jobs
                        WHERE status = 'complete' AND compute_ms IS NOT NULL
                        ORDER BY completed_at DESC
                        LIMIT 20
                    )
                    """
                ).fetchone()
                average_ms = duration_row["average_ms"]
                if average_ms is not None:
                    estimated_wait = (float(average_ms) / 1000.0) * position
            result = (
                json.loads(row["result_json"])
                if row["result_json"] is not None
                else None
            )
            return JobSnapshot(
                job_id=str(row["job_id"]),
                status=str(row["status"]),
                queue_position=position,
                estimated_wait_seconds=estimated_wait,
                created_at=float(row["created_at"]),
                started_at=(
                    float(row["started_at"])
                    if row["started_at"] is not None
                    else None
                ),
                completed_at=(
                    float(row["completed_at"])
                    if row["completed_at"] is not None
                    else None
                ),
                compute_ms=(
                    float(row["compute_ms"])
                    if row["compute_ms"] is not None
                    else None
                ),
                result=result,
                error_code=(
                    str(row["error_code"])
                    if row["error_code"] is not None
                    else None
                ),
            )

    def cancel(self, job_id: str) -> JobSnapshot:
        now = time.time()
        with self._connect() as connection:
            row = connection.execute(
                "SELECT status FROM detailed_species_jobs WHERE job_id = ?",
                (job_id,),
            ).fetchone()
            if row is None:
                raise KeyError(job_id)
            if row["status"] == "queued":
                connection.execute(
                    """
                    UPDATE detailed_species_jobs
                    SET status = 'cancelled', cancel_requested = 1, completed_at = ?
                    WHERE job_id = ?
                    """,
                    (now, job_id),
                )
            elif row["status"] == "running":
                connection.execute(
                    """
                    UPDATE detailed_species_jobs
                    SET cancel_requested = 1
                    WHERE job_id = ?
                    """,
                    (job_id,),
                )
        return self.get(job_id)

    def metrics(self) -> dict[str, Any]:
        with self._connect() as connection:
            counts = {
                str(row["status"]): int(row["count"])
                for row in connection.execute(
                    """
                    SELECT status, COUNT(*) AS count
                    FROM detailed_species_jobs
                    GROUP BY status
                    """
                )
            }
            oldest = connection.execute(
                """
                SELECT MIN(created_at) AS created_at
                FROM detailed_species_jobs
                WHERE status = 'queued'
                """
            ).fetchone()["created_at"]
        return {
            "worker_healthy": self.is_available(),
            "queue_depth": counts.get("queued", 0),
            "active_jobs": counts.get("running", 0),
            "completed_jobs": counts.get("complete", 0),
            "failed_jobs": counts.get("failed", 0),
            "cancelled_jobs": counts.get("cancelled", 0),
            "oldest_queued_age_seconds": (
                max(0.0, time.time() - float(oldest))
                if oldest is not None
                else None
            ),
            "queue_capacity": self.max_queued_jobs,
            **_runtime_metrics(),
        }

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                claimed = self._retry_storage_operation(
                    self._claim_next,
                    "polling",
                )
            except _WorkerStopping:
                return
            if claimed is None:
                with self._condition:
                    self._condition.wait(timeout=1)
                continue
            job_id, payload = claimed
            self._process_claimed_job(job_id, payload)

    def _process_claimed_job(
        self,
        job_id: str,
        payload: dict[str, Any],
    ) -> None:
        started = time.perf_counter()
        try:
            result = self.calculator(
                payload,
                lambda: self._retry_storage_operation(
                    lambda: self._is_cancel_requested(job_id),
                    "cancellation check",
                ),
            )
            cancelled = self._retry_storage_operation(
                lambda: self._is_cancel_requested(job_id),
                "cancellation check",
            )
        except _WorkerStopping:
            return
        except Exception as exc:
            try:
                cancelled = self._retry_storage_operation(
                    lambda: self._is_cancel_requested(job_id),
                    "cancellation check",
                )
                if cancelled:
                    finish = partial(self._finish_cancelled, job_id)
                else:
                    finish = partial(
                        self._finish_failed,
                        job_id,
                        type(exc).__name__,
                        (time.perf_counter() - started) * 1000,
                    )
            except _WorkerStopping:
                return
        else:
            if cancelled:
                finish = partial(self._finish_cancelled, job_id)
            else:
                finish = partial(
                    self._finish_complete,
                    job_id,
                    result,
                    (time.perf_counter() - started) * 1000,
                )

        try:
            self._retry_storage_operation(finish, "job finalization")
        except _WorkerStopping:
            return

    def _retry_storage_operation(
        self,
        operation: Callable[[], StorageResult],
        operation_name: str,
    ) -> StorageResult:
        consecutive_failures = 0
        retry_seconds = min(
            self.storage_retry_initial_seconds,
            self.storage_retry_max_seconds,
        )
        while not self._stop.is_set():
            try:
                result = operation()
            except sqlite3.OperationalError:
                consecutive_failures += 1
                if (
                    consecutive_failures
                    >= self.storage_failure_unhealthy_threshold
                ):
                    self._storage_healthy = False
                LOGGER.warning(
                    "Detailed species queue %s failed; retrying in %.2fs",
                    operation_name,
                    retry_seconds,
                    exc_info=True,
                )
                if self._wait_for_retry(retry_seconds):
                    raise _WorkerStopping
                retry_seconds = min(
                    retry_seconds * 2,
                    self.storage_retry_max_seconds,
                )
                continue

            self._storage_healthy = True
            return result
        raise _WorkerStopping

    def _wait_for_retry(self, retry_seconds: float) -> bool:
        return self._stop.wait(retry_seconds)

    def _claim_next(self) -> tuple[str, dict[str, Any]] | None:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
                SELECT job_id, payload_json
                FROM detailed_species_jobs
                WHERE status = 'queued' AND cancel_requested = 0
                ORDER BY created_at
                LIMIT 1
                """
            ).fetchone()
            if row is None:
                connection.commit()
                return None
            connection.execute(
                """
                UPDATE detailed_species_jobs
                SET status = 'running', started_at = ?
                WHERE job_id = ?
                """,
                (time.time(), row["job_id"]),
            )
            connection.commit()
            return str(row["job_id"]), json.loads(row["payload_json"])

    def _is_cancel_requested(self, job_id: str) -> bool:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT cancel_requested
                FROM detailed_species_jobs
                WHERE job_id = ?
                """,
                (job_id,),
            ).fetchone()
        return row is None or bool(row["cancel_requested"])

    def _finish_complete(
        self,
        job_id: str,
        result: dict[str, Any],
        compute_ms: float,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE detailed_species_jobs
                SET status = 'complete', result_json = ?, completed_at = ?,
                    compute_ms = ?
                WHERE job_id = ?
                """,
                (
                    json.dumps(result, separators=(",", ":"), ensure_ascii=False),
                    time.time(),
                    compute_ms,
                    job_id,
                ),
            )

    def _finish_failed(
        self,
        job_id: str,
        error_code: str,
        compute_ms: float,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE detailed_species_jobs
                SET status = 'failed', error_code = ?, completed_at = ?,
                    compute_ms = ?
                WHERE job_id = ?
                """,
                (error_code, time.time(), compute_ms, job_id),
            )

    def _finish_cancelled(self, job_id: str) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE detailed_species_jobs
                SET status = 'cancelled', completed_at = ?
                WHERE job_id = ?
                """,
                (time.time(), job_id),
            )

    def _initialize_database(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS detailed_species_jobs (
                    job_id TEXT PRIMARY KEY,
                    work_key TEXT NOT NULL,
                    status TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    result_json TEXT,
                    error_code TEXT,
                    created_at REAL NOT NULL,
                    started_at REAL,
                    completed_at REAL,
                    compute_ms REAL,
                    cancel_requested INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS detailed_species_jobs_status_created
                ON detailed_species_jobs(status, created_at)
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS detailed_species_jobs_work_key
                ON detailed_species_jobs(work_key, status)
                """
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self.database_path,
            timeout=5,
            isolation_level=None,
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection


def _runtime_metrics() -> dict[str, Any]:
    process_rss_mb = _proc_value_mb(Path("/proc/self/status"), "VmRSS:")
    host_available_mb = _proc_value_mb(Path("/proc/meminfo"), "MemAvailable:")
    cgroup_current_mb = _bytes_file_mb(Path("/sys/fs/cgroup/memory.current"))
    cgroup_peak_mb = _bytes_file_mb(Path("/sys/fs/cgroup/memory.peak"))
    oom_kills = None
    events_path = Path("/sys/fs/cgroup/memory.events")
    if events_path.is_file():
        try:
            events = {
                key: int(value)
                for key, value in (
                    line.split()
                    for line in events_path.read_text(encoding="utf-8").splitlines()
                )
            }
            oom_kills = events.get("oom_kill")
        except (OSError, ValueError):
            pass
    try:
        load_average_1m = os.getloadavg()[0]
    except OSError:
        load_average_1m = None
    return {
        "process_rss_mb": process_rss_mb,
        "host_available_memory_mb": host_available_mb,
        "cgroup_memory_current_mb": cgroup_current_mb,
        "cgroup_memory_peak_mb": cgroup_peak_mb,
        "cgroup_oom_kills": oom_kills,
        "load_average_1m": load_average_1m,
        "cpu_count": os.cpu_count(),
    }


def _proc_value_mb(path: Path, prefix: str) -> float | None:
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith(prefix):
                value_kib = int(line.split()[1])
                return round(value_kib / 1024, 3)
    except (OSError, IndexError, ValueError):
        pass
    return None


def _bytes_file_mb(path: Path) -> float | None:
    try:
        value = path.read_text(encoding="utf-8").strip()
        if value == "max":
            return None
        return round(int(value) / (1024 * 1024), 3)
    except (OSError, ValueError):
        return None
