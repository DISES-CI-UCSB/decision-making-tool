"""Incremental backfill for CORINE land-use percents.

Copy every existing compact/verbose metric row except the ten CLC land-use
percent ids, recompute those ten with the current catalog class mapping, and
restamp catalog provenance.

    * ``land_use_*_pct_of_aoi`` is solution-independent (once per boundary).
    * ``land_use_*_pct`` is solution-selected mix (once per solution × boundary).

    Default ``--clc-encoding national-remapped`` keeps the current catalog
    class IDs (1=forest, 5=artificial). SIRAP packet CLC is classic IDEAM
    (1=artificial, 3=forest) and must be run with ``--clc-encoding classic-ideam``.

Full replay must call ``corine_level_1_pct`` / ``corine_level_1_pct_of_aoi`` —
the same calculators this module uses.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from collections.abc import Callable, Mapping
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from blob_manifest import SIRAP_CLASSIC_IDEAM_SELECTED_VALUES
from boundaries.boundary_loader import BOUNDARY_SOURCE_SPECS, load_all_boundaries
from boundaries.boundary_mask import rasterize_boundary
from calculators.land_cover import corine_level_1_pct, corine_level_1_pct_of_aoi
from cli_utils import find_repo_root
from compact_metrics import (
    COMPACT_CACHE_SUFFIX,
    is_compact_document,
    to_compact_document,
    to_verbose_document,
)
from local_io import DEFAULT_CACHE_DIR, cached_download
from metric_definitions import (
    LAND_USE_OF_AOI_METRIC_IDS,
    LAND_USE_SELECTED_PCT_METRIC_IDS,
    computable_metrics,
    off_manifest_layer_renderings,
    off_manifest_layer_urls,
)
from metric_output import empty_boundary
from metrics_contract import PROVENANCE_KEY, catalog_signature
from raster_metrics import SolutionRaster, read_layer_mask, read_reference_raster, read_solution_raster
from solution_domain import normalize_domain

CACHE_SUFFIX = ".metrics.json"
DEFAULT_OUTPUT_DIR = Path("data/metrics/generated/land-use-of-aoi-backfill")
COBERTURAS_INPUT_PREFIX = "layer:coberturas_"
CLC_ENCODING_NATIONAL_REMAPPED = "national-remapped"
CLC_ENCODING_CLASSIC_IDEAM = "classic-ideam"
VALID_CLC_ENCODINGS = (
    CLC_ENCODING_NATIONAL_REMAPPED,
    CLC_ENCODING_CLASSIC_IDEAM,
)
PACKET_ALIGNMENT_FORMAT = "sirap-packet-alignment-inventory-v1"
PACKET_CLC_BASENAME = "ideam_clc_2022_level1_national.tif"
PACKET_CLC_RELATIVE = Path("sources") / "packet-layers" / PACKET_CLC_BASENAME

LAND_USE_OF_AOI_LAYER_BY_METRIC_ID: dict[str, str] = {
    definition.metric_id: definition.layer_id or ""
    for definition in computable_metrics()
    if definition.metric_id in LAND_USE_OF_AOI_METRIC_IDS
}
LAND_USE_SELECTED_PCT_LAYER_BY_METRIC_ID: dict[str, str] = {
    definition.metric_id: definition.layer_id or ""
    for definition in computable_metrics()
    if definition.metric_id in LAND_USE_SELECTED_PCT_METRIC_IDS
}
LAND_USE_PERCENT_METRIC_IDS: tuple[str, ...] = (
    LAND_USE_SELECTED_PCT_METRIC_IDS + LAND_USE_OF_AOI_METRIC_IDS
)
COBERTURAS_CLASS_LAYER_IDS: tuple[str, ...] = tuple(
    dict.fromkeys(
        [
            *LAND_USE_SELECTED_PCT_LAYER_BY_METRIC_ID.values(),
            *LAND_USE_OF_AOI_LAYER_BY_METRIC_ID.values(),
        ]
    )
)

ScopeKey = tuple[str, str]
ScopeValues = Mapping[str, float | None]
ComputeScopeValues = Callable[["SourcePins", Path, Path | None], dict[ScopeKey, dict[str, float | None]]]


class SourcePinError(RuntimeError):
    """Raised when coberturas or boundary bytes do not match the patched release."""


@dataclass(frozen=True)
class CoberturasPin:
    url: str
    source_sha256: str
    aligned_sha256: str | None = None
    cache_key: str | None = None


@dataclass(frozen=True)
class SourcePins:
    coberturas: CoberturasPin | None
    boundary_sha256_by_level: dict[str, str]
    domain: str
    target_grid_sha256: str | None = None
    region_id: str | None = None
    packet_sha256: str | None = None
    clc_encoding: str = CLC_ENCODING_NATIONAL_REMAPPED


def clc_layer_renderings(encoding: str) -> dict[str, dict[str, Any]]:
    """Return coberturas binary renderings for one CLC class encoding."""

    if encoding == CLC_ENCODING_CLASSIC_IDEAM:
        return {
            layer_id: {"valueType": "binary", "selectedValue": selected_value}
            for layer_id, selected_value in SIRAP_CLASSIC_IDEAM_SELECTED_VALUES.items()
            if layer_id.startswith("coberturas_")
        }
    if encoding != CLC_ENCODING_NATIONAL_REMAPPED:
        raise ValueError(
            f"Unknown CLC encoding {encoding!r}; expected one of {VALID_CLC_ENCODINGS}."
        )
    return off_manifest_layer_renderings()


def assert_clc_encoding_renderings(encoding: str, renderings: Mapping[str, Mapping[str, Any]]) -> None:
    forest = renderings.get("coberturas_forests_and_semi_natural_areas", {}).get("selectedValue")
    artificial = renderings.get("coberturas_artificial_surfaces", {}).get("selectedValue")
    if encoding == CLC_ENCODING_CLASSIC_IDEAM:
        if forest != 3 or artificial != 1:
            raise SourcePinError(
                "classic-ideam encoding must use IDEAM 3=forest and 1=artificial; "
                f"got forest={forest!r} artificial={artificial!r}."
            )
        return
    if forest != 1 or artificial != 5:
        raise SourcePinError(
            "national-remapped encoding must use catalog 1=forest and 5=artificial; "
            f"got forest={forest!r} artificial={artificial!r}."
        )


def compute_land_use_selected_percents(
    raster: SolutionRaster,
    layer_masks: Mapping[str, Any],
) -> dict[str, float | None]:
    """Compute the five selected-area CLC percents with the replay calculator."""

    values: dict[str, float | None] = {}
    for metric_id in LAND_USE_SELECTED_PCT_METRIC_IDS:
        layer_id = LAND_USE_SELECTED_PCT_LAYER_BY_METRIC_ID[metric_id]
        mask = layer_masks[layer_id]
        values[metric_id] = corine_level_1_pct(raster, mask)
    return values


def compute_land_use_of_aoi_percents(
    raster: SolutionRaster,
    layer_masks: Mapping[str, Any],
) -> dict[str, float | None]:
    """Compute the five whole-AOI CLC percents with the replay calculator."""

    values: dict[str, float | None] = {}
    for metric_id in LAND_USE_OF_AOI_METRIC_IDS:
        layer_id = LAND_USE_OF_AOI_LAYER_BY_METRIC_ID[metric_id]
        mask = layer_masks[layer_id]
        values[metric_id] = corine_level_1_pct_of_aoi(raster, mask)
    return values


def existing_metric_ids(metrics: list[dict[str, Any]]) -> list[str]:
    return [
        str(row.get("metricId"))
        for row in metrics
        if isinstance(row, dict) and row.get("metricId")
    ]


def append_land_use_of_aoi_rows(
    metrics: list[dict[str, Any]],
    values: Mapping[str, float | None],
    *,
    source: str = "raster:coberturas+boundary",
    empty_scope: bool = False,
) -> list[dict[str, Any]]:
    """Copy ``metrics`` and append missing of-AOI rows in catalog order."""

    observed = existing_metric_ids(metrics)
    present = [metric_id for metric_id in LAND_USE_OF_AOI_METRIC_IDS if metric_id in observed]
    if present:
        if set(present) == set(LAND_USE_OF_AOI_METRIC_IDS):
            raise ValueError("Scope already contains land_use_*_pct_of_aoi rows.")
        raise ValueError("Scope already contains a partial land_use_*_pct_of_aoi set.")

    definitions_by_id = {item.metric_id: item for item in computable_metrics()}
    appended = [dict(row) for row in metrics]
    for metric_id in LAND_USE_OF_AOI_METRIC_IDS:
        definition = definitions_by_id[metric_id]
        if empty_scope:
            appended.append(empty_boundary(definition))
            continue
        value = values.get(metric_id)
        appended.append(
            {
                "metricId": metric_id,
                "value": value,
                "unit": definition.unit,
                "status": "ready" if value is not None else "blocked",
                "source": source,
                "notes": (
                    f"(AOI ∩ '{definition.layer_id}') / aoi_area × 100."
                    if value is not None
                    else "AOI area is zero; cannot compute percent."
                ),
                "labelKey": definition.label_key,
                "formatHint": definition.format_hint,
            }
        )
    return appended


def _land_use_row(
    metric_id: str,
    value: float | None,
    *,
    source: str,
    empty_scope: bool,
    notes: str,
) -> dict[str, Any]:
    definition = next(
        item for item in computable_metrics() if item.metric_id == metric_id
    )
    if empty_scope:
        return empty_boundary(definition)
    return {
        "metricId": metric_id,
        "value": value,
        "unit": definition.unit,
        "status": "ready" if value is not None else "blocked",
        "source": source,
        "notes": notes if value is not None else "AOI or selected area is zero; cannot compute percent.",
        "labelKey": definition.label_key,
        "formatHint": definition.format_hint,
    }


def upsert_land_use_rows(
    metrics: list[dict[str, Any]],
    values: Mapping[str, float | None],
    metric_ids: tuple[str, ...],
    *,
    source: str,
    notes: str,
    empty_scope: bool = False,
) -> list[dict[str, Any]]:
    """Replace existing rows for ``metric_ids``, or append any that are missing."""

    replacements = {
        metric_id: _land_use_row(
            metric_id,
            values.get(metric_id),
            source=source,
            empty_scope=empty_scope,
            notes=notes.format(layer_id=next(
                item.layer_id
                for item in computable_metrics()
                if item.metric_id == metric_id
            )),
        )
        for metric_id in metric_ids
    }
    updated: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in metrics:
        metric_id = str(row.get("metricId") or "")
        if metric_id in replacements:
            updated.append(replacements[metric_id])
            seen.add(metric_id)
            continue
        updated.append(dict(row))
    for metric_id in metric_ids:
        if metric_id not in seen:
            updated.append(replacements[metric_id])
    return updated


def expected_backfill_metric_ids() -> list[str]:
    return [definition.metric_id for definition in computable_metrics()]


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def assert_file_sha256(path: Path, expected: str, *, label: str) -> None:
    observed = _sha256_file(path)
    if observed != expected:
        raise SourcePinError(
            f"{label} SHA-256 moved; refusing to backfill with new bytes. "
            f"expected {expected}, observed {observed} ({path})."
        )


def extract_coberturas_pin(document: Mapping[str, Any]) -> CoberturasPin:
    provenance = document.get(PROVENANCE_KEY)
    if not isinstance(provenance, dict):
        raise SourcePinError("Document is missing metricsProvenance.")
    alignment = provenance.get("inputAlignment")
    entries = alignment.get("entries") if isinstance(alignment, dict) else None
    if not isinstance(entries, list):
        raise SourcePinError("Document is missing inputAlignment.entries for coberturas.")

    coberturas_entries = [
        entry
        for entry in entries
        if isinstance(entry, dict)
        and str(entry.get("inputId") or "").startswith(COBERTURAS_INPUT_PREFIX)
    ]
    if not coberturas_entries:
        raise SourcePinError("Document inputAlignment has no coberturas layer pins.")

    first = coberturas_entries[0]
    url = str(first.get("sourceUrl") or "")
    source_sha256 = str(first.get("sourceSha256") or "")
    if not url or len(source_sha256) != 64:
        raise SourcePinError("Coberturas pin is missing sourceUrl or sourceSha256.")

    for entry in coberturas_entries[1:]:
        if entry.get("sourceUrl") != url or entry.get("sourceSha256") != source_sha256:
            raise SourcePinError("Document has conflicting coberturas source pins.")

    aligned = first.get("alignedSha256")
    cache_key = first.get("cacheKey")
    return CoberturasPin(
        url=url,
        source_sha256=source_sha256,
        aligned_sha256=str(aligned) if isinstance(aligned, str) else None,
        cache_key=str(cache_key) if isinstance(cache_key, str) else None,
    )


def extract_boundary_pins(document: Mapping[str, Any]) -> dict[str, str]:
    provenance = document.get(PROVENANCE_KEY)
    if not isinstance(provenance, dict):
        raise SourcePinError("Document is missing metricsProvenance.")
    boundary = provenance.get("boundaryProvenance")
    sources = boundary.get("sources") if isinstance(boundary, dict) else None
    if not isinstance(sources, dict):
        return {}
    pins: dict[str, str] = {}
    for level, spec in sources.items():
        if not isinstance(spec, dict):
            continue
        sha256 = spec.get("sha256")
        if isinstance(sha256, str) and sha256:
            pins[str(level)] = sha256
    return pins


def extract_packet_pins(document: Mapping[str, Any]) -> SourcePins:
    """Read SIRAP packet-shaped alignment (regionId / packetSha256 / targetGridSha256)."""

    provenance = document.get(PROVENANCE_KEY)
    if not isinstance(provenance, dict):
        raise SourcePinError("Document is missing metricsProvenance.")
    alignment = provenance.get("inputAlignment")
    if not isinstance(alignment, dict) or alignment.get("format") != PACKET_ALIGNMENT_FORMAT:
        observed = alignment.get("format") if isinstance(alignment, dict) else type(alignment).__name__
        raise SourcePinError(
            "classic-ideam / packet mode requires "
            f"{PACKET_ALIGNMENT_FORMAT} with regionId/packetSha256/targetGridSha256; "
            f"got {observed!r}."
        )
    if alignment.get("entries"):
        raise SourcePinError(
            "Packet alignment unexpectedly contains coberturas inputAlignment.entries."
        )
    region_id = alignment.get("regionId")
    packet_sha256 = alignment.get("packetSha256")
    target_grid = alignment.get("targetGridSha256")
    if not isinstance(region_id, str) or not region_id.strip():
        raise SourcePinError("Packet alignment is missing regionId.")
    if not isinstance(packet_sha256, str) or len(packet_sha256) != 64:
        raise SourcePinError("Packet alignment is missing packetSha256.")
    if not isinstance(target_grid, str) or len(target_grid) != 64:
        raise SourcePinError("Packet alignment is missing targetGridSha256.")
    return SourcePins(
        coberturas=None,
        boundary_sha256_by_level=extract_boundary_pins(document),
        domain=normalize_domain(provenance.get("solutionDomain")),
        target_grid_sha256=target_grid,
        region_id=region_id,
        packet_sha256=packet_sha256,
        clc_encoding=CLC_ENCODING_CLASSIC_IDEAM,
    )


def extract_source_pins(
    document: Mapping[str, Any],
    *,
    clc_encoding: str = CLC_ENCODING_NATIONAL_REMAPPED,
) -> SourcePins:
    if clc_encoding == CLC_ENCODING_CLASSIC_IDEAM:
        return extract_packet_pins(document)
    if clc_encoding != CLC_ENCODING_NATIONAL_REMAPPED:
        raise ValueError(
            f"Unknown CLC encoding {clc_encoding!r}; expected one of {VALID_CLC_ENCODINGS}."
        )
    provenance = document.get(PROVENANCE_KEY)
    if not isinstance(provenance, dict):
        raise SourcePinError("Document is missing metricsProvenance.")
    alignment = provenance.get("inputAlignment")
    if isinstance(alignment, dict) and alignment.get("format") == PACKET_ALIGNMENT_FORMAT:
        raise SourcePinError(
            "Document inputAlignment is packet-shaped (regionId/packetSha256/"
            "targetGridSha256) with no coberturas entries. Use --clc-encoding "
            "classic-ideam and the regional aligned CLC raster."
        )
    domain = normalize_domain(provenance.get("solutionDomain"))
    target_grid = None
    if isinstance(alignment, dict) and isinstance(alignment.get("targetGridSha256"), str):
        target_grid = alignment["targetGridSha256"]
    return SourcePins(
        coberturas=extract_coberturas_pin(document),
        boundary_sha256_by_level=extract_boundary_pins(document),
        domain=domain,
        target_grid_sha256=target_grid,
        clc_encoding=CLC_ENCODING_NATIONAL_REMAPPED,
    )


def assert_source_pins_match(expected: SourcePins, observed: SourcePins) -> None:
    if observed.clc_encoding != expected.clc_encoding:
        raise SourcePinError(
            "CLC encoding differs across documents in this batch; "
            f"{expected.clc_encoding} vs {observed.clc_encoding}."
        )
    if expected.region_id or observed.region_id or expected.coberturas is None:
        if observed.region_id != expected.region_id:
            raise SourcePinError(
                "Packet regionId differs across documents in this batch; "
                f"{expected.region_id} vs {observed.region_id}."
            )
    else:
        if expected.coberturas is None or observed.coberturas is None:
            raise SourcePinError("National backfill is missing coberturas pins.")
        if observed.coberturas.source_sha256 != expected.coberturas.source_sha256:
            raise SourcePinError(
                "Coberturas source SHA differs across documents in this batch; "
                f"{expected.coberturas.source_sha256} vs {observed.coberturas.source_sha256}."
            )
        if observed.coberturas.url != expected.coberturas.url:
            raise SourcePinError("Coberturas URL differs across documents in this batch.")
    if observed.domain != expected.domain:
        raise SourcePinError(
            f"Solution domain differs across documents: {expected.domain} vs {observed.domain}."
        )
    if (
        expected.target_grid_sha256
        and observed.target_grid_sha256
        and observed.target_grid_sha256 != expected.target_grid_sha256
    ):
        raise SourcePinError("targetGridSha256 differs across documents in this batch.")
    shared_levels = set(expected.boundary_sha256_by_level) & set(observed.boundary_sha256_by_level)
    for level in sorted(shared_levels):
        if (
            expected.boundary_sha256_by_level[level]
            != observed.boundary_sha256_by_level[level]
        ):
            raise SourcePinError(f"Boundary {level} SHA differs across documents.")


def assert_boundary_specs_unmoved(pins: SourcePins) -> None:
    """Fail if the release pin no longer matches the current boundary source specs."""

    for level, pinned in pins.boundary_sha256_by_level.items():
        spec = BOUNDARY_SOURCE_SPECS.get(level)
        if spec is None:
            continue
        if pinned != spec.expected_sha256:
            raise SourcePinError(
                f"Boundary {level} SHA moved since this release was generated; "
                f"document pin {pinned} != current spec {spec.expected_sha256}."
            )


def restamp_catalog_signature(document: dict[str, Any]) -> dict[str, Any]:
    """Rewrite catalogSignature from the document's existing generationConfig."""

    provenance = document.get(PROVENANCE_KEY)
    if not isinstance(provenance, dict):
        raise SourcePinError("Document is missing metricsProvenance.")
    domain = normalize_domain(provenance.get("solutionDomain"))
    config = provenance.get("generationConfig")
    if not isinstance(config, dict):
        raise SourcePinError("Document is missing generationConfig.")
    stamped = deepcopy(document)
    stamped[PROVENANCE_KEY] = dict(provenance)
    stamped[PROVENANCE_KEY]["catalogSignature"] = catalog_signature(domain, config)
    return stamped


