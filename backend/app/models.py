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
        description="Optional metric identifiers. Use area for the area metric pair, or any implemented Tier 1 metric id exposed by the loaded artifact.",
    )
    artifact_version: str | None = Field(
        default=None,
        description="Optional artifact version pin requested by the client.",
    )


class PolygonMetricsResponse(BaseModel):
    status: Literal["ok", "artifact_required", "invalid_request", "not_implemented"]
    message: str
    artifact_state: ArtifactState
    requested_metrics: list[str] | None = None
    metrics: dict[str, float | None] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
