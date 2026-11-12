from __future__ import annotations

import io
import sys

import pytest

from console_encoding import use_utf8_console_streams

ARROW = "\u2192"


def _cp1252_stream() -> tuple[io.TextIOWrapper, io.BytesIO]:
    buffer = io.BytesIO()
    return io.TextIOWrapper(buffer, encoding="cp1252", newline="\n"), buffer


class _StreamWithoutReconfigure:
    def __init__(self) -> None:
        self.written: list[str] = []

    def write(self, text: str) -> int:
        self.written.append(text)
        return len(text)

    def flush(self) -> None:
        pass


def test_cp1252_stdout_prints_the_arrow_after_switching_to_utf8(monkeypatch):
    stdout, stdout_bytes = _cp1252_stream()
    stderr, stderr_bytes = _cp1252_stream()
    monkeypatch.setattr(sys, "stdout", stdout)
    monkeypatch.setattr(sys, "stderr", stderr)

    with pytest.raises(UnicodeEncodeError):
        print(ARROW, flush=True)

    use_utf8_console_streams()
    print(f"built {ARROW} cache", flush=True)
    print(f"error {ARROW} report", file=sys.stderr, flush=True)

    assert stdout_bytes.getvalue() == f"built {ARROW} cache\n".encode("utf-8")
    assert stderr_bytes.getvalue() == f"error {ARROW} report\n".encode("utf-8")


def test_streams_without_reconfigure_are_left_untouched(monkeypatch):
    stdout = _StreamWithoutReconfigure()
    monkeypatch.setattr(sys, "stdout", stdout)
    monkeypatch.setattr(sys, "stderr", None)

    use_utf8_console_streams()
    print(ARROW)

    assert sys.stdout is stdout
    assert stdout.written == [ARROW, "\n"]
