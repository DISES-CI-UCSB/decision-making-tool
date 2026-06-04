from __future__ import annotations

from fastapi import FastAPI, HTTPException, status

from .artifacts import artifact_ready, get_artifact_state
from .config import get_settings
from .models import (
    HealthResponse,
    PolygonMetricsRequest,
    PolygonMetricsResponse,
    ReadinessResponse,
)

app = FastAPI(
    title="DISES Decision Making Tool Metrics API",
    version="0.1.0",
    description="Foundation skeleton for backend metrics endpoints.",
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.get("/ready", response_model=ReadinessResponse)
def ready() -> ReadinessResponse:
    settings = get_settings()
    state = get_artifact_state(settings)

    if not artifact_ready(settings, state):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=ReadinessResponse(status="not_ready", artifact_state=state).model_dump(),
        )

    return ReadinessResponse(status="ready", artifact_state=state)


@app.post(
    "/metrics/custom-polygon",
    response_model=PolygonMetricsResponse,
    responses={
        501: {"model": PolygonMetricsResponse},
        503: {"model": PolygonMetricsResponse},
    },
)
def custom_polygon_metrics(request: PolygonMetricsRequest) -> PolygonMetricsResponse:
    settings = get_settings()
    state = get_artifact_state(settings)

    if not state.available:
        response = PolygonMetricsResponse(
            status="artifact_required",
            message="Metric artifacts are required before custom polygon metrics can run.",
            artifact_state=state,
            requested_metrics=request.metrics,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=response.model_dump(),
        )

    response = PolygonMetricsResponse(
        status="not_implemented",
        message="Custom polygon metric calculation is not implemented in Chat #1.",
        artifact_state=state,
        requested_metrics=request.metrics,
    )
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail=response.model_dump(),
    )
