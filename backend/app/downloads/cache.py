from __future__ import annotations

from dataclasses import dataclass
from threading import Lock
from typing import Callable


@dataclass
class _Entry:
    value: object
    expires_at: float


class TtlCache:
    """Small in-process cache. A non-positive TTL stores nothing."""

    def __init__(self, clock: Callable[[], float]) -> None:
        self._clock = clock
        self._items: dict[str, _Entry] = {}
        self._lock = Lock()

    def get(self, key: str) -> object | None:
        now = self._clock()
        with self._lock:
            entry = self._items.get(key)
            if entry is None:
                return None
            if entry.expires_at <= now:
                self._items.pop(key, None)
                return None
            return entry.value

    def set(self, key: str, value: object, ttl_seconds: float) -> None:
        if ttl_seconds <= 0:
            return
        with self._lock:
            self._items[key] = _Entry(value, self._clock() + ttl_seconds)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
