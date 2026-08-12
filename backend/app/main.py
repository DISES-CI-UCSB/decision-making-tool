from __future__ import annotations

import logging
import secrets
import sqlite3
import time
from contextlib import asynccontextmanager
from typing import Any, Callable

from fastapi import FastAPI, Header, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware

from .area_profile import calculate_custom_area_profile
from .artifacts import (
    artifact_ready,
    get_artifact_state,
    get_runtime_artifact,
    reset_runtime_artifact_cache,
    warmup_artifacts,
)
from .config import get_settings
from .models import (
    CustomAreaProfileRequest,
    CustomAreaProfileResponse,
    CustomPolygonOpsResponse,
    DetailedSpeciesCoverageRequest,
    DetailedSpeciesJobResponse,
    HealthResponse,
    PolygonMetricsRequest,
    PolygonMetricsResponse,
    ReadinessResponse,
)
from .job_queue import DetailedSpeciesJobQueue, JobQueueFullError, JobSnapshot
from .metric_adapters import build_custom_aoi_raster
from .polygon_metrics import PolygonMetricError, calculate_custom_polygon_metrics
from .solution_registry import SolutionRegistryError
from .species_index import RuntimeSpeciesBitsetIndex

LOGGER = logging.getLogger(__name__)
_DETAILED_SPECIES_QUEUE: DetailedSpeciesJobQueue | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _DETAILED_SPECIES_QUEUE
    settings = get_settings()
    warmup_artifacts(settings)
    _DETAILED_SPECIES_QUEUE = DetailedSpeciesJobQueue(
        settings.custom_polygon_job_db,
        _calculate_detailed_species_coverage,
    )
    _DETAILED_SPECIES_QUEUE.start()
    try:
        yield
    finally:
        if _DETAILED_SPECIES_QUEUE is not None:
            _DETAILED_SPECIES_QUEUE.stop()
            _DETAILED_SPECIES_QUEUE = None
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
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
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

    unavailable_reason = _detailed_species_unavailable_reason()
    if unavailable_reason is not None:
        detail = ReadinessResponse(
            status="not_ready",
            artifact_state=state,
        ).model_dump()
        detail["detailed_species_status"] = unavailable_reason
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=detail,
            headers={"Retry-After": "10"},
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


@app.post(
    "/area-profile/custom-polygon",
    response_model=CustomAreaProfileResponse,
)
def custom_polygon_area_profile(
    request: CustomAreaProfileRequest,
) -> CustomAreaProfileResponse:
    settings = get_settings()
    state = get_artifact_state(settings)
    artifact = get_runtime_artifact(settings)
    if artifact is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "status": "artifact_required",
                "message": "Runtime artifacts are required for custom area profiles.",
            },
        )
    if request.artifact_version and request.artifact_version != state.artifact_version:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "status": "invalid_request",
                "message": (
                    f"Requested artifact_version {request.artifact_version} is not loaded."
                ),
            },
        )

    solution_raster = None
    solution_raster_checksum = None
    if request.solution_id:
        if artifact.solution_registry is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "status": "solution_registry_required",
                    "message": "The solution raster registry is unavailable.",
                },
            )
        try:
            solution_raster, solution_raster_checksum = artifact.solution_registry.load(
                request.solution_id
            )
        except SolutionRegistryError as exc:
            error = str(exc)
            status_code = (
                status.HTTP_400_BAD_REQUEST
                if error.startswith("solution_not_registered:")
                else status.HTTP_503_SERVICE_UNAVAILABLE
            )
            raise HTTPException(
                status_code=status_code,
                detail={"status": "solution_unavailable", "message": error},
            ) from exc

    try:
        sections, selection, overall_status = calculate_custom_area_profile(
            artifact,
            request.geometry,
            request.sections,
            solution_raster,
        )
    except PolygonMetricError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"status": "invalid_request", "message": str(exc)},
        ) from exc

    if state.artifact_version is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"status": "artifact_required", "message": "Artifact version is unavailable."},
        )
    return CustomAreaProfileResponse(
        status=overall_status,
        artifact_version=state.artifact_version,
        selection=selection,
        requested_sections=request.sections,
        sections=sections,
        solution_id=request.solution_id,
        solution_raster_checksum=solution_raster_checksum,
    )


@app.post(
    "/area-profile/custom-polygon/species-coverage/jobs",
    response_model=DetailedSpeciesJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_detailed_species_job(
    request: DetailedSpeciesCoverageRequest,
    response: Response,
) -> DetailedSpeciesJobResponse:
    queue = _require_detailed_species_queue()
    settings = get_settings()
    state = get_artifact_state(settings)
    artifact = get_runtime_artifact(settings)
    if artifact is None or not isinstance(
        artifact.species_index,
        RuntimeSpeciesBitsetIndex,
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "status": "species_index_required",
                "message": "The detailed species index is unavailable.",
            },
        )
    if request.artifact_version and request.artifact_version != state.artifact_version:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "status": "invalid_request",
                "message": "The requested artifact version is not loaded.",
            },
        )
    if (
        artifact.solution_registry is None
        or request.solution_id not in artifact.solution_registry.entries
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "status": "solution_unavailable",
                "message": "The requested solution is not registered.",
            },
        )

    payload = {
        "geometry": request.geometry,
        "solution_id": request.solution_id,
        "artifact_version": state.artifact_version,
    }
    try:
        snapshot, coalesced = queue.enqueue(payload)
    except JobQueueFullError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "status": "temporarily_overloaded",
                "message": "Detailed species processing is at capacity.",
            },
            headers={"Retry-After": "10"},
        ) from exc
    except sqlite3.OperationalError as exc:
        raise _detailed_species_unavailable_exception(
            "queue_storage_unavailable"
        ) from exc
    if snapshot.status == "complete":
        response.status_code = status.HTTP_200_OK
    return _job_response(snapshot, coalesced=coalesced)


