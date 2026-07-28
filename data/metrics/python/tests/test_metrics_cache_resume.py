from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import main as pipeline
from blob_manifest import ResolvedManifest
from metric_definitions import computable_metrics
from metrics_contract import (
    PROVENANCE_KEY,
    build_metrics_provenance,
    catalog_signature,
)


def _solution(solution_id: str = "demo", *, domain: str = "land") -> dict:
    return {
        "id": solution_id,
        "domain": domain,
        "scope": domain,
        "displayUrl": f"https://example.test/{solution_id}.tif",
        "blobPath": f"solutions/{solution_id}.tif",
    }


def _manifest(solution: dict) -> ResolvedManifest:
    return ResolvedManifest(
        url="https://example.test/manifest.json",
        raw={},
        public_blob_host="https://example.test",
        layers_by_id={},
        national_solutions=[solution] if solution["domain"] == "land" else [],
        batch_solutions=[solution],
    )


def _write_cache(
    output_dir: Path,
    solution: dict,
    provenance: dict | None,
) -> None:
    cache_path = pipeline.cache_solution_path(output_dir, solution["id"])
    cache_path.parent.mkdir(parents=True)
    domain = solution["domain"]
    metrics = [
        {
            "metricId": definition.metric_id,
            "status": (
                "not_applicable"
                if (
                    domain not in definition.applicable_domains
                    or definition.kind == "aoi_percent"
                )
                else "ready"
            ),
        }
        for definition in computable_metrics()
    ]
    document = {
        "solutionId": solution["id"],
        "generatedAt": "2026-07-23T00:00:00Z",
        "geographies": {
            "national": {"colombia": {"metrics": metrics}},
        },
    }
    if provenance is not None:
        document[PROVENANCE_KEY] = provenance
    cache_path.write_text(json.dumps(document), encoding="utf-8")


def _resume(output_dir: Path, solution: dict):
    return pipeline._resume_entry_for_existing_cache(
        solution,
        _manifest(solution),
        output_dir,
        "metrics/cache",
    )


def test_resume_accepts_matching_catalog_signature(tmp_path: Path):
    solution = _solution()
    _write_cache(
        tmp_path,
        solution,
        build_metrics_provenance(
            "land",
            species_csv_url=pipeline.SPECIES_CSV_URL,
        ),
    )

    entry = _resume(tmp_path, solution)

    assert entry is not None
    assert entry["resumeSkipped"] is True
    assert entry["solutionDomain"] == "land"


def test_catalog_signature_is_deterministic_and_order_sensitive():
    provenance = build_metrics_provenance("land", species_csv_url="source.csv")
    config = provenance["generationConfig"]
    reordered_config = dict(reversed(list(config.items())))

    assert catalog_signature("land", config) == catalog_signature(
        "land",
        reordered_config,
    )
    assert catalog_signature(
        "land",
        config,
        catalog=reversed(computable_metrics()),
    ) != catalog_signature("land", config)


def test_resume_rejects_legacy_cache_without_signature(tmp_path: Path):
    solution = _solution()
    _write_cache(tmp_path, solution, None)

    assert _resume(tmp_path, solution) is None


def test_resume_rejects_applicability_catalog_change(tmp_path: Path):
    solution = _solution()
    provenance = build_metrics_provenance(
        "land",
        species_csv_url=pipeline.SPECIES_CSV_URL,
    )
    definitions = list(computable_metrics())
    definitions[0] = replace(
        definitions[0],
        applicable_domains=frozenset({"marine"}),
    )
    provenance["catalogSignature"] = catalog_signature(
        "land",
        provenance["generationConfig"],
        catalog=definitions,
    )
    _write_cache(tmp_path, solution, provenance)

    assert _resume(tmp_path, solution) is None


def test_resume_rejects_generation_config_change(tmp_path: Path):
    solution = _solution()
    _write_cache(
        tmp_path,
        solution,
        build_metrics_provenance(
            "land",
            national_only=True,
            species_csv_url=pipeline.SPECIES_CSV_URL,
        ),
    )

    assert _resume(tmp_path, solution) is None


def test_resume_rejects_land_cache_for_marine_solution(tmp_path: Path):
    solution = _solution(domain="marine")
    _write_cache(
        tmp_path,
        solution,
        build_metrics_provenance(
            "land",
            species_csv_url=pipeline.SPECIES_CSV_URL,
        ),
    )

    assert _resume(tmp_path, solution) is None
