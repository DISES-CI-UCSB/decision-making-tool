"""Build regional SIRAP custom-AOI runtime artifacts for the VM backend."""

from __future__ import annotations

import argparse
import copy
import csv
import json
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
METRICS_PIPELINE = REPO_ROOT / "data" / "metrics" / "python" / "metrics_pipeline"
for _import_root in (BACKEND_ROOT, METRICS_PIPELINE):
    if str(_import_root) not in sys.path:
        sys.path.insert(0, str(_import_root))

from raster_align import exact_grid_matches, policy_for_layer  # noqa: E402
from raster_metrics import RasterFingerprint  # noqa: E402
from scripts.aligned_cache import read_fingerprint, sha256_file  # noqa: E402
from sparse.species_bitset import build_species_bitset  # noqa: E402
from scripts.build_runtime_artifact import (  # noqa: E402
    ECOSYSTEM_SOURCE_URLS_BY_GRID,
    MESA_ECOSYSTEM_CATALOG_URL,
    DownloadedSource,
    aggregate_file_checksum,
    copy_source,
    download_source,
    file_entry,
    load_species_pool_sizes,
    metric_ids_for_layer,
    safe_filename,
    write_json,
)

PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
DEFAULT_RELEASE_ID = "sirap-2026-09-02-v6"
DEFAULT_ARTIFACT_DIR = REPO_ROOT / "backend" / "runtime-artifacts" / "sirap"
SUPPORTED_SIRAP_IDS = {
    "eje-cafetero": 40,
    "orinoquia": 16,
}
ECOSYSTEM_LAYER_ID = "ecosistemas_IAVH_2024"
STRATEGIC_LAYER_SPECS = (
    ("paramos", "paramos.tif", "ecosystem_coverage_paramo"),
    ("wetlands", "humedales.tif", "ecosystem_coverage_wetlands"),
    ("bosque_seco", "bosque_seco.tif", "ecosystem_coverage_dry_forest"),
    ("mangroves", "mangroves.tif", "mangrove_coverage"),
)
STRATEGIC_METRIC_IDS = {layer_id: metric_id for layer_id, _, metric_id in STRATEGIC_LAYER_SPECS}
ARTIFACT_KIND = "sirap-raster-custom-aoi/v1"
SCHEMA_VERSION = "metrics-artifact-manifest/v1"
SOURCE_SUMMARY_FORMAT = "sirap-source-summary-v1"
SIRAP_SOLUTION_TARGETS_FORMAT = "sirap-solution-targets-v1"
SIRAP_RUNTIME_COVERAGE_FORMAT = "sirap-runtime-coverage-v1"
SIRAP_TARGET_EVALUATION = "prioritizr_model"
SIRAP_ECOSYSTEM_EVALUATIONS = frozenset({"prioritizr_model", "post-hoc"})
SIRAP_SPECIES_EVALUATIONS = frozenset({SIRAP_TARGET_EVALUATION})
SIRAP_TARGET_FEATURE_TYPES = frozenset({"ecosystem", "species", "strategic ecosystem"})


@dataclass(frozen=True)
class SirapReleaseManifest:
    url: str
    release_id: str
    public_blob_host: str
    solutions: list[dict[str, Any]]