def scope_is_empty(scope: Mapping[str, Any]) -> bool:
    state = scope.get("scopeState")
    if not isinstance(state, dict):
        return False
    if state.get("classification") == "empty":
        return True
    return state.get("solutionValidCellCount") == 0


def document_of_aoi_state(document: Mapping[str, Any]) -> str:
    """Return missing, present, or partial for of-AOI rows across all scopes."""

    seen: set[str] = set()
    for scopes in (document.get("geographies") or {}).values():
        if not isinstance(scopes, dict):
            continue
        for scope in scopes.values():
            if not isinstance(scope, dict):
                continue
            ids = set(existing_metric_ids(scope.get("metrics") or []))
            present = [metric_id for metric_id in LAND_USE_OF_AOI_METRIC_IDS if metric_id in ids]
            if not present:
                seen.add("missing")
            elif set(present) == set(LAND_USE_OF_AOI_METRIC_IDS):
                seen.add("present")
            else:
                return "partial"
    if seen == {"present"}:
        return "present"
    if seen == {"missing"}:
        return "missing"
    if not seen:
        return "missing"
    return "partial"


def backfill_verbose_document(
    document: dict[str, Any],
    values_by_scope: Mapping[ScopeKey, ScopeValues],
    selected_values_by_scope: Mapping[ScopeKey, ScopeValues] | None = None,
) -> dict[str, Any]:
    """Copy non-CLC rows, upsert both land-use percent families, then restamp."""

    state = document_of_aoi_state(document)
    if state == "partial":
        raise ValueError("Document has a partial land_use_*_pct_of_aoi set.")

    updated = deepcopy(document)
    geographies = updated.get("geographies")
    if not isinstance(geographies, dict):
        raise ValueError("Document is missing geographies.")

    for level, scopes in geographies.items():
        if not isinstance(scopes, dict):
            continue
        for scope_id, scope in scopes.items():
            if not isinstance(scope, dict):
                continue
            metrics = scope.get("metrics")
            if not isinstance(metrics, list):
                raise ValueError(f"{level}/{scope_id} is missing a metrics array.")
            empty = scope_is_empty(scope)
            of_aoi_values = values_by_scope.get((str(level), str(scope_id)))
            if not empty and of_aoi_values is None:
                raise ValueError(
                    f"No of-AOI values computed for {level}/{scope_id}."
                )
            metrics = upsert_land_use_rows(
                metrics,
                of_aoi_values or {},
                LAND_USE_OF_AOI_METRIC_IDS,
                source="raster:coberturas+boundary",
                notes="(AOI ∩ '{layer_id}') / aoi_area × 100.",
                empty_scope=empty,
            )
            if selected_values_by_scope is not None:
                selected_values = selected_values_by_scope.get(
                    (str(level), str(scope_id))
                )
                if not empty and selected_values is None:
                    raise ValueError(
                        f"No selected land-use values computed for {level}/{scope_id}."
                    )
                metrics = upsert_land_use_rows(
                    metrics,
                    selected_values or {},
                    LAND_USE_SELECTED_PCT_METRIC_IDS,
                    source="raster:coberturas+solution",
                    notes="(selected ∩ '{layer_id}') / selected_area × 100.",
                    empty_scope=empty,
                )
            scope["metrics"] = metrics
    return restamp_catalog_signature(updated)


