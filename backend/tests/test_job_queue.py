from __future__ import annotations

import sqlite3
import threading
import time
from pathlib import Path

import pytest

from app.job_queue import DetailedSpeciesJobQueue, JobQueueFullError


def test_job_queue_coalesces_completed_work(tmp_path: Path) -> None:
    queue = DetailedSpeciesJobQueue(
        tmp_path / "jobs.sqlite3",
        lambda payload, _is_cancelled: {"value": payload["value"]},
    )
    queue.start()
    try:
        created, coalesced = queue.enqueue({"value": 7})
        assert not coalesced

        completed = _wait_for_status(queue, created.job_id, "complete")
        assert completed.result == {"value": 7}

        cached, coalesced = queue.enqueue({"value": 7})
        assert coalesced
        assert cached.job_id == created.job_id
        assert cached.status == "complete"
    finally:
        queue.stop()


def test_job_queue_reports_capacity_and_cancels_waiting_work(tmp_path: Path) -> None:
    release_worker = threading.Event()

    def calculate(
        payload: dict[str, int],
        _is_cancelled,
    ) -> dict[str, int]:
        release_worker.wait(timeout=2)
        return payload

    queue = DetailedSpeciesJobQueue(
        tmp_path / "jobs.sqlite3",
        calculate,
        max_queued_jobs=1,
    )
    queue.start()
    try:
        running, _ = queue.enqueue({"value": 1})
        _wait_for_status(queue, running.job_id, "running")
        waiting, _ = queue.enqueue({"value": 2})
        assert queue.get(waiting.job_id).queue_position == 1

        with pytest.raises(JobQueueFullError):
            queue.enqueue({"value": 3})

        cancelled = queue.cancel(waiting.job_id)
        assert cancelled.status == "cancelled"
        assert queue.metrics()["cancelled_jobs"] == 1
    finally:
        release_worker.set()
        queue.stop()