@dataclass(frozen=True)
class ReferenceGridMetadata:
    sirap_id: str
    source_url: str
    sha256: str
    size_bytes: int
    crs: str
    width: int
    height: int
    transform: tuple[float, float, float, float, float, float]
    valid_cell_count: int
    sample_solution_id: str

    def manifest_metadata(self) -> dict[str, Any]:
        return {
            "name": self.sirap_id,
            "summary": (
                f"Regional SIRAP planning grid for {self.sirap_id!r} "
                f"({self.width}x{self.height}, {self.crs})."
            ),
            "source": self.source_url,
            "crs": self.crs,
            "width": self.width,
            "height": self.height,
            "transform": list(self.transform),
            "valid_cell_count": self.valid_cell_count,
            "sample_solution_id": self.sample_solution_id,
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a regional SIRAP custom-AOI runtime artifact."
    )
    parser.add_argument(
        "--sirap-id",
        required=True,
        choices=sorted(SUPPORTED_SIRAP_IDS),
        help="Regional SIRAP identifier to package.",
    )
    parser.add_argument(
        "--release-id",
        default=DEFAULT_RELEASE_ID,
        help="Immutable SIRAP release identifier.",
    )
    parser.add_argument(
        "--artifact-dir",
        type=Path,
        default=DEFAULT_ARTIFACT_DIR,
        help="Directory where the regional artifact tree is written.",
    )
    parser.add_argument(
        "--manifest-url",
        default=None,
        help=(
            "SIRAP runtime release manifest URL. Defaults to the published "
            "release manifest on blob storage."
        ),
    )
    parser.add_argument(
        "--packet-manifest-url",
        default=None,
        help=(
            "Approved packet manifest URL or local path with regionalInputPacket "
            "bindings. Defaults to the release's regional packet manifest on blob."
        ),
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download source rasters and summaries.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    release_id = str(args.release_id).strip()
    sirap_id = str(args.sirap_id).strip()
    manifest_url = (
        str(args.manifest_url).strip()
        if args.manifest_url
        else release_manifest_url(release_id)
    )
    packet_manifest_url = (
        str(args.packet_manifest_url).strip()
        if args.packet_manifest_url
        else default_packet_manifest_url(release_id, sirap_id)
    )

    release = fetch_release_manifest(manifest_url, release_id)
    regional_solutions = filter_solutions(release.solutions, sirap_id)
    expected_count = SUPPORTED_SIRAP_IDS[sirap_id]
    if len(regional_solutions) != expected_count:
        raise SystemExit(
            f"Release {release_id!r} has {len(regional_solutions)} solutions for "
            f"{sirap_id!r}; expected {expected_count}."
        )

    packet_solutions = load_packet_solutions(packet_manifest_url, sirap_id)
    packet_by_id = {str(solution["id"]): solution for solution in packet_solutions}
    sample_solution = regional_solutions[0]
    sample_packet = packet_by_id.get(str(sample_solution["id"]))
    if sample_packet is None:
        raise SystemExit(
            f"Packet manifest is missing regionalInputPacket bindings for "
            f"{sample_solution['id']!r}."
        )

    artifact_dir = (args.artifact_dir / sirap_id).resolve()
    sources_dir = artifact_dir / "sources"
    sources_dir.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    artifact_version = f"{sirap_id}-custom-aoi-{now.replace(':', '').replace('-', '')}"

    reference_source = download_source(
        str(sample_solution["displayUrl"]),
        sources_dir / f"reference_solution_{safe_filename(sample_solution['id'])}.tif",
        force=args.force,
    )
    reference_grid = resolve_reference_grid(
        sirap_id,
        sample_solution,
        reference_source,
    )
    reference_fingerprint = read_fingerprint(reference_source.path)
    file_entries = [
        file_entry(
            reference_source.path,
            artifact_dir,
            reference_source.sha256,
            reference_source.bytes,
        )
    ]

    layer_entries: list[dict[str, Any]] = []
    packet_layers = sample_packet["regionalInputPacket"]["layers"]
    ecosystem_binding = packet_layers.get(ECOSYSTEM_LAYER_ID)
    if not isinstance(ecosystem_binding, dict):
        raise SystemExit(
            f"Packet manifest for {sirap_id!r} is missing layer {ECOSYSTEM_LAYER_ID!r}."
        )
    ecosystem = download_source(
        str(ecosystem_binding["url"]),
        sources_dir / f"{safe_filename(ECOSYSTEM_LAYER_ID)}.tif",
        force=args.force,
    )
    if ecosystem.sha256 != str(ecosystem_binding["sha256"]):
        raise SystemExit(
            f"{ECOSYSTEM_LAYER_ID} checksum does not match the packet binding."
        )
    file_entries.append(
        file_entry(ecosystem.path, artifact_dir, ecosystem.sha256, ecosystem.bytes)
    )
    layer_entries.append(
        {
            "layer_id": ECOSYSTEM_LAYER_ID,
            "path": str(ecosystem.path.relative_to(artifact_dir)),
            "kind": "categorical",
            "rendering": ecosystem_binding.get("rendering") or {"valueType": "categorical"},
            "source_url": str(ecosystem_binding["url"]),
            "metric_ids": list(metric_ids_for_layer(ECOSYSTEM_LAYER_ID)),
            "checksum": {"algorithm": "sha256", "value": ecosystem.sha256},
            "size_bytes": ecosystem.bytes,
        }
    )
    supplemental_layers, packaged_layer_ids = build_supplemental_raster_layers(
        packet_layers,
        sources_dir=sources_dir,
        artifact_dir=artifact_dir,
        reference_fingerprint=reference_fingerprint,
        file_entries=file_entries,
        force=args.force,
    )
    layer_entries.extend(supplemental_layers)
    if packaged_layer_ids - {ECOSYSTEM_LAYER_ID}:
        print(
            "Packaged supplemental raster layers: "
            + ", ".join(sorted(packaged_layer_ids - {ECOSYSTEM_LAYER_ID}))
        )

    summary_binding = sample_packet["regionalInputPacket"]["authoritativeSummary"]
    summary_url = published_source_summary_url(release, sample_solution["id"])
    summary = download_source(
        summary_url,
        sources_dir / "authoritative-summary" / f"{safe_filename(sample_solution['id'])}.summary.csv",
        force=args.force,
    )
    file_entries.append(
        file_entry(summary.path, artifact_dir, summary.sha256, summary.bytes)
    )

    ecosystem_inventory = build_ecosystem_inventory_bundle(
        ecosystem,
        sources_dir,
        artifact_dir,
        file_entries,
        force=args.force,
    )

    mec_national_denominator_url = extract_mec_national_denominator_url(regional_solutions)
    mec_national_denominator: dict[str, Any] | None = None
    if mec_national_denominator_url is not None:
        denominator = download_source(
            mec_national_denominator_url,
            sources_dir / "mesa-coverage" / "national-denominator.mec.json",
            force=args.force,
        )
        file_entries.append(
            file_entry(
                denominator.path,
                artifact_dir,
                denominator.sha256,
                denominator.bytes,
            )
        )
        mec_national_denominator = {
            "path": str(denominator.path.relative_to(artifact_dir)),
            "source_url": mec_national_denominator_url,
            "checksum": {"algorithm": "sha256", "value": denominator.sha256},
            "size_bytes": denominator.bytes,
        }

    solution_rasters = build_solution_rasters(regional_solutions)
    species_entries = build_species_matrix_bundle(
        sample_packet["regionalInputPacket"],
        sources_dir,
        artifact_dir,
        file_entries,
        force=args.force,
    )
    species_bitset = build_species_bitset_bundle(
        species_entries,
        artifact_dir,
        sources_dir,
        file_entries,
    )
    species_pool_sizes = resolve_species_pool_sizes(sample_packet["regionalInputPacket"])
    species_matrices: list[dict[str, Any]] | dict[str, Any] = species_entries
    if not species_entries:
        species_matrices = build_species_matrix_stub(sample_packet["regionalInputPacket"])
    sirap_coverage = build_sirap_coverage_bundle(
        release,
        regional_solutions,
        packet_by_id,
        layer_entries,
        sources_dir,
        artifact_dir,
        file_entries,
        mec_national_denominator,
        force=args.force,
    )
    aggregate_checksum = aggregate_file_checksum(file_entries)
    runtime_manifest = {
        "artifact_version": artifact_version,
        "artifact_kind": ARTIFACT_KIND,
        "schema_version": SCHEMA_VERSION,
        "created_at": now,
        "checksum": {"algorithm": "sha256", "value": aggregate_checksum},
        "checksum_scope": "files/v1",
        "sirap_id": sirap_id,
        "release_id": release_id,
        "source_manifest": {
            "url": release.url,
            "public_blob_host": release.public_blob_host,
            "packet_manifest_url": packet_manifest_url,
            "sample_solution_id": sample_solution.get("id"),
            "sample_solution_name": sample_solution.get("name"),
            "purpose": (
                "Runtime source rasters for live custom AOI metrics on regional "
                "SIRAP solutions."
            ),
        },
        "reference_grid": reference_grid.manifest_metadata(),
        "reference_raster_path": str(reference_source.path.relative_to(artifact_dir)),
        "reference_raster_checksum": {
            "algorithm": "sha256",
            "value": reference_source.sha256,
        },
        "valid_data": {
            "source": "reference_solution_raster",
            "valid_cell_count": reference_grid.valid_cell_count,
            "notes": (
                "Valid planning cells are inferred from the first regional solution "
                "raster mask; Phase 1 uses the solution grid as the AOI support."
            ),
        },
        "authoritative_summary": {
            "format": SOURCE_SUMMARY_FORMAT,
            "path": str(summary.path.relative_to(artifact_dir)),
            "source_url": summary_url,
            "packet_binding": {
                "url": str(summary_binding["url"]),
                "sha256": str(summary_binding["sha256"]),
                "schema": str(summary_binding.get("schema") or ""),
            },
            "checksum": {"algorithm": "sha256", "value": summary.sha256},
            "size_bytes": summary.bytes,
        },
        "raster_layers": layer_entries,
        "ecosystem_inventory": ecosystem_inventory,
        "species_matrices": species_matrices,
        **({"species_bitset": species_bitset} if species_bitset is not None else {}),
        **({"species_pool_sizes": species_pool_sizes} if species_pool_sizes is not None else {}),
        "mec_national_denominator": mec_national_denominator,
        "sirap_coverage": sirap_coverage,
        "solution_rasters": solution_rasters,
        "files": file_entries,
    }

    manifest_path = artifact_dir / "manifest.json"
    write_json(manifest_path, runtime_manifest)
    print(f"Wrote SIRAP runtime artifact manifest: {manifest_path}")
    print(f"Regional solutions registered: {len(solution_rasters)}")
    print(f"Downloaded/reused files: {len(file_entries)}")
    if isinstance(species_matrices, dict) and species_matrices.get("status") == "stubbed":
        print("No regional species SMSP matrices were packaged.")


def release_manifest_url(release_id: str) -> str:
    return f"{PUBLIC_BLOB_HOST}/releases/{release_id}/manifest.json"


def default_packet_manifest_url(release_id: str, sirap_id: str) -> str:
    return f"{PUBLIC_BLOB_HOST}/releases/{release_id}/packet-manifests/{sirap_id}.json"


def published_source_summary_url(release: SirapReleaseManifest, solution_id: str) -> str:
    return (
        f"{release.public_blob_host.rstrip('/')}/releases/"
        f"{release.release_id}/source-summaries/{solution_id}.summary.csv"
    )


def fetch_release_manifest(url: str, release_id: str) -> SirapReleaseManifest:
    document = fetch_json(url)
    solutions = document.get("solutions")
    if not isinstance(solutions, list) or not solutions:
        raise SystemExit(f"SIRAP release manifest has no solutions: {url}")
    public_blob_host = str(document.get("publicBlobHost") or PUBLIC_BLOB_HOST)
    manifest_release_id = str(document.get("releaseId") or release_id)
    if manifest_release_id != release_id:
        raise SystemExit(
            f"Release manifest {url!r} declares releaseId {manifest_release_id!r}; "
            f"expected {release_id!r}."
        )
    return SirapReleaseManifest(
        url=url,
        release_id=manifest_release_id,
        public_blob_host=public_blob_host,
        solutions=solutions,
    )


def load_packet_solutions(url: str, sirap_id: str) -> list[dict[str, Any]]:
    document = fetch_json(url)
    solutions = document.get("solutions")
    if not isinstance(solutions, list) or not solutions:
        raise SystemExit(f"Packet manifest has no solutions: {url}")
    regional = [
        solution
        for solution in solutions
        if str(solution.get("sirapId") or "") == sirap_id
        and isinstance(solution.get("regionalInputPacket"), dict)
    ]
    if not regional:
        raise SystemExit(
            f"Packet manifest {url!r} has no regionalInputPacket entries for {sirap_id!r}."
        )
    return regional


def filter_solutions(solutions: list[dict[str, Any]], sirap_id: str) -> list[dict[str, Any]]:
    regional = [
        solution
        for solution in solutions
        if str(solution.get("scope") or "").strip().lower() == "sirap"
        and str(solution.get("sirapId") or "") == sirap_id
    ]
    return sorted(regional, key=lambda item: str(item.get("id") or ""))


def build_supplemental_raster_layers(
    packet_layers: dict[str, Any],
    *,
    sources_dir: Path,
    artifact_dir: Path,
    reference_fingerprint: RasterFingerprint,
    file_entries: list[dict[str, Any]],
    force: bool,
) -> tuple[list[dict[str, Any]], set[str]]:
    """Package packet-bound metric layers, falling back to national strategic rasters."""
    layer_entries: list[dict[str, Any]] = []
    packaged_layer_ids: set[str] = set()

    for layer_id, binding in sorted(packet_layers.items()):
        if layer_id == ECOSYSTEM_LAYER_ID or not isinstance(binding, dict):
            continue
        source_url = str(binding.get("url") or "").strip()
        if not source_url:
            continue
        filename = Path(source_url.split("?", 1)[0]).name or f"{layer_id}.tif"
        packaged, aligned_to_reference = package_aligned_layer(
            layer_id,
            source_url,
            filename,
            sources_dir=sources_dir,
            reference_fingerprint=reference_fingerprint,
            force=force,
            expected_sha256=str(binding.get("sha256") or "").strip() or None,
            cache_subdir="packet-layers",
        )
        if aligned_to_reference:
            print(
                f"Aligned {layer_id} to {reference_fingerprint.crs} "
                f"{reference_fingerprint.width}x{reference_fingerprint.height}."
            )
        file_entries.append(
            file_entry(packaged.path, artifact_dir, packaged.sha256, packaged.bytes)
        )
        entry = _layer_manifest_entry(
            layer_id,
            binding,
            packaged,
            artifact_dir,
            source_url,
        )
        layer_entries.append(entry)
        packaged_layer_ids.add(layer_id)

    for layer_id, filename, metric_id in STRATEGIC_LAYER_SPECS:
        if layer_id in packaged_layer_ids:
            continue
        strategic_url = f"{PUBLIC_BLOB_HOST}/inputs/features/strategic/{filename}"
        packaged, aligned_to_reference = package_aligned_layer(
            layer_id,
            strategic_url,
            filename,
            sources_dir=sources_dir,
            reference_fingerprint=reference_fingerprint,
            force=force,
            cache_subdir="strategic",
        )
        if aligned_to_reference:
            print(
                f"Aligned {layer_id} to {reference_fingerprint.crs} "
                f"{reference_fingerprint.width}x{reference_fingerprint.height}."
            )
        file_entries.append(
            file_entry(packaged.path, artifact_dir, packaged.sha256, packaged.bytes)
        )
        layer_entries.append(
            {
                "layer_id": layer_id,
                "path": str(packaged.path.relative_to(artifact_dir)),
                "kind": "binary",
                "rendering": {"valueType": "binary", "selectedValue": 1},
                "metric_ids": [metric_id],
                "source_url": strategic_url,
                "checksum": {"algorithm": "sha256", "value": packaged.sha256},
                "size_bytes": packaged.bytes,
            }
        )
        packaged_layer_ids.add(layer_id)

    return layer_entries, packaged_layer_ids


def _layer_manifest_entry(
    layer_id: str,
    binding: dict[str, Any],
    packaged: DownloadedSource,
    artifact_dir: Path,
    source_url: str,
) -> dict[str, Any]:
    metric_ids = list(metric_ids_for_layer(layer_id))
    if not metric_ids and layer_id in STRATEGIC_METRIC_IDS:
        metric_ids = [STRATEGIC_METRIC_IDS[layer_id]]
    entry: dict[str, Any] = {
        "layer_id": layer_id,
        "path": str(packaged.path.relative_to(artifact_dir)),
        "kind": _layer_kind(binding),
        "rendering": binding.get("rendering") or {"valueType": "categorical"},
        "source_url": source_url,
        "checksum": {"algorithm": "sha256", "value": packaged.sha256},
        "size_bytes": packaged.bytes,
    }
    if metric_ids:
        entry["metric_ids"] = metric_ids
    return entry


def _layer_kind(binding: dict[str, Any]) -> str:
    alignment = binding.get("alignment")
    if isinstance(alignment, dict):
        layer_class = str(alignment.get("layerClass") or "").strip()
        if layer_class == "fraction_or_density":
            return "continuous"
        if layer_class in {"binary", "categorical"}:
            return layer_class
    rendering = binding.get("rendering")
    if isinstance(rendering, dict):
        value_type = str(rendering.get("valueType") or "").strip()
        if value_type == "continuous":
            return "continuous"
        if value_type == "binary":
            return "binary"
    return "categorical"


def package_aligned_layer(
    layer_id: str,
    source_url: str,
    filename: str,
    *,
    sources_dir: Path,
    reference_fingerprint: RasterFingerprint,
    force: bool,
    expected_sha256: str | None = None,
    cache_subdir: str = "layers",
) -> tuple[DownloadedSource, bool]:
    """Download one metric layer and align it to the regional reference grid when needed."""
    raw = download_source(
        source_url,
        sources_dir / cache_subdir / f"raw_{filename}",
        force=force,
    )
    if expected_sha256 and raw.sha256 != expected_sha256:
        raise SystemExit(
            f"{layer_id} checksum does not match the packet binding."
        )
    target = sources_dir / cache_subdir / filename
    source_fingerprint = read_fingerprint(raw.path)
    if exact_grid_matches(source_fingerprint, reference_fingerprint):
        return copy_source(raw.path, target), False

    align_raster_to_reference_grid(
        raw.path,
        target,
        layer_id=layer_id,
        reference_fingerprint=reference_fingerprint,
    )
    return DownloadedSource(target, sha256_file(target), target.stat().st_size), True


def resolve_species_pool_sizes(packet: dict[str, Any]) -> dict[str, Any] | None:
    species = packet.get("species")
    if isinstance(species, dict):
        denominator = species.get("nationalDenominator")
        if isinstance(denominator, dict):
            total_non_fish = denominator.get("nonFishCount")
            if isinstance(total_non_fish, (int, float)) and total_non_fish > 0:
                pool_sizes: dict[str, Any] = {"total_non_fish": int(total_non_fish)}
                by_bucket = denominator.get("byBucket")
                if isinstance(by_bucket, dict) and by_bucket:
                    pool_sizes["by_bucket"] = {
                        str(key): int(value)
                        for key, value in by_bucket.items()
                        if isinstance(value, (int, float))
                    }
                threatened_total = denominator.get("threatenedTotal")
                if isinstance(threatened_total, (int, float)) and threatened_total > 0:
                    pool_sizes["threatened_total"] = int(threatened_total)
                return pool_sizes
    try:
        return load_species_pool_sizes()
    except (OSError, ValueError, KeyError):
        return None


def align_raster_to_reference_grid(
    source_path: Path,
    target_path: Path,
    *,
    layer_id: str,
    reference_fingerprint: RasterFingerprint,
) -> None:
    """Reproject one strategic layer onto the regional SIRAP reference grid."""
    if reference_fingerprint.crs is None:
        raise SystemExit(f"Reference grid for {layer_id!r} has no CRS.")

    policy = policy_for_layer(layer_id)
    resampling = {
        "nearest": Resampling.nearest,
        "bilinear": Resampling.bilinear,
        "average": Resampling.average,
        "sum": Resampling.sum,
    }[policy.resampling]

    target_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = target_path.with_name(f".{target_path.name}.part")
    with rasterio.open(source_path) as source:
        if source.count != 1:
            raise SystemExit(f"Strategic layer {layer_id!r} must have exactly one band.")
        if source.crs is None:
            raise SystemExit(f"Strategic layer {layer_id!r} has no CRS.")

        source_array = source.read(1)
        destination_array = np.full(
            (reference_fingerprint.height, reference_fingerprint.width),
            source.nodata if source.nodata is not None else 0,
            dtype=source_array.dtype,
        )
        reproject(
            source=source_array,
            destination=destination_array,
            src_transform=source.transform,
            src_crs=source.crs,
            src_nodata=source.nodata,
            dst_transform=rasterio.Affine(*reference_fingerprint.transform),
            dst_crs=reference_fingerprint.crs,
            dst_nodata=source.nodata,
            resampling=resampling,
            init_dest_nodata=True,
        )
        profile = source.profile.copy()
        profile.update(
            {
                "driver": "GTiff",
                "height": reference_fingerprint.height,
                "width": reference_fingerprint.width,
                "transform": rasterio.Affine(*reference_fingerprint.transform),
                "crs": reference_fingerprint.crs,
                "count": 1,
            }
        )
        with rasterio.open(tmp, "w", **profile) as destination:
            destination.write(destination_array, 1)
    tmp.replace(target_path)


def resolve_reference_grid(
    sirap_id: str,
    sample_solution: dict[str, Any],
    source: DownloadedSource,
) -> ReferenceGridMetadata:
    fingerprint = read_fingerprint(source.path)
    with rasterio.open(source.path) as dataset:
        data = dataset.read(1, masked=True)
        valid_cell_count = int(np.count_nonzero(~data.mask))
    return ReferenceGridMetadata(
        sirap_id=sirap_id,
        source_url=str(sample_solution["displayUrl"]),
        sha256=source.sha256,
        size_bytes=source.bytes,
        crs=str(fingerprint.crs),
        width=int(fingerprint.width),
        height=int(fingerprint.height),
        transform=tuple(float(value) for value in fingerprint.transform),
        valid_cell_count=valid_cell_count,
        sample_solution_id=str(sample_solution["id"]),
    )


def build_solution_rasters(solutions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "solution_id": str(solution["id"]),
            "source_url": str(solution["displayUrl"]),
            "blob_path": str(solution.get("blobPath") or ""),
            "raster_sha256": str(solution.get("rasterSha256") or ""),
            "category_semantics": {
                "1": "new_prioritizr",
                "2": "pre_existing_aggregate",
            },
        }
        for solution in solutions
    ]


