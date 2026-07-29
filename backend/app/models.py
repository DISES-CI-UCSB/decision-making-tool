from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

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


AreaProfileSectionName = Literal["species", "ecosystems"]
AreaProfileSectionStatus = Literal["complete", "empty", "zero_cells", "unavailable", "failed"]


class CustomAreaProfileRequest(BaseModel):
    geometry: dict[str, Any] = Field(
        ...,
        description="GeoJSON Polygon or MultiPolygon geometry for the custom area.",
    )
    sections: list[AreaProfileSectionName]
    artifact_version: str | None = None

    @field_validator("sections")
    @classmethod
    def validate_sections(
        cls,
        sections: list[AreaProfileSectionName],
    ) -> list[AreaProfileSectionName]:
        if not sections:
            raise ValueError("sections must include species and/or ecosystems.")
        return list(dict.fromkeys(sections))


class SpeciesAreaProfileRecord(BaseModel):
    id: str = Field(description="Dataset-scoped deterministic identifier, not an external taxon ID.")
    scientific_name: str
    group: str
    iucn_status: str


class SpeciesAreaProfileSection(BaseModel):
    status: AreaProfileSectionStatus
    records: list[SpeciesAreaProfileRecord] = Field(default_factory=list)
    record_count: int = 0
    id_scope: Literal["runtime-species-dataset"] = "runtime-species-dataset"
    reason: str | None = None


class EcosystemAreaProfileRecord(BaseModel):
    id: str
    label: str
    area_km2: float
    share_of_classified_pct: float | None


class EcosystemAreaProfileView(BaseModel):
    id: str
    label: str
    records: list[EcosystemAreaProfileRecord] = Field(default_factory=list)


class EcosystemAreaProfileSection(BaseModel):
    status: AreaProfileSectionStatus
    canonical_summary_view: Literal["broadEcosystem"] = "broadEcosystem"
    classified_area_km2: float = 0.0
    views: list[EcosystemAreaProfileView] = Field(default_factory=list)
    reason: str | None = None


class CustomAreaProfileSelection(BaseModel):
    status: Literal["selected", "zero_cells", "unavailable"]
    selected_cell_count: int | None
    available_cell_count: int | None
    area_km2: float | None
    source: str
    crs: str | None = None


class CustomAreaProfileResponse(BaseModel):
    format: Literal["custom-aoi-area-profile-v1"] = "custom-aoi-area-profile-v1"
    status: Literal["complete", "partial", "zero_cells"]
    artifact_version: str
    selection: CustomAreaProfileSelection
    requested_sections: list[AreaProfileSectionName]
    sections: dict[AreaProfileSectionName, SpeciesAreaProfileSection | EcosystemAreaProfileSection]