def discover_metric_paths(input_dir: Path) -> list[Path]:
    if not input_dir.is_dir():
        raise FileNotFoundError(f"Input directory does not exist: {input_dir}")
    paths = [
        path
        for path in sorted(input_dir.rglob("*"))
        if path.is_file()
        and (
            path.name.endswith(COMPACT_CACHE_SUFFIX)
            or path.name.endswith(CACHE_SUFFIX)
        )
    ]
    return paths


def solution_stem(path: Path) -> str:
    name = path.name
    if name.endswith(COMPACT_CACHE_SUFFIX):
        return name[: -len(COMPACT_CACHE_SUFFIX)]
    if name.endswith(CACHE_SUFFIX):
        return name[: -len(CACHE_SUFFIX)]
    return path.stem


def load_metric_document(path: Path) -> tuple[dict[str, Any], bool]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"{path} is not a JSON object.")
    if is_compact_document(raw):
        return to_verbose_document(raw), True
    return raw, False


def dump_metric_document(
    path: Path,
    document: dict[str, Any],
    *,
    compact: bool,
) -> None:
    payload = to_compact_document(document) if compact else document
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def coberturas_class_masks(
    path: Path,
    raster: SolutionRaster,
    *,
    encoding: str = CLC_ENCODING_NATIONAL_REMAPPED,
) -> dict[str, Any]:
    renderings = clc_layer_renderings(encoding)
    assert_clc_encoding_renderings(encoding, renderings)
    masks: dict[str, Any] = {}
    for layer_id in COBERTURAS_CLASS_LAYER_IDS:
        rendering = renderings.get(layer_id, {})
        if encoding == CLC_ENCODING_CLASSIC_IDEAM and not rendering:
            raise SourcePinError(f"classic-ideam encoding has no class ID for {layer_id}.")
        masks[layer_id] = read_layer_mask(
            path,
            raster.fingerprint,
            rendering=rendering,
        )
    return masks


