"""Generate geography-partitioned compact MEC ecosystem coverage artifacts.

The output is intentionally separate from the general metric cache so the UI
can lazy-load only the selected geography level. Generation is resumable at
the solution/geography level and never uploads artifacts.

Examples (from the repository root):

    # Validate the default five-view composite ingestion outputs.
    python data/metrics/python/metrics_pipeline/mec_compact.py --validate-only

    # Generate one solution and one geography level from the composite source.
    python data/metrics/python/metrics_pipeline/mec_compact.py \
      --solution-id estr17_esp17_runap_com_res_iheh \
      --geography-level departments

    # Explicit two-view fallback while composite outputs are unavailable.
    python data/metrics/python/metrics_pipeline/mec_compact.py \
      --source-mode iavh --solution-id estr17_esp17_runap_com_res_iheh \
      --geography-level national
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import sys
import time
import traceback
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable
from urllib.parse import urlsplit, urlunsplit

import numpy as np
import rasterio

from blob_manifest import (
    DEFAULT_MANIFEST_URL,
    ManifestError,
    ResolvedManifest,
    fetch_manifest,
    solution_blob_basename,
)
from boundaries.boundary_loader import BoundaryFeature, load_all_boundaries
from boundaries.boundary_mask import BoundaryMaskCache
from cli_utils import find_repo_root, resolve_output_dir
from local_io import DEFAULT_CACHE_DIR, DownloadError, cached_download
from path_contracts import safe_solution_id
from raster_metrics import (
    RasterError,
    RasterFingerprint,
    SolutionRaster,
    read_layer_values,
    read_solution_raster,
)
from raster_align import NEAREST_CATEGORICAL, AlignmentResult, RasterAlignmentCache
from release_config import load_release_config
from release_selection import (
    ReleaseSelection,
    ReleaseSelectionError,
    full_release_selection,
    load_release_partition,
    reconcile_release_reports,
    validate_release_entries,
)
from solution_catalog import (
    SolutionCatalog,
    SolutionCatalogError,
    bind_release_output,
    catalog_binding,
    load_release_plan,
    load_solution_catalog,
    release_plan_cache_policy,
    validate_catalog_solution_ids,
)

LEGACY_MEC_COMPACT_FORMAT = "mec-compact-v1"
MEC_COMPACT_FORMAT = "mec-compact-v2"
MEC_COMPACT_SUFFIX = ".mec.compact.json"
MEC_SIGNATURE_FORMAT = "mec-generation-signature-v3"
MEC_GENERATOR_CONFIG_VERSION = "mec-generator-config-v6"
DEFAULT_OUTPUT_DIR = Path("data/metrics/generated/mec")
DEFAULT_BLOB_DIRECTORY = "metrics/mec-cache"
SOURCE_MODE_COMPOSITE = "composite"
SOURCE_MODE_IAVH = "iavh"
SOURCE_MODES = (SOURCE_MODE_COMPOSITE, SOURCE_MODE_IAVH)
_PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
DEFAULT_CLASSIFICATION_SUMMARY = (
    f"{_PUBLIC_BLOB_HOST}/inputs/features/ecosystems/"
    "ecosystem-classification-summary.json"
)
DEFAULT_MEC_RASTER_URL = (
    f"{_PUBLIC_BLOB_HOST}/inputs/features/ecosystems/"
    "ecosistemas_IAVH_2024.tif"
)
DEFAULT_IAVH_CROSSWALK_URL = (
    f"{_PUBLIC_BLOB_HOST}/inputs/features/ecosystems/"
    "ecosistemas_IDs_IAVH_2024.csv"
)
DEFAULT_COMPOSITE_RASTER_URL = (
    f"{_PUBLIC_BLOB_HOST}/inputs/features/ecosystems/"
    "ecosistemas_IDEAM_MEC_2024.tif"
)
DEFAULT_COMPOSITE_CROSSWALK_URL = (
    f"{_PUBLIC_BLOB_HOST}/inputs/features/ecosystems/"
    "ecosistemas_IDs_IDEAM_MEC_2024.csv"
)
DEFAULT_COMPOSITE_PROVENANCE_URL = (
    f"{_PUBLIC_BLOB_HOST}/inputs/features/ecosystems/"
    "ecosistemas_IDEAM_MEC_2024.provenance.json"
)
MEC_RASTER_SOURCE_ID = "ecosistemas_IAVH_2024"
MEC_CROSSWALK_SOURCE_ID = "ecosistemas_IDs_IAVH_2024"
MEC_RASTER_NODATA = 4_294_967_295
IAVH_BIOME_ID_MIN = 1
IAVH_BIOME_ID_MAX = 430
GEOGRAPHY_LEVELS = (
    "national",
    "departments",
    "municipalities",
    "siraps",
    "runaps",
    "omecs",
)
AREA_DECIMALS = 6

BIOME_FAMILY_PREFIXES = (
    "Orobioma",
    "Zonobioma",
    "Hidrobioma",
    "Helobioma",
    "Peinobioma",
    "Litobioma",
    "Halobioma",
)
OTHER_BIOME_FAMILY = "Other/N.A."
UI_VIEW_IDS = (
    "biomeFamily",
    "broadBiomeContext",
    "biomeRegion",
    "broadEcosystem",
    "detailedEcosystem",
)
COMPOSITE_VIEW_LABELS = {
    "biomeFamily": "Biome Family",
    "broadBiomeContext": "Broad Biome Context",
    "biomeRegion": "IAvH Biome-Region Class",
    "broadEcosystem": "Broad Ecosystem",
    "detailedEcosystem": "Detailed Ecosystem",
}
COMPOSITE_LABEL_ALIASES = {
    (
        "biomeRegion",
        "Zonobioma Alternohigrico Tropical  Cordillera Oriental Magdalena Medio",
    ): "Zonobioma Alternohigrico Tropical Cordillera Oriental Magdalena Medio",
    (
        "broadEcosystem",
        "Vegetacion Secundaria",
    ): "Vegetación Secundaria",
}
COMPOSITE_CROSSWALK_COLUMNS = (
    "rasterValue",
    "tipoEcosistema",
    *UI_VIEW_IDS,
)
COMPOSITE_PROVENANCE_FORMAT = "mec-2024-provenance-v1"
COMPOSITE_TUPLE_FIELDS = (
    "tipo_ecos",
    "gran_bioma",
    "bioma_iavh",
    "ecos_sintesis",
    "ecos_general",
)
COMPOSITE_SUPPORTED_VIEW_METADATA = [
    {
        "view": view_id,
        "mapping": "authoritative-composite-crosswalk",
        "rule": f"Exact {view_id} label from ecosistemas_IDs_IDEAM_MEC_2024.csv.",
    }
    for view_id in UI_VIEW_IDS
]
IAVH_SUPPORTED_VIEW_METADATA = [
    {
        "view": "biomeFamily",
        "mapping": "derived",
        "rule": (
            "First matching established biome-label prefix; trimmed exact "
            f"'N.A.' maps to {OTHER_BIOME_FAMILY}; all other prefixes fail."
        ),
    },
    {
        "view": "biomeRegion",
        "mapping": "authoritative",
        "rule": "biome_id → biome from ecosistemas_IDs_IAVH_2024.csv.",
    },
]
IAVH_UNSUPPORTED_VIEW_METADATA = [
    {
        "view": "broadBiomeContext",
        "reason": "Cannot be defensibly derived from IAvH biome_id.",
    },
    {
        "view": "broadEcosystem",
        "reason": "Cannot be defensibly derived from IAvH biome_id.",
    },
    {
        "view": "detailedEcosystem",
        "reason": "Cannot be defensibly derived from IAvH biome_id.",
    },
]

ROW_LAYOUT = [
    "scopeIndex",
    "classIndex",
    "ecosystemAreaKm2",
    "preExistingCoverageKm2",
    "newPrioritizrCoverageKm2",
]
SCOPE_STATS_FIELDS = (
    "scopeAreaKm2",
    "classifiedKm2",
    "unclassifiedKm2",
    "boundaryProvenanceRef",
)
RASTERIZATION_SEMANTICS = {
    "referenceGrid": "MEC raster grid",
    "boundaryInclusion": "pixel-center",
    "allTouched": False,
    "maskMeaning": "True when the reference-grid pixel center is inside the boundary",
}
SEMANTICS = {
    "ecosystemAreaKm2": (
        "Area of the MEC class inside the scope, independent of solution nodata "
        "and selection."
    ),
    "preExistingCoverageKm2": (
        "MEC class area intersecting solution raster value 2 (pre-existing/"
        "locked-in coverage)."
    ),
    "newPrioritizrCoverageKm2": (
        "MEC class area intersecting solution raster value 1 (new Prioritizr "
        "coverage)."
    ),
    "derivedValues": (
        "totalCoveredKm2 is the sum of the two coverage components. Coverage "
        "percent is totalCoveredKm2 / ecosystemAreaKm2 × 100. Ecosystem share "
        "of an AOI is ecosystemAreaKm2 / scopeAreaKm2 × 100."
    ),
    "scopeStats": (
        "scopeAreaKm2 includes every reference-grid cell whose center is inside "
        "the scope. classifiedKm2 includes only finite MEC cells; "
        "unclassifiedKm2 is their nonnegative difference."
    ),
    "nationalBenchmark": (
        "National rows derive targetAreaKm2 = ecosystemAreaKm2 × "
        "targetPercent / 100, met from totalCoveredKm2 >= targetAreaKm2, and "
        "shortfallKm2 = max(targetAreaKm2 - totalCoveredKm2, 0). A zero-area "
        "class has null coverage percent, not-applicable status, and zero "
        "shortfall. These are national coverage benchmarks, not evidence that "
        "the class was a solver constraint."
    ),
    "invariants": (
        "Pre-existing and new Prioritizr masks are disjoint; their union is "
        "selected coverage. Components are nonnegative and their sum cannot "
        "exceed ecosystemAreaKm2."
    ),
}


class MecTaxonomyError(ValueError):
    """Raised when the classification summary cannot map labels to raster values."""


@dataclass(frozen=True)
class MecView:
    view_id: str
    label: str


@dataclass(frozen=True)
class MecClass:
    view_index: int
    class_id: str
    label: str
    raster_values: tuple[int, ...]


@dataclass(frozen=True)
class CompositeCrosswalkRow:
    raster_value: int
    tipo_ecosistema: str
    labels: tuple[str, str, str, str, str]


@dataclass(frozen=True)
class MecTaxonomy:
    source_version: str | None
    views: tuple[MecView, ...]
    classes: tuple[MecClass, ...]
    source_mode: str = SOURCE_MODE_IAVH
    tipo_ecosistema_catalog: tuple[str, ...] = ()
    source_tuple_catalog: tuple[tuple[Any, ...], ...] = ()

    @property
    def view_catalog(self) -> list[list[Any]]:
        return [[view.view_id, view.label] for view in self.views]

    @property
    def class_catalog(self) -> list[list[Any]]:
        return [
            [item.view_index, item.class_id, item.label]
            for item in self.classes
        ]

    def class_indexes_by_raster_value(self) -> dict[int, list[int]]:
        result: dict[int, list[int]] = {}
        for class_index, item in enumerate(self.classes):
            for raster_value in item.raster_values:
                result.setdefault(raster_value, []).append(class_index)
        return result

    @property
    def raster_values(self) -> set[int]:
        return {
            raster_value
            for item in self.classes
            for raster_value in item.raster_values
        }


@dataclass(frozen=True)
class MecSourceMetadata:
    mec_raster: str
    crosswalk: str
    provenance: str | None
    classification_summary: str | None


def resolve_source_metadata(
    source_mode: str,
    *,
    mec_raster: str | None = None,
    crosswalk: str | None = None,
    provenance: str | None = None,
    classification_summary: str | None = None,
) -> MecSourceMetadata:
    """Resolve public defaults while preserving explicit offline file sources."""

    if source_mode == SOURCE_MODE_COMPOSITE:
        return MecSourceMetadata(
            mec_raster=mec_raster or DEFAULT_COMPOSITE_RASTER_URL,
            crosswalk=crosswalk or DEFAULT_COMPOSITE_CROSSWALK_URL,
            provenance=provenance or DEFAULT_COMPOSITE_PROVENANCE_URL,
            classification_summary=None,
        )
    if source_mode == SOURCE_MODE_IAVH:
        return MecSourceMetadata(
            mec_raster=mec_raster or DEFAULT_MEC_RASTER_URL,
            crosswalk=crosswalk or DEFAULT_IAVH_CROSSWALK_URL,
            provenance=None,
            classification_summary=classification_summary or None,
        )
    raise MecTaxonomyError(f"Unsupported MEC source mode {source_mode!r}.")


def view_support_for_mode(source_mode: str) -> dict[str, list[dict[str, str]]]:
    if source_mode == SOURCE_MODE_COMPOSITE:
        return {
            "supported": COMPOSITE_SUPPORTED_VIEW_METADATA,
            "unsupported": [],
        }
    if source_mode == SOURCE_MODE_IAVH:
        return {
            "supported": IAVH_SUPPORTED_VIEW_METADATA,
            "unsupported": IAVH_UNSUPPORTED_VIEW_METADATA,
        }
    raise MecTaxonomyError(f"Unsupported MEC source mode {source_mode!r}.")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _portable_source_reference(source: str | None) -> str | None:
    """Keep public URLs/relative paths without secrets or absolute local paths."""

    if source is None:
        return None
    if source.startswith(("https://", "http://")):
        parsed = urlsplit(source)
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
    path = Path(source).expanduser()
    return path.name if path.is_absolute() else path.as_posix()


def _portable_metadata(value: Any) -> Any:
    """Recursively remove absolute local paths from emitted provenance."""

    if isinstance(value, dict):
        return {
            str(key): _portable_metadata(item)
            for key, item in value.items()
            if not any(
                secret in str(key).casefold()
                for secret in ("token", "password", "secret", "credential")
            )
        }
    if isinstance(value, (list, tuple)):
        return [_portable_metadata(item) for item in value]
    if isinstance(value, str):
        return _portable_source_reference(value)
    return value


def _grid_payload(fingerprint: RasterFingerprint) -> dict[str, Any]:
    payload = {
        "crs": fingerprint.crs,
        "transform": list(fingerprint.transform),
        "width": fingerprint.width,
        "height": fingerprint.height,
    }
    return {**payload, "fingerprintSha256": _canonical_sha256(payload)}


def resolve_national_target(solution: dict[str, Any]) -> dict[str, Any]:
    """Return the authoritative 17/30 national benchmark from finder metadata."""

    finder_inputs = solution.get("finderInputs")
    if not isinstance(finder_inputs, dict):
        raise ManifestError(
            f"Solution {solution.get('id')!r} has no finderInputs target metadata."
        )
    if solution.get("scope") == "sirap":
        structured = finder_inputs.get("structuredTargets")
        if not isinstance(structured, dict):
            raise ManifestError(
                f"SIRAP solution {solution.get('id')!r} lacks structured target metadata."
            )
        return {
            "applicability": "not-applicable-regional-post-hoc",
            "targetPercent": None,
            "source": "solution.finderInputs.structuredTargets",
            "statusStorage": "not-evaluated",
            "interpretation": (
                "MEC ecosystem coverage is an additional regional outcome, "
                "not SIRAP solver-target attainment."
            ),
            "solverTargetFeatureSet": finder_inputs.get("targetFeatureSet"),
            "solverTargetFeatureIds": list(
                finder_inputs.get("targetFeatureIds") or []
            ),
        }
    raw_target = finder_inputs.get("targetPercent")
    if isinstance(raw_target, bool):
        raw_target = None
    try:
        target_percent = float(raw_target)
    except (TypeError, ValueError) as exc:
        raise ManifestError(
            f"Solution {solution.get('id')!r} has invalid finderInputs.targetPercent "
            f"{raw_target!r}; expected 17 or 30."
        ) from exc
    if target_percent not in (17.0, 30.0):
        raise ManifestError(
            f"Solution {solution.get('id')!r} has unsupported national target "
            f"{target_percent:g}; expected 17 or 30."
        )
    return {
        "applicability": "national-only",
        "targetPercent": int(target_percent),
        "source": "solution.finderInputs.targetPercent",
        "statusStorage": "derived-from-row-areas",
        "zeroAreaStatus": "not-applicable",
        "interpretation": "national-coverage-benchmark-not-solver-constraint-attainment",
        "derivedFields": {
            "totalCoveredKm2": (
                "preExistingCoverageKm2 + newPrioritizrCoverageKm2"
            ),
            "coveragePercent": (
                "totalCoveredKm2 / ecosystemAreaKm2 * 100; null when "
                "ecosystemAreaKm2 is zero"
            ),
            "benchmarkMet": (
                "coveragePercent >= targetPercent; not-applicable when "
                "ecosystemAreaKm2 is zero"
            ),
            "benchmarkShortfallKm2": (
                "max(ecosystemAreaKm2 * targetPercent / 100 - "
                "totalCoveredKm2, 0)"
            ),
        },
        "solverTargetFeatureSet": finder_inputs.get("targetFeatureSet"),
        "solverTargetFeatureIds": list(finder_inputs.get("targetFeatureIds") or []),
    }


def _boundary_features(collection: Any) -> list[BoundaryFeature]:
    if isinstance(collection, list):
        return collection
    features = getattr(collection, "features", None)
    if isinstance(features, (list, tuple)):
        return list(features)
    raise TypeError("Boundary collection must be a feature list or expose .features.")


def _boundary_collection_metadata(level: str, collection: Any) -> dict[str, Any]:
    """Use collection provenance when supplied, with a deterministic fallback."""

    supplied: Any = None
    for attribute in (
        "provenance",
        "source_provenance",
        "source_metadata",
        "metadata",
    ):
        candidate = getattr(collection, attribute, None)
        if candidate is not None:
            supplied = candidate
            break
    features = _boundary_features(collection)
    feature_metadata = (
        getattr(features[0], "source_metadata", None)
        if features
        else None
    )
    if feature_metadata is not None:
        supplied = {
            "url": _portable_source_reference(feature_metadata.url),
            "crs": feature_metadata.crs,
            "featureCount": feature_metadata.feature_count,
            "idField": feature_metadata.id_field,
            "nameField": feature_metadata.name_field,
            "featureBehavior": feature_metadata.feature_behavior,
        }
    fingerprint = None
    for attribute in ("source_fingerprint", "fingerprint", "fingerprint_sha256"):
        candidate = getattr(collection, attribute, None)
        if candidate:
            fingerprint = str(candidate)
            break
    if fingerprint is None and features:
        feature_fingerprint = getattr(features[0], "source_sha256", None)
        if feature_fingerprint:
            fingerprint = str(feature_fingerprint)
    if fingerprint is None:
        fingerprint = _canonical_sha256(
            [
                [
                    feature.boundary_id,
                    feature.source_crs,
                    feature.geometry,
                ]
                for feature in features
            ]
        )
    result = {
        "level": level,
        "featureCount": len(features),
        "sourceFingerprint": fingerprint,
        "source": _portable_metadata(supplied),
    }
    if feature_metadata is not None:
        result.update(
            {
                "sourceSha256": feature_metadata.sha256,
                "catalogSha256": feature_metadata.catalog_sha256,
                "geometryCollectionSha256": (
                    feature_metadata.geometry_collection_sha256
                ),
            }
        )
    return result


def boundary_provenance_by_level(
    boundaries_by_level: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    return {
        level: _boundary_collection_metadata(level, collection)
        for level, collection in sorted(boundaries_by_level.items())
    }


def build_generation_signature(
    *,
    taxonomy: MecTaxonomy,
    crosswalk_content: str,
    crosswalk_source: str,
    classification_summary: dict[str, Any] | None,
    classification_summary_source: str | None,
    provenance_source: str | None,
    provenance_sha256: str | None,
    manifest_url: str,
    mec_raster_url: str,
    mec_raster_sha256: str,
    solution_url: str,
    solution_raster_sha256: str,
    solution_grid: RasterFingerprint,
    boundary_provenance: dict[str, dict[str, Any]],
    national_target: dict[str, Any],
    aligned_mec_identity: dict[str, str],
    geography_level: str = "departments",
) -> dict[str, str]:
    """Return a deterministic signature for every input affecting an artifact."""

    _validate_geography_level(geography_level)
    boundary_level = "departments" if geography_level == "national" else geography_level
    relevant_boundary_provenance = {
        boundary_level: boundary_provenance[boundary_level]
    }
    payload = {
        "signatureFormat": MEC_SIGNATURE_FORMAT,
        "generatorConfigVersion": MEC_GENERATOR_CONFIG_VERSION,
        "artifactFormat": MEC_COMPACT_FORMAT,
        "config": {
            "areaDecimals": AREA_DECIMALS,
            "rowLayout": ROW_LAYOUT,
            "scopeStatsFields": SCOPE_STATS_FIELDS,
            "semantics": SEMANTICS,
            "rasterization": RASTERIZATION_SEMANTICS,
            "viewSupport": view_support_for_mode(taxonomy.source_mode),
        },
        "taxonomy": {
            "sourceMode": taxonomy.source_mode,
            "sourceVersion": taxonomy.source_version,
            "views": taxonomy.view_catalog,
            "classes": [
                [
                    item.view_index,
                    item.class_id,
                    item.label,
                    list(item.raster_values),
                ]
                for item in taxonomy.classes
            ],
            "tipoEcosistemaCatalog": taxonomy.tipo_ecosistema_catalog,
            "sourceTupleCatalog": taxonomy.source_tuple_catalog,
        },
        "sources": {
            "classificationSummary": classification_summary_source,
            "classificationSummarySha256": (
                _canonical_sha256(classification_summary)
                if classification_summary is not None
                else None
            ),
            "crosswalk": crosswalk_source,
            "crosswalkSha256": hashlib.sha256(
                crosswalk_content.encode("utf-8")
            ).hexdigest(),
            "provenance": provenance_source,
            "provenanceSha256": provenance_sha256,
            "manifest": manifest_url,
            "mecRasterUrl": mec_raster_url,
            "mecRasterSha256": mec_raster_sha256,
            "alignedMec": aligned_mec_identity,
            "solutionUrl": solution_url,
            "solutionRasterSha256": solution_raster_sha256,
        },
        "solutionGrid": _grid_payload(solution_grid),
        "boundaryProvenance": relevant_boundary_provenance,
        "nationalTarget": national_target,
    }
    return {
        "format": MEC_SIGNATURE_FORMAT,
        "sha256": _canonical_sha256(payload),
    }


def _slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return normalized or "class"


def biome_family_for_label(label: str) -> str:
    """Apply the canonical biome-region → family rule used by MEC consumers."""

    if label.strip() == "N.A.":
        return OTHER_BIOME_FAMILY
    for family in BIOME_FAMILY_PREFIXES:
        if label.startswith(family):
            return family
    raise MecTaxonomyError(
        f"Unknown biome-family prefix in biomeRegion label {label!r}; expected "
        f"one of {BIOME_FAMILY_PREFIXES} or trimmed exact 'N.A.'."
    )


def load_iavh_crosswalk(content: str) -> dict[int, str]:
    """Parse the authoritative biome_id → biome CSV and require all 430 IDs."""

    if not content.strip():
        raise MecTaxonomyError(
            "Authoritative IAvH biome crosswalk is empty; class order cannot be inferred."
        )
    reader = csv.DictReader(io.StringIO(content))
    fields = set(reader.fieldnames or [])
    required = {"biome_id", "biome"}
    if not required.issubset(fields):
        raise MecTaxonomyError(
            f"IAvH crosswalk must contain columns {sorted(required)}; got {sorted(fields)}."
        )

    mapping: dict[int, str] = {}
    for row_number, row in enumerate(reader, start=2):
        raw_id = str(row.get("biome_id") or "").strip()
        label = str(row.get("biome") or "").strip()
        try:
            biome_id = int(raw_id)
        except ValueError as exc:
            raise MecTaxonomyError(
                f"IAvH crosswalk row {row_number} has invalid biome_id {raw_id!r}."
            ) from exc
        if biome_id in mapping:
            raise MecTaxonomyError(
                f"IAvH crosswalk repeats biome_id {biome_id}."
            )
        if not label:
            raise MecTaxonomyError(
                f"IAvH crosswalk row {row_number} has an empty biome label."
            )
        mapping[biome_id] = label

    expected = set(range(IAVH_BIOME_ID_MIN, IAVH_BIOME_ID_MAX + 1))
    observed = set(mapping)
    if observed != expected:
        missing = sorted(expected - observed)
        unexpected = sorted(observed - expected)
        raise MecTaxonomyError(
            "Authoritative IAvH crosswalk must map every biome_id 1–430; "
            f"missing={missing[:12]}, unexpected={unexpected[:12]}."
        )
    return mapping


def _summary_biome_region_labels(summary: dict[str, Any]) -> list[str]:
    sections = summary.get("classifications")
    if not isinstance(sections, list):
        raise MecTaxonomyError(
            "Classification summary must contain a 'classifications' list."
        )
    section = next(
        (
            item
            for item in sections
            if isinstance(item, dict) and item.get("view") == "biomeRegion"
        ),
        None,
    )
    if section is None or not isinstance(section.get("values"), list):
        raise MecTaxonomyError(
            "Classification summary has no valid biomeRegion values."
        )
    labels = [
        str(item.get("label") or "").strip()
        for item in section["values"]
        if isinstance(item, dict)
    ]
    if not labels or any(not label for label in labels):
        raise MecTaxonomyError(
            "Classification summary biomeRegion contains invalid labels."
        )
    return labels


def build_mec_taxonomy(
    crosswalk: dict[int, str],
    *,
    summary: dict[str, Any] | None = None,
) -> MecTaxonomy:
    """Build only the two views safely supported by authoritative biome IDs."""

    if not crosswalk:
        raise MecTaxonomyError(
            "Authoritative IAvH biome crosswalk is required; summary row order "
            "must never be used as a raster mapping."
        )
    if summary is not None:
        summary_labels = _summary_biome_region_labels(summary)
        if Counter(summary_labels) != Counter(crosswalk.values()):
            missing = sorted(
                (Counter(crosswalk.values()) - Counter(summary_labels)).elements()
            )
            extra = sorted(
                (Counter(summary_labels) - Counter(crosswalk.values())).elements()
            )
            raise MecTaxonomyError(
                "IAvH crosswalk labels do not match classification summary "
                f"biomeRegion labels; missing={missing[:8]}, extra={extra[:8]}."
            )

    family_values: dict[str, list[int]] = {
        family: [] for family in (*BIOME_FAMILY_PREFIXES, OTHER_BIOME_FAMILY)
    }
    for biome_id, label in sorted(crosswalk.items()):
        family_values[biome_family_for_label(label)].append(biome_id)

    classes = [
        MecClass(
            view_index=0,
            class_id=f"biomeFamily:{_slug(family)}",
            label=family,
            raster_values=tuple(family_values[family]),
        )
        for family in (*BIOME_FAMILY_PREFIXES, OTHER_BIOME_FAMILY)
    ]
    classes.extend(
        MecClass(
            view_index=1,
            class_id=f"biomeRegion:{biome_id}",
            label=label,
            raster_values=(biome_id,),
        )
        for biome_id, label in sorted(crosswalk.items())
    )
    return MecTaxonomy(
        source_version="iavh-biome-id-crosswalk-v1",
        views=(
            MecView(view_id="biomeFamily", label="Biome Family"),
            MecView(
                view_id="biomeRegion",
                label="IAvH Biome-Region Class",
            ),
        ),
        classes=tuple(classes),
    )


def load_composite_crosswalk(content: str) -> tuple[CompositeCrosswalkRow, ...]:
    """Parse the exact crosswalk emitted by data/scripts/mec-2024."""

    if not content.strip():
        raise MecTaxonomyError("Official MEC composite crosswalk is empty.")
    reader = csv.DictReader(io.StringIO(content))
    missing = set(COMPOSITE_CROSSWALK_COLUMNS) - set(reader.fieldnames or ())
    if missing:
        raise MecTaxonomyError(
            f"Official MEC composite crosswalk is missing columns: {sorted(missing)}."
        )

    rows: list[CompositeCrosswalkRow] = []
    seen_ids: set[int] = set()
    seen_tuples: set[tuple[str, ...]] = set()
    for row_number, raw in enumerate(reader, start=2):
        try:
            raster_value = int(str(raw["rasterValue"]).strip())
        except (TypeError, ValueError) as exc:
            raise MecTaxonomyError(
                f"Composite crosswalk row {row_number} has invalid rasterValue."
            ) from exc
        if not 1 <= raster_value <= np.iinfo(np.uint16).max:
            raise MecTaxonomyError(
                f"Composite crosswalk rasterValue {raster_value} must fit UInt16 "
                "and exclude nodata 0."
            )
        raw_labels = tuple(str(raw[view_id]) for view_id in UI_VIEW_IDS)
        labels = tuple(
            COMPOSITE_LABEL_ALIASES.get(
                (view_id, raw_label),
                raw_label,
            )
            for view_id, raw_label in zip(UI_VIEW_IDS, raw_labels, strict=True)
        )
        tipo_ecosistema = raw["tipoEcosistema"]
        all_labels = (tipo_ecosistema, *labels)
        if any(not isinstance(label, str) or label == "" for label in all_labels):
            raise MecTaxonomyError(
                f"Composite crosswalk row {row_number} has an empty required label."
            )
        expected_family = biome_family_for_label(labels[2])
        if labels[0] != expected_family:
            raise MecTaxonomyError(
                f"Composite crosswalk row {row_number} has biomeFamily "
                f"{labels[0]!r} inconsistent with biomeRegion {labels[2]!r}; "
                f"expected canonical {expected_family!r}."
            )
        source_category_tuple = (str(tipo_ecosistema), *raw_labels)
        if raster_value in seen_ids:
            raise MecTaxonomyError(
                f"Composite crosswalk repeats rasterValue {raster_value}."
            )
        if source_category_tuple in seen_tuples:
            raise MecTaxonomyError(
                f"Composite crosswalk repeats a category tuple at row {row_number}."
            )
        seen_ids.add(raster_value)
        seen_tuples.add(source_category_tuple)
        rows.append(
            CompositeCrosswalkRow(
                raster_value=raster_value,
                tipo_ecosistema=tipo_ecosistema,
                labels=labels,  # type: ignore[arg-type]
            )
        )
    if not rows:
        raise MecTaxonomyError("Official MEC composite crosswalk has no rows.")
    return tuple(sorted(rows, key=lambda row: row.raster_value))


def build_composite_taxonomy(
    rows: tuple[CompositeCrosswalkRow, ...],
) -> MecTaxonomy:
    """Build all five UI views from exact composite crosswalk labels."""

    views = tuple(
        MecView(view_id=view_id, label=COMPOSITE_VIEW_LABELS[view_id])
        for view_id in UI_VIEW_IDS
    )
    classes: list[MecClass] = []
    class_index_by_view_label: dict[tuple[int, str], int] = {}
    for view_index, _ in enumerate(UI_VIEW_IDS):
        values_by_label: dict[str, list[int]] = {}
        for row in rows:
            values_by_label.setdefault(row.labels[view_index], []).append(
                row.raster_value
            )
        seen_class_ids: set[str] = set()
        for label, raster_values in values_by_label.items():
            class_id = f"{UI_VIEW_IDS[view_index]}:{_slug(label)}"
            if class_id in seen_class_ids:
                digest = hashlib.sha256(label.encode("utf-8")).hexdigest()[:10]
                class_id = f"{class_id}-{digest}"
            seen_class_ids.add(class_id)
            class_index = len(classes)
            classes.append(
                MecClass(
                    view_index=view_index,
                    class_id=class_id,
                    label=label,
                    raster_values=tuple(raster_values),
                )
            )
            class_index_by_view_label[(view_index, label)] = class_index

    tipo_catalog = tuple(
        dict.fromkeys(row.tipo_ecosistema for row in rows)
    )
    tipo_index = {
        label: index for index, label in enumerate(tipo_catalog)
    }
    source_tuple_catalog = tuple(
        (
            row.raster_value,
            tipo_index[row.tipo_ecosistema],
            *(
                class_index_by_view_label[(view_index, row.labels[view_index])]
                for view_index in range(len(UI_VIEW_IDS))
            ),
        )
        for row in rows
    )
    return MecTaxonomy(
        source_version="ideam-mec-composite-crosswalk-v1",
        views=views,
        classes=tuple(classes),
        source_mode=SOURCE_MODE_COMPOSITE,
        tipo_ecosistema_catalog=tipo_catalog,
        source_tuple_catalog=source_tuple_catalog,
    )


def validate_composite_provenance(
    provenance: dict[str, Any],
    *,
    raster_sha256: str,
    crosswalk_sha256: str,
    crosswalk_row_count: int,
) -> None:
    """Verify the ingestion provenance contract and output checksums."""

    if provenance.get("format") != COMPOSITE_PROVENANCE_FORMAT:
        raise MecTaxonomyError(
            f"Composite provenance format must be {COMPOSITE_PROVENANCE_FORMAT!r}."
        )
    catalog = provenance.get("catalog")
    outputs = provenance.get("outputs")
    rasterization = provenance.get("rasterization")
    source = provenance.get("source")
    grid = provenance.get("grid")
    if not isinstance(provenance.get("generatedAt"), str):
        raise MecTaxonomyError(
            "Composite provenance must include generatedAt."
        )
    if not isinstance(source, dict) or source.get("publisher") != "IDEAM":
        raise MecTaxonomyError(
            "Composite provenance must identify IDEAM as the source publisher."
        )
    if not isinstance(catalog, dict) or not isinstance(outputs, dict):
        raise MecTaxonomyError(
            "Composite provenance must contain catalog and outputs objects."
        )
    if catalog.get("rowCount") != crosswalk_row_count:
        raise MecTaxonomyError(
            "Composite provenance catalog rowCount does not match the crosswalk."
        )
    if catalog.get("crosswalkSha256") != crosswalk_sha256:
        raise MecTaxonomyError(
            "Composite provenance catalog crosswalkSha256 does not match."
        )
    if not isinstance(catalog.get("crosswalkSignature"), str):
        raise MecTaxonomyError(
            "Composite provenance catalog crosswalkSignature is missing."
        )
    if tuple(catalog.get("tupleFields") or ()) != COMPOSITE_TUPLE_FIELDS:
        raise MecTaxonomyError(
            "Composite provenance catalog tupleFields do not match ingestion schema."
        )
    if not isinstance(rasterization, dict) or (
        rasterization.get("dtype") != "uint16"
        or rasterization.get("nodata") != 0
    ):
        raise MecTaxonomyError(
            "Composite provenance rasterization must declare UInt16/nodata 0."
        )
    if not isinstance(grid, dict) or not isinstance(
        grid.get("fingerprintSha256"), str
    ):
        raise MecTaxonomyError(
            "Composite provenance grid fingerprint is missing."
        )
    for output_name, expected_sha in (
        ("compositeRaster", raster_sha256),
        ("crosswalk", crosswalk_sha256),
    ):
        output = outputs.get(output_name)
        if not isinstance(output, dict) or output.get("sha256") != expected_sha:
            raise MecTaxonomyError(
                f"Composite provenance output checksum for {output_name} does not match."
            )


def validate_observed_raster_values(
    values: np.ndarray,
    mapped_values: Iterable[int],
    *,
    source_mode: str = SOURCE_MODE_IAVH,
) -> set[int]:
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        raise MecTaxonomyError("IAvH MEC raster contains no finite biome IDs.")
    if not np.all(np.equal(finite, np.floor(finite))):
        sample = finite[np.not_equal(finite, np.floor(finite))][:5].tolist()
        raise MecTaxonomyError(
            f"IAvH MEC raster contains non-integer biome IDs: {sample}"
        )

    observed = {int(value) for value in np.unique(finite)}
    maximum = (
        np.iinfo(np.uint16).max
        if source_mode == SOURCE_MODE_COMPOSITE
        else IAVH_BIOME_ID_MAX
    )
    outside_range = {
        value
        for value in observed
        if not 1 <= value <= maximum
    }
    if outside_range:
        raise MecTaxonomyError(
            f"MEC raster contains class IDs outside 1–{maximum}: "
            f"{sorted(outside_range)[:12]}."
        )
    unknown = observed - set(mapped_values)
    if unknown:
        raise MecTaxonomyError(
            f"MEC raster contains class IDs absent from the authoritative "
            f"crosswalk: {sorted(unknown)[:12]}."
        )
    return observed


def validate_taxonomy_partition(
    taxonomy: MecTaxonomy,
    observed_values: Iterable[int] | None = None,
) -> None:
    """Require every MEC value to map to exactly one class in every view."""

    expected_values = (
        taxonomy.raster_values
        if observed_values is None
        else set(observed_values)
    )
    counts: dict[tuple[int, int], int] = {
        (view_index, raster_value): 0
        for view_index in range(len(taxonomy.views))
        for raster_value in expected_values
    }
    for item in taxonomy.classes:
        for raster_value in item.raster_values:
            key = (item.view_index, raster_value)
            if key in counts:
                counts[key] += 1
    invalid = [
        (taxonomy.views[view_index].view_id, raster_value, count)
        for (view_index, raster_value), count in counts.items()
        if count != 1
    ]
    if invalid:
        raise MecTaxonomyError(
            "Every finite MEC pixel must map to exactly one class per view; "
            f"invalid mappings={invalid[:12]}."
        )


def validate_mec_raster_source(source: str) -> None:
    """Reject the known species-richness raster if configured as MEC."""

    leaf = source.split("?", 1)[0].rstrip("/").rsplit("/", 1)[-1]
    if leaf.casefold() == "ecosistemas.tif":
        raise MecTaxonomyError(
            "inputs/features/ecosystems/ecosistemas.tif is a continuous "
            "species-richness surface, not categorical MEC data. Configure "
            "ecosistemas_IAVH_2024.tif instead."
        )


def read_mec_raster_values(
    path: Path,
    expected: RasterFingerprint,
    taxonomy: MecTaxonomy,
) -> tuple[np.ndarray, set[int]]:
    """Read and validate the configured authoritative MEC raster."""

    with rasterio.open(path) as dataset:
        dtype = np.dtype(dataset.dtypes[0])
        expected_dtype = (
            np.dtype(np.uint16)
            if taxonomy.source_mode == SOURCE_MODE_COMPOSITE
            else np.dtype(np.uint32)
        )
        expected_nodata = (
            0
            if taxonomy.source_mode == SOURCE_MODE_COMPOSITE
            else MEC_RASTER_NODATA
        )
        if dtype != expected_dtype:
            raise RasterError(
                f"{taxonomy.source_mode} MEC raster {path} must use "
                f"{expected_dtype.name}; got {dtype}."
            )
        if dataset.nodata is None or int(dataset.nodata) != expected_nodata:
            raise RasterError(
                f"{taxonomy.source_mode} MEC raster {path} must declare "
                f"nodata={expected_nodata}; "
                f"got {dataset.nodata!r}."
            )
    values = read_layer_values(path, expected)
    observed = validate_observed_raster_values(
        values,
        taxonomy.raster_values,
        source_mode=taxonomy.source_mode,
    )
    validate_taxonomy_partition(taxonomy, observed)
    return values, observed


def mec_output_path(
    output_dir: Path,
    solution_id: str,
    geography_level: str,
) -> Path:
    _validate_geography_level(geography_level)
    return (
        output_dir
        / "cache"
        / safe_solution_id(solution_id)
        / f"{geography_level}{MEC_COMPACT_SUFFIX}"
    )


def expected_mec_blob_path(
    solution_id: str,
    geography_level: str,
    *,
    blob_directory: str = DEFAULT_BLOB_DIRECTORY,
) -> str:
    _validate_geography_level(geography_level)
    directory = blob_directory.strip("/")
    return (
        f"{directory}/{safe_solution_id(solution_id)}/"
        f"{geography_level}{MEC_COMPACT_SUFFIX}"
    )


def expected_mec_public_url(
    public_blob_host: str,
    solution_id: str,
    geography_level: str,
    *,
    blob_directory: str = DEFAULT_BLOB_DIRECTORY,
) -> str:
    return (
        f"{public_blob_host.rstrip('/')}/"
        f"{expected_mec_blob_path(solution_id, geography_level, blob_directory=blob_directory)}"
    )


def _validate_geography_level(level: str) -> None:
    if level not in GEOGRAPHY_LEVELS:
        raise ValueError(
            f"Unsupported geography level '{level}'; expected one of {GEOGRAPHY_LEVELS}."
        )


def _code_areas(
    ecosystem_values: np.ndarray,
    mask: np.ndarray,
    pixel_area_km2_per_row: np.ndarray,
) -> dict[int, float]:
    included = mask & np.isfinite(ecosystem_values)
    rows, columns = np.nonzero(included)
    if rows.size == 0:
        return {}
    codes = ecosystem_values[rows, columns].astype(np.int64)
    unique_codes, inverse = np.unique(codes, return_inverse=True)
    areas = np.bincount(
        inverse,
        weights=pixel_area_km2_per_row[rows],
        minlength=len(unique_codes),
    )
    return {
        int(code): float(area)
        for code, area in zip(unique_codes, areas)
    }


def _sum_class_area(code_areas: dict[int, float], item: MecClass) -> float:
    return sum(code_areas.get(value, 0.0) for value in item.raster_values)


def _rounded_areas(
    ecosystem_area: float,
    pre_existing: float,
    new_prioritizr: float,
) -> tuple[float, float, float]:
    result = (
        round(ecosystem_area, AREA_DECIMALS),
        round(pre_existing, AREA_DECIMALS),
        round(new_prioritizr, AREA_DECIMALS),
    )
    if result[1] + result[2] > result[0]:
        result = (
            result[0],
            result[1],
            round(max(result[0] - result[1], 0.0), AREA_DECIMALS),
        )
    return result


def _mask_area_km2(
    mask: np.ndarray,
    pixel_area_km2_per_row: np.ndarray,
) -> float:
    rows, _ = np.nonzero(mask)
    if rows.size == 0:
        return 0.0
    return float(pixel_area_km2_per_row[rows].sum())


def compute_scope_stats(
    *,
    scope_mask: np.ndarray,
    ecosystem_values: np.ndarray,
    pixel_area_km2_per_row: np.ndarray,
    boundary_provenance_ref: str,
) -> dict[str, Any]:
    scope_area = _mask_area_km2(scope_mask, pixel_area_km2_per_row)
    classified_area = _mask_area_km2(
        scope_mask & np.isfinite(ecosystem_values),
        pixel_area_km2_per_row,
    )
    rounded_scope_area = round(scope_area, AREA_DECIMALS)
    rounded_classified_area = min(
        round(classified_area, AREA_DECIMALS),
        rounded_scope_area,
    )
    rounded_unclassified_area = round(
        rounded_scope_area - rounded_classified_area,
        AREA_DECIMALS,
    )
    return {
        "scopeAreaKm2": rounded_scope_area,
        "classifiedKm2": rounded_classified_area,
        "unclassifiedKm2": rounded_unclassified_area,
        "boundaryProvenanceRef": boundary_provenance_ref,
    }


def compute_scope_rows(
    *,
    scope_index: int,
    scope_mask: np.ndarray,
    pre_existing_mask: np.ndarray,
    new_prioritizr_mask: np.ndarray,
    selected_mask: np.ndarray,
    ecosystem_values: np.ndarray,
    pixel_area_km2_per_row: np.ndarray,
    taxonomy: MecTaxonomy,
    emit_absent_classes: bool = False,
) -> list[list[Any]]:
    """Compute class rows using categorical solution values 2 and 1."""

    expected_shape = ecosystem_values.shape
    for name, value in (
        ("scope_mask", scope_mask),
        ("pre_existing_mask", pre_existing_mask),
        ("new_prioritizr_mask", new_prioritizr_mask),
        ("selected_mask", selected_mask),
    ):
        if value.shape != expected_shape:
            raise ValueError(
                f"{name} shape {value.shape} does not match ecosystem grid {expected_shape}."
            )
    if pixel_area_km2_per_row.shape != (expected_shape[0],):
        raise ValueError(
            "pixel_area_km2_per_row must contain one value per ecosystem raster row."
        )

    if np.any(pre_existing_mask & new_prioritizr_mask):
        raise AssertionError("Pre-existing and new Prioritizr masks overlap.")
    if not np.array_equal(pre_existing_mask | new_prioritizr_mask, selected_mask):
        raise AssertionError(
            "Selected mask must equal the union of pre-existing and new Prioritizr masks."
        )

    ecosystem_mask = scope_mask & np.isfinite(ecosystem_values)
    scoped_pre_existing = ecosystem_mask & pre_existing_mask
    scoped_new_prioritizr = ecosystem_mask & new_prioritizr_mask
    scoped_selected = ecosystem_mask & selected_mask
    if not np.array_equal(
        scoped_pre_existing | scoped_new_prioritizr,
        scoped_selected,
    ):
        raise AssertionError("Classified selected coverage does not equal its components.")
    if np.any(scoped_selected & ~ecosystem_mask):
        raise AssertionError("Selected MEC coverage extends outside available area.")

    ecosystem_by_code = _code_areas(
        ecosystem_values, ecosystem_mask, pixel_area_km2_per_row
    )
    pre_existing_by_code = _code_areas(
        ecosystem_values, scoped_pre_existing, pixel_area_km2_per_row
    )
    new_prioritizr_by_code = _code_areas(
        ecosystem_values, scoped_new_prioritizr, pixel_area_km2_per_row
    )

    rows: list[list[Any]] = []
    for class_index, item in enumerate(taxonomy.classes):
        ecosystem_area = _sum_class_area(ecosystem_by_code, item)
        if ecosystem_area <= 0 and not emit_absent_classes:
            continue
        pre_existing = _sum_class_area(pre_existing_by_code, item)
        new_prioritizr = _sum_class_area(new_prioritizr_by_code, item)
        tolerance = max(1e-9, ecosystem_area * 1e-12)
        if min(ecosystem_area, pre_existing, new_prioritizr) < 0:
            raise AssertionError(f"Negative area for class '{item.class_id}'.")
        if pre_existing + new_prioritizr > ecosystem_area + tolerance:
            raise AssertionError(
                f"Selected coverage exceeds ecosystem area for class '{item.class_id}'."
            )
        ecosystem_area, pre_existing, new_prioritizr = _rounded_areas(
            ecosystem_area, pre_existing, new_prioritizr
        )
        rows.append(
            [
                scope_index,
                class_index,
                ecosystem_area,
                pre_existing,
                new_prioritizr,
            ]
        )

    classified_area = _mask_area_km2(
        ecosystem_mask,
        pixel_area_km2_per_row,
    )
    for view_index, view in enumerate(taxonomy.views):
        view_area = sum(
            row[2]
            for row in rows
            if taxonomy.classes[row[1]].view_index == view_index
        )
        tolerance = max(10 ** (-AREA_DECIMALS) * len(taxonomy.classes), classified_area * 1e-10)
        if abs(view_area - classified_area) > tolerance:
            raise AssertionError(
                f"Ecosystem areas for view '{view.view_id}' sum to {view_area}, "
                f"not classified area {classified_area}."
            )
    return rows


def compute_inventory_rows(
    *,
    scope_mask: np.ndarray,
    ecosystem_values: np.ndarray,
    pixel_area_km2_per_row: np.ndarray,
    taxonomy: MecTaxonomy,
) -> list[list[Any]]:
    """Return present-only ecosystem denominator rows without solution coverage."""
    empty_mask = np.zeros_like(scope_mask, dtype=bool)
    return compute_scope_rows(
        scope_index=0,
        scope_mask=scope_mask,
        pre_existing_mask=empty_mask,
        new_prioritizr_mask=empty_mask,
        selected_mask=empty_mask,
        ecosystem_values=ecosystem_values,
        pixel_area_km2_per_row=pixel_area_km2_per_row,
        taxonomy=taxonomy,
    )


def build_mec_document(
    *,
    solution_id: str,
    geography_level: str,
    scopes: list[tuple[Any, ...]],
    raster: SolutionRaster,
    ecosystem_values: np.ndarray,
    taxonomy: MecTaxonomy,
    mec_raster_source: str,
    mec_raster_sha256: str,
    crosswalk_source: str,
    crosswalk_sha256: str,
    classification_summary_source: str | None,
    provenance_source: str | None,
    provenance_sha256: str | None,
    solution_raster_source: str,
    solution_raster_sha256: str,
    observed_biome_ids: set[int],
    boundary_provenance: dict[str, dict[str, Any]],
    national_target: dict[str, Any],
    generation_signature: dict[str, str],
    aligned_mec_identity: dict[str, str],
    generated_at: str,
    solution_catalog_binding: dict[str, Any] | None = None,
) -> dict[str, Any]:
    _validate_geography_level(geography_level)
    boundary_level = "departments" if geography_level == "national" else geography_level
    relevant_boundary_provenance = {
        boundary_level: boundary_provenance[boundary_level]
    }
    scope_catalog: list[list[str]] = []
    scope_stats: dict[str, dict[str, Any]] = {}
    rows: list[list[Any]] = []
    for scope_index, scope in enumerate(scopes):
        if len(scope) == 3:
            scope_id, scope_name, scope_mask = scope
            boundary_provenance_ref = geography_level
        elif len(scope) == 4:
            (
                scope_id,
                scope_name,
                scope_mask,
                boundary_provenance_ref,
            ) = scope
        else:
            raise ValueError("Scope tuples must contain 3 or 4 values.")
        scope_catalog.append([scope_id, scope_name])
        scope_stats[str(scope_index)] = compute_scope_stats(
            scope_mask=scope_mask,
            ecosystem_values=ecosystem_values,
            pixel_area_km2_per_row=raster.pixel_area_km2_per_row,
            boundary_provenance_ref=boundary_provenance_ref,
        )
        rows.extend(
            compute_scope_rows(
                scope_index=scope_index,
                scope_mask=scope_mask,
                pre_existing_mask=raster.pre_existing_mask,
                new_prioritizr_mask=raster.new_prioritizr_mask,
                selected_mask=raster.selected_mask,
                ecosystem_values=ecosystem_values,
                pixel_area_km2_per_row=raster.pixel_area_km2_per_row,
                taxonomy=taxonomy,
                emit_absent_classes=geography_level == "national",
            )
        )

    document = {
        "format": MEC_COMPACT_FORMAT,
        "generatorConfigVersion": MEC_GENERATOR_CONFIG_VERSION,
        "solutionId": solution_id,
        "geographyLevel": geography_level,
        "generatedAt": generated_at,
        "generationSignature": generation_signature,
        "sourceMode": taxonomy.source_mode,
        "units": "km2",
        "sources": {
            "mecRasterSourceId": (
                "ecosistemas_IDEAM_MEC_2024"
                if taxonomy.source_mode == SOURCE_MODE_COMPOSITE
                else MEC_RASTER_SOURCE_ID
            ),
            "mecRaster": _portable_source_reference(mec_raster_source),
            "mecRasterSha256": mec_raster_sha256,
            "alignedMec": aligned_mec_identity,
            "crosswalkSourceId": (
                "ecosistemas_IDs_IDEAM_MEC_2024"
                if taxonomy.source_mode == SOURCE_MODE_COMPOSITE
                else MEC_CROSSWALK_SOURCE_ID
            ),
            "crosswalk": _portable_source_reference(crosswalk_source),
            "crosswalkSha256": crosswalk_sha256,
            "provenance": _portable_source_reference(provenance_source),
            "provenanceSha256": provenance_sha256,
            "classificationSummary": _portable_source_reference(
                classification_summary_source
            ),
            "taxonomyVersion": taxonomy.source_version,
            "solutionRaster": _portable_source_reference(solution_raster_source),
            "solutionRasterSha256": solution_raster_sha256,
        },
        "sourceCoverage": {
            "mappedClassIdCount": len(taxonomy.raster_values),
            "observedClassIdCount": len(observed_biome_ids),
            "absentMappedClassIdCount": len(taxonomy.raster_values)
            - len(observed_biome_ids),
            # Compatibility aliases retained from the original two-view schema.
            "mappedBiomeIdCount": len(taxonomy.raster_values),
            "observedBiomeIdCount": len(observed_biome_ids),
            "absentMappedBiomeIdCount": len(taxonomy.raster_values)
            - len(observed_biome_ids),
        },
        "viewSupport": view_support_for_mode(taxonomy.source_mode),
        "semantics": SEMANTICS,
        "rowLayout": ROW_LAYOUT,
        "scopeStatsFields": list(SCOPE_STATS_FIELDS),
        "grid": {
            **_grid_payload(raster.fingerprint),
            "rasterization": RASTERIZATION_SEMANTICS,
        },
        "boundaryProvenance": _portable_metadata(relevant_boundary_provenance),
        "viewCatalog": taxonomy.view_catalog,
        "classCatalog": taxonomy.class_catalog,
        "tipoEcosistemaCatalog": list(taxonomy.tipo_ecosistema_catalog),
        "sourceTupleLayout": (
            [
                "rasterValue",
                "tipoEcosistemaIndex",
                *[f"{view_id}ClassIndex" for view_id in UI_VIEW_IDS],
            ]
            if taxonomy.source_mode == SOURCE_MODE_COMPOSITE
            else []
        ),
        "sourceTupleCatalog": [
            list(row) for row in taxonomy.source_tuple_catalog
        ],
        "scopeCatalog": scope_catalog,
        "scopeStats": scope_stats,
        "rows": rows,
    }
    if geography_level == "national":
        if national_target["applicability"] == "national-only":
            document["nationalCoverageBenchmark"] = national_target
        else:
            document["coverageOutcomeContext"] = national_target
    if solution_catalog_binding is not None:
        document["solutionCatalogBinding"] = solution_catalog_binding
    return document


def ecosystem_denominator_signature(document: dict[str, Any]) -> str:
    """Hash only solution-independent scope and ecosystem denominator data."""

    return _canonical_sha256(
        {
            "geographyLevel": document.get("geographyLevel"),
            "scopeCatalog": document.get("scopeCatalog"),
            "scopeStats": document.get("scopeStats"),
            "ecosystemAreas": [
                row[:3] for row in document.get("rows") or []
            ],
        }
    )


def _write_minified_json(path: Path, document: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def _write_report(output_dir: Path, report: dict[str, Any]) -> Path:
    path = output_dir / "publish-report.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)
    return path


def _resolve_source_path(
    source: str,
    cache_dir: Path,
    *,
    force_download: bool,
) -> Path:
    if source.startswith(("https://", "http://")):
        return cached_download(source, cache_dir, force=force_download).path
    return Path(source).expanduser()


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_text_source(
    source: str,
    cache_dir: Path,
    *,
    force_download: bool,
) -> str:
    path = _resolve_source_path(
        source,
        cache_dir,
        force_download=force_download,
    )
    return path.read_text(encoding="utf-8-sig")


def _load_json_source(
    source: str,
    cache_dir: Path,
    *,
    force_download: bool,
) -> dict[str, Any]:
    payload = json.loads(
        _load_text_source(source, cache_dir, force_download=force_download)
    )
    if not isinstance(payload, dict):
        raise MecTaxonomyError("Classification summary root must be a JSON object.")
    return payload


def _select_land_solutions(
    manifest: ResolvedManifest,
    requested_ids: list[str] | None,
    limit: int | None,
) -> list[dict[str, Any]]:
    solutions = [
        solution
        for solution in manifest.national_solutions
        if str(solution.get("domain") or "land").casefold() != "marine"
    ]
    if requested_ids:
        wanted = set(requested_ids)
        solutions = [
            solution for solution in solutions if str(solution.get("id")) in wanted
        ]
        missing = wanted - {str(solution.get("id")) for solution in solutions}
        if missing:
            raise ManifestError(
                f"Requested land solution ids not found in manifest: {sorted(missing)}"
            )
    if limit is not None:
        solutions = solutions[:limit]
    return solutions


def _manifest_solution_catalog(
    manifest: ResolvedManifest,
) -> tuple[list[dict[str, Any]], list[str], list[str]]:
    solutions = list(manifest.national_solutions)
    known_ids = [str(solution.get("id")) for solution in solutions]
    unsorted_land_solutions = [
        solution
        for solution in solutions
        if str(solution.get("domain") or "land").casefold() != "marine"
    ]
    if len(known_ids) != len(set(known_ids)):
        raise ManifestError("manifest contains duplicate solution ids.")
    land_solutions = sorted(
        unsorted_land_solutions,
        key=lambda solution: str(solution.get("id")),
    )
    land_ids = [str(solution.get("id")) for solution in land_solutions]
    return land_solutions, sorted(known_ids), land_ids


def _release_plan_land_ids(
    path: Path,
    *,
    catalog: SolutionCatalog,
    land_solution_ids: Iterable[str],
) -> tuple[str, ...]:
    recompute_ids = set(
        load_release_plan(path, catalog=catalog, action="recompute")
    )
    land_ids = set(land_solution_ids)
    selected = tuple(
        solution_id
        for solution_id in catalog.solution_ids
        if solution_id in recompute_ids and solution_id in land_ids
    )
    if len(selected) != len(recompute_ids & land_ids):
        raise SolutionCatalogError(
            "release plan recompute count does not match MEC land selection."
        )
    return selected


def mec_document_is_complete(
    document: dict[str, Any],
    *,
    solution_id: str,
    geography_level: str,
    generation_signature: dict[str, str] | None = None,
    aligned_mec_identity: dict[str, Any] | None = None,
    expected_catalog_binding: dict[str, Any] | None = None,
) -> bool:
    observed_signature = document.get("generationSignature")
    if generation_signature is None:
        generation_signature = observed_signature
    if not (
        isinstance(observed_signature, dict)
        and observed_signature.get("format") == MEC_SIGNATURE_FORMAT
        and isinstance(observed_signature.get("sha256"), str)
        and re.fullmatch(r"[0-9a-f]{64}", observed_signature["sha256"])
    ):
        return False
    scope_catalog = document.get("scopeCatalog")
    class_catalog = document.get("classCatalog")
    view_catalog = document.get("viewCatalog")
    scope_stats = document.get("scopeStats")
    rows = document.get("rows")
    if not (
        document.get("format") == MEC_COMPACT_FORMAT
        and document.get("solutionId") == solution_id
        and document.get("geographyLevel") == geography_level
        and document.get("generationSignature") == generation_signature
        and (
            aligned_mec_identity is None
            or document.get("sources", {}).get("alignedMec")
            == aligned_mec_identity
        )
        and (
            expected_catalog_binding is None
            or document.get("solutionCatalogBinding") == expected_catalog_binding
        )
        and document.get("rowLayout") == ROW_LAYOUT
        and document.get("scopeStatsFields") == list(SCOPE_STATS_FIELDS)
        and isinstance(scope_catalog, list)
        and bool(scope_catalog)
        and isinstance(class_catalog, list)
        and bool(class_catalog)
        and isinstance(view_catalog, list)
        and bool(view_catalog)
        and isinstance(scope_stats, dict)
        and isinstance(rows, list)
    ):
        return False
    if any(
        not isinstance(scope, list)
        or len(scope) != 2
        or not isinstance(scope[0], str)
        for scope in scope_catalog
    ):
        return False
    if len({scope[0] for scope in scope_catalog}) != len(scope_catalog):
        return False
    if set(scope_stats) != {str(index) for index in range(len(scope_catalog))}:
        return False
    if any(
        not isinstance(stats, dict)
        or any(field not in stats for field in SCOPE_STATS_FIELDS)
        for stats in scope_stats.values()
    ):
        return False
    rows_by_scope = {
        index: 0
        for index in range(len(scope_catalog))
    }
    for row in rows:
        if isinstance(row, list) and row and isinstance(row[0], int):
            rows_by_scope[row[0]] = rows_by_scope.get(row[0], 0) + 1
    if any(
        isinstance(scope_stats[str(index)].get("classifiedKm2"), (int, float))
        and scope_stats[str(index)]["classifiedKm2"] > 0
        and rows_by_scope.get(index, 0) == 0
        for index in range(len(scope_catalog))
    ):
        return False
    return all(
        isinstance(row, list)
        and len(row) == len(ROW_LAYOUT)
        and isinstance(row[0], int)
        and 0 <= row[0] < len(scope_catalog)
        and isinstance(row[1], int)
        and 0 <= row[1] < len(class_catalog)
        for row in rows
    )


def _artifact_is_resumable(
    path: Path,
    *,
    solution_id: str,
    geography_level: str,
    generation_signature: dict[str, str],
    aligned_mec_identity: dict[str, Any] | None = None,
    expected_catalog_binding: dict[str, Any] | None = None,
) -> bool:
    if not path.exists():
        return False
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return mec_document_is_complete(
        document,
        solution_id=solution_id,
        geography_level=geography_level,
        generation_signature=generation_signature,
        aligned_mec_identity=aligned_mec_identity,
        expected_catalog_binding=expected_catalog_binding,
    )


def _scopes_for_level(
    level: str,
    *,
    raster: SolutionRaster,
    boundaries_by_level: dict[str, Any],
    boundary_masks: BoundaryMaskCache,
) -> list[tuple[str, str, np.ndarray, str]]:
    if level == "national":
        source_level = (
            "national"
            if "national" in boundaries_by_level
            else "departments"
        )
        collection = boundaries_by_level.get(source_level)
        if collection is None:
            raise RuntimeError(
                "National MEC scope requires an authoritative national boundary "
                "or authoritative department boundaries."
            )
        features = _boundary_features(collection)
        if not features:
            raise RuntimeError(
                f"Boundary level '{source_level}' contains no features."
            )
        national_mask = np.zeros(raster.selected_mask.shape, dtype=bool)
        for feature in features:
            national_mask |= boundary_masks.get(
                feature.geo_level,
                feature.boundary_id,
                feature.geometry,
                raster.fingerprint,
                source_crs=feature.source_crs,
                source_sha256=feature.source_sha256,
                geometry_sha256=feature.geometry_sha256,
            )
        return [
            (
                "colombia",
                "Colombia",
                national_mask,
                source_level,
            )
        ]
    collection = boundaries_by_level.get(level)
    if collection is None:
        raise RuntimeError(f"Boundary level '{level}' was not loaded.")
    features = _boundary_features(collection)
    return [
        (
            feature.boundary_id,
            feature.name,
            boundary_masks.get(
                feature.geo_level,
                feature.boundary_id,
                feature.geometry,
                raster.fingerprint,
                source_crs=feature.source_crs,
                source_sha256=feature.source_sha256,
                geometry_sha256=feature.geometry_sha256,
            ),
            level,
        )
        for feature in features
    ]


def _run_geography_levels(
    *,
    solution_id: str,
    levels: Iterable[str],
    generate_level: Callable[[str], dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Run independent geography artifacts and isolate failures by level."""

    entries: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    for level in levels:
        try:
            entries.append(generate_level(level))
        except Exception as exc:
            failures.append(
                {
                    "solutionId": solution_id,
                    "geographyLevel": level,
                    "error": str(exc),
                    "traceback": traceback.format_exc(),
                }
            )
            print(
                f"[mec-compact] FAILED {solution_id}/{level}: {exc}",
                file=sys.stderr,
            )
    return entries, failures


