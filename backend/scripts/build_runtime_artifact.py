from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
METRICS_PIPELINE = REPO_ROOT / "data" / "metrics" / "python" / "metrics_pipeline"
if str(METRICS_PIPELINE) not in sys.path:
    sys.path.insert(0, str(METRICS_PIPELINE))

from blob_manifest import DEFAULT_MANIFEST_URL, fetch_manifest  # noqa: E402
from metric_definitions import METRIC_CATALOG  # noqa: E402
from species_data import CLASS_BUCKETS, compute_pool_sizes, load_species_records  # noqa: E402

PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
DEFAULT_ARTIFACT_DIR = REPO_ROOT / "backend" / "runtime-artifacts"
SPECIES_CSV_PATH = METRICS_PIPELINE / "artifacts" / "species" / "biomod_spp_ranges_updatedIUCN.csv"
SPECIES_MATRIX_GROUPS = (*CLASS_BUCKETS, "threatened")


@dataclass(frozen=True)
class LayerSpec:
    layer_id: str
    url: str
    kind: str
    rendering: dict[str, Any]
    metric_ids: tuple[str, ...]


@dataclass(frozen=True)
class SpeciesMatrixSpec:
    group: str
    url: str
    metric_ids: tuple[str, ...]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the VM runtime artifact for custom AOI metrics.")
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument("--manifest-url", default=DEFAULT_MANIFEST_URL)
    parser.add_argument("--solution-id", default=None)
    parser.add_argument("--force", action="store_true", help="Re-download source rasters.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    artifact_dir = args.artifact_dir.resolve()
    sources_dir = artifact_dir / "sources"
    sources_dir.mkdir(parents=True, exist_ok=True)

    manifest = fetch_manifest(args.manifest_url)
    solution = select_solution(manifest.national_solutions, args.solution_id)
    reference_layer = manifest.layers_by_id.get("ecosistemas")
    if not reference_layer or not reference_layer.get("displayUrl"):
        raise SystemExit("Manifest layer ecosistemas is required as the custom AOI reference grid.")
    print("Selected reference grid: ecosistemas")
    print(f"Sample solution recorded for provenance: {solution.get('id')} ({solution.get('name')})")

    reference = download_source(
        str(reference_layer["displayUrl"]),
        sources_dir / "reference_grid_ecosistemas.tif",
        force=args.force,
    )

    layer_specs = build_layer_specs(manifest.layers_by_id)
    species_specs = build_species_matrix_specs()
    layer_entries: list[dict[str, Any]] = []
    file_entries = [file_entry(reference.path, artifact_dir, reference.sha256, reference.bytes)]
    downloaded_by_url = {str(reference_layer["displayUrl"]): reference}

    for spec in layer_specs:
        cached = downloaded_by_url.get(spec.url)
        if cached is None:
            cached = download_source(
                spec.url,
                sources_dir / f"{safe_filename(spec.layer_id)}.tif",
                force=args.force,
            )
            downloaded_by_url[spec.url] = cached
            file_entries.append(file_entry(cached.path, artifact_dir, cached.sha256, cached.bytes))

        layer_entries.append(
            {
                "layer_id": spec.layer_id,
                "path": str(cached.path.relative_to(artifact_dir)),
                "kind": spec.kind,
                "rendering": spec.rendering,
                "source_url": spec.url,
                "metric_ids": list(spec.metric_ids),
                "checksum": {"algorithm": "sha256", "value": cached.sha256},
                "size_bytes": cached.bytes,
            }
        )

    species_entries: list[dict[str, Any]] = []
    for spec in species_specs:
        cached = download_source(
            spec.url,
            sources_dir / "species-sparse" / f"species_{safe_filename(spec.group)}.smtx.gz",
            force=args.force,
        )
        file_entries.append(file_entry(cached.path, artifact_dir, cached.sha256, cached.bytes))
        species_entries.append(
            {
                "group": spec.group,
                "path": str(cached.path.relative_to(artifact_dir)),
                "source_url": spec.url,
                "metric_ids": list(spec.metric_ids),
                "checksum": {"algorithm": "sha256", "value": cached.sha256},
                "size_bytes": cached.bytes,
            }
        )

    species_pool_sizes = load_species_pool_sizes()
    aggregate_checksum = aggregate_file_checksum(file_entries)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    runtime_manifest = {
        "artifact_version": f"colombia-custom-aoi-v1-{now.replace(':', '').replace('-', '')}",
        "artifact_kind": "colombia-raster-custom-aoi/v1",
        "schema_version": "metrics-artifact-manifest/v1",
        "created_at": now,
        "checksum": {"algorithm": "sha256", "value": aggregate_checksum},
        "source_manifest": {
            "url": manifest.url,
            "public_blob_host": manifest.public_blob_host,
            "reference_grid_layer_id": "ecosistemas",
            "reference_grid_url": reference_layer.get("displayUrl"),
            "sample_solution_id": solution.get("id"),
            "sample_solution_name": solution.get("name"),
            "purpose": "Runtime source rasters for live custom AOI metrics on the VM backend.",
        },
        "reference_raster_path": str(reference.path.relative_to(artifact_dir)),
        "reference_raster_checksum": {"algorithm": "sha256", "value": reference.sha256},
        "raster_layers": layer_entries,
        "species_matrices": species_entries,
        "species_pool_sizes": species_pool_sizes,
        "metric_coverage": metric_coverage(layer_specs, species_specs),
        "files": file_entries,
    }

    manifest_path = artifact_dir / "manifest.json"
    write_json(manifest_path, runtime_manifest)
    print(f"Wrote runtime artifact manifest: {manifest_path}")
    print(f"Downloaded/reused files: {len(file_entries)}")
    print(f"Implemented metric count: {len(runtime_manifest['metric_coverage']['implemented_now'])}")


def select_solution(solutions: list[dict[str, Any]], solution_id: str | None) -> dict[str, Any]:
    if solution_id is None:
        return solutions[0]
    for solution in solutions:
        if str(solution.get("id")) == solution_id:
            return solution
    raise SystemExit(f"Solution id not found in manifest: {solution_id}")


def build_layer_specs(layers_by_id: dict[str, dict[str, Any]]) -> list[LayerSpec]:
    specs: list[LayerSpec] = []
    for layer_id in [
        "ecosistemas",
        "paramos",
        "bosque_seco",
        "wetlands",
        "mangroves",
        "resguardos",
        "comunidades",
    ]:
        layer = layers_by_id.get(layer_id)
        if not layer or not layer.get("displayUrl"):
            print(f"Skipping missing manifest layer: {layer_id}")
            continue
        specs.append(
            LayerSpec(
                layer_id=layer_id,
                url=str(layer["displayUrl"]),
                kind="binary",
                rendering=dict(layer.get("rendering") or {}),
                metric_ids=metric_ids_for_layer(layer_id),
            )
        )

    specs.extend(
        [
            LayerSpec(
                "recarga_agua",
                f"{PUBLIC_BLOB_HOST}/inputs/features/ground_water_recharge/recarga_agua_subterranea_moderado_alto.tif",
                "binary",
                {"valueType": "binary", "selectedValue": 1},
                metric_ids_for_layer("recarga_agua"),
            ),
            LayerSpec(
                "coberturas_forest",
                f"{PUBLIC_BLOB_HOST}/boundaries/coberturas.tif",
                "categorical",
                {"valueType": "binary", "selectedValue": 1},
                metric_ids_for_layer("coberturas_forest"),
            ),
            LayerSpec(
                "coberturas_agriculture",
                f"{PUBLIC_BLOB_HOST}/boundaries/coberturas.tif",
                "categorical",
                {"valueType": "binary", "selectedValue": 2},
                metric_ids_for_layer("coberturas_agriculture"),
            ),
            LayerSpec(
                "coberturas_other",
                f"{PUBLIC_BLOB_HOST}/boundaries/coberturas.tif",
                "categorical",
                {"valueType": "binary", "selectedValues": [3, 4, 5]},
                metric_ids_for_layer("coberturas_other"),
            ),
            LayerSpec(
                "runap_protegidas",
                f"{PUBLIC_BLOB_HOST}/inputs/includes/runap_protected_areas.tif",
                "categorical",
                {},
                metric_ids_for_layer("runap_protegidas"),
            ),
            LayerSpec(
                "runap_parques",
                f"{PUBLIC_BLOB_HOST}/inputs/includes/runap_protected_areas.tif",
                "categorical",
                {"valueType": "binary", "selectedValue": 3},
                metric_ids_for_layer("runap_parques"),
            ),
            LayerSpec(
                "biomasa",
                f"{PUBLIC_BLOB_HOST}/inputs/features/biomass/biomasa_areara+subterranea_1km.tif",
                "continuous",
                {"valueType": "continuous"},
                metric_ids_for_layer("biomasa"),
            ),
            LayerSpec(
                "carbono_organico",
                f"{PUBLIC_BLOB_HOST}/inputs/features/carbon/carbono_organico.tif",
                "continuous",
                {"valueType": "continuous"},
                metric_ids_for_layer("carbono_organico"),
            ),
        ]
    )
    return specs


def metric_ids_for_layer(layer_id: str) -> tuple[str, ...]:
    return tuple(metric.metric_id for metric in METRIC_CATALOG if metric.layer_id == layer_id)


def build_species_matrix_specs() -> list[SpeciesMatrixSpec]:
    return [
        SpeciesMatrixSpec(
            group=group,
            url=f"{PUBLIC_BLOB_HOST}/inputs/features/species-sparse/species_{group}.smtx.gz",
            metric_ids=metric_ids_for_species_group(group),
        )
        for group in SPECIES_MATRIX_GROUPS
    ]


def metric_ids_for_species_group(group: str) -> tuple[str, ...]:
    if group == "threatened":
        return ("threatened_species_count",)
    return tuple(
        metric.metric_id
        for metric in METRIC_CATALOG
        if metric.kind == "species_richness" and metric.species_bucket == group
    )


def load_species_pool_sizes() -> dict[str, Any]:
    records = load_species_records(SPECIES_CSV_PATH)
    pool_sizes = compute_pool_sizes(records)
    return {
        "total_non_fish": pool_sizes.total_non_fish,
        "threatened_total": pool_sizes.threatened_total,
        "by_bucket": dict(pool_sizes.by_bucket),
    }


@dataclass(frozen=True)
class DownloadedSource:
    path: Path
    sha256: str
    bytes: int


def download_source(url: str, target: Path, *, force: bool) -> DownloadedSource:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and not force:
        return DownloadedSource(target, sha256_file(target), target.stat().st_size)

    tmp = target.with_name(f".{target.name}.part")
    req = urllib.request.Request(url, headers={"User-Agent": "dmt-runtime-artifact/0.1"})
    with urllib.request.urlopen(req, timeout=180) as response, tmp.open("wb") as handle:
        shutil.copyfileobj(response, handle)
    tmp.replace(target)
    return DownloadedSource(target, sha256_file(target), target.stat().st_size)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_entry(path: Path, artifact_dir: Path, sha256: str, size_bytes: int) -> dict[str, Any]:
    return {
        "path": str(path.relative_to(artifact_dir)),
        "size_bytes": size_bytes,
        "checksum": {"algorithm": "sha256", "value": sha256},
    }


def aggregate_file_checksum(files: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for entry in sorted(files, key=lambda item: item["path"]):
        digest.update(entry["path"].encode("utf-8"))
        digest.update(str(entry["size_bytes"]).encode("utf-8"))
        digest.update(entry["checksum"]["value"].encode("utf-8"))
    return digest.hexdigest()


def metric_coverage(layer_specs: list[LayerSpec], species_specs: list[SpeciesMatrixSpec]) -> dict[str, Any]:
    implemented = {
        "priority_area_in_region",
        "national_contribution",
        "priority_area_pct_of_region",
        "species_pct_of_national",
    }
    for spec in layer_specs:
        implemented.update(spec.metric_ids)
    for spec in species_specs:
        implemented.update(spec.metric_ids)

    species = [
        metric.metric_id for metric in METRIC_CATALOG if str(metric.kind).startswith("species_")
    ]
    species_not_custom_aoi = ["threatened_species_secured"]
    metadata = [
        metric.metric_id for metric in METRIC_CATALOG if metric.kind in {"metadata_summary", "metadata_coverage"}
    ]
    deferred = [metric.metric_id for metric in METRIC_CATALOG if metric.kind == "deferred_pairwise"]
    blocked = [metric.metric_id for metric in METRIC_CATALOG if metric.kind == "blocked_no_data"]

    return {
        "implemented_now": sorted(implemented),
        "feasible_next": sorted(set(species) - implemented - set(species_not_custom_aoi)),
        "blocked_missing_data_or_definition": sorted(metadata + blocked),
        "unsuitable_live_custom_polygon_without_new_design": sorted(deferred + species_not_custom_aoi),
        "notes": {
            "implemented_now": "Area, binary overlap, percent overlap, land-cover, protected-area, water, carbon, species richness, threatened species count, and national species percent metrics.",
            "feasible_next": "No cataloged species overlap metrics remain feasible with the current custom AOI request contract.",
            "metadata": "Manifest summary metrics are scenario metadata and do not apply directly to arbitrary custom polygons.",
            "deferred": "Pairwise comparison metrics require two scenarios. Threatened species secured requires a scenario target percent that custom AOI requests do not currently provide.",
        },
    }


def safe_filename(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in value)


def write_json(path: Path, doc: dict[str, Any]) -> None:
    tmp = path.with_name(f".{path.name}.tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(doc, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    tmp.replace(path)


if __name__ == "__main__":
    main()
