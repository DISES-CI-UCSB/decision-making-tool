from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from mec_compact import (
    SOURCE_MODE_COMPOSITE,
    UI_VIEW_IDS,
    MecTaxonomy,
    build_composite_taxonomy,
    compute_inventory_rows,
    compute_scope_rows,
    load_composite_crosswalk,
    read_mec_raster_values,
    validate_composite_provenance,
    validate_taxonomy_partition,
)
from raster_metrics import SolutionRaster


CANONICAL_SUMMARY_VIEW = "broadEcosystem"


class EcosystemInventoryError(ValueError):
    pass


@dataclass(frozen=True)
class RuntimeEcosystemInventory:
    raster_path: Path
    crosswalk_path: Path
    provenance_path: Path
    taxonomy: MecTaxonomy
    provenance: dict[str, Any]


def load_ecosystem_inventory(
    raster_path: Path,
    crosswalk_path: Path,
    provenance_path: Path,
    *,
    raster_sha256: str,
    crosswalk_sha256: str,
) -> RuntimeEcosystemInventory:
    try:
        crosswalk_content = crosswalk_path.read_text(encoding="utf-8-sig")
        rows = load_composite_crosswalk(crosswalk_content)
        taxonomy = build_composite_taxonomy(rows)
        validate_taxonomy_partition(taxonomy)
        if taxonomy.source_mode != SOURCE_MODE_COMPOSITE:
            raise EcosystemInventoryError("ecosystem_inventory_requires_composite_source")

        provenance = json.loads(provenance_path.read_text(encoding="utf-8-sig"))
        if not isinstance(provenance, dict):
            raise EcosystemInventoryError("ecosystem_inventory_provenance_invalid")
        validate_composite_provenance(
            provenance,
            raster_sha256=raster_sha256,
            crosswalk_sha256=crosswalk_sha256,
            crosswalk_row_count=len(rows),
        )
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        if isinstance(exc, EcosystemInventoryError):
            raise
        raise EcosystemInventoryError(f"ecosystem_inventory_load_failed:{exc}") from exc

    return RuntimeEcosystemInventory(
        raster_path=raster_path,
        crosswalk_path=crosswalk_path,
        provenance_path=provenance_path,
        taxonomy=taxonomy,
        provenance=provenance,
    )


