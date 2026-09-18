from __future__ import annotations

import threading
import time
from dataclasses import dataclass

from fastapi import HTTPException, Request, status

from .config import get_settings


EXPENSIVE_POST_PATHS = frozenset(
    {
        "/metrics/custom-polygon",
        "/area-profile/custom-polygon",
        "/area-profile/custom-polygon/species-coverage/jobs",
    }
)


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    retry_after_seconds: float


class InMemoryRateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def check(
        self,
        key: str,
        max_requests: int,
        window_seconds: float = 60.0,
    ) -> RateLimitDecision:
        if max_requests <= 0:
            return RateLimitDecision(True, 0.0)
        now = time.monotonic()
        window_start = now - window_seconds
        with self._lock:
            hits = [stamp for stamp in self._hits.get(key, []) if stamp > window_start]
            if len(hits) >= max_requests:
                retry_after = window_seconds - (now - hits[0])
                self._hits[key] = hits
                return RateLimitDecision(False, max(retry_after, 0.0))
            hits.append(now)
            self._hits[key] = hits
            return RateLimitDecision(True, 0.0)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


_LIMITER = InMemoryRateLimiter()


def reset_rate_limiter() -> None:
    _LIMITER.reset()


def client_key(request: Request) -> str:
    if request.client is None:
        return "unknown"
    return request.client.host


def enforce_expensive_post_rate_limit(request: Request, max_requests: int) -> None:
    decision = _LIMITER.check(client_key(request), max_requests)
    if decision.allowed:
        return
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail={
            "status": "rate_limited",
            "message": "Too many custom-polygon requests. Retry later.",
        },
        headers={"Retry-After": str(max(1, int(decision.retry_after_seconds + 0.999)))},
    )


def expensive_post_rate_limit(request: Request) -> None:
    if request.method != "POST" or request.url.path not in EXPENSIVE_POST_PATHS:
        return
    enforce_expensive_post_rate_limit(request, get_settings().rate_limit_per_minute)
