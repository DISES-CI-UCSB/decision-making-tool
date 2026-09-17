from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.rate_limit import reset_rate_limiter


GEOMETRY = {
    "type": "Polygon",
    "coordinates": [
        [
            [0.0, 0.0],
            [2.0, 0.0],
            [2.0, 1.0],
            [0.0, 1.0],
            [0.0, 0.0],
        ]
    ],
}
METRICS_REQUEST = {"geometry": GEOMETRY, "metrics": ["area"]}
AREA_PROFILE_REQUEST = {"geometry": GEOMETRY, "sections": ["species"]}
SPECIES_JOB_REQUEST = {"geometry": GEOMETRY, "solution_id": "solution-1"}


def test_expensive_posts_share_one_rate_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DMT_RATE_LIMIT_PER_MINUTE", "2")
    reset_rate_limiter()
    client = TestClient(app)

    first = client.post("/metrics/custom-polygon", json=METRICS_REQUEST)
    second = client.post("/area-profile/custom-polygon", json=AREA_PROFILE_REQUEST)
    third = client.post(
        "/area-profile/custom-polygon/species-coverage/jobs",
        json=SPECIES_JOB_REQUEST,
    )

    assert first.status_code != 429
    assert second.status_code != 429
    assert third.status_code == 429
    assert third.json()["detail"]["status"] == "rate_limited"
    assert third.headers["retry-after"].isdigit()


def test_health_and_job_reads_stay_unlimited(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DMT_RATE_LIMIT_PER_MINUTE", "1")
    reset_rate_limiter()
    client = TestClient(app)

    assert client.post("/metrics/custom-polygon", json=METRICS_REQUEST).status_code != 429
    assert client.post("/metrics/custom-polygon", json=METRICS_REQUEST).status_code == 429
    assert client.get("/health").status_code == 200
    job = client.get("/area-profile/custom-polygon/species-coverage/jobs/missing-job")
    assert job.status_code in {404, 503}
