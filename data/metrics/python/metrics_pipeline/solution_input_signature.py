"""Canonical signatures for every solution-specific metric input."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from blob_manifest import ResolvedManifest
from solution_catalog import SolutionCatalogEntry

SOLUTION_INPUT_SIGNATURE_FORMAT = "solution-input-signature-v3"


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def build_solution_input_signature(
    *,
    solution: dict[str, Any],
    catalog_entry: SolutionCatalogEntry,
    manifest: ResolvedManifest,
    metrics_provenance: dict[str, Any],
    source_identity: dict[str, Any],
) -> dict[str, str]:
    """Hash all manifest, catalog, external-source, and calculation inputs."""

    manifest_solution = {
        key: value
        for key, value in solution.items()
        if not key.startswith("_") and key != "precomputedMetricUrls"
    }
    provenance_contract = {
        key: value
        for key, value in metrics_provenance.items()
        if key not in {"releaseId", "reusedFromReleaseId"}
    }
    descriptor = {
        "format": SOLUTION_INPUT_SIGNATURE_FORMAT,
        "catalogSolution": catalog_entry.to_dict(),
        "manifestSolution": manifest_solution,
        "manifestLayers": {
            layer_id: manifest.layers_by_id[layer_id]
            for layer_id in sorted(manifest.layers_by_id)
        },
        "sourceIdentity": source_identity,
        "metricsContract": provenance_contract,
    }
    return {
        "format": SOLUTION_INPUT_SIGNATURE_FORMAT,
        "sha256": canonical_sha256(descriptor),
    }
