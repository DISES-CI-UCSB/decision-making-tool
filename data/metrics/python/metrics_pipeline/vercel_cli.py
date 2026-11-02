"""Locate and launch the Vercel CLI identically on macOS, Linux, and Windows.

npm installs the CLI as ``vercel`` on POSIX and as ``vercel.cmd`` on Windows.
``subprocess`` without a shell cannot launch ``vercel.cmd`` by its bare name,
so every launch first resolves the full path with :func:`shutil.which`, which
honors ``PATHEXT`` on Windows.
"""

from __future__ import annotations

import shutil
import subprocess
from collections.abc import Sequence
from typing import Any

VERCEL_EXECUTABLE_NAME = "vercel"
VERCEL_CLI_MISSING_MESSAGE = "Vercel CLI not found on PATH; install with npm i -g vercel"


class VercelCliNotFoundError(FileNotFoundError):
    """The Vercel CLI is not installed or not reachable through ``PATH``."""

    def __init__(self) -> None:
        super().__init__(VERCEL_CLI_MISSING_MESSAGE)


def require_vercel_cli() -> str:
    """Return the CLI's full path; entry points call this before long work."""
    executable = shutil.which(VERCEL_EXECUTABLE_NAME)
    if executable is None:
        raise VercelCliNotFoundError()
    return executable


def run_vercel(args: Sequence[str], **run_kwargs: Any) -> subprocess.CompletedProcess:
    """Run ``vercel <args>`` through :func:`subprocess.run` without a shell.

    A ``PATH`` lookup miss is left for the launch to report, so callers that
    substitute ``subprocess.run`` never need the CLI installed.
    """
    executable = shutil.which(VERCEL_EXECUTABLE_NAME) or VERCEL_EXECUTABLE_NAME
    try:
        return subprocess.run([executable, *args], **run_kwargs)
    except FileNotFoundError as exc:
        raise VercelCliNotFoundError() from exc
