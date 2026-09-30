"""File locks and process stats that work on Windows and Unix.

Unix locking uses fcntl (file control). Windows uses msvcrt, the C runtime
lock. Directory flush is skipped on Windows because that operating system
cannot fsync a directory handle.
"""

from __future__ import annotations

import os
import sys
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

_ZERO_USAGE = SimpleNamespace(ru_utime=0.0, ru_stime=0.0, ru_maxrss=0)


def lock_exclusive(handle, *, nonblocking: bool = False) -> None:
    """Lock an open file exclusively.

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
    mode = msvcrt.LK_NBLCK if nonblocking else msvcrt.LK_LOCK
    try:
        msvcrt.locking(handle.fileno(), mode, 1)
    except OSError as exc:
        if nonblocking:
            raise BlockingIOError(exc.errno or 0, "file lock is busy") from exc
        raise


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


def process_rusage():
    """Return this process's resource usage, or zeros when resource is missing.

    The stdlib resource module is Unix-only. Windows callers still get
    ru_utime, ru_stime, and ru_maxrss fields so timing math can run.
    """
    if resource is None:
        return _ZERO_USAGE
    return resource.getrusage(resource.RUSAGE_SELF)


def peak_rss_bytes() -> int:
    """Peak resident memory in bytes, or 0 when the OS does not report it."""
    peak = int(process_rusage().ru_maxrss)
    if resource is None:
        return 0
    if sys.platform == "darwin":
        return peak
    return peak * 1024
