from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from .artifacts import ArtifactState


class HealthResponse(BaseModel):
    status: Literal["ok"]


class ReadinessResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    artifact_state: ArtifactState


class PolygonMetricsRequest(BaseModel):
    geometry: dict[str, Any] = Field(
        ...,
        description="GeoJSON Polygon or MultiPolygon geometry for the custom area.",
    )
    metrics: list[str] | None = Field(
        default=None,
        description="Optional metric identifiers to request once the metric engine exists.",
    )
    artifact_version: str | None = Field(
        default=None,
        description="Optional artifact version pin requested by the client.",
    )


class PolygonMetricsResponse(BaseModel):
    status: Literal["artifact_required", "not_implemented"]
    message: str
    artifact_state: ArtifactState
    requested_metrics: list[str] | None = None
