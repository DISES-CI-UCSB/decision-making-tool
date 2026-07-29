from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from mec_compact import (
    SOURCE_MODE_COMPOSITE,
    UI_VIEW_IDS,
    MecTaxonomy,
    build_composite_taxonomy,
    compute_inventory_rows,
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
) -> dict[str, Any]:
    try:
        ecosystem_values, _ = read_mec_raster_values(
            inventory.raster_path,
            raster.fingerprint,
            inventory.taxonomy,
        )
        rows = compute_inventory_rows(
            scope_mask=raster.selected_mask,
            ecosystem_values=ecosystem_values,
            pixel_area_km2_per_row=raster.pixel_area_km2_per_row,
            taxonomy=inventory.taxonomy,
        )
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
    for row in rows:
        item = inventory.taxonomy.classes[int(row[1])]
        view_id = inventory.taxonomy.views[item.view_index].view_id
        area_km2 = float(row[2])
        records_by_view[view_id].append(
            {
                "id": item.class_id,
                "label": item.label,
                "area_km2": area_km2,
                "share_of_classified_pct": (
                    (area_km2 / classified_area_km2) * 100.0
                    if classified_area_km2 > 0
                    else None
                ),
            }
        )

    views = []
    for view_id, view_label in inventory.taxonomy.view_catalog:
        records = records_by_view[view_id]
        records.sort(key=lambda record: (-record["area_km2"], record["label"], record["id"]))
        views.append({"id": view_id, "label": view_label, "records": records})

    return {
        "canonical_summary_view": CANONICAL_SUMMARY_VIEW,
        "classified_area_km2": classified_area_km2,
        "views": views,
    }