def compute_boundary_masks(
    planning_raster: SolutionRaster,
    features_by_level: Mapping[str, list[Any]],
) -> dict[ScopeKey, np.ndarray]:
    """Rasterize each boundary once; national uses the planning-grid valid mask."""

    masks: dict[ScopeKey, np.ndarray] = {
        ("national", "colombia"): np.asarray(planning_raster.valid_mask, dtype=bool)
    }
    for level, features in features_by_level.items():
        for feature in features:
            masks[(str(level), feature.boundary_id)] = rasterize_boundary(
                feature.geometry,
                planning_raster.fingerprint,
                source_crs=getattr(feature, "source_crs", None),
            )
    return masks


def compute_selected_values_by_scope(
    solution_raster: SolutionRaster,
    layer_masks: Mapping[str, Any],
    boundary_masks: Mapping[ScopeKey, np.ndarray],
) -> dict[ScopeKey, dict[str, float | None]]:
    values: dict[ScopeKey, dict[str, float | None]] = {}
    for scope_key, boundary_mask in boundary_masks.items():
        scoped = solution_raster.with_boundary_mask(boundary_mask)
        values[scope_key] = compute_land_use_selected_percents(scoped, layer_masks)
    return values


def resolve_solution_raster_path(document: Mapping[str, Any], solutions_dir: Path) -> Path:
    raster_meta = document.get("solutionRaster")
    if not isinstance(raster_meta, dict):
        raise SourcePinError("Document is missing solutionRaster provenance.")
    basename = raster_meta.get("solutionBasename")
    expected_sha = raster_meta.get("sha256")
    if not isinstance(basename, str) or not basename:
        raise SourcePinError("Document solutionRaster is missing solutionBasename.")
    if not isinstance(expected_sha, str) or len(expected_sha) != 64:
        raise SourcePinError("Document solutionRaster is missing sha256.")
    path = solutions_dir / basename
    if not path.is_file():
        raise FileNotFoundError(f"Solution raster not found: {path}")
    assert_file_sha256(path, expected_sha, label=basename)
    return path


