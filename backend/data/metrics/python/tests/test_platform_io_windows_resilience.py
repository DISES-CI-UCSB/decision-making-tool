"""Windows file-in-use retries, blocking lock emulation, and memory readers.

Windows behavior is simulated with monkeypatching so these run on any OS.
"""

from __future__ import annotations

import ctypes
import errno
import os
from pathlib import Path
from types import SimpleNamespace

import pytest

import platform_io


def _in_use_error() -> PermissionError:
    return PermissionError(errno.EACCES, "The process cannot access the file")


@pytest.fixture
def sleeps(monkeypatch) -> list[float]:
    recorded: list[float] = []
    monkeypatch.setattr(platform_io, "time", SimpleNamespace(sleep=recorded.append))
    return recorded


@pytest.fixture
def simulate_windows_file_errors(monkeypatch) -> None:
    monkeypatch.setattr(platform_io, "_RETRY_FILE_IN_USE_ERRORS", True)


@pytest.fixture
def simulate_unix_file_errors(monkeypatch) -> None:
    monkeypatch.setattr(platform_io, "_RETRY_FILE_IN_USE_ERRORS", False)


def test_replace_succeeds_after_windows_reports_destination_in_use(
    tmp_path: Path, monkeypatch, sleeps, simulate_windows_file_errors
):
    source = tmp_path / "new.json"
    destination = tmp_path / "report.json"
    source.write_text("new", encoding="utf-8")
    destination.write_text("old", encoding="utf-8")
    real_replace = os.replace
    attempts: list[int] = []

    def replace_blocked_three_times(src, dst):
        attempts.append(1)
        if len(attempts) <= 3:
            raise _in_use_error()
        real_replace(src, dst)

    monkeypatch.setattr(os, "replace", replace_blocked_three_times)
    platform_io.replace_with_retry(source, destination)

    assert destination.read_text(encoding="utf-8") == "new"
    assert not source.exists()
    assert len(attempts) == 4
    assert len(sleeps) == 3


def test_replace_raises_original_error_when_file_stays_in_use(
    tmp_path: Path, monkeypatch, sleeps, simulate_windows_file_errors
):
    attempts: list[int] = []

    def replace_always_blocked(src, dst):
        attempts.append(1)
        raise _in_use_error()

    monkeypatch.setattr(os, "replace", replace_always_blocked)
    with pytest.raises(PermissionError):
        platform_io.replace_with_retry(tmp_path / "a", tmp_path / "b")

    assert len(attempts) == len(platform_io._REPLACE_RETRY_DELAYS_SECONDS) + 1
    assert sum(sleeps) < 10


def test_replace_does_not_retry_errors_other_than_file_in_use(
    tmp_path: Path, sleeps, simulate_windows_file_errors
):
    with pytest.raises(FileNotFoundError):
        platform_io.replace_with_retry(tmp_path / "missing", tmp_path / "b")
    assert sleeps == []


def test_replace_on_unix_is_a_single_plain_os_replace(
    tmp_path: Path, monkeypatch, sleeps, simulate_unix_file_errors
):
    attempts: list[tuple] = []

    def replace_blocked(src, dst):
        attempts.append((src, dst))
        raise _in_use_error()

    monkeypatch.setattr(os, "replace", replace_blocked)
    with pytest.raises(PermissionError):
        platform_io.replace_with_retry(tmp_path / "a", tmp_path / "b")
    assert attempts == [(tmp_path / "a", tmp_path / "b")]
    assert sleeps == []


def test_best_effort_unlink_skips_a_file_windows_keeps_in_use(
    tmp_path: Path, monkeypatch, sleeps, simulate_windows_file_errors
):
    held = tmp_path / "held.tif"
    held.write_bytes(b"raster")
    attempts: list[int] = []

    def unlink_blocked(self, missing_ok=False):
        attempts.append(1)
        raise _in_use_error()

    monkeypatch.setattr(Path, "unlink", unlink_blocked)

    assert platform_io.unlink_best_effort(held) is False
    assert held.is_file()
    assert len(attempts) == len(platform_io._UNLINK_RETRY_DELAYS_SECONDS) + 1
    assert sum(sleeps) < 10


def test_best_effort_unlink_deletes_once_the_file_is_released(
    tmp_path: Path, monkeypatch, sleeps, simulate_windows_file_errors
):
    held = tmp_path / "held.tif"
    held.write_bytes(b"raster")
    real_unlink = Path.unlink
    attempts: list[int] = []

    def unlink_blocked_twice(self, missing_ok=False):
        attempts.append(1)
        if len(attempts) <= 2:
            raise _in_use_error()
        real_unlink(self, missing_ok=missing_ok)

    monkeypatch.setattr(Path, "unlink", unlink_blocked_twice)

    assert platform_io.unlink_best_effort(held) is True
    assert not held.exists()
    assert len(sleeps) == 2


def test_best_effort_unlink_treats_a_missing_file_as_deleted(
    tmp_path: Path, simulate_windows_file_errors
):
    assert platform_io.unlink_best_effort(tmp_path / "gone") is True