def _entry(
    *,
    path: Path,
    repo_root: Path,
    solution_id: str,
    level: str,
    public_blob_host: str,
    blob_directory: str,
    resume_skipped: bool,
) -> dict[str, Any]:
    try:
        local_path = str(path.relative_to(repo_root))
    except ValueError:
        local_path = Path(*path.parts[-3:]).as_posix()
    return {
        "solutionId": solution_id,
        "geographyLevel": level,
        "cachePath": local_path,
        "expectedBlobPath": expected_mec_blob_path(
            solution_id, level, blob_directory=blob_directory
        ),
        "expectedPublicUrl": expected_mec_public_url(
            public_blob_host,
            solution_id,
            level,
            blob_directory=blob_directory,
        ),
        "bytes": path.stat().st_size,
        "resumeSkipped": resume_skipped,
    }


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest-url", default=DEFAULT_MANIFEST_URL)
    parser.add_argument(
        "--source-mode",
        choices=SOURCE_MODES,
        default=SOURCE_MODE_COMPOSITE,
        help=(
            "MEC source contract. Composite is the five-view default; IAvH is "
            "an explicit two-view fallback."
        ),
    )
    parser.add_argument(
        "--classification-summary",
        default=DEFAULT_CLASSIFICATION_SUMMARY,
        help=(
            "Optional summary used to validate IAvH fallback labels; pass an "
            "empty string to skip."
        ),
    )
    parser.add_argument(
        "--mec-raster",
        default=None,
        help="Composite/IAvH raster URL or local path (mode-specific default).",
    )
    parser.add_argument(
        "--crosswalk",
        default=None,
        help="Composite/IAvH crosswalk URL or local path (mode-specific default).",
    )
    parser.add_argument(
        "--provenance",
        default=None,
        help="Composite provenance.json URL or local path (required in composite mode).",
    )
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    parser.add_argument(
        "--blob-directory",
        default=DEFAULT_BLOB_DIRECTORY,
        help=f"Expected Blob prefix recorded in the report (default: {DEFAULT_BLOB_DIRECTORY}).",
    )
    parser.add_argument(
        "--release-id",
        default=None,
        help="Use the immutable MEC v2 prefix for this explicit release id.",
    )
    parser.add_argument(
        "--solution-catalog",
        type=Path,
        default=None,
        help="Versioned solution-catalog-v1 contract (required with --release-id).",
    )
    parser.add_argument(
        "--release-plan",
        type=Path,
        default=None,
        help="Process only catalog entries marked recompute in a release preflight plan.",
    )
    parser.add_argument(
        "--release-partition",
        type=Path,
        default=None,
        help=(
            "Fail-closed partial release descriptor containing releaseId, "
            "partitionIndex/count, expectedArtifactCount, and exact solutionIds."
        ),
    )
    parser.add_argument(
        "--reconcile-partition-report",
        action="append",
        type=Path,
        default=None,
        help=(
            "Validate final disjoint/full release union from partition publish reports "
            "(repeat once per partition)."
        ),
    )
    parser.add_argument(
        "--solution-id",
        action="append",
        default=None,
        help="Restrict generation to one or more land solution ids (repeatable).",
    )
    parser.add_argument(
        "--geography-level",
        action="append",
        choices=GEOGRAPHY_LEVELS,
        default=None,
        help="Restrict generation to one or more exact geography keys (repeatable).",
    )
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--cache-policy",
        choices=("use-cache", "recompute-all"),
        default="use-cache",
        help=(
            "use-cache resumes valid artifacts (default); recompute-all ignores "
            "calculated outputs and rebuilds the selected artifacts."
        ),
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="Force raster and summary downloads.",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate the manifest and explicit taxonomy mapping, then exit.",
    )
    args = parser.parse_args(argv)
    if args.release_id and args.solution_catalog is None:
        parser.error("--release-id requires --solution-catalog")
    if args.release_plan is not None and args.solution_catalog is None:
        parser.error("--release-plan requires --solution-catalog")
    return args


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        solution_catalog = (
            load_solution_catalog(args.solution_catalog)
            if args.solution_catalog is not None
            else None
        )
        if (
            solution_catalog is not None
            and args.release_id is not None
            and solution_catalog.release_id != args.release_id
        ):
            raise SolutionCatalogError(
                "--release-id must exactly match solution catalog releaseId."
            )
        if solution_catalog is not None and args.release_plan is not None:
            args.cache_policy = release_plan_cache_policy(
                args.release_plan,
                catalog=solution_catalog,
            )
    except SolutionCatalogError as exc:
        print(f"[mec-compact] ERROR: {exc}", file=sys.stderr)
        return 2
    solution_catalog_binding = (
        catalog_binding(solution_catalog)
        if solution_catalog is not None
        else None
    )
    if args.release_partition and not args.release_id:
        print(
            "[mec-compact] ERROR: --release-partition requires --release-id",
            file=sys.stderr,
        )
        return 2
    if args.reconcile_partition_report and not args.release_id:
        print(
            "[mec-compact] ERROR: reconciliation requires --release-id",
            file=sys.stderr,
        )
        return 2
    if args.release_id:
        args.blob_directory = load_release_config(args.release_id).mec_v2_directory
        if args.output_dir == DEFAULT_OUTPUT_DIR:
            args.output_dir = (
                Path("data/metrics/generated/releases")
                / args.release_id
                / "mec/v2"
            )
    repo_root = find_repo_root()
    output_dir = resolve_output_dir(repo_root, args.output_dir)
    cache_dir = resolve_output_dir(repo_root, args.cache_dir)
    if solution_catalog is not None and args.release_id is not None:
        try:
            bind_release_output(
                output_dir,
                catalog=solution_catalog,
                component="mec-v2",
            )
        except SolutionCatalogError as exc:
            print(f"[mec-compact] ERROR: {exc}", file=sys.stderr)
            return 2
    if args.reconcile_partition_report:
        if any(
            (
                args.release_partition,
                args.solution_id,
                args.geography_level,
                args.limit,
                args.validate_only,
            )
        ):
            print(
                "[mec-compact] ERROR: reconciliation cannot be combined with generation filters",
                file=sys.stderr,
            )
            return 2
        try:
            manifest = fetch_manifest(args.manifest_url)
            _, _, land_ids = _manifest_solution_catalog(manifest)
            assert solution_catalog is not None
            validate_catalog_solution_ids(
                solution_catalog,
                (
                    str(solution.get("id"))
                    for solution in manifest.batch_solutions
                ),
            )
            reports = [
                json.loads(
                    resolve_output_dir(repo_root, report_path).read_text(
                        encoding="utf-8"
                    )
                )
                for report_path in args.reconcile_partition_report
            ]
            reconciliation = reconcile_release_reports(
                reports,
                release_id=args.release_id,
                land_solution_ids=land_ids,
                artifact_levels=GEOGRAPHY_LEVELS,
                expected_solution_count=solution_catalog.expected_land_count,
                expected_blob_directory=args.blob_directory,
            )
            output_dir.mkdir(parents=True, exist_ok=True)
            report_path = output_dir / "release-reconciliation.json"
            _write_minified_json(report_path, reconciliation)
            print(f"[mec-compact] reconciled release -> {report_path}")
            return 0
        except (
            OSError,
            json.JSONDecodeError,
            ManifestError,
            ReleaseSelectionError,
            SolutionCatalogError,
        ) as exc:
            print(f"[mec-compact] ERROR: {exc}", file=sys.stderr)
            return 2
    source_metadata = resolve_source_metadata(
        args.source_mode,
        mec_raster=args.mec_raster,
        crosswalk=args.crosswalk,
        provenance=args.provenance,
        classification_summary=args.classification_summary,
    )
    mec_raster_source = source_metadata.mec_raster
    crosswalk_source = source_metadata.crosswalk
    provenance_source = source_metadata.provenance
    classification_summary_source = source_metadata.classification_summary
    levels = tuple(dict.fromkeys(args.geography_level or GEOGRAPHY_LEVELS))
    generated_at = _utc_now_iso()
    started = time.time()

    base_report: dict[str, Any] = {
        "format": MEC_COMPACT_FORMAT,
        "generatedAt": generated_at,
        "manifestUrl": _portable_source_reference(args.manifest_url),
        "sourceMode": args.source_mode,
        "mecRaster": _portable_source_reference(mec_raster_source),
        "crosswalk": _portable_source_reference(crosswalk_source),
        "provenance": _portable_source_reference(provenance_source),
        "classificationSummary": _portable_source_reference(
            classification_summary_source
        ),
        "outputDir": (
            str(output_dir.relative_to(repo_root))
            if output_dir.is_relative_to(repo_root)
            else output_dir.name
        ),
        "blobDirectory": args.blob_directory,
        "cachePolicy": args.cache_policy,
        "solutionCatalog": (
            {
                "format": "solution-catalog-v1",
                "catalogVersion": solution_catalog.catalog_version,
                "releaseId": solution_catalog.release_id,
                "sha256": solution_catalog.sha256,
                "expectedCounts": {
                    "total": solution_catalog.expected_total_count,
                    "land": solution_catalog.expected_land_count,
                    "marine": solution_catalog.expected_marine_count,
                },
            }
            if solution_catalog is not None
            else None
        ),
        "geographyLevels": list(levels),
        "entries": [],
        "failures": [],
    }

    try:
        validate_mec_raster_source(mec_raster_source)
        mec_raster_path = _resolve_source_path(
            mec_raster_source, cache_dir, force_download=args.no_cache
        )
        mec_raster_sha256 = _sha256_path(mec_raster_path)
        crosswalk_path = _resolve_source_path(
            crosswalk_source, cache_dir, force_download=args.no_cache
        )
        crosswalk_content = crosswalk_path.read_text(encoding="utf-8-sig")
        crosswalk_sha256 = _sha256_path(crosswalk_path)
        provenance: dict[str, Any] | None = None
        provenance_sha256: str | None = None
        summary: dict[str, Any] | None = None
        if args.source_mode == SOURCE_MODE_COMPOSITE:
            composite_rows = load_composite_crosswalk(crosswalk_content)
            taxonomy = build_composite_taxonomy(composite_rows)
            if provenance_source is None:
                raise MecTaxonomyError(
                    "Composite source mode requires ingestion provenance."
                )
            provenance_path = _resolve_source_path(
                provenance_source,
                cache_dir,
                force_download=args.no_cache,
            )
            provenance = json.loads(
                provenance_path.read_text(encoding="utf-8-sig")
            )
            if not isinstance(provenance, dict):
                raise MecTaxonomyError(
                    "Composite provenance root must be a JSON object."
                )
            validate_composite_provenance(
                provenance,
                raster_sha256=mec_raster_sha256,
                crosswalk_sha256=crosswalk_sha256,
                crosswalk_row_count=len(composite_rows),
            )
            provenance_sha256 = _sha256_path(provenance_path)
        else:
            crosswalk = load_iavh_crosswalk(crosswalk_content)
            summary = (
                _load_json_source(
                    classification_summary_source,
                    cache_dir,
                    force_download=args.no_cache,
                )
                if classification_summary_source
                else None
            )
            taxonomy = build_mec_taxonomy(crosswalk, summary=summary)
        validate_taxonomy_partition(taxonomy)
        manifest = fetch_manifest(args.manifest_url)
        land_solutions, known_ids, land_ids = _manifest_solution_catalog(manifest)
        if solution_catalog is not None:
            validate_catalog_solution_ids(
                solution_catalog,
                (
                    str(solution.get("id"))
                    for solution in manifest.batch_solutions
                ),
            )
            catalog_land_ids = tuple(
                entry.solution_id
                for entry in solution_catalog.solutions
                if entry.domain == "land"
            )
            if tuple(sorted(land_ids)) != catalog_land_ids:
                raise SolutionCatalogError(
                    "manifest land solution ids do not match the solution catalog."
                )
            catalog_by_id = solution_catalog.by_id
            catalog_land_solutions: list[dict[str, Any]] = []
            for solution in land_solutions:
                solution_id = str(solution["id"])
                entry = catalog_by_id[solution_id]
                observed_basename = solution_blob_basename(solution)
                if observed_basename != entry.solution_basename:
                    raise SolutionCatalogError(
                        f"solution {solution_id!r} basename mismatch: "
                        f"manifest={observed_basename!r}, "
                        f"catalog={entry.solution_basename!r}"
                    )
                catalog_land_solutions.append(dict(solution))
            land_solutions = catalog_land_solutions
        release_selection: ReleaseSelection | None = None
        if args.release_id:
            if set(levels) != set(GEOGRAPHY_LEVELS):
                raise ManifestError(
                    "MEC v2 release generation requires all six geography levels"
                )
            if args.release_plan:
                if args.release_partition or args.solution_id or args.limit is not None:
                    raise ManifestError(
                        "--release-plan cannot be combined with release selection filters"
                    )
                assert solution_catalog is not None
                selected_land_ids = _release_plan_land_ids(
                    args.release_plan,
                    catalog=solution_catalog,
                    land_solution_ids=land_ids,
                )
                release_selection = ReleaseSelection(
                    release_id=args.release_id,
                    solution_ids=selected_land_ids,
                    expected_artifact_count=(
                        len(selected_land_ids) * len(GEOGRAPHY_LEVELS)
                    ),
                    mode="recompute",
                )
            elif args.release_partition:
                if args.solution_id or args.limit is not None:
                    raise ManifestError(
                        "--release-partition cannot be combined with --solution-id or --limit"
                    )
                release_selection = load_release_partition(
                    resolve_output_dir(repo_root, args.release_partition),
                    release_id=args.release_id,
                    known_solution_ids=known_ids,
                    land_solution_ids=land_ids,
                    artifact_levels=GEOGRAPHY_LEVELS,
                )
            else:
                if args.solution_id or args.limit is not None:
                    raise ManifestError(
                        "full MEC v2 release cannot use --solution-id or --limit; "
                        "use an explicit --release-partition descriptor"
                    )
                release_selection = full_release_selection(
                    release_id=args.release_id,
                    land_solution_ids=land_ids,
                    expected_solution_count=solution_catalog.expected_land_count,
                    artifact_levels=GEOGRAPHY_LEVELS,
                )
            solution_by_id = {
                str(solution["id"]): solution for solution in land_solutions
            }
            solutions = [
                solution_by_id[solution_id]
                for solution_id in release_selection.solution_ids
            ]
        else:
            solutions = _select_land_solutions(
                manifest, args.solution_id, args.limit
            )
        national_targets = {
            str(solution["id"]): resolve_national_target(solution)
            for solution in solutions
        }
    except (
        OSError,
        json.JSONDecodeError,
        DownloadError,
        MecTaxonomyError,
        ManifestError,
        ReleaseSelectionError,
        SolutionCatalogError,
    ) as exc:
        base_report["failures"].append(
            {"stage": "validation", "error": str(exc)}
        )
        report_path = _write_report(output_dir, base_report)
        print(f"[mec-compact] ERROR: {exc}", file=sys.stderr)
        print(f"[mec-compact] failure report -> {report_path}", file=sys.stderr)
        return 2

    base_report["publicBlobHost"] = _portable_source_reference(
        manifest.public_blob_host
    )
    base_report["classificationViews"] = [
        view.view_id for view in taxonomy.views
    ]
    base_report["viewSupport"] = {
        **view_support_for_mode(taxonomy.source_mode),
    }
    base_report["crosswalkClassIdCount"] = len(taxonomy.raster_values)
    base_report["classCount"] = len(taxonomy.classes)
    base_report["solutionCount"] = len(solutions)
    base_report["generationSignatureFormat"] = MEC_SIGNATURE_FORMAT
    base_report["generatorConfigVersion"] = MEC_GENERATOR_CONFIG_VERSION
    if release_selection is not None:
        base_report["releaseSelection"] = release_selection.to_report()
    if args.validate_only:
        report_path = _write_report(output_dir, base_report)
        print(
            f"[mec-compact] validated {len(taxonomy.views)} view(s), "
            f"{len(taxonomy.classes)} classes, and {len(solutions)} land solution(s)"
        )
        print(f"[mec-compact] report -> {report_path}")
        return 0

    output_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    boundaries_by_level, boundary_errors = load_all_boundaries(cache_dir)
    boundary_provenance = boundary_provenance_by_level(boundaries_by_level)
    base_report["boundaryErrors"] = {
        level: error
        for level, error in boundary_errors.items()
        if level in levels or (level == "departments" and "national" in levels)
    }
    base_report["boundaryProvenance"] = boundary_provenance

    reference_fingerprint: RasterFingerprint | None = None
    ecosystem_values: np.ndarray | None = None
    observed_biome_ids: set[int] | None = None
    aligned_mec: AlignmentResult | None = None
    alignment_cache = RasterAlignmentCache(cache_dir)
    boundary_masks = BoundaryMaskCache()
    denominator_signatures_by_level: dict[str, str] = {}

    for index, solution in enumerate(solutions, start=1):
        solution_id = str(solution["id"])
        try:
            solution_path = cached_download(
                str(solution["displayUrl"]),
                cache_dir,
                force=args.no_cache,
            ).path
            solution_raster_sha256 = _sha256_path(solution_path)
            if solution_catalog is not None:
                expected_sha256 = solution_catalog.by_id[solution_id].raster_sha256
                if solution_raster_sha256 != expected_sha256:
                    raise SolutionCatalogError(
                        f"raster SHA-256 mismatch for {solution_id!r}: "
                        f"expected {expected_sha256}, observed "
                        f"{solution_raster_sha256}"
                    )
            raster = read_solution_raster(solution_path)
            if reference_fingerprint is None:
                candidate_fingerprint = raster.fingerprint
                aligned_mec = alignment_cache.align(
                    mec_raster_path,
                    mec_raster_sha256,
                    candidate_fingerprint,
                    NEAREST_CATEGORICAL,
                    source_url=mec_raster_source,
                )
                (
                    candidate_ecosystem_values,
                    candidate_observed_biome_ids,
                ) = read_mec_raster_values(
                    aligned_mec.path,
                    candidate_fingerprint,
                    taxonomy,
                )
                reference_fingerprint = candidate_fingerprint
                ecosystem_values = candidate_ecosystem_values
                observed_biome_ids = candidate_observed_biome_ids
            elif not raster.fingerprint.matches(reference_fingerprint):
                raise RasterError(
                    f"Solution raster {solution_path} does not align with the MEC grid.\n"
                    f"  expected: {reference_fingerprint}\n"
                    f"  observed: {raster.fingerprint}"
                )
            assert ecosystem_values is not None
            assert observed_biome_ids is not None
            assert aligned_mec is not None
            aligned_mec_identity = {
                "cacheKey": aligned_mec.cache_key,
                "sourceSha256": aligned_mec.source_sha256,
                "alignedSha256": aligned_mec.aligned_sha256,
                "targetGridSha256": aligned_mec.target_grid_sha256,
                "policySha256": aligned_mec.policy_sha256,
            }
            generation_signatures = {
                level: build_generation_signature(
                    taxonomy=taxonomy,
                    crosswalk_content=crosswalk_content,
                    crosswalk_source=crosswalk_source,
                    classification_summary=summary,
                    classification_summary_source=classification_summary_source,
                    provenance_source=provenance_source,
                    provenance_sha256=provenance_sha256,
                    manifest_url=args.manifest_url,
                    mec_raster_url=mec_raster_source,
                    mec_raster_sha256=mec_raster_sha256,
                    solution_url=str(solution["displayUrl"]),
                    solution_raster_sha256=solution_raster_sha256,
                    solution_grid=raster.fingerprint,
                    boundary_provenance=boundary_provenance,
                    national_target=national_targets[solution_id],
                    aligned_mec_identity=aligned_mec_identity,
                    geography_level=level,
                )
                for level in levels
            }
        except Exception as exc:
            setup_traceback = traceback.format_exc()
            for level in levels:
                base_report["failures"].append(
                    {
                        "solutionId": solution_id,
                        "geographyLevel": level,
                        "stage": "solution-setup",
                        "error": str(exc),
                        "traceback": setup_traceback,
                    }
                )
            print(
                f"[mec-compact] FAILED setup for {solution_id}: {exc}",
                file=sys.stderr,
            )
            continue

        pending_levels: list[str] = []
        for level in levels:
            path = mec_output_path(output_dir, solution_id, level)
            if args.cache_policy == "use-cache" and _artifact_is_resumable(
                path,
                solution_id=solution_id,
                geography_level=level,
                generation_signature=generation_signatures[level],
                aligned_mec_identity=aligned_mec_identity,
                expected_catalog_binding=solution_catalog_binding,
            ):
                base_report["entries"].append(
                    _entry(
                        path=path,
                        repo_root=repo_root,
                        solution_id=solution_id,
                        level=level,
                        public_blob_host=manifest.public_blob_host,
                        blob_directory=args.blob_directory,
                        resume_skipped=True,
                    )
                )
            else:
                pending_levels.append(level)
        if not pending_levels:
            continue
        print(
            f"[mec-compact] [{index}/{len(solutions)}] {solution_id}: "
            f"{', '.join(pending_levels)}"
        )

        def generate_level(level: str) -> dict[str, Any]:
            if level in boundary_errors:
                raise RuntimeError(
                    f"Could not load requested boundary level '{level}': "
                    f"{boundary_errors[level]}"
                )
            scopes = _scopes_for_level(
                level,
                raster=raster,
                boundaries_by_level=boundaries_by_level,
                boundary_masks=boundary_masks,
            )
            document = build_mec_document(
                solution_id=solution_id,
                geography_level=level,
                scopes=scopes,
                raster=raster,
                ecosystem_values=ecosystem_values,
                taxonomy=taxonomy,
                mec_raster_source=mec_raster_source,
                mec_raster_sha256=mec_raster_sha256,
                crosswalk_source=crosswalk_source,
                crosswalk_sha256=crosswalk_sha256,
                classification_summary_source=classification_summary_source,
                provenance_source=provenance_source,
                provenance_sha256=provenance_sha256,
                solution_raster_source=str(solution["displayUrl"]),
                solution_raster_sha256=solution_raster_sha256,
                observed_biome_ids=observed_biome_ids,
                boundary_provenance=boundary_provenance,
                national_target=national_targets[solution_id],
                generation_signature=generation_signatures[level],
                aligned_mec_identity=aligned_mec_identity,
                generated_at=generated_at,
                solution_catalog_binding=solution_catalog_binding,
            )
            denominator_signature = ecosystem_denominator_signature(document)
            expected_denominator_signature = denominator_signatures_by_level.setdefault(
                level,
                denominator_signature,
            )
            if denominator_signature != expected_denominator_signature:
                raise AssertionError(
                    f"Ecosystem denominator changed between solutions for '{level}'."
                )
            path = mec_output_path(output_dir, solution_id, level)
            _write_minified_json(path, document)
            return _entry(
                path=path,
                repo_root=repo_root,
                solution_id=solution_id,
                level=level,
                public_blob_host=manifest.public_blob_host,
                blob_directory=args.blob_directory,
                resume_skipped=False,
            )

        level_entries, level_failures = _run_geography_levels(
            solution_id=solution_id,
            levels=pending_levels,
            generate_level=generate_level,
        )
        base_report["entries"].extend(level_entries)
        base_report["failures"].extend(level_failures)

    base_report["entries"].sort(
        key=lambda item: (item["solutionId"], item["geographyLevel"])
    )
    base_report["elapsedSeconds"] = round(time.time() - started, 2)
    if release_selection is not None:
        try:
            validate_release_entries(
                base_report["entries"],
                selection=release_selection,
                artifact_levels=GEOGRAPHY_LEVELS,
            )
        except ReleaseSelectionError as exc:
            base_report["failures"].append(
                {"stage": "release-completeness", "error": str(exc)}
            )
    report_path = _write_report(output_dir, base_report)
    print(
        f"[mec-compact] wrote {len(base_report['entries'])} artifact(s), "
        f"{len(base_report['failures'])} failure(s) -> {report_path}"
    )
    return 0 if not base_report["failures"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
