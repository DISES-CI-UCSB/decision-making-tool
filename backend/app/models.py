from __future__ import annotations

import math
from typing import Any, Literal, Union

from pydantic import BaseModel, Field, field_validator, model_validator

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
    solution_id: str | None = Field(
        default=None,
        description="Optional solution id used to route regional SIRAP artifacts.",
    )


class PolygonMetricsResponse(BaseModel):
    status: Literal["ok", "artifact_required", "invalid_request", "not_implemented"]
    message: str
    artifact_state: ArtifactState
    requested_metrics: list[str] | None = None
    metrics: dict[str, float | None] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


AreaProfileSectionName = Literal["species", "ecosystems"]
AreaProfileSectionStatus = Literal[
    "complete", "empty", "zero_cells", "unavailable", "failed"
]


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
    id: str = Field(
        description="Dataset-scoped deterministic identifier, not an external taxon ID."
    )
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
    share_of_total_aoi_pct: float | None
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


class MesaAoiCoverageRecord(BaseModel):
    feature: str
    total_in_aoi: float = Field(ge=0)
    national_total: float = Field(ge=0)
    classified_total_in_aoi: float = Field(ge=0)
    share_of_national_total: float | None = Field(ge=0, le=1)
    share_of_classified_aoi: float | None = Field(ge=0, le=1)
    held_in_aoi: float = Field(ge=0)
    coverage_within_aoi: float | None = Field(ge=0, le=1)
    pre_existing_held_in_aoi: float = Field(ge=0)
    pre_existing_coverage_within_aoi: float | None = Field(ge=0, le=1)
    new_prioritizr_held_in_aoi: float = Field(ge=0)
    new_prioritizr_coverage_within_aoi: float | None = Field(ge=0, le=1)
    contribution_to_national_coverage: float | None = Field(ge=0, le=1)
    pre_existing_contribution_to_national_coverage: float | None = Field(ge=0, le=1)
    new_prioritizr_contribution_to_national_coverage: float | None = Field(ge=0, le=1)
    contribution_to_national_target: float | None = Field(ge=0)

    @model_validator(mode="after")
    def validate_cell_count_semantics(self) -> "MesaAoiCoverageRecord":
        for field in (
            "total_in_aoi",
            "national_total",
            "classified_total_in_aoi",
            "held_in_aoi",
            "pre_existing_held_in_aoi",
            "new_prioritizr_held_in_aoi",
        ):
            if not float(getattr(self, field)).is_integer():
                raise ValueError(f"{field} must be a whole planning-cell count")
        if self.total_in_aoi > self.national_total:
            raise ValueError("total_in_aoi cannot exceed national_total")
        if self.total_in_aoi > self.classified_total_in_aoi:
            raise ValueError("total_in_aoi cannot exceed classified_total_in_aoi")
        if self.held_in_aoi > self.total_in_aoi:
            raise ValueError("held_in_aoi cannot exceed total_in_aoi")
        if not math.isclose(
            self.held_in_aoi,
            self.pre_existing_held_in_aoi + self.new_prioritizr_held_in_aoi,
            abs_tol=1e-12,
        ):
            raise ValueError(
                "held_in_aoi must equal pre_existing_held_in_aoi plus "
                "new_prioritizr_held_in_aoi"
            )

        _validate_ratio(
            self.share_of_national_total,
            self.total_in_aoi,
            self.national_total,
            "share_of_national_total",
        )
        _validate_ratio(
            self.share_of_classified_aoi,
            self.total_in_aoi,
            self.classified_total_in_aoi,
            "share_of_classified_aoi",
        )
        _validate_ratio(
            self.coverage_within_aoi,
            self.held_in_aoi,
            self.total_in_aoi,
            "coverage_within_aoi",
        )
        _validate_ratio(
            self.pre_existing_coverage_within_aoi,
            self.pre_existing_held_in_aoi,
            self.total_in_aoi,
            "pre_existing_coverage_within_aoi",
        )
        _validate_ratio(
            self.new_prioritizr_coverage_within_aoi,
            self.new_prioritizr_held_in_aoi,
            self.total_in_aoi,
            "new_prioritizr_coverage_within_aoi",
        )
        _validate_ratio(
            self.contribution_to_national_coverage,
            self.held_in_aoi,
            self.national_total,
            "contribution_to_national_coverage",
        )
        _validate_ratio(
            self.pre_existing_contribution_to_national_coverage,
            self.pre_existing_held_in_aoi,
            self.national_total,
            "pre_existing_contribution_to_national_coverage",
        )
        _validate_ratio(
            self.new_prioritizr_contribution_to_national_coverage,
            self.new_prioritizr_held_in_aoi,
            self.national_total,
            "new_prioritizr_contribution_to_national_coverage",
        )
        return self


def _validate_ratio(
    value: float | None,
    numerator: float,
    denominator: float,
    field: str,
) -> None:
    if denominator == 0:
        if value is not None:
            raise ValueError(f"{field} must be null when its denominator is zero")
        return
    expected = numerator / denominator
    if value is None or not math.isclose(value, expected, rel_tol=1e-12, abs_tol=1e-12):
        raise ValueError(f"{field} does not match its planning-cell denominator")


class EcosystemAreaProfileSection(BaseModel):
    status: AreaProfileSectionStatus
    canonical_summary_view: Literal["broadEcosystem"] = "broadEcosystem"
    classified_area_km2: float = 0.0
    views: list[EcosystemAreaProfileView] = Field(default_factory=list)
    solution_coverage: list[MesaAoiCoverageRecord] = Field(default_factory=list)
    reason: str | None = None


class CustomAreaProfileSelection(BaseModel):
    status: Literal["selected", "zero_cells", "unavailable"]
    selected_cell_count: int | None
    available_cell_count: int | None
    area_km2: float | None
    source: str
    crs: str | None = None


AreaProfileSection = Union[SpeciesAreaProfileSection, EcosystemAreaProfileSection]


def _coerce_area_profile_section(
    section_name: str,
    section: Any,
) -> AreaProfileSection:
    if section_name == "species":
        if isinstance(section, SpeciesAreaProfileSection):
            return section
        return SpeciesAreaProfileSection.model_validate(section)
    if section_name == "ecosystems":
        if isinstance(section, EcosystemAreaProfileSection):
            return section
        return EcosystemAreaProfileSection.model_validate(section)
    raise ValueError(f"Unknown area profile section: {section_name}")


class CustomAreaProfileResponse(BaseModel):
    format: Literal["custom-aoi-area-profile-v1"] = "custom-aoi-area-profile-v1"
    status: Literal["complete", "partial", "zero_cells"]
    artifact_version: str
    selection: CustomAreaProfileSelection
    requested_sections: list[AreaProfileSectionName]
    sections: dict[AreaProfileSectionName, AreaProfileSection]
    solution_id: str | None = None
    solution_raster_checksum: str | None = None

    @model_validator(mode="before")
    @classmethod
    def coerce_sections_by_name(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        sections = data.get("sections")
        if not isinstance(sections, dict):
            return data
        return {
            **data,
            "sections": {
                section_name: _coerce_area_profile_section(section_name, section)
                for section_name, section in sections.items()
            },
        }


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
    total_in_aoi: float | None = None
    held_in_aoi: float | None = None
    coverage_within_aoi: float | None = None
    contribution_to_national_coverage: float | None = None
    contribution_to_national_target: float | None = None


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
