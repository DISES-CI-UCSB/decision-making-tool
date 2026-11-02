"""Keep CLI output printable when stdout or stderr is not a UTF-8 stream.

Windows encodes redirected ``stdout``/``stderr`` with the ANSI code page
(usually cp1252), which cannot represent characters such as U+2192 (→), so a
``print`` raises :class:`UnicodeEncodeError`. Setting ``PYTHONUTF8=1`` in the
environment before launching Python is an equivalent alternative.
"""

from __future__ import annotations

import sys


def use_utf8_console_streams() -> None:
    """Re-encode ``sys.stdout`` and ``sys.stderr`` as UTF-8, replacing unencodable text."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")