def compute_values_by_scope(
    planning_raster: SolutionRaster,
    layer_masks: Mapping[str, Any],
    features_by_level: Mapping[str, list[Any]],
) -> dict[ScopeKey, dict[str, float | None]]:
    """Compute five of-AOI percents once per national / boundary scope."""

    values: dict[ScopeKey, dict[str, float | None]] = {
        ("national", "colombia"): compute_land_use_of_aoi_percents(
            planning_raster,
            layer_masks,
        )
    }
    for level, features in features_by_level.items():
        for feature in features:
            mask = rasterize_boundary(
                feature.geometry,
                planning_raster.fingerprint,
                source_crs=getattr(feature, "source_crs", None),
            )
            scoped = planning_raster.with_boundary_mask(mask)
            values[(level, feature.boundary_id)] = compute_land_use_of_aoi_percents(
                scoped,
                layer_masks,
            )
    return values


def collect_needed_scopes(paths: list[Path]) -> set[ScopeKey]:
    """Union of non-empty compact/verbose geographies in a pin group."""

    needed: set[ScopeKey] = set()
    for path in paths:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            continue
        for level, scopes in (raw.get("geographies") or {}).items():
            if not isinstance(scopes, dict):
                continue
            for scope_id, scope in scopes.items():
                if isinstance(scope, dict) and not scope_is_empty(scope):
                    needed.add((str(level), str(scope_id)))
    return needed