def build_ecosystem_inventory_bundle(
    ecosystem: DownloadedSource,
    sources_dir: Path,
    artifact_dir: Path,
    file_entries: list[dict[str, Any]],
    *,
    force: bool,
) -> dict[str, Any]:
    inventory_sources = ECOSYSTEM_SOURCE_URLS_BY_GRID["land-solution"]
    bundle: dict[str, Any] = {
        "raster": {
            "path": str(ecosystem.path.relative_to(artifact_dir)),
            "source_url": None,
            "checksum": {"algorithm": "sha256", "value": ecosystem.sha256},
            "size_bytes": ecosystem.bytes,
        }
    }
    for source_name in ("crosswalk", "provenance"):
        source_url = inventory_sources[source_name]
        suffix = ".csv" if source_name == "crosswalk" else ".json"
        cached = download_source(
            source_url,
            sources_dir / "ecosystems" / f"mec-composite-{source_name}{suffix}",
            force=force,
        )
        file_entries.append(
            file_entry(cached.path, artifact_dir, cached.sha256, cached.bytes)
        )
        bundle[source_name] = {
            "path": str(cached.path.relative_to(artifact_dir)),
            "source_url": source_url,
            "checksum": {"algorithm": "sha256", "value": cached.sha256},
            "size_bytes": cached.bytes,
        }

    provenance_path = artifact_dir / bundle["provenance"]["path"]
    provenance = json.loads(provenance_path.read_text(encoding="utf-8-sig"))
    patched = copy.deepcopy(provenance)
    outputs = patched.setdefault("outputs", {})
    composite = outputs.setdefault("compositeRaster", {})
    composite["sha256"] = ecosystem.sha256
    provenance_path.write_text(
        json.dumps(patched, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    patched_sha256 = sha256_file(provenance_path)
    patched_size = provenance_path.stat().st_size
    for entry in file_entries:
        if entry["path"] == bundle["provenance"]["path"]:
            entry["checksum"]["value"] = patched_sha256
            entry["size_bytes"] = patched_size
            break
    bundle["provenance"]["checksum"]["value"] = patched_sha256
    bundle["provenance"]["size_bytes"] = patched_size
    return bundle


def build_sirap_coverage_bundle(
    release: SirapReleaseManifest,
    solutions: list[dict[str, Any]],
    packet_by_id: dict[str, dict[str, Any]],
    layer_entries: list[dict[str, Any]],
    sources_dir: Path,
    artifact_dir: Path,
    file_entries: list[dict[str, Any]],
    mec_national_denominator: dict[str, Any] | None,
    *,
    force: bool,
) -> dict[str, Any]:
    catalog = download_source(
        MESA_ECOSYSTEM_CATALOG_URL,
        sources_dir / "sirap-coverage" / "ecosistemas_IDs_IAVH_2024.csv",
        force=force,
    )
    file_entries.append(
        file_entry(catalog.path, artifact_dir, catalog.sha256, catalog.bytes)
    )

    coverage_dir = sources_dir / "sirap-coverage"
    solution_targets: dict[str, dict[str, Any]] = {}
    for solution in solutions:
        solution_id = str(solution["id"])
        packet = packet_by_id.get(solution_id)
        if packet is None:
            raise SystemExit(
                f"Packet manifest is missing regionalInputPacket bindings for "
                f"{solution_id!r}."
            )
        summary_url = published_source_summary_url(release, solution_id)
        summary = download_source(
            summary_url,
            coverage_dir / f"{safe_filename(solution_id)}.summary.csv",
            force=force,
        )
        file_entries.append(
            file_entry(summary.path, artifact_dir, summary.sha256, summary.bytes)
        )
        targets = parse_sirap_summary_targets(
            summary.path,
            scenario_name=str(solution.get("name") or ""),
        )
        targets_path = coverage_dir / f"{safe_filename(solution_id)}.targets.json"
        write_json(
            targets_path,
            {
                "format": SIRAP_SOLUTION_TARGETS_FORMAT,
                "solution_id": solution_id,
                "targets": targets,
            },
        )
        targets_sha256 = sha256_file(targets_path)
        targets_size = targets_path.stat().st_size
        file_entries.append(
            file_entry(targets_path, artifact_dir, targets_sha256, targets_size)
        )
        solution_targets[solution_id] = {
            "path": str(targets_path.relative_to(artifact_dir)),
            "source_url": summary_url,
            "summary_path": str(summary.path.relative_to(artifact_dir)),
            "checksum": {"algorithm": "sha256", "value": targets_sha256},
            "size_bytes": targets_size,
            "target_count": len(targets),
        }

    bundle: dict[str, Any] = {
        "format": SIRAP_RUNTIME_COVERAGE_FORMAT,
        "ecosystems": {
            "raster_layer_id": ECOSYSTEM_LAYER_ID,
            "catalog": {
                "path": str(catalog.path.relative_to(artifact_dir)),
                "source_url": MESA_ECOSYSTEM_CATALOG_URL,
                "checksum": {"algorithm": "sha256", "value": catalog.sha256},
                "size_bytes": catalog.bytes,
            },
        },
        "solution_targets": solution_targets,
    }
    if mec_national_denominator is not None:
        bundle["national_denominator"] = mec_national_denominator
    return bundle


def parse_sirap_summary_targets(summary_path: Path, *, scenario_name: str) -> list[dict[str, Any]]:
    with summary_path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        header_map = {
            _normalized_column(name): name
            for name in (reader.fieldnames or [])
            if name is not None
        }

    def value(row: dict[str, Any], *names: str) -> str:
        for name in names:
            column = header_map.get(_normalized_column(name))
            if column is not None and row.get(column) not in (None, ""):
                return str(row[column]).strip()
        return ""

    expected_scenario = _normalized_scenario(scenario_name)
    targets: list[dict[str, Any]] = []
    for row in rows:
        evaluated = value(row, "evaluated", "evaluation", "evaluated_by").casefold()
        raw_type = value(row, "feature_type", "feature type", "type").casefold()
        if raw_type not in SIRAP_TARGET_FEATURE_TYPES:
            continue
        allowed_evaluations = (
            SIRAP_ECOSYSTEM_EVALUATIONS
            if raw_type in {"ecosystem", "strategic ecosystem"}
            else SIRAP_SPECIES_EVALUATIONS
        )
        if evaluated not in allowed_evaluations:
            continue
        scenario = value(row, "scenario", "scenario_name", "scenario name")
        normalized_scenario = _normalized_scenario(scenario)
        if (
            expected_scenario
            and normalized_scenario
            and not _scenario_matches(expected_scenario, normalized_scenario)
        ):
            continue
        feature = value(row, "feature", "feature_name", "feature name")
        if not feature:
            continue
        raw_relative_target = value(
            row, "relative_target", "relative target", "target", "relativeTarget"
        )
        if not raw_relative_target or raw_relative_target.upper() == "NA":
            continue
        try:
            relative_target = float(raw_relative_target)
        except ValueError:
            continue
        feature_class = value(row, "class", "feature_class", "feature class") or None
        if feature_class == "NA":
            feature_class = None
        targets.append(
            {
                "feature": feature,
                "feature_type": raw_type,
                "class": feature_class,
                "relative_target": relative_target,
                "evaluated": evaluated,
            }
        )
    return targets


def _normalized_column(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def _normalized_scenario(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def _scenario_matches(expected: str, actual: str) -> bool:
    """Accept release naming variants that add/remove separators or prefixes."""
    return expected == actual or expected in actual or actual in expected


def build_species_matrix_bundle(
    packet: dict[str, Any],
    sources_dir: Path,
    artifact_dir: Path,
    file_entries: list[dict[str, Any]],
    *,
    force: bool,
) -> list[dict[str, Any]]:
    species = packet.get("species")
    if not isinstance(species, dict) or not isinstance(species.get("matrices"), list):
        return []

    entries: list[dict[str, Any]] = []
    for index, binding in enumerate(species["matrices"]):
        if not isinstance(binding, dict):
            continue
        group = _sirap_species_group(binding.get("taxonomicClass"))
        source_url = str(binding.get("url") or "").strip()
        expected_sha256 = str(binding.get("sha256") or "").strip()
        if group is None or not source_url or not expected_sha256:
            continue
        suffix = ".smsp.gz" if source_url.endswith(".gz") else ".smsp"
        source = download_source(
            source_url,
            sources_dir / "species" / f"{group}-{index}{suffix}",
            force=force,
        )
        if source.sha256 != expected_sha256:
            raise SystemExit(f"Species matrix {group} checksum does not match binding.")
        file_entries.append(file_entry(source.path, artifact_dir, source.sha256, source.bytes))
        entries.append(
            {
                "group": group,
                "path": str(source.path.relative_to(artifact_dir)),
                "source_url": source_url,
                "checksum": {"algorithm": "sha256", "value": source.sha256},
                "size_bytes": source.bytes,
                "grid_sha256": str(binding.get("gridSha256") or ""),
            }
        )
    return entries


def build_species_bitset_bundle(
    species_entries: list[dict[str, Any]],
    artifact_dir: Path,
    sources_dir: Path,
    file_entries: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Build the detailed custom-AOI index from the regional species matrices."""
    if not species_entries:
        return None

    matrix_paths = [
        (str(entry["group"]), artifact_dir / str(entry["path"]))
        for entry in species_entries
    ]
    bitset_dir = sources_dir / "species-bitset"
    data_path = bitset_dir / "species.cells.bits"
    metadata_path = bitset_dir / "species.cells.json"
    build_species_bitset(matrix_paths, data_path, metadata_path)

    result: dict[str, Any] = {}
    for key, path in {"data": data_path, "metadata": metadata_path}.items():
        checksum = sha256_file(path)
        size_bytes = path.stat().st_size
        file_entries.append(file_entry(path, artifact_dir, checksum, size_bytes))
        result[key] = {
            "path": str(path.relative_to(artifact_dir)),
            "checksum": {"algorithm": "sha256", "value": checksum},
            "size_bytes": size_bytes,
        }
    return result


def build_species_matrix_stub(packet: dict[str, Any]) -> dict[str, Any]:
    species = packet.get("species")
    matrices = species.get("matrices") if isinstance(species, dict) else None
    declared_bindings = (
        [entry for entry in matrices if isinstance(entry, dict)]
        if isinstance(matrices, list)
        else []
    )
    return {
        "status": "stubbed",
        "todo": (
            "Download and package regional SMSP matrices from "
            "regionalInputPacket.species.matrices and wire the backend species "
            "accumulator to the regional grid."
        ),
        "declared_bindings": declared_bindings,
        "entries": [],
    }


def _sirap_species_group(taxonomic_class: Any) -> str | None:
    normalized = re.sub(r"[^a-z0-9]", "", str(taxonomic_class or "").casefold())
    return {
        "mammalia": "mammals",
        "aves": "birds",
        "amphibia": "amphibians",
        "squamata": "reptiles",
        "crocodylia": "reptiles",
        "magnoliopsida": "plants",
        "threatened": "threatened",
    }.get(normalized)


def extract_mec_national_denominator_url(
    solutions: list[dict[str, Any]],
) -> str | None:
    for solution in solutions:
        urls = solution.get("precomputedMetricUrls")
        if not isinstance(urls, dict):
            continue
        url = urls.get("mecNationalDenominator")
        if isinstance(url, str) and url.strip():
            return url.strip()
    return None


def fetch_json(url: str) -> dict[str, Any]:
    parsed_path = Path(url)
    if parsed_path.exists() and parsed_path.is_file():
        try:
            document = json.loads(parsed_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SystemExit(f"Could not read local manifest {url}: {exc}") from exc
        if not isinstance(document, dict):
            raise SystemExit(f"Manifest {url!r} must be a JSON object.")
        return document

    req = urllib.request.Request(url, headers={"User-Agent": "dmt-sirap-runtime-artifact/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=180) as response:
            payload = response.read()
    except urllib.error.URLError as exc:
        raise SystemExit(f"Could not fetch manifest {url!r}: {exc}") from exc
    try:
        document = json.loads(payload.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Manifest {url!r} is not valid JSON: {exc}") from exc
    if not isinstance(document, dict):
        raise SystemExit(f"Manifest {url!r} must be a JSON object.")
    return document


if __name__ == "__main__":
    main()
