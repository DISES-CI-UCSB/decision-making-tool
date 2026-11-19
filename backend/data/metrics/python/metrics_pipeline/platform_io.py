"""File locks, file replacement, and process stats that work on Windows and Unix.

Unix locking uses fcntl (file control). Windows uses msvcrt, the C runtime
lock. Directory flush is skipped on Windows because that operating system
cannot fsync a directory handle.

Windows refuses to replace or delete a file that another process holds open
(PermissionError, WinError 5 or 32), where Unix succeeds. The replace and
unlink helpers retry briefly on Windows and are plain os calls on Unix.

Windows memory stats come from kernel32 and psapi through ctypes because the
stdlib resource module is Unix-only.
"""

from __future__ import annotations

import ctypes
import errno
import functools
import logging
import os
import sys
import time
from pathlib import Path
from types import SimpleNamespace

try:
    import fcntl
except ImportError:
    fcntl = None

try:
    import msvcrt
except ImportError:
    msvcrt = None

try:
    import resource
except ImportError:
    resource = None

_LOGGER = logging.getLogger(__name__)
_ZERO_USAGE = SimpleNamespace(ru_utime=0.0, ru_stime=0.0, ru_maxrss=0)
_RETRY_FILE_IN_USE_ERRORS = os.name == "nt"
# About 7 s total: a replace failure loses data, so it waits longer.
_REPLACE_RETRY_DELAYS_SECONDS = (0.01, 0.02, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 2.0, 2.0)
# About 1.6 s total: an optional delete must not stall a worker for long.
_UNLINK_RETRY_DELAYS_SECONDS = (0.01, 0.02, 0.05, 0.1, 0.2, 0.4, 0.8)
_WINDOWS_LOCK_POLL_SECONDS = 0.05
_WINDOWS_LOCK_BUSY_ERRNOS = frozenset(
    {errno.EACCES, errno.EDEADLK, getattr(errno, "EDEADLOCK", errno.EDEADLK)}
)


def lock_exclusive(handle, *, nonblocking: bool = False) -> None:
    """Lock an open file exclusively, waiting forever unless nonblocking.

    Raises BlockingIOError when nonblocking is true and another holder has the lock.
    """
    if fcntl is not None:
        flags = fcntl.LOCK_EX
        if nonblocking:
            flags |= fcntl.LOCK_NB
        fcntl.flock(handle.fileno(), flags)
        return
    if msvcrt is None:
        raise OSError("No file-lock implementation is available.")
    _prepare_windows_lock_region(handle)
    if not nonblocking:
        _lock_windows_until_acquired(handle)
        return
    try:
        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError as exc:
        raise BlockingIOError(exc.errno or 0, "file lock is busy") from exc


def _lock_windows_until_acquired(handle) -> None:
    """Poll the non-blocking lock until it succeeds, matching Unix flock.

    msvcrt.LK_LOCK gives up with OSError after about 10 seconds.
    """
    while True:
        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            return
        except OSError as exc:
            if exc.errno not in _WINDOWS_LOCK_BUSY_ERRNOS:
                raise
        time.sleep(_WINDOWS_LOCK_POLL_SECONDS)


def unlock_exclusive(handle) -> None:
    if fcntl is not None:
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        return
    if msvcrt is None:
        return
    handle.seek(0)
    try:
        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
    except OSError:
        return


def _prepare_windows_lock_region(handle) -> None:
    """msvcrt locks a byte range, so the lock file needs at least one byte."""
    handle.seek(0, os.SEEK_END)
    if handle.tell() == 0:
        handle.write(b"\0")
        handle.flush()
    handle.seek(0)


def fsync_directory(path: Path) -> None:
    """Flush directory entries after a rename. No-op on Windows."""
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def replace_with_retry(source: str | os.PathLike, destination: str | os.PathLike) -> None:
    """os.replace that waits briefly while Windows reports the file in use.

    On Unix this is exactly os.replace. On Windows the final PermissionError
    propagates so a failed write is never silently lost.
    """
    if not _RETRY_FILE_IN_USE_ERRORS:
        os.replace(source, destination)
        return
    for delay in _REPLACE_RETRY_DELAYS_SECONDS:
        try:
            os.replace(source, destination)
            return
        except PermissionError as exc:
            _LOGGER.debug("Replacing %s is blocked (%s); retrying.", destination, exc)
            time.sleep(delay)
    os.replace(source, destination)