def compute_values_for_document_scopes(
    planning_raster: SolutionRaster,
    layer_masks: Mapping[str, Any],
    features_by_level: Mapping[str, list[Any]],
    needed_scopes: set[ScopeKey],
) -> dict[ScopeKey, dict[str, float | None]]:
    """Compute of-AOI percents for geographies present in the compact.

    ``national`` and ``sirap`` scopes use the planning raster valid mask
    (SIRAP AOI). Departments and municipalities are rasterized against that grid.
    """

    feature_index: dict[ScopeKey, Any] = {
        (str(level), feature.boundary_id): feature
        for level, features in features_by_level.items()
        for feature in features
    }
    values: dict[ScopeKey, dict[str, float | None]] = {}
    for scope_key in sorted(needed_scopes):
        level, _scope_id = scope_key
        if level in {"national", "sirap"}:
            values[scope_key] = compute_land_use_of_aoi_percents(
                planning_raster,
                layer_masks,
            )
            continue
        feature = feature_index.get(scope_key)
        if feature is None:
            raise SourcePinError(
                f"No pinned boundary feature for {level}/{_scope_id}."
            )
        mask = rasterize_boundary(
            feature.geometry,
            planning_raster.fingerprint,
            source_crs=getattr(feature, "source_crs", None),
        )
        scoped = planning_raster.with_boundary_mask(mask)
        values[scope_key] = compute_land_use_of_aoi_percents(scoped, layer_masks)
    return values


def resolve_packet_clc_path(
    pins: SourcePins,
    *,
    planning_raster: Path | None,
    packet_clc_root: Path | None,
) -> Path:
    if planning_raster is not None:
        return planning_raster
    if packet_clc_root is None:
        raise SourcePinError(
            "classic-ideam packet mode requires --planning-raster or --packet-clc-root."
        )
    if not pins.region_id:
        raise SourcePinError("Packet pins are missing regionId.")
    path = packet_clc_root / pins.region_id / PACKET_CLC_RELATIVE
    if not path.is_file():
        raise FileNotFoundError(f"Aligned packet CLC not found: {path}")
    return path


def load_packet_clc(clc_path: Path) -> tuple[SolutionRaster, dict[str, Any]]:
    planning_raster = read_reference_raster(clc_path)
    masks = coberturas_class_masks(
        clc_path,
        planning_raster,
        encoding=CLC_ENCODING_CLASSIC_IDEAM,
    )
    return planning_raster, masks


def _packet_group_key(pins: SourcePins) -> tuple[str, str, str]:
    return (
        pins.region_id or "",
        pins.target_grid_sha256 or "",
        pins.domain,
    )


def _group_packet_paths(
    paths: list[Path],
    *,
    clc_encoding: str,
) -> dict[tuple[str, str, str], tuple[SourcePins, list[Path]]]:
    grouped: dict[tuple[str, str, str], tuple[SourcePins, list[Path]]] = {}
    for path in paths:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"{path} is not a JSON object.")
        pins = extract_source_pins(raw, clc_encoding=clc_encoding)
        key = _packet_group_key(pins)
        existing = grouped.get(key)
        if existing is None:
            grouped[key] = (pins, [path])
            continue
        assert_source_pins_match(existing[0], pins)
        existing[1].append(path)
    return grouped


def _aligned_cache_path(cache_dir: Path, cache_key: str) -> Path:
    return cache_dir / "aligned" / cache_key[:2] / f"{cache_key}.tif"


def load_pinned_coberturas(
    pins: SourcePins,
    cache_dir: Path,
    *,
    planning_raster_path: Path | None = None,
) -> tuple[SolutionRaster, dict[str, Any], Path]:
    """Download coberturas, refuse SHA drift, and return planning raster + class masks."""

    if pins.coberturas is None:
        raise SourcePinError("National coberturas pin is missing.")
    fallback_url = off_manifest_layer_urls().get(
        "coberturas_artificial_surfaces",
        pins.coberturas.url,
    )
    download = cached_download(pins.coberturas.url or fallback_url, cache_dir)
    assert_file_sha256(
        download.path,
        pins.coberturas.source_sha256,
        label="coberturas.tif",
    )

    coberturas_path = download.path
    if pins.coberturas.cache_key and pins.coberturas.aligned_sha256:
        aligned_path = _aligned_cache_path(cache_dir, pins.coberturas.cache_key)
        if not aligned_path.is_file() and planning_raster_path is None:
            raise SourcePinError(
                "Aligned coberturas is missing from the local alignment cache; "
                f"expected {aligned_path}. Restore the 3.0.1 aligned cache or pass "
                "--planning-raster so the writer can stay on the release grid."
            )
        if aligned_path.is_file():
            assert_file_sha256(
                aligned_path,
                pins.coberturas.aligned_sha256,
                label="aligned coberturas",
            )
            coberturas_path = aligned_path

    planning_path = planning_raster_path or coberturas_path
    planning_raster = read_reference_raster(planning_path)
    masks = coberturas_class_masks(
        coberturas_path,
        planning_raster,
        encoding=CLC_ENCODING_NATIONAL_REMAPPED,
    )
    return planning_raster, masks, coberturas_path