def build_ecosystem_inventory(
    inventory: RuntimeEcosystemInventory,
    raster: SolutionRaster,
    solution_raster: SolutionRaster | None = None,
    *,
    reference_scope: str = "national",
) -> dict[str, Any]:
    if reference_scope not in {"national", "sirap"}:
        raise EcosystemInventoryError(f"unsupported_ecosystem_reference_scope:{reference_scope}")
    total_aoi_area_km2 = raster.selected_area_km2
    try:
        ecosystem_values, _ = read_mec_raster_values(
            inventory.raster_path,
            raster.fingerprint,
            inventory.taxonomy,
        )
        if solution_raster is None:
            rows = compute_inventory_rows(
                scope_mask=raster.selected_mask,
                ecosystem_values=ecosystem_values,
                pixel_area_km2_per_row=raster.pixel_area_km2_per_row,
                taxonomy=inventory.taxonomy,
            )
        else:
            if not raster.fingerprint.matches(solution_raster.fingerprint):
                raise EcosystemInventoryError("solution_raster_grid_mismatch")
            rows = compute_scope_rows(
                scope_index=0,
                scope_mask=raster.selected_mask,
                pre_existing_mask=solution_raster.pre_existing_mask,
                new_prioritizr_mask=solution_raster.new_prioritizr_mask,
                selected_mask=solution_raster.selected_mask,
                ecosystem_values=ecosystem_values,
                pixel_area_km2_per_row=raster.pixel_area_km2_per_row,
                taxonomy=inventory.taxonomy,
            )
        national_scope_mask = np.isfinite(ecosystem_values)
        reference_scope_mask = (
            solution_raster.valid_mask
            if reference_scope == "sirap" and solution_raster is not None
            else raster.valid_mask
            if reference_scope == "sirap"
            else national_scope_mask
        )
        reference_rows = compute_inventory_rows(
            scope_mask=reference_scope_mask,
            ecosystem_values=ecosystem_values,
            pixel_area_km2_per_row=raster.pixel_area_km2_per_row,
            taxonomy=inventory.taxonomy,
        )
        national_area_by_class: dict[int, float] | None = None
        if reference_scope == "sirap":
            national_reference_rows = compute_inventory_rows(
                scope_mask=national_scope_mask,
                ecosystem_values=ecosystem_values,
                pixel_area_km2_per_row=raster.pixel_area_km2_per_row,
                taxonomy=inventory.taxonomy,
            )
            national_area_by_class = {
                int(row[1]): float(row[2])
                for row in national_reference_rows
            }
    except Exception as exc:
        raise EcosystemInventoryError(f"ecosystem_inventory_query_failed:{exc}") from exc

    classified_area_km2 = sum(
        float(row[2])
        for row in rows
        if inventory.taxonomy.classes[int(row[1])].view_index
        == UI_VIEW_IDS.index(CANONICAL_SUMMARY_VIEW)
    )
    records_by_view: dict[str, list[dict[str, Any]]] = {
        view_id: [] for view_id in UI_VIEW_IDS
    }
    reference_area_by_class = {
        int(row[1]): float(row[2])
        for row in reference_rows
    }
    for row in rows:
        item = inventory.taxonomy.classes[int(row[1])]
        view_id = inventory.taxonomy.views[item.view_index].view_id
        area_km2 = float(row[2])
        pre_existing_area_km2 = (
            float(row[3])
            if solution_raster is not None
            else None
        )
        new_area_km2 = (
            float(row[4])
            if solution_raster is not None
            else None
        )
        solution_area_km2 = (
            pre_existing_area_km2 + new_area_km2
            if pre_existing_area_km2 is not None and new_area_km2 is not None
            else None
        )
        reference_area_km2 = reference_area_by_class.get(int(row[1]), 0.0)
        record: dict[str, Any] = {
            "id": item.class_id,
            "label": item.label,
            "area_km2": area_km2,
            "share_of_classified_pct": (
                (area_km2 / classified_area_km2) * 100.0
                if classified_area_km2 > 0
                else None
            ),
            "share_of_total_aoi_pct": _percentage(
                area_km2,
                total_aoi_area_km2,
            ),
            "solution_covered_area_km2": solution_area_km2,
            "solution_covered_pct_of_aoi": _percentage(
                solution_area_km2,
                area_km2,
            ) if solution_area_km2 is not None else None,
            "pre_existing_covered_area_km2": pre_existing_area_km2,
            "pre_existing_covered_pct_of_aoi": _percentage(
                pre_existing_area_km2,
                area_km2,
            ) if pre_existing_area_km2 is not None else None,
            "new_covered_area_km2": new_area_km2,
            "new_covered_pct_of_aoi": _percentage(
                new_area_km2,
                area_km2,
            ) if new_area_km2 is not None else None,
        }
        if reference_scope == "national":
            record["national_area_km2"] = reference_area_km2
            share_of_reference = _percentage(area_km2, reference_area_km2)
            if share_of_reference is not None:
                record["share_of_national_class_pct"] = share_of_reference
        elif reference_scope == "sirap":
            record["sirap_area_km2"] = reference_area_km2
            share_of_sirap = _percentage(area_km2, reference_area_km2)
            if share_of_sirap is not None:
                record["share_of_sirap_class_pct"] = share_of_sirap
            national_area_km2 = (
                national_area_by_class.get(int(row[1]), 0.0)
                if national_area_by_class is not None
                else 0.0
            )
            record["national_area_km2"] = national_area_km2
            share_of_national = _percentage(area_km2, national_area_km2)
            if share_of_national is not None:
                record["share_of_national_class_pct"] = share_of_national
        records_by_view[view_id].append(record)

    views = []
    for view_id, view_label in inventory.taxonomy.view_catalog:
        records = records_by_view[view_id]
        records.sort(key=lambda record: (-record["area_km2"], record["label"], record["id"]))
        views.append({"id": view_id, "label": view_label, "records": records})

    return {
        "canonical_summary_view": CANONICAL_SUMMARY_VIEW,
        "reference_scope": reference_scope,
        "classified_area_km2": classified_area_km2,
        "views": views,
    }


def _percentage(numerator: float, denominator: float) -> float | None:
    if denominator <= 0:
        return None
    return (numerator / denominator) * 100.0
