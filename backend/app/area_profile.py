from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .artifacts import RuntimeArtifact
from .config import SIRAP_ARTIFACT_KIND
from .coverage_target_validation import MESA_V3_ECOSYSTEM_TARGET_COUNT
from .ecosystem_inventory import EcosystemInventoryError, build_ecosystem_inventory
from .metric_adapters import build_custom_aoi_raster
from .models import AreaProfileSectionName
from .polygon_metrics import PolygonMetricError, validate_polygon_geometry
from .solution_coverage import (
    SolutionCoverageError,
    calculate_ecosystem_aoi_coverage,
)
from .sirap_coverage import (
    SirapCoverageError,
    calculate_sirap_ecosystem_aoi_coverage,
)
from .species_index import (
    RuntimeSpeciesBitsetIndex,
    SpeciesIndexQueryError,
    SpeciesOverlapRecord,
    sort_species_records,
    stream_species_overlap_records,
)

if TYPE_CHECKING:
    from raster_metrics import SolutionRaster


SPECIES_GROUPS = ("mammals", "birds", "amphibians", "reptiles", "plants")


def calculate_custom_area_profile(
    artifact: RuntimeArtifact,
    geometry: dict[str, Any],
    requested_sections: list[AreaProfileSectionName],
    solution_raster: SolutionRaster | None = None,
    solution_id: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any], str]:
    validate_polygon_geometry(geometry)
    if artifact.reference_raster_path is None:
        sections = {
            section: _unavailable_section(section, "reference_raster_not_configured")
            for section in requested_sections
        }
        return (
            sections,
            {
                "status": "unavailable",
                "selected_cell_count": None,
                "available_cell_count": None,
                "area_km2": None,
                "source": "unavailable",
            },
            "partial",
        )

    try:
        raster = build_custom_aoi_raster(artifact.reference_raster_path, geometry)
    except Exception as exc:
        raise PolygonMetricError(f"Custom polygon raster selection failed: {exc}") from exc

    selection = {
        "status": "selected" if raster.selected_cells > 0 else "zero_cells",
        "selected_cell_count": int(raster.selected_cells),
        "available_cell_count": int(raster.valid_cells),
        "area_km2": float(raster.selected_area_km2),
        "source": "colombia-raster-geometry-mask-v1",
        "crs": raster.fingerprint.crs,
    }
    if raster.selected_cells == 0:
        return (
            {section: _zero_cell_section(section) for section in requested_sections},
            selection,
            "zero_cells",
        )

    sections: dict[str, dict[str, Any]] = {}
    for section in requested_sections:
        try:
            sections[section] = (
                _species_section(artifact, raster)
                if section == "species"
                else _ecosystems_section(
                    artifact,
                    raster,
                    solution_raster,
                    solution_id,
                )
            )
        except (
            SpeciesIndexQueryError,
            EcosystemInventoryError,
            SolutionCoverageError,
            SirapCoverageError,
        ) as exc:
            sections[section] = _failed_section(section, str(exc))
        except Exception as exc:
            sections[section] = _failed_section(section, f"{section}_query_failed:{exc}")

    overall_status = (
        "partial"
        if any(section["status"] in {"unavailable", "failed"} for section in sections.values())
        else "complete"
    )
    return sections, selection, overall_status


def _species_section(artifact: RuntimeArtifact, raster: SolutionRaster) -> dict[str, Any]:
    raw_species = artifact.manifest.get("species_matrices")
    if isinstance(raw_species, dict) and raw_species.get("status") == "stubbed":
        return _unavailable_section("species", "species_matrices_stubbed")

    available_groups = (
        artifact.species_index.groups
        if artifact.species_index is not None
        else artifact.species_matrices
    )
    missing = [group for group in SPECIES_GROUPS if group not in available_groups]
    if missing:
        return _unavailable_section(
            "species",
            "species_matrix_group_missing:" + ",".join(missing),
        )

    if isinstance(artifact.species_index, RuntimeSpeciesBitsetIndex):
        records = artifact.species_index.all_overlap_records(raster)
    else:
        records: list[SpeciesOverlapRecord] = []
        for group in SPECIES_GROUPS:
            if artifact.species_index is not None and group in artifact.species_index.groups:
                records.extend(artifact.species_index.overlap_records(group, raster))
            else:
                records.extend(
                    stream_species_overlap_records(artifact.species_matrices[group], raster)
                )
    records = sort_species_records(records)
    return {
        "status": "complete" if records else "empty",
        "records": [
            {
                "id": record.id,
                "scientific_name": record.scientific_name,
                "group": record.group,
                "iucn_status": record.iucn_status,
            }
            for record in records
        ],
        "record_count": len(records),
        "id_scope": "runtime-species-dataset",
    }