def load_pinned_boundaries(pins: SourcePins, cache_dir: Path) -> dict[str, list[Any]]:
    assert_boundary_specs_unmoved(pins)
    boundaries, errors = load_all_boundaries(cache_dir)
    if errors:
        wanted = set(pins.boundary_sha256_by_level)
        blocking = {level: message for level, message in errors.items() if level in wanted}
        if blocking:
            raise SourcePinError(
                "Failed to load pinned boundary sources: "
                + "; ".join(f"{level}: {message}" for level, message in sorted(blocking.items()))
            )
    for level, features in boundaries.items():
        if not features:
            continue
        expected = pins.boundary_sha256_by_level.get(level)
        if expected is None:
            continue
        observed = features[0].source_sha256
        if observed != expected:
            raise SourcePinError(
                f"Boundary {level} SHA-256 moved; expected {expected}, observed {observed}."
            )
    return {
        level: features
        for level, features in boundaries.items()
        if level in pins.boundary_sha256_by_level
    }


def compute_scope_values_from_sources(
    pins: SourcePins,
    cache_dir: Path,
    planning_raster_path: Path | None = None,
) -> dict[ScopeKey, dict[str, float | None]]:
    planning_raster, layer_masks, _ = load_pinned_coberturas(
        pins,
        cache_dir,
        planning_raster_path=planning_raster_path,
    )
    features_by_level = load_pinned_boundaries(pins, cache_dir)
    return compute_values_by_scope(planning_raster, layer_masks, features_by_level)


def _select_paths(paths: list[Path], limit: int | None) -> list[Path]:
    if limit is None:
        return paths
    selected: list[Path] = []
    seen: list[str] = []
    for path in paths:
        stem = solution_stem(path)
        if stem not in seen:
            if len(seen) >= limit:
                continue
            seen.append(stem)
        if stem in seen:
            selected.append(path)
    return selected