def unlink_best_effort(path: Path) -> bool:
    """Delete path if it exists; return False when Windows keeps it in use.

    For optional deletes such as cache eviction. On Unix this is exactly
    Path.unlink(missing_ok=True), so it always returns True or raises.
    """
    if not _RETRY_FILE_IN_USE_ERRORS:
        path.unlink(missing_ok=True)
        return True
    for delay in _UNLINK_RETRY_DELAYS_SECONDS:
        try:
            path.unlink(missing_ok=True)
            return True
        except PermissionError:
            time.sleep(delay)
    try:
        path.unlink(missing_ok=True)
        return True
    except PermissionError as exc:
        _LOGGER.info("Skipped deleting %s because it is still in use (%s).", path, exc)
        return False


def process_rusage():
    """Return this process's resource usage, or zeros when resource is missing.

    The stdlib resource module is Unix-only. Windows callers still get
    ru_utime, ru_stime, and ru_maxrss fields so timing math can run.
    """
    if resource is None:
        return _ZERO_USAGE
    return resource.getrusage(resource.RUSAGE_SELF)


def peak_rss_bytes() -> int:
    """Peak resident memory in bytes, or 0 when the OS does not report it.

    Windows reports the peak working set, its name for peak resident memory.
    """
    if resource is None:
        return windows_peak_working_set_bytes() or 0
    peak = int(process_rusage().ru_maxrss)
    if sys.platform == "darwin":
        return peak
    return peak * 1024


class _MemoryStatusEx(ctypes.Structure):
    """Win32 MEMORYSTATUSEX, filled by kernel32.GlobalMemoryStatusEx."""

    _fields_ = [
        ("dwLength", ctypes.c_uint32),
        ("dwMemoryLoad", ctypes.c_uint32),
        ("ullTotalPhys", ctypes.c_uint64),
        ("ullAvailPhys", ctypes.c_uint64),
        ("ullTotalPageFile", ctypes.c_uint64),
        ("ullAvailPageFile", ctypes.c_uint64),
        ("ullTotalVirtual", ctypes.c_uint64),
        ("ullAvailVirtual", ctypes.c_uint64),
        ("ullAvailExtendedVirtual", ctypes.c_uint64),
    ]


class _ProcessMemoryCounters(ctypes.Structure):
    """Win32 PROCESS_MEMORY_COUNTERS, filled by psapi.GetProcessMemoryInfo."""

    _fields_ = [
        ("cb", ctypes.c_uint32),
        ("PageFaultCount", ctypes.c_uint32),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
    ]


@functools.lru_cache(maxsize=1)
def _windows_dlls() -> SimpleNamespace:
    """Private kernel32/psapi handles so shared ctypes.windll signatures stay untouched."""
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    kernel32.GlobalMemoryStatusEx.argtypes = [ctypes.POINTER(_MemoryStatusEx)]
    kernel32.GlobalMemoryStatusEx.restype = ctypes.c_int
    kernel32.GetCurrentProcess.argtypes = []
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    psapi.GetProcessMemoryInfo.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(_ProcessMemoryCounters),
        ctypes.c_uint32,
    ]
    psapi.GetProcessMemoryInfo.restype = ctypes.c_int
    return SimpleNamespace(kernel32=kernel32, psapi=psapi)


def windows_free_memory_percent(kernel32=None) -> int | None:
    """Available physical memory as a whole percent of total, or None.

    Returns None off Windows or when GlobalMemoryStatusEx fails.
    """
    status = _MemoryStatusEx()
    status.dwLength = ctypes.sizeof(_MemoryStatusEx)
    try:
        if kernel32 is None:
            kernel32 = _windows_dlls().kernel32
        if not kernel32.GlobalMemoryStatusEx(ctypes.pointer(status)):
            return None
    except (AttributeError, OSError):
        return None
    if status.ullTotalPhys == 0:
        return None
    return int(status.ullAvailPhys * 100 // status.ullTotalPhys)


def windows_peak_working_set_bytes(kernel32=None, psapi=None) -> int | None:
    """This process's peak working set in bytes, or None.

    Returns None off Windows or when GetProcessMemoryInfo fails.
    """
    counters = _ProcessMemoryCounters()
    counters.cb = ctypes.sizeof(_ProcessMemoryCounters)
    try:
        if kernel32 is None or psapi is None:
            dlls = _windows_dlls()
            kernel32 = kernel32 or dlls.kernel32
            psapi = psapi or dlls.psapi
        process = kernel32.GetCurrentProcess()
        if not psapi.GetProcessMemoryInfo(process, ctypes.pointer(counters), counters.cb):
            return None
    except (AttributeError, OSError):
        return None
    return int(counters.PeakWorkingSetSize)