def test_best_effort_unlink_on_unix_raises_like_path_unlink(
    tmp_path: Path, monkeypatch, sleeps, simulate_unix_file_errors
):
    def unlink_blocked(self, missing_ok=False):
        raise _in_use_error()

    monkeypatch.setattr(Path, "unlink", unlink_blocked)
    with pytest.raises(PermissionError):
        platform_io.unlink_best_effort(tmp_path / "x")
    assert sleeps == []


class _FakeMsvcrt:
    LK_UNLCK = 0
    LK_LOCK = 1
    LK_NBLCK = 2

    def __init__(self, failures: list[OSError]):
        self.failures = list(failures)
        self.modes: list[int] = []

    def locking(self, fileno, mode, nbytes):
        self.modes.append(mode)
        if self.failures:
            raise self.failures.pop(0)


@pytest.fixture
def lock_file(tmp_path: Path):
    with (tmp_path / "key.lock").open("a+b") as handle:
        yield handle


def _simulate_windows_lock(monkeypatch, fake: _FakeMsvcrt) -> None:
    monkeypatch.setattr(platform_io, "fcntl", None)
    monkeypatch.setattr(platform_io, "msvcrt", fake)


def test_blocking_windows_lock_waits_past_busy_attempts_instead_of_giving_up(
    monkeypatch, sleeps, lock_file
):
    busy = [OSError(errno.EACCES, "locked")] * 400
    fake = _FakeMsvcrt(busy)
    _simulate_windows_lock(monkeypatch, fake)

    platform_io.lock_exclusive(lock_file)

    assert len(fake.modes) == 401
    assert set(fake.modes) == {fake.LK_NBLCK}
    assert len(sleeps) == 400


def test_blocking_windows_lock_raises_errors_that_are_not_contention(
    monkeypatch, sleeps, lock_file
):
    fake = _FakeMsvcrt([OSError(errno.EBADF, "bad file descriptor")])
    _simulate_windows_lock(monkeypatch, fake)

    with pytest.raises(OSError) as raised:
        platform_io.lock_exclusive(lock_file)
    assert raised.value.errno == errno.EBADF
    assert sleeps == []


def test_nonblocking_windows_lock_still_reports_busy_immediately(
    monkeypatch, sleeps, lock_file
):
    fake = _FakeMsvcrt([OSError(errno.EACCES, "locked")])
    _simulate_windows_lock(monkeypatch, fake)

    with pytest.raises(BlockingIOError):
        platform_io.lock_exclusive(lock_file, nonblocking=True)
    assert fake.modes == [fake.LK_NBLCK]
    assert sleeps == []


class _FakeKernel32:
    def __init__(self, *, total: int, available: int, succeeds: bool = True):
        self.total = total
        self.available = available
        self.succeeds = succeeds

    def GlobalMemoryStatusEx(self, status_pointer):
        status = status_pointer.contents
        assert status.dwLength == ctypes.sizeof(platform_io._MemoryStatusEx)
        status.ullTotalPhys = self.total
        status.ullAvailPhys = self.available
        return 1 if self.succeeds else 0

    def GetCurrentProcess(self):
        return 123


def test_windows_free_memory_percent_reports_available_share_of_physical_memory():
    gib = 1024**3
    kernel32 = _FakeKernel32(total=16 * gib, available=1 * gib)
    assert platform_io.windows_free_memory_percent(kernel32) == 6


def test_windows_free_memory_percent_is_none_when_the_call_fails():
    kernel32 = _FakeKernel32(total=16, available=8, succeeds=False)
    assert platform_io.windows_free_memory_percent(kernel32) is None
    assert platform_io.windows_free_memory_percent(_FakeKernel32(total=0, available=0)) is None


class _FakePsapi:
    def __init__(self, *, peak: int, succeeds: bool = True):
        self.peak = peak
        self.succeeds = succeeds
        self.process = None

    def GetProcessMemoryInfo(self, process, counters_pointer, size):
        self.process = process
        assert size == ctypes.sizeof(platform_io._ProcessMemoryCounters)
        counters_pointer.contents.PeakWorkingSetSize = self.peak
        return 1 if self.succeeds else 0


def test_windows_peak_working_set_reads_this_process_peak():
    psapi = _FakePsapi(peak=5_000_000)
    kernel32 = _FakeKernel32(total=1, available=1)
    assert platform_io.windows_peak_working_set_bytes(kernel32, psapi) == 5_000_000
    assert psapi.process == 123


def test_windows_peak_working_set_is_none_when_the_call_fails():
    psapi = _FakePsapi(peak=5, succeeds=False)
    kernel32 = _FakeKernel32(total=1, available=1)
    assert platform_io.windows_peak_working_set_bytes(kernel32, psapi) is None


def test_peak_rss_bytes_uses_windows_peak_working_set_without_resource_module(monkeypatch):
    monkeypatch.setattr(platform_io, "resource", None)
    monkeypatch.setattr(platform_io, "windows_peak_working_set_bytes", lambda: 7_340_032)
    assert platform_io.peak_rss_bytes() == 7_340_032

    monkeypatch.setattr(platform_io, "windows_peak_working_set_bytes", lambda: None)
    assert platform_io.peak_rss_bytes() == 0
