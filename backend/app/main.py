from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from .artifacts import (
    artifact_ready,
    get_artifact_state,
    get_runtime_artifact,
    reset_runtime_artifact_cache,
    warmup_artifacts,
)
from .config import get_settings
from .models import (
    HealthResponse,
    PolygonMetricsRequest,
    PolygonMetricsResponse,
    ReadinessResponse,
)
from .polygon_metrics import PolygonMetricError, calculate_custom_polygon_metrics

LOGGER = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    warmup_artifacts(get_settings())
    try:
        yield
    finally:
        reset_runtime_artifact_cache()


app = FastAPI(
    title="DISES Decision Making Tool Metrics API",
    version="0.2.0",
    description="Backend metrics endpoints for custom polygon smoke paths.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4200",
        "http://localhost:4300",
        "http://localhost:4301",
        "http://127.0.0.1:4200",
        "http://127.0.0.1:4300",
        "http://127.0.0.1:4301",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
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
        400: {"model": PolygonMetricsResponse},
        422: {"model": PolygonMetricsResponse},
        503: {"model": PolygonMetricsResponse},
    },
)
def custom_polygon_metrics(request: PolygonMetricsRequest) -> PolygonMetricsResponse:
    started = time.perf_counter()
    settings = get_settings()
    state = get_artifact_state(settings)
    artifact = get_runtime_artifact(settings)

    if artifact is None:
        response = PolygonMetricsResponse(
            status="artifact_required",
            message="Metric artifacts are required before custom polygon metrics can run.",
            artifact_state=state,
            requested_metrics=request.metrics,
            metadata={"request_ms": round((time.perf_counter() - started) * 1000, 3)},
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=response.model_dump(),
        )

    if request.artifact_version and request.artifact_version != state.artifact_version:
        response = PolygonMetricsResponse(
            status="invalid_request",
            message=f"Requested artifact_version {request.artifact_version} is not loaded.",
            artifact_state=state,
            requested_metrics=request.metrics,
            metadata={"request_ms": round((time.perf_counter() - started) * 1000, 3)},
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=response.model_dump())

    try:
        metrics, metadata = calculate_custom_polygon_metrics(
            artifact,
            request.geometry,
            request.metrics,
        )
    except PolygonMetricError as exc:
        response = PolygonMetricsResponse(
            status="invalid_request",
            message=str(exc),
            artifact_state=state,
            requested_metrics=request.metrics,
            metadata={"request_ms": round((time.perf_counter() - started) * 1000, 3)},
        )
        raise HTTPException(status_code=422, detail=response.model_dump())

    total_ms = round((time.perf_counter() - started) * 1000, 3)
    metadata["total_request_ms"] = total_ms
    metadata["artifact"] = state.metadata
    LOGGER.info(
        "Custom polygon metrics completed",
        extra={
            "request_ms": total_ms,
            "artifact_version": state.artifact_version,
            "matched_cell_count": metadata.get("matched_cell_count"),
        },
    )
    return PolygonMetricsResponse(
        status="ok",
        message="Custom polygon metrics calculated from the loaded runtime artifact.",
        artifact_state=state,
        requested_metrics=request.metrics,
        metrics=metrics,
        metadata=metadata,
    )