def run_backfill(
    *,
    input_dir: Path,
    output_dir: Path,
    cache_dir: Path,
    in_place: bool = False,
    dry_run: bool = False,
    limit: int | None = None,
    planning_raster: Path | None = None,
    compute_scope_values: ComputeScopeValues | None = None,
    solutions_dir: Path | None = None,
    clc_encoding: str = CLC_ENCODING_NATIONAL_REMAPPED,
    packet_clc_root: Path | None = None,
) -> dict[str, Any]:
    """Copy non-CLC rows and recompute land-use percents into a new cache tree."""

    if clc_encoding not in VALID_CLC_ENCODINGS:
        raise ValueError(
            f"Unknown CLC encoding {clc_encoding!r}; expected one of {VALID_CLC_ENCODINGS}."
        )
    if clc_encoding == CLC_ENCODING_CLASSIC_IDEAM:
        if in_place:
            raise ValueError("Refusing --in-place for classic-ideam/packet backfill.")
        if solutions_dir is not None:
            raise ValueError(
                "Refusing --solutions-dir for classic-ideam/packet backfill; "
                "selected land_use_*_pct is already correct."
            )
    if in_place:
        output_dir = input_dir
    elif output_dir.resolve() == input_dir.resolve():
        raise ValueError(
            "Refusing to overwrite the source cache; pass --in-place or a new --output-dir."
        )

    paths = _select_paths(discover_metric_paths(input_dir), limit)
    if not paths:
        raise FileNotFoundError(f"No metric documents found under {input_dir}")

    if clc_encoding == CLC_ENCODING_CLASSIC_IDEAM:
        pin_groups = _group_packet_paths(paths, clc_encoding=clc_encoding)
        if planning_raster is not None and len(pin_groups) > 1:
            raise ValueError(
                "Multiple SIRAP grids in this input; pass --packet-clc-root "
                "instead of a single --planning-raster."
            )
    else:
        first_raw = json.loads(paths[0].read_text(encoding="utf-8"))
        if not isinstance(first_raw, dict):
            raise ValueError(f"{paths[0]} is not a JSON object.")
        pins = extract_source_pins(first_raw, clc_encoding=clc_encoding)
        for path in paths[1:]:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                raise ValueError(f"{path} is not a JSON object.")
            assert_source_pins_match(
                pins, extract_source_pins(raw, clc_encoding=clc_encoding)
            )
        pin_groups = {("national", "", "", pins.domain): (pins, paths)}

    written: list[str] = []
    skipped: list[str] = []
    updated: dict[str, Any] = {}
    unique_stems: list[str] = []
    scopes_computed = 0
    coberturas_sha256: str | None = None
    region_ids: list[str] = []

    for _group_key, (pins, group_input_paths) in pin_groups.items():
        assert_boundary_specs_unmoved(pins)
        if pins.region_id:
            region_ids.append(pins.region_id)
        layer_masks: dict[str, Any] | None = None
        boundary_masks: dict[ScopeKey, np.ndarray] | None = None
        if solutions_dir is not None:
            planning, layer_masks, _ = load_pinned_coberturas(
                pins,
                cache_dir,
                planning_raster_path=planning_raster,
            )
            features_by_level = load_pinned_boundaries(pins, cache_dir)
            boundary_masks = compute_boundary_masks(planning, features_by_level)
            values_by_scope = {
                scope_key: compute_land_use_of_aoi_percents(
                    planning.with_boundary_mask(boundary_mask),
                    layer_masks,
                )
                for scope_key, boundary_mask in boundary_masks.items()
            }
        elif compute_scope_values is not None:
            values_by_scope = compute_scope_values(pins, cache_dir, planning_raster)
        elif clc_encoding == CLC_ENCODING_CLASSIC_IDEAM:
            clc_path = resolve_packet_clc_path(
                pins,
                planning_raster=planning_raster,
                packet_clc_root=packet_clc_root,
            )
            planning, layer_masks = load_packet_clc(clc_path)
            features_by_level = load_pinned_boundaries(pins, cache_dir)
            needed = collect_needed_scopes(group_input_paths)
            values_by_scope = compute_values_for_document_scopes(
                planning,
                layer_masks,
                features_by_level,
                needed,
            )
            print(
                f"[land-use-of-aoi] classic-ideam region={pins.region_id} "
                f"scopes={len(values_by_scope)} solutions={len({solution_stem(p) for p in group_input_paths})}",
                flush=True,
            )
        else:
            values_by_scope = compute_scope_values_from_sources(
                pins, cache_dir, planning_raster
            )
        scopes_computed += len(values_by_scope)
        if pins.coberturas is not None:
            coberturas_sha256 = pins.coberturas.source_sha256

        grouped: dict[str, list[Path]] = defaultdict(list)
        for path in group_input_paths:
            grouped[solution_stem(path)].append(path)
        unique_solutions = list(grouped)
        unique_stems.extend(unique_solutions)
        for index, (stem, group_paths) in enumerate(grouped.items(), start=1):
            selected_values: dict[ScopeKey, dict[str, float | None]] | None = None
            if solutions_dir is not None:
                if layer_masks is None or boundary_masks is None:
                    raise RuntimeError(
                        "CLC inputs were not loaded for selected-percent recompute."
                    )
                sample, _ = load_metric_document(group_paths[0])
                solution_path = resolve_solution_raster_path(sample, solutions_dir)
                solution_raster = read_solution_raster(solution_path)
                selected_values = compute_selected_values_by_scope(
                    solution_raster,
                    layer_masks,
                    boundary_masks,
                )
                print(
                    f"[land-use-remap] {index}/{len(unique_solutions)} {stem}",
                    flush=True,
                )
            for path in group_paths:
                document, compact = load_metric_document(path)
                state = document_of_aoi_state(document)
                if state == "partial":
                    raise ValueError(f"{path} has a partial land_use_*_pct_of_aoi set.")
                updated = backfill_verbose_document(
                    document,
                    values_by_scope,
                    selected_values,
                )
                relative = path.relative_to(input_dir)
                destination = path if in_place else output_dir / relative
                if dry_run:
                    written.append(str(relative))
                    continue
                dump_metric_document(destination, updated, compact=compact)
                written.append(str(destination))

    report = {
        "inputDir": str(input_dir),
        "outputDir": str(output_dir),
        "dryRun": dry_run,
        "inPlace": in_place,
        "clcEncoding": clc_encoding,
        "regionIds": region_ids,
        "recomputedSelectedPct": solutions_dir is not None,
        "solutionsDir": str(solutions_dir) if solutions_dir is not None else None,
        "solutionFiles": len(paths),
        "uniqueSolutions": len(unique_stems),
        "scopesComputed": scopes_computed,
        "coberturasSha256": coberturas_sha256,
        "catalogSignature": (updated.get(PROVENANCE_KEY) or {}).get("catalogSignature"),
        "written": written,
        "alreadyPresent": skipped,
    }
    return report


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-dir",
        type=Path,
        required=True,
        help="Source verbose/compact cache directory (or a parent that contains both).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=(
            "New output directory (default: data/metrics/generated/land-use-of-aoi-backfill). "
            "Never overwrites --input-dir unless --in-place is set."
        ),
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=DEFAULT_CACHE_DIR,
        help=f"Local coberturas + boundary download cache (default: {DEFAULT_CACHE_DIR}).",
    )
    parser.add_argument(
        "--planning-raster",
        type=Path,
        default=None,
        help=(
            "Optional planning-grid raster whose valid cells are the national AOI. "
            "Defaults to coberturas valid cells."
        ),
    )
    parser.add_argument(
        "--in-place",
        action="store_true",
        help="Overwrite the source cache. Off by default.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate pins and compute (unless injected), but do not write files.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process only the first N unique solution ids (sorted).",
    )
    parser.add_argument(
        "--solutions-dir",
        type=Path,
        default=None,
        help=(
            "Directory of land solution GeoTIFFs named by solutionBasename. "
            "When set, both land-use charts are recomputed with the current "
            "coberturas class mapping. Refused for --clc-encoding classic-ideam."
        ),
    )
    parser.add_argument(
        "--clc-encoding",
        choices=VALID_CLC_ENCODINGS,
        default=CLC_ENCODING_NATIONAL_REMAPPED,
        help=(
            "CLC class-ID mapping. national-remapped is the current catalog "
            "(1=forest, 5=artificial). classic-ideam is SIRAP packet CLC "
            "(1=artificial, 3=forest) and must not be mixed with the national path."
        ),
    )
    parser.add_argument(
        "--packet-clc-root",
        type=Path,
        default=None,
        help=(
            "Root of regional runtime artifacts. classic-ideam looks up "
            "{region}/sources/packet-layers/ideam_clc_2022_level1_national.tif."
        ),
    )
    return parser.parse_args(argv)


def _resolve(repo_root: Path, path: Path) -> Path:
    return path if path.is_absolute() else repo_root / path


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    repo_root = find_repo_root()
    report = run_backfill(
        input_dir=_resolve(repo_root, args.input_dir),
        output_dir=_resolve(repo_root, args.output_dir),
        cache_dir=_resolve(repo_root, args.cache_dir),
        in_place=args.in_place,
        dry_run=args.dry_run,
        limit=args.limit,
        planning_raster=(
            _resolve(repo_root, args.planning_raster)
            if args.planning_raster is not None
            else None
        ),
        solutions_dir=(
            _resolve(repo_root, args.solutions_dir)
            if args.solutions_dir is not None
            else None
        ),
        clc_encoding=args.clc_encoding,
        packet_clc_root=(
            _resolve(repo_root, args.packet_clc_root)
            if args.packet_clc_root is not None
            else None
        ),
    )
    print("[land-use-of-aoi] " + json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
