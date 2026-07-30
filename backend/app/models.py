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
    solution_id: str | None = Field(
        default=None,
        description="Registered active solution used for category 1/2 coverage.",
    )

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
    national_area_km2: float
    share_of_classified_pct: float | None
    share_of_national_class_pct: float | None
    solution_covered_area_km2: float | None
    solution_covered_pct_of_aoi: float | None
    pre_existing_covered_area_km2: float | None
    pre_existing_covered_pct_of_aoi: float | None
    new_covered_area_km2: float | None
    new_covered_pct_of_aoi: float | None


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
    solution_id: str | None = None
    solution_raster_checksum: str | None = None


class DetailedSpeciesCoverageRequest(BaseModel):
    geometry: dict[str, Any]
    solution_id: str
    artifact_version: str | None = None


class DetailedSpeciesCoverageRecord(BaseModel):
    id: str
    scientific_name: str
    group: str
    iucn_status: str
    range_area_km2: float
    range_in_aoi_area_km2: float
    range_in_aoi_pct: float
    solution_covered_in_aoi_area_km2: float
    solution_covered_in_aoi_pct: float
    pre_existing_covered_in_aoi_area_km2: float
    pre_existing_covered_in_aoi_pct: float
    new_covered_in_aoi_area_km2: float
    new_covered_in_aoi_pct: float


class DetailedSpeciesCoverageResult(BaseModel):
    artifact_version: str
    solution_id: str
    solution_raster_checksum: str
    records: list[DetailedSpeciesCoverageRecord]


class DetailedSpeciesJobResponse(BaseModel):
    job_id: str
    status: Literal["queued", "running", "complete", "failed", "cancelled"]
    queue_position: int | None = None
    estimated_wait_seconds: float | None = None
    compute_ms: float | None = None
    result: DetailedSpeciesCoverageResult | None = None
    error_code: str | None = None
    coalesced: bool = False


class CustomPolygonOpsResponse(BaseModel):
    worker_healthy: bool
    queue_depth: int
    active_jobs: int
    completed_jobs: int
    failed_jobs: int
    cancelled_jobs: int
    oldest_queued_age_seconds: float | None
    queue_capacity: int
    process_rss_mb: float | None
    host_available_memory_mb: float | None
    cgroup_memory_current_mb: float | None
    cgroup_memory_peak_mb: float | None
    cgroup_oom_kills: int | None
    load_average_1m: float | None
    cpu_count: int | None
