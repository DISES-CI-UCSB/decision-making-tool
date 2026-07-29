from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .artifacts import RuntimeArtifact
from .ecosystem_inventory import EcosystemInventoryError, build_ecosystem_inventory
from .metric_adapters import build_custom_aoi_raster
from .models import AreaProfileSectionName
from .polygon_metrics import PolygonMetricError, validate_polygon_geometry
from .species_index import (
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
                else _ecosystems_section(artifact, raster)
            )
        except (SpeciesIndexQueryError, EcosystemInventoryError) as exc:
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
    missing = [group for group in SPECIES_GROUPS if group not in artifact.species_matrices]
    if missing:
        return _unavailable_section(
            "species",
            "species_matrix_group_missing:" + ",".join(missing),
        )

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


def _ecosystems_section(artifact: RuntimeArtifact, raster: SolutionRaster) -> dict[str, Any]:
    if artifact.ecosystem_inventory is None:
        return _unavailable_section("ecosystems", "ecosystem_artifact_not_packaged")
    inventory = build_ecosystem_inventory(artifact.ecosystem_inventory, raster)
    record_count = sum(len(view["records"]) for view in inventory["views"])
    return {
        "status": "complete" if record_count else "empty",
        **inventory,
    }


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