@app.get(
    "/area-profile/custom-polygon/species-coverage/jobs/{job_id}",
    response_model=DetailedSpeciesJobResponse,
)
def get_detailed_species_job(job_id: str) -> DetailedSpeciesJobResponse:
    try:
        snapshot = _require_detailed_species_queue().get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND) from exc
    except sqlite3.OperationalError as exc:
        raise _detailed_species_unavailable_exception(
            "queue_storage_unavailable"
        ) from exc
    return _job_response(snapshot)


@app.delete(
    "/area-profile/custom-polygon/species-coverage/jobs/{job_id}",
    response_model=DetailedSpeciesJobResponse,
)
def cancel_detailed_species_job(job_id: str) -> DetailedSpeciesJobResponse:
    try:
        snapshot = _require_detailed_species_queue().cancel(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND) from exc
    except sqlite3.OperationalError as exc:
        raise _detailed_species_unavailable_exception(
            "queue_storage_unavailable"
        ) from exc
    return _job_response(snapshot)


@app.get(
    "/ops/custom-polygon",
    response_model=CustomPolygonOpsResponse,
    include_in_schema=False,
)
def custom_polygon_ops(
    ops_token: str | None = Header(default=None, alias="X-DMT-Ops-Token"),
) -> CustomPolygonOpsResponse:
    expected_token = get_settings().ops_token
    if (
        expected_token is None
        or ops_token is None
        or not secrets.compare_digest(ops_token, expected_token)
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    try:
        metrics = _require_detailed_species_queue().metrics()
    except sqlite3.OperationalError as exc:
        raise _detailed_species_unavailable_exception(
            "queue_storage_unavailable"
        ) from exc
    return CustomPolygonOpsResponse(**metrics)


def _require_detailed_species_queue() -> DetailedSpeciesJobQueue:
    if _DETAILED_SPECIES_QUEUE is None:
        raise _detailed_species_unavailable_exception("worker_unavailable")
    unavailable_reason = _DETAILED_SPECIES_QUEUE.unavailable_reason()
    if unavailable_reason is not None:
        raise _detailed_species_unavailable_exception(unavailable_reason)
    return _DETAILED_SPECIES_QUEUE


def _detailed_species_unavailable_reason() -> str | None:
    if _DETAILED_SPECIES_QUEUE is None:
        return "worker_unavailable"
    return _DETAILED_SPECIES_QUEUE.unavailable_reason()


def _detailed_species_unavailable_exception(reason: str) -> HTTPException:
    message = (
        "Detailed species queue storage is temporarily unavailable."
        if reason == "queue_storage_unavailable"
        else "The detailed species worker is unavailable."
    )
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={"status": reason, "message": message},
        headers={"Retry-After": "10"},
    )


def _calculate_detailed_species_coverage(
    payload: dict[str, Any],
    is_cancelled: Callable[[], bool],
) -> dict[str, Any]:
    settings = get_settings()
    state = get_artifact_state(settings)
    artifact = get_runtime_artifact(settings)
    if artifact is None or not isinstance(
        artifact.species_index,
        RuntimeSpeciesBitsetIndex,
    ):
        raise RuntimeError("species_index_required")
    if payload.get("artifact_version") != state.artifact_version:
        raise RuntimeError("artifact_version_changed")
    if artifact.reference_raster_path is None:
        raise RuntimeError("reference_raster_required")
    if artifact.solution_registry is None:
        raise RuntimeError("solution_registry_required")

    solution_id = str(payload["solution_id"])
    solution_raster, solution_checksum = artifact.solution_registry.load(solution_id)
    aoi_raster = build_custom_aoi_raster(
        artifact.reference_raster_path,
        payload["geometry"],
    )
    records = artifact.species_index.detailed_coverage_records(
        aoi_raster,
        solution_raster,
        is_cancelled,
    )
    if state.artifact_version is None:
        raise RuntimeError("artifact_version_required")
    return {
        "artifact_version": state.artifact_version,
        "solution_id": solution_id,
        "solution_raster_checksum": solution_checksum,
        "records": [record.__dict__ for record in records],
    }


def _job_response(
    snapshot: JobSnapshot,
    *,
    coalesced: bool = False,
) -> DetailedSpeciesJobResponse:
    return DetailedSpeciesJobResponse(
        job_id=snapshot.job_id,
        status=snapshot.status,
        queue_position=snapshot.queue_position,
        estimated_wait_seconds=snapshot.estimated_wait_seconds,
        compute_ms=snapshot.compute_ms,
        result=snapshot.result,
        error_code=snapshot.error_code,
        coalesced=coalesced,
    )
