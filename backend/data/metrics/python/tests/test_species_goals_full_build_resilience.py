"""Full-build monitor: memory-pressure stop, peak memory, report writes, size walk.

Windows behavior is simulated with monkeypatching so these run on any OS.
"""

from __future__ import annotations

import errno
import importlib.util
import itertools
import os
import subprocess
import sys
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

import platform_io

BUILD_SCRIPT = Path(__file__).resolve().parents[1] / "run_species_goals_full_build.py"


@pytest.fixture(scope="module")
def build():
    spec = importlib.util.spec_from_file_location(
        "run_species_goals_full_build", BUILD_SCRIPT
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class _EmptyQueue:
    def get(self, timeout=None):
        import queue

        raise queue.Empty

    def get_nowait(self):
        import queue

        raise queue.Empty


class _ProcessAliveUntilStopped:
    exitcode = 0

    def __init__(self, stop_event: threading.Event, max_checks: int):
        self.stop_event = stop_event
        self.remaining_checks = max_checks

    def is_alive(self) -> bool:
        self.remaining_checks -= 1
        return self.remaining_checks >= 0 and not self.stop_event.is_set()

    def join(self) -> None:
        return None


def _empty_report() -> dict:
    return {
        "solutions": {},
        "workers": {},
        "resources": {
            "diskFreeGiB": 0.0,
            "memoryFreePercent": None,
            "outputBytes": 0,
            "peakWorkerRssBytes": 0,
            "peakValidatorRssBytes": 0,
        },
        "errors": [],
        "blockers": [],
    }


def _monitor_with_memory_readings(
    build, monkeypatch, tmp_path: Path, readings: list[int | None], max_checks: int
) -> tuple[dict, threading.Event, list[int | None]]:
    observed: list[int | None] = []
    remaining = iter(readings)

    def read_memory() -> int | None:
        value = next(remaining, 50)
        observed.append(value)
        return value

    clock = itertools.count(start=1_000, step=30)
    monkeypatch.setattr(build, "_memory_free_percent", read_memory)
    monkeypatch.setattr(build, "_disk_free_gib", lambda path: 1_000.0)
    monkeypatch.setattr(build, "time", SimpleNamespace(monotonic=lambda: next(clock)))
    stop_event = threading.Event()
    report = _empty_report()
    build._monitor_processes(
        processes=[_ProcessAliveUntilStopped(stop_event, max_checks)],
        event_queue=_EmptyQueue(),
        stop_event=stop_event,
        report=report,
        report_path=tmp_path / "report.json",
        output_root=tmp_path,
        started=0.0,
    )
    return report, stop_event, observed


def _memory_blockers(report: dict) -> list[dict]:
    return [b for b in report["blockers"] if b["reason"] == "unsafe-memory-pressure"]


def test_three_consecutive_low_memory_readings_stop_the_build(
    build, monkeypatch, tmp_path: Path
):
    report, stop_event, observed = _monitor_with_memory_readings(
        build, monkeypatch, tmp_path, readings=[5, 9, 3], max_checks=20
    )

    assert stop_event.is_set()
    assert _memory_blockers(report) == [
        {"type": "blocker", "reason": "unsafe-memory-pressure"}
    ]
    assert observed[:3] == [5, 9, 3]


def test_a_healthy_reading_between_low_readings_resets_the_memory_stop(
    build, monkeypatch, tmp_path: Path
):
    report, stop_event, _ = _monitor_with_memory_readings(
        build, monkeypatch, tmp_path, readings=[5, 5, 10, 5, 5, 50], max_checks=6
    )

    assert not stop_event.is_set()
    assert _memory_blockers(report) == []


def test_missing_memory_readings_never_stop_the_build(
    build, monkeypatch, tmp_path: Path
):
    report, stop_event, _ = _monitor_with_memory_readings(
        build, monkeypatch, tmp_path, readings=[None] * 6, max_checks=6
    )

    assert not stop_event.is_set()
    assert _memory_blockers(report) == []


def test_memory_reading_on_windows_uses_global_memory_status(build, monkeypatch):
    monkeypatch.setattr(build, "os", SimpleNamespace(name="nt"))
    monkeypatch.setattr(build, "windows_free_memory_percent", lambda: 42)
    assert build._memory_free_percent() == 42


def test_memory_reading_off_windows_still_parses_macos_memory_pressure(
    build, monkeypatch
):
    calls: list[list[str]] = []

    def run(command, **kwargs):
        calls.append(command)
        return SimpleNamespace(stdout="System-wide memory free percentage: 37%\n")

    monkeypatch.setattr(build, "os", SimpleNamespace(name="posix"))
    monkeypatch.setattr(
        build,
        "subprocess",
        SimpleNamespace(run=run, SubprocessError=subprocess.SubprocessError),
    )
    assert build._memory_free_percent() == 37
    assert calls == [["/usr/bin/memory_pressure", "-Q"]]


def test_peak_memory_on_windows_reports_the_peak_working_set(build, monkeypatch):
    monkeypatch.setattr(build, "os", SimpleNamespace(name="nt"))
    monkeypatch.setattr(build, "peak_rss_bytes", lambda: 3_000_000_000)
    assert build._max_rss_bytes() == 3_000_000_000


def test_peak_memory_off_windows_reports_raw_rusage_max_rss(build, monkeypatch):
    monkeypatch.setattr(build, "os", SimpleNamespace(name="posix"))
    monkeypatch.setattr(build, "process_rusage", lambda: SimpleNamespace(ru_maxrss=12_345))
    assert build._max_rss_bytes() == 12_345


def test_report_write_succeeds_after_windows_reports_it_in_use(
    build, monkeypatch, tmp_path: Path
):
    monkeypatch.setattr(platform_io, "_RETRY_FILE_IN_USE_ERRORS", True)
    monkeypatch.setattr(platform_io, "time", SimpleNamespace(sleep=lambda seconds: None))
    real_replace = os.replace
    attempts: list[int] = []

    def replace_blocked_twice(src, dst):
        attempts.append(1)
        if len(attempts) <= 2:
            raise PermissionError(errno.EACCES, "report is open in another process")
        real_replace(src, dst)

    monkeypatch.setattr(os, "replace", replace_blocked_twice)
    report_path = tmp_path / "report.json"
    build._atomic_json_write(report_path, {"phase": "generating"})

    assert report_path.read_bytes() == b'{\n  "phase": "generating"\n}\n'
    assert len(attempts) == 3


def test_output_size_walk_skips_files_deleted_or_locked_mid_walk(
    build, monkeypatch, tmp_path: Path
):
    kept = tmp_path / "kept.json"
    vanishing = tmp_path / "nested" / "vanishing.json"
    delete_pending = tmp_path / "nested" / "delete-pending.json"
    vanishing.parent.mkdir()
    kept.write_bytes(b"x" * 10)
    vanishing.write_bytes(b"x" * 1_000)
    delete_pending.write_bytes(b"x" * 100_000)
    real_is_file = Path.is_file
    real_stat = Path.stat

    def is_file_then_vanish(self):
        result = real_is_file(self)
        if self == vanishing and result:
            os.remove(self)
        return result

    def stat_denied_for_delete_pending(self, *args, **kwargs):
        if self == delete_pending:
            raise PermissionError(errno.EACCES, "delete pending")
        return real_stat(self, *args, **kwargs)

    monkeypatch.setattr(Path, "is_file", is_file_then_vanish)
    monkeypatch.setattr(Path, "stat", stat_denied_for_delete_pending)

    assert build._output_tree_bytes(tmp_path) == 10