def test_job_queue_retries_transient_claim_failure_and_processes_work(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    queue = DetailedSpeciesJobQueue(
        tmp_path / "jobs.sqlite3",
        lambda payload, _is_cancelled: payload,
        storage_retry_initial_seconds=0.01,
        storage_retry_max_seconds=0.01,
    )
    original_claim_next = queue._claim_next
    attempts = 0

    def claim_next():
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise sqlite3.OperationalError("database is temporarily locked")
        return original_claim_next()

    monkeypatch.setattr(queue, "_claim_next", claim_next)
    queue.start()
    try:
        created, _ = queue.enqueue({"value": 7})

        completed = _wait_for_status(queue, created.job_id, "complete")

        assert completed.result == {"value": 7}
        assert attempts >= 2
        assert queue.is_available()
    finally:
        queue.stop()


def test_job_queue_backs_off_and_reports_persistent_claim_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    queue = DetailedSpeciesJobQueue(
        tmp_path / "jobs.sqlite3",
        lambda payload, _is_cancelled: payload,
        storage_retry_initial_seconds=0.02,
        storage_retry_max_seconds=0.02,
        storage_failure_unhealthy_threshold=2,
    )
    call_times: list[float] = []

    def fail_claim():
        call_times.append(time.monotonic())
        raise sqlite3.OperationalError("storage unavailable")

    monkeypatch.setattr(queue, "_claim_next", fail_claim)
    queue.start()
    try:
        _wait_until(lambda: len(call_times) >= 3)

        assert all(
            later - earlier >= 0.015
            for earlier, later in zip(call_times, call_times[1:])
        )
        assert queue._worker is not None and queue._worker.is_alive()
        assert queue.unavailable_reason() == "queue_storage_unavailable"
        assert queue.metrics()["worker_healthy"] is False
    finally:
        queue.stop()


def test_job_queue_retries_transient_cancellation_check_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    queue = DetailedSpeciesJobQueue(
        tmp_path / "jobs.sqlite3",
        lambda payload, _is_cancelled: payload,
        storage_retry_initial_seconds=0.01,
        storage_retry_max_seconds=0.01,
    )
    original_is_cancel_requested = queue._is_cancel_requested
    attempts = 0

    def is_cancel_requested(job_id: str) -> bool:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise sqlite3.OperationalError("temporary cancellation read failure")
        return original_is_cancel_requested(job_id)

    queue.start()
    monkeypatch.setattr(queue, "_is_cancel_requested", is_cancel_requested)
    try:
        created, _ = queue.enqueue({"value": 7})

        completed = _wait_for_status(queue, created.job_id, "complete")

        assert completed.result == {"value": 7}
        assert attempts >= 2
        assert queue.is_available()
    finally:
        queue.stop()


def test_job_queue_retries_transient_finalization_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    queue = DetailedSpeciesJobQueue(
        tmp_path / "jobs.sqlite3",
        lambda payload, _is_cancelled: payload,
        storage_retry_initial_seconds=0.01,
        storage_retry_max_seconds=0.01,
    )
    original_finish_complete = queue._finish_complete
    attempts = 0

    def finish_complete(job_id: str, result: dict, compute_ms: float) -> None:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise sqlite3.OperationalError("temporary finalization failure")
        original_finish_complete(job_id, result, compute_ms)

    queue.start()
    monkeypatch.setattr(queue, "_finish_complete", finish_complete)
    try:
        created, _ = queue.enqueue({"value": 7})

        completed = _wait_for_status(queue, created.job_id, "complete")

        assert completed.result == {"value": 7}
        assert attempts == 2
        assert queue.is_available()
    finally:
        queue.stop()


def test_job_queue_recovers_health_after_storage_recovers(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    queue = DetailedSpeciesJobQueue(
        tmp_path / "jobs.sqlite3",
        lambda payload, _is_cancelled: payload,
        storage_retry_initial_seconds=0.01,
        storage_retry_max_seconds=0.01,
        storage_failure_unhealthy_threshold=2,
    )
    original_claim_next = queue._claim_next
    allow_recovery = threading.Event()
    attempts = 0

    def claim_next():
        nonlocal attempts
        attempts += 1
        if attempts <= 2:
            raise sqlite3.OperationalError("storage unavailable")
        allow_recovery.wait(timeout=2)
        return original_claim_next()

    monkeypatch.setattr(queue, "_claim_next", claim_next)
    queue.start()
    try:
        _wait_until(
            lambda: queue.unavailable_reason() == "queue_storage_unavailable"
        )

        allow_recovery.set()
        _wait_until(queue.is_available)

        assert queue.unavailable_reason() is None
        assert queue._worker is not None and queue._worker.is_alive()
    finally:
        allow_recovery.set()
        queue.stop()


def test_storage_retry_uses_exponential_progression_and_cap(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    queue = DetailedSpeciesJobQueue(
        tmp_path / "jobs.sqlite3",
        lambda payload, _is_cancelled: payload,
        storage_retry_initial_seconds=0.01,
        storage_retry_max_seconds=0.04,
    )
    retry_delays: list[float] = []
    attempts = 0

    def operation() -> str:
        nonlocal attempts
        attempts += 1
        if attempts <= 4:
            raise sqlite3.OperationalError("storage unavailable")
        return "recovered"

    monkeypatch.setattr(
        queue,
        "_wait_for_retry",
        lambda delay: retry_delays.append(delay) or False,
    )

    result = queue._retry_storage_operation(operation, "test operation")

    assert result == "recovered"
    assert retry_delays == [0.01, 0.02, 0.04, 0.04]
    assert queue._storage_healthy is True


def test_job_queue_shutdown_interrupts_storage_backoff(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    queue = DetailedSpeciesJobQueue(
        tmp_path / "jobs.sqlite3",
        lambda payload, _is_cancelled: payload,
        storage_retry_initial_seconds=5,
        storage_retry_max_seconds=5,
    )
    claim_failed = threading.Event()

    def fail_claim():
        claim_failed.set()
        raise sqlite3.OperationalError("storage unavailable")

    monkeypatch.setattr(queue, "_claim_next", fail_claim)
    queue.start()
    worker = queue._worker
    assert claim_failed.wait(timeout=1)

    started = time.monotonic()
    queue.stop()

    assert time.monotonic() - started < 0.5
    assert worker is not None and not worker.is_alive()


def test_job_queue_reports_worker_unavailable_when_not_running(tmp_path: Path) -> None:
    queue = DetailedSpeciesJobQueue(
        tmp_path / "jobs.sqlite3",
        lambda payload, _is_cancelled: payload,
    )

    assert queue.unavailable_reason() == "worker_unavailable"
    assert not queue.is_available()


def _wait_for_status(
    queue: DetailedSpeciesJobQueue,
    job_id: str,
    status: str,
) -> object:
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        snapshot = queue.get(job_id)
        if snapshot.status == status:
            return snapshot
        time.sleep(0.01)
    raise AssertionError(f"Job {job_id} did not reach {status}.")


def _wait_until(predicate) -> None:
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("Condition was not met before timeout.")