def _ecosystems_section(
    artifact: RuntimeArtifact,
    raster: SolutionRaster,
    solution_raster: SolutionRaster | None,
    solution_id: str | None,
) -> dict[str, Any]:
    coverage_rows = (
        _sirap_ecosystem_rows(artifact, raster, solution_raster, solution_id)
        if _is_sirap_artifact(artifact)
        else _mesa_ecosystem_rows(artifact, raster, solution_raster, solution_id)
    )
    if artifact.ecosystem_inventory is None and not coverage_rows:
        return _unavailable_section("ecosystems", "ecosystem_artifact_not_packaged")
    inventory = (
        build_ecosystem_inventory(
            artifact.ecosystem_inventory,
            raster,
            solution_raster,
        )
        if artifact.ecosystem_inventory is not None
        else {
            "canonical_summary_view": "broadEcosystem",
            "classified_area_km2": 0.0,
            "views": [],
        }
    )
    record_count = sum(len(view["records"]) for view in inventory["views"])
    return {
        "status": "complete" if record_count or coverage_rows else "empty",
        **inventory,
        "solution_coverage": coverage_rows,
    }


def _is_sirap_artifact(artifact: RuntimeArtifact) -> bool:
    return (
        artifact.manifest.get("artifact_kind") == SIRAP_ARTIFACT_KIND
        or artifact.sirap_coverage is not None
    )


def _sirap_ecosystem_rows(
    artifact: RuntimeArtifact,
    raster: SolutionRaster,
    solution_raster: SolutionRaster | None,
    solution_id: str | None,
) -> list[dict[str, Any]]:
    if (
        artifact.sirap_coverage is None
        or solution_raster is None
        or solution_id is None
    ):
        return []
    rows = calculate_sirap_ecosystem_aoi_coverage(
        artifact.sirap_coverage,
        solution_id,
        raster,
        solution_raster,
    )
    return [_coverage_row_dict(row) for row in rows.values()]


def _coverage_row_dict(row: Any) -> dict[str, Any]:
    return {
        "feature": row.feature,
        "total_in_aoi": row.total_amount_aoi,
        "national_total": row.national_total_amount,
        "classified_total_in_aoi": row.classified_total_amount_aoi,
        "share_of_national_total": row.share_of_national_amount,
        "share_of_classified_aoi": row.share_of_classified_aoi,
        "held_in_aoi": row.absolute_held_aoi,
        "coverage_within_aoi": row.coverage_within_aoi,
        "pre_existing_held_in_aoi": row.absolute_pre_existing_aoi,
        "pre_existing_coverage_within_aoi": row.pre_existing_coverage_within_aoi,
        "new_prioritizr_held_in_aoi": row.absolute_new_prioritizr_aoi,
        "new_prioritizr_coverage_within_aoi": row.new_prioritizr_coverage_within_aoi,
        "contribution_to_national_coverage": row.contribution_to_national_coverage,
        "pre_existing_contribution_to_national_coverage": (
            row.pre_existing_contribution_to_national_coverage
        ),
        "new_prioritizr_contribution_to_national_coverage": (
            row.new_prioritizr_contribution_to_national_coverage
        ),
        "contribution_to_national_target": row.contribution_to_national_target,
    }


def _mesa_ecosystem_rows(
    artifact: RuntimeArtifact,
    raster: SolutionRaster,
    solution_raster: SolutionRaster | None,
    solution_id: str | None,
) -> list[dict[str, Any]]:
    if (
        artifact.mesa_coverage is None
        or solution_raster is None
        or solution_id is None
    ):
        return []
    rows = calculate_ecosystem_aoi_coverage(
        artifact.mesa_coverage,
        solution_id,
        raster,
        solution_raster,
    )
    if len(rows) != MESA_V3_ECOSYSTEM_TARGET_COUNT:
        raise SolutionCoverageError(
            "mesa_ecosystem_coverage_incomplete:"
            f"expected_{MESA_V3_ECOSYSTEM_TARGET_COUNT}_received_{len(rows)}"
        )
    return [_coverage_row_dict(row) for row in rows.values()]


def _unavailable_section(section: str, reason: str) -> dict[str, Any]:
    return {
        **_empty_section_payload(section),
        "status": "unavailable",
        "reason": reason,
    }


def _failed_section(section: str, reason: str) -> dict[str, Any]:
    return {
        **_empty_section_payload(section),
        "status": "failed",
        "reason": reason,
    }


def _zero_cell_section(section: str) -> dict[str, Any]:
    return {
        **_empty_section_payload(section),
        "status": "zero_cells",
        "reason": "polygon_selected_no_reference_grid_cells",
    }


def _empty_section_payload(section: str) -> dict[str, Any]:
    if section == "species":
        return {
            "records": [],
            "record_count": 0,
            "id_scope": "runtime-species-dataset",
        }
    return {
        "canonical_summary_view": "broadEcosystem",
        "classified_area_km2": 0.0,
        "views": [],
    }
