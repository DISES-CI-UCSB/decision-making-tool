from __future__ import annotations

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
