from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import shutil
import struct
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import rasterio

DOWNLOAD_CHUNK_BYTES = 1024 * 1024
DOWNLOAD_PROGRESS_INTERVAL_BYTES = 8 * 1024 * 1024

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
METRICS_PIPELINE = Path(
    os.getenv(
        "DMT_METRICS_PIPELINE_PATH",
        str(REPO_ROOT / "data" / "metrics" / "python" / "metrics_pipeline"),
    )
)
for _import_root in (BACKEND_ROOT, METRICS_PIPELINE):
    if str(_import_root) not in sys.path:
        sys.path.insert(0, str(_import_root))

from blob_manifest import DEFAULT_MANIFEST_URL, fetch_manifest  # noqa: E402
from coverage_parity_contract import (  # noqa: E402
    CoverageParityContract,
    load_coverage_parity_contract,
)
from metric_definitions import (  # noqa: E402
    COBERTURAS_SELECTED_VALUE_BY_LAYER_ID,
    METRIC_CATALOG,
)
from species_data import CLASS_BUCKETS, compute_pool_sizes, load_species_records  # noqa: E402
from sparse.species_bitset import build_species_bitset  # noqa: E402
from scripts.hydration_package import load_hydration_package  # noqa: E402
from scripts.species_bitset_cache import ensure_species_bitset  # noqa: E402

from app.coverage_target_validation import (  # noqa: E402
    CATALOG_301_AMPHIBIAN_COUNT,
    CATALOG_301_GOLDEN_SPECIES_TARGET_COUNT,
    CoverageTargetValidationError,
    MESA_V3_ECOSYSTEM_TARGET_COUNT,
    MESA_V3_GOLDEN_SPECIES_TARGET_COUNT,
    validate_coverage_targets,
)
from scripts.build_species_matrices_from_overlap import (  # noqa: E402
    CACHE_POSITIVE_AREA_EPSILON_M2,
    ConversionError,
    convert as convert_overlap_species_matrices,
)
from scripts.aligned_cache import (  # noqa: E402
    AlignedCacheError,
    AlignedRaster,
    AlignedRasterCache,
    align_layer_to_reference,
    read_fingerprint,
    sha256_file,
)
from scripts.land_solution_inputs import (  # noqa: E402
    ECOSYSTEM_BLOB_PATHS,
    LAND_SOLUTION_REFERENCE_PIN,
    ReferenceRasterPinError,
    public_url,
    species_matrix_blob_path,
)

PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
DEFAULT_ARTIFACT_DIR = Path(
    os.getenv("DMT_ARTIFACT_DIR", str(BACKEND_ROOT / "runtime-artifacts"))
)
DEFAULT_V3_PARITY_CONTRACT = (
    Path(
        os.getenv(
            "DMT_RELEASE_SPECS_DIR",
            str(REPO_ROOT / "data" / "metrics" / "release-specs"),
        )
    )
    / "solutions-v3-0-0"
    / "coverage-parity-contract.json"
)
SPECIES_CSV_PATH = METRICS_PIPELINE / "artifacts" / "species" / "biomod_spp_ranges_updatedIUCN.csv"
DEFAULT_SPECIES_OVERLAP_CACHE = (
    REPO_ROOT
    / "data"
    / "metrics"
    / "cache"
    / "releases"
    / "solutions-v3-0-1-20260903"
    / "species-overlap"
)
DEFAULT_SPECIES_EXCEPTION = (
    REPO_ROOT
    / "data"
    / "metrics"
    / "release-specs"
    / "solutions-v3-0-1-20260903"
    / "species-exception.json"
)
SPECIES_MATRIX_GROUPS = (*CLASS_BUCKETS, "threatened")
ECOSYSTEM_LAYER_ID = "ecosistemas_IAVH_2024"
MESA_ECOSYSTEM_LAYER_ID = "mesa_ecosistemas_IAVH_2024"
MESA_ECOSYSTEM_CATALOG_URL = (
    f"{PUBLIC_BLOB_HOST}/inputs/features/ecosystems/"
    "ecosistemas_IDs_IAVH_2024.csv"
)

# The MEC ecosystem bundle and the species matrices exist once per reference
# grid. The EPSG:4326 objects stay where they are for the opt-in ecosistemas
# path; the default land-solution grid reads its own `land-solution-9377/` objects.
ECOSYSTEM_SOURCE_URLS_BY_GRID = {
    "ecosistemas": {
        "raster": (
            f"{PUBLIC_BLOB_HOST}/inputs/features/ecosystems/"
            "ecosistemas_IDEAM_MEC_2024.tif"
        ),
        "crosswalk": (
            f"{PUBLIC_BLOB_HOST}/inputs/features/ecosystems/"
            "ecosistemas_IDs_IDEAM_MEC_2024.csv"
        ),
        "provenance": (
            f"{PUBLIC_BLOB_HOST}/inputs/features/ecosystems/"
            "ecosistemas_IDEAM_MEC_2024.provenance.json"
        ),
    },
    "land-solution": {
        name: public_url(blob_path) for name, blob_path in ECOSYSTEM_BLOB_PATHS.items()
    },
}

SPECIES_MATRIX_URL_BUILDERS = {
    "ecosistemas": lambda group: (
        f"{PUBLIC_BLOB_HOST}/inputs/features/species-sparse/species_{group}.smtx.gz"
    ),
    "land-solution": lambda group: public_url(species_matrix_blob_path(group)),
}


def _log(message: str) -> None:
    print(message, flush=True)


def _format_bytes(size: int) -> str:
    if size >= 1024**3:
        return f"{size / 1024**3:.2f} GB"
    if size >= 1024**2:
        return f"{size / 1024**2:.1f} MB"
    if size >= 1024:
        return f"{size / 1024:.0f} KB"
    return f"{size} B"


def _progress_bar(fraction: float, width: int = 20) -> str:
    clamped = max(0.0, min(1.0, fraction))
    filled = int(round(clamped * width))
    return "#" * filled + "-" * (width - filled)


def _report_download(name: str, done: int, total: int | None, *, final: bool = False) -> None:
    if total and total > 0:
        fraction = min(1.0, done / total)
        line = (
            f"[hydrate] {name}  [{_progress_bar(fraction)}]  "
            f"{fraction * 100:5.1f}%  {_format_bytes(done)}/{_format_bytes(total)}"
        )
    else:
        line = f"[hydrate] {name}  {_format_bytes(done)}"
    tty = sys.stdout.isatty()
    if tty and not final:
        print("\r" + line, end="", flush=True)
        return
    if tty:
        print("\r" + line, flush=True)
        return
    if final or done == 0:
        print(line, flush=True)


@dataclass(frozen=True)
class LayerSpec:
    layer_id: str
    url: str
    kind: str
    rendering: dict[str, Any]
    metric_ids: tuple[str, ...]
    # Alignment class from metrics_pipeline/raster_align.py `_LAYER_POLICIES`.
    # It selects the resampling used to reproject the layer, so density layers
    # must never be resolved through a nearest-neighbour cache entry.
    alignment_class: str


@dataclass(frozen=True)
class SpeciesMatrixSpec:
    group: str
    url: str
    metric_ids: tuple[str, ...]


@dataclass(frozen=True)
class ReferenceGrid:
    name: str
    expected_crs: str
    summary: str


@dataclass(frozen=True)
class ResolvedReferenceGrid:
    """Verified reference bytes and their canonical runtime provenance."""

    name: str
    summary: str
    source: str
    sha256: str
    size_bytes: int
    crs: str
    width: int
    height: int
    transform: tuple[float, float, float, float, float, float]
    valid_cell_count: int
    release_id: str | None = None
    logical_path: str | None = None

    def manifest_metadata(self) -> dict[str, Any]:
        if self.release_id is None:
            pin = reference_raster_pin(self.name)
        else:
            pin = {
                "source": self.source,
                "logical_path": self.logical_path,
                "release_id": self.release_id,
                "sha256": self.sha256,
                "size_bytes": self.size_bytes,
                "valid_cell_count": self.valid_cell_count,
                "rationale": (
                    "Coverage-parity template verified against the loaded contract "
                    "and packaged reference raster."
                ),
            }
        return {
            "name": self.name,
            "summary": self.summary,
            "source": self.source,
            "crs": self.crs,
            "width": self.width,
            "height": self.height,
            "transform": list(self.transform),
            "pin": pin,
        }

    def parity_contract_grid(self) -> dict[str, Any]:
        if self.release_id is None:
            raise ValueError("Legacy reference grids do not have parity contract metadata.")
        return {
            "crs": self.crs,
            "width": self.width,
            "height": self.height,
            "transform": list(self.transform),
            "valid_planning_cell_count": self.valid_cell_count,
            "template_sha256": self.sha256,
        }


# Mirrors `_LAYER_POLICIES` in metrics_pipeline/raster_align.py. Only the two
# density layers use `average`; resampling them with nearest would corrupt
# carbon totals. Layers sharing one categorical source (the coberturas and
# runap aliases) must share a class so they resolve to one aligned file.
ALIGNMENT_CLASS_BY_LAYER_ID = {
    "ecosistemas_IAVH_2024": "categorical",
    "paramos": "categorical",
    "bosque_seco": "binary",
    "wetlands": "categorical",
    "mangroves": "binary",
    "resguardos": "binary",
    "comunidades": "binary",
    "recarga_agua": "binary",
    "coberturas_artificial_surfaces": "categorical",
    "coberturas_agricultural_areas": "categorical",
    "coberturas_forests_and_semi_natural_areas": "categorical",
    "coberturas_wetlands": "categorical",
    "coberturas_water_bodies": "categorical",
    "coberturas_agriculture": "categorical",
    "runap_protegidas": "categorical",
    "runap_parques": "categorical",
    "biomasa": "fraction_or_density",
    "carbono_organico": "fraction_or_density",
}


REFERENCE_GRIDS = {
    "ecosistemas": ReferenceGrid(
        name="ecosistemas",
        expected_crs="EPSG:4326",
        summary="Legacy WGS84 ecosystem grid from the layer manifest (1497x2069).",
    ),
    "land-solution": ReferenceGrid(
        name="land-solution",
        expected_crs="EPSG:9377",
        summary="v0.2 land solution grid shared with the precomputed metrics (1353x1838, 1000 m).",
    ),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the VM runtime artifact for custom AOI metrics.")
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument("--manifest-url", default=DEFAULT_MANIFEST_URL)
    parser.add_argument("--solution-id", default=None)
    parser.add_argument("--coverage-parity-contract", type=Path, default=None)
    parser.add_argument(
        "--production-v3",
        action="store_true",
        help=(
            "Build the immutable EPSG:9377 Custom AOI release with the pinned "
            "V3 Mesa coverage contract. This profile fails closed."
        ),
    )
    parser.add_argument("--force", action="store_true", help="Re-download source rasters.")
    parser.add_argument(
        "--immutable-release",
        action="store_true",
        help="Build into a versioned releases directory without activating it.",
    )
    parser.add_argument(
        "--reference-grid",
        choices=sorted(REFERENCE_GRIDS),
        default="land-solution",
        help="Which grid the custom AOI is rasterized on. Defaults to the EPSG:9377 land-solution grid.",
    )
    parser.add_argument(
        "--reference-raster",
        default=None,
        help=(
            "URL or local path defining the land-solution reference grid. Defaults "
            "to the pinned aligned MEC composite and must match that pin either way."
        ),
    )
    parser.add_argument(
        "--aligned-cache",
        type=Path,
        default=None,
        help=(
            "Metrics pipeline cache directory holding aligned/<key[:2]>/<key>.tif. "
            "Optional. Without it, land-solution layers are warped onto the "
            "EPSG:9377 reference grid during hydrate."
        ),
    )
    parser.add_argument(
        "--species-overlap-cache",
        type=Path,
        default=DEFAULT_SPECIES_OVERLAP_CACHE,
        help=(
            "3.0.1 species-exact-overlap cache used to package the 158-amphibian "
            "national universe instead of the 9-species Mesa amphibians bundle."
        ),
    )
    parser.add_argument(
        "--species-exception",
        type=Path,
        default=DEFAULT_SPECIES_EXCEPTION,
        help="Signed 3.0.1 species-exception.json for the overlap-cache catalogue.",
    )
    args = parser.parse_args()
    if args.production_v3:
        args.reference_grid = "land-solution"
        args.immutable_release = True
        if args.coverage_parity_contract is None:
            args.coverage_parity_contract = DEFAULT_V3_PARITY_CONTRACT
    if args.reference_grid == "land-solution":
        if not args.reference_raster and args.coverage_parity_contract is None:
            args.reference_raster = LAND_SOLUTION_REFERENCE_PIN.url
    elif args.reference_raster:
        parser.error("--reference-raster only applies to --reference-grid land-solution.")
    return args


def main() -> None:
    args = parse_args()
    production_v3 = bool(getattr(args, "production_v3", False))
    parity_contract_path = getattr(args, "coverage_parity_contract", None)
    parity_contract = (
        load_coverage_parity_contract(parity_contract_path)
        if parity_contract_path is not None
        else None
    )
    if parity_contract is not None:
        if args.reference_grid != "land-solution":
            raise SystemExit("Coverage parity runtime requires --reference-grid land-solution.")
        args.reference_raster = parity_contract.document["grid"]["template"]["url"]
    if production_v3 and parity_contract is None:
        raise SystemExit("Production V3 runtime requires the coverage parity contract.")
    if production_v3 and (
        parity_contract.ecosystem_feature_count != MESA_V3_ECOSYSTEM_TARGET_COUNT
        or parity_contract.species_feature_count
        != MESA_V3_GOLDEN_SPECIES_TARGET_COUNT
    ):
        raise SystemExit(
            "Production V3 coverage contract must declare exactly 417 ecosystems "
            "and 7,980 Mesa golden-solution species."
        )
    overlap_cache = getattr(args, "species_overlap_cache", None)
    species_exception = getattr(args, "species_exception", None)
    use_overlap_amphibians = (
        args.reference_grid == "land-solution"
        and isinstance(overlap_cache, Path)
        and overlap_cache.is_dir()
    )
    if production_v3 and not use_overlap_amphibians:
        raise SystemExit(
            "Catalog 3.0.1 amphibians require the national-grid species-overlap "
            "cache; refusing to package the 9-species Mesa amphibians bundle."
        )
    packaged_species_count = (
        CATALOG_301_GOLDEN_SPECIES_TARGET_COUNT
        if production_v3 or use_overlap_amphibians
        else None
    )
    artifact_root = args.artifact_dir.resolve()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    artifact_version = f"colombia-custom-aoi-v1-{now.replace(':', '').replace('-', '')}"
    final_release_dir: Path | None = None
    if args.immutable_release:
        final_release_dir = artifact_root / "releases" / artifact_version
        artifact_dir = final_release_dir.with_name(f".{artifact_version}.partial")
        if artifact_dir.exists() or final_release_dir.exists():
            raise SystemExit(f"Artifact release already exists: {artifact_version}")
    else:
        artifact_dir = artifact_root
    sources_dir = artifact_dir / "sources"
    sources_dir.mkdir(parents=True, exist_ok=True)

    _log(f"[hydrate] writing artifacts to {artifact_dir}")
    _log("[hydrate] 1/8 fetching layer manifest")
    manifest = fetch_manifest(args.manifest_url)
    hydration_package = load_hydration_package(manifest.raw)
    if hydration_package is None and "manifest/manifest.json" in args.manifest_url:
        raise SystemExit(
            "Published catalog is missing hydrationPackage. "
            "Republish manifest.json with the EPSG:9377 land-solution recipe."
        )
    if hydration_package is not None:
        _log(
            "[hydrate] catalog hydrationPackage "
            f"{hydration_package.default_reference_grid} "
            f"{hydration_package.reference_grid(args.reference_grid).get('crs')}"
        )
        packaged_reference = hydration_package.reference_raster_url(args.reference_grid)
        if packaged_reference and args.reference_raster in {
            None,
            LAND_SOLUTION_REFERENCE_PIN.url,
        }:
            args.reference_raster = packaged_reference
    solution = select_solution(manifest.national_solutions, args.solution_id)
    reference_grid = REFERENCE_GRIDS[args.reference_grid]
    reference_source_url = resolve_reference_source_url(args, manifest.layers_by_id)
    _log(f"[hydrate] selected reference grid: {reference_grid.name} — {reference_grid.summary}")
    _log(
        "[hydrate] sample solution for provenance: "
        f"{solution.get('id')} ({solution.get('name')})"
    )

    _log("[hydrate] 2/8 downloading reference raster")
    reference = fetch_source(
        reference_source_url,
        sources_dir / f"reference_grid_{safe_filename(reference_grid.name)}.tif",
        force=args.force,
    )
    reference_fingerprint = read_fingerprint(reference.path)
    if reference_fingerprint.crs != reference_grid.expected_crs:
        raise SystemExit(
            f"Reference raster {reference_source_url} is {reference_fingerprint.crs}; "
            f"reference grid {reference_grid.name} requires {reference_grid.expected_crs}."
        )
    _log(
        "[hydrate] 3/8 counting valid cells on the reference grid "
        "(CPU-heavy, can take a few minutes with no byte progress)"
    )
    resolved_reference_grid = resolve_reference_grid(
        reference_grid,
        reference_source_url,
        reference,
        reference_fingerprint,
        parity_contract,
    )
    if parity_contract is not None:
        print("Reference raster matches the v3 Mesa coverage-parity contract.", flush=True)
    elif args.reference_grid == "land-solution":
        print(
            "Reference raster matches the land-solution pin: "
            f"{LAND_SOLUTION_REFERENCE_PIN.rationale}",
            flush=True,
        )
    _log(
        f"[hydrate] reference fingerprint: {reference_fingerprint.crs} "
        f"{reference_fingerprint.width}x{reference_fingerprint.height}"
    )

    aligned_cache = None
    if args.aligned_cache is not None:
        try:
            aligned_cache = AlignedRasterCache(args.aligned_cache)
        except AlignedCacheError as exc:
            raise SystemExit(str(exc)) from exc

    layer_specs = build_layer_specs(
        manifest.layers_by_id,
        reference_grid.name,
        parity_contract,
        hydration_package,
    )
    species_specs = build_species_matrix_specs(
        reference_grid.name,
        parity_contract,
        hydration_package,
    )
    layer_entries: list[dict[str, Any]] = []
    file_entries = [file_entry(reference.path, artifact_dir, reference.sha256, reference.bytes)]
    sources_by_url = {reference_source_url: reference}
    aligned_by_url: dict[str, AlignedRaster] = {}
    layer_ids_by_url: dict[str, list[str]] = {}

    _log(f"[hydrate] 4/8 downloading raster layers ({len(layer_specs)} layers)")
    for index, spec in enumerate(layer_specs, start=1):
        _log(f"[hydrate] layer {index}/{len(layer_specs)} {spec.layer_id}")
        layer_ids_by_url.setdefault(spec.url, []).append(spec.layer_id)
        cached = sources_by_url.get(spec.url)
        if cached is None:
            target = sources_dir / f"{safe_filename(spec.layer_id)}.tif"
            if spec.layer_id == MESA_ECOSYSTEM_LAYER_ID:
                cached = download_source(spec.url, target, force=args.force)
            elif aligned_cache is not None:
                try:
                    aligned = aligned_cache.lookup(
                        spec.layer_id,
                        source_url=spec.url,
                        layer_class=spec.alignment_class,
                        target=reference_fingerprint,
                    )
                except AlignedCacheError as exc:
                    raise SystemExit(str(exc)) from exc
                aligned_by_url[spec.url] = aligned
                cached = copy_source(aligned.path, target)
                print(
                    f"Reused aligned {spec.layer_id} "
                    f"({aligned.layer_class}/{aligned.resampling}) from {aligned.cache_key[:12]}"
                )
            else:
                cached = _download_and_align_layer(
                    spec,
                    target,
                    reference_fingerprint=reference_fingerprint,
                    force=args.force,
                )
            sources_by_url[spec.url] = cached
            file_entries.append(file_entry(cached.path, artifact_dir, cached.sha256, cached.bytes))
        if spec.layer_id == MESA_ECOSYSTEM_LAYER_ID:
            expected_sha256 = parity_contract.document["ecosystems"]["raster"]["sha256"]
            if cached.sha256 != expected_sha256:
                raise SystemExit(
                    "Mesa ecosystem raster checksum does not match the parity contract."
                )
            mesa_fingerprint = read_fingerprint(cached.path)
            if mesa_fingerprint != reference_fingerprint:
                raise SystemExit(
                    "Mesa ecosystem raster does not exactly match the v3 reference grid."
                )

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

    amphibian_names: set[str] | None = None
    if use_overlap_amphibians:
        golden_solution_id = (
            parity_contract.solution_id
            if parity_contract is not None
            else "eco17_estr17_esprep17_runap_iheh2022"
        )
        amphibian_names = load_golden_amphibian_names(
            manifest.national_solutions,
            sources_dir / "mesa-coverage" / f"{safe_filename(golden_solution_id)}.goals.json",
            golden_solution_id=golden_solution_id,
            force=args.force,
        )
        print(
            f"Packaging {len(amphibian_names)} catalog 3.0.1 amphibians from the "
            "national-grid overlap cache."
        )

    species_entries: list[dict[str, Any]] = []
    species_matrix_paths: dict[str, Path] = {}
    mesa_grid_template: Path | None = None
    ordered_species_specs = [
        spec
        for spec in species_specs
        if not (spec.group == "amphibians" and use_overlap_amphibians)
    ]
    if use_overlap_amphibians:
        ordered_species_specs.extend(
            spec for spec in species_specs if spec.group == "amphibians"
        )
    _log(f"[hydrate] 5/8 downloading species matrices ({len(ordered_species_specs)} groups)")
    for index, spec in enumerate(ordered_species_specs, start=1):
        _log(f"[hydrate] species matrix {index}/{len(ordered_species_specs)} {spec.group}")
        destination = (
            sources_dir / "species-sparse" / f"species_{safe_filename(spec.group)}.smtx.gz"
        )
        if spec.group == "amphibians" and use_overlap_amphibians:
            cached = package_overlap_amphibians_matrix(
                destination,
                overlap_cache=overlap_cache,
                species_exception=species_exception
                if isinstance(species_exception, Path)
                else DEFAULT_SPECIES_EXCEPTION,
                amphibian_names=amphibian_names or set(),
                grid_template_path=mesa_grid_template,
            )
            source_url = str(overlap_cache)
        else:
            cached = download_source(spec.url, destination, force=args.force)
            source_url = spec.url
            if (
                parity_contract is not None
                and spec.group != "threatened"
                and spec.group != "amphibians"
            ):
                expected_bundle = next(
                    entry
                    for entry in parity_contract.document["species"]["runtimeBundles"]
                    if entry["group"] == spec.group
                )
                if cached.sha256 != expected_bundle["sha256"]:
                    raise SystemExit(
                        f"Mesa species bundle checksum mismatch for {spec.group}."
                    )
            if spec.group in CLASS_BUCKETS and mesa_grid_template is None:
                mesa_grid_template = cached.path
        file_entries.append(file_entry(cached.path, artifact_dir, cached.sha256, cached.bytes))
        species_entries.append(
            {
                "group": spec.group,
                "path": str(cached.path.relative_to(artifact_dir)),
                "source_url": source_url,
                "metric_ids": list(spec.metric_ids),
                "checksum": {"algorithm": "sha256", "value": cached.sha256},
                "size_bytes": cached.bytes,
            }
        )
        if spec.group in CLASS_BUCKETS:
            species_matrix_paths[spec.group] = cached.path

    species_bitset_dir = sources_dir / "species-bitset"
    species_bitset_data = species_bitset_dir / "species.cells.bits"
    species_bitset_metadata = species_bitset_dir / "species.cells.json"
    _log("[hydrate] 6/8 species bitset")
    ensure_species_bitset(
        kit_id=(
            hydration_package.species_bitset_kit_id(args.reference_grid)
            if hydration_package is not None
            else f"national-{args.reference_grid}"
        ),
        matrix_paths=species_matrix_paths,
        data_path=species_bitset_data,
        metadata_path=species_bitset_metadata,
        force=args.force,
        download=download_source,
        build=build_species_bitset,
        log=_log,
    )
    species_bitset: dict[str, Any] = {}
    for key, path in {
        "data": species_bitset_data,
        "metadata": species_bitset_metadata,
    }.items():
        checksum = sha256_file(path)
        size_bytes = path.stat().st_size
        file_entries.append(file_entry(path, artifact_dir, checksum, size_bytes))
        species_bitset[key] = {
            "path": str(path.relative_to(artifact_dir)),
            "checksum": {"algorithm": "sha256", "value": checksum},
            "size_bytes": size_bytes,
        }

    species_pool_sizes = load_species_pool_sizes()
    solution_rasters = [
        {
            "solution_id": str(solution_entry["id"]),
            "source_url": str(solution_entry["displayUrl"]),
            "blob_path": str(solution_entry["blobPath"]),
            "category_semantics": {
                "1": "new_prioritizr",
                "2": "pre_existing_aggregate",
            },
        }
        for solution_entry in manifest.national_solutions
    ]
    ecosystem_inventory: dict[str, Any] = {}
    # These URLs are mutable publication targets, so refresh the small MEC bundle
    # on every build rather than silently pairing stale files with a new manifest.
    _log("[hydrate] 7/8 packaging ecosystem inventory")
    ecosystem_source_urls = (
        hydration_package.ecosystem_inventory_urls(reference_grid.name)
        if hydration_package is not None
        else ECOSYSTEM_SOURCE_URLS_BY_GRID[reference_grid.name]
    )
    for source_name, source_url in ecosystem_source_urls.items():
        suffix = {
            "raster": ".tif",
            "crosswalk": ".csv",
            "provenance": ".json",
        }[source_name]
        cached = download_source(
            source_url,
            sources_dir / "ecosystems" / f"mec-composite-{source_name}{suffix}",
            force=True,
        )
        file_entries.append(file_entry(cached.path, artifact_dir, cached.sha256, cached.bytes))
        ecosystem_inventory[source_name] = {
            "path": str(cached.path.relative_to(artifact_dir)),
            "source_url": source_url,
            "checksum": {"algorithm": "sha256", "value": cached.sha256},
            "size_bytes": cached.bytes,
        }

    _log("[hydrate] packaging Mesa coverage metadata")
    mesa_coverage = build_mesa_coverage_artifact(
        reference_grid.name,
        manifest.national_solutions,
        artifact_dir,
        sources_dir,
        file_entries,
        force=args.force,
        parity_contract=parity_contract,
        resolved_reference_grid=resolved_reference_grid,
        packaged_species_count=packaged_species_count,
    )
    if production_v3 and mesa_coverage is None:
        raise SystemExit("Production V3 runtime did not produce Mesa coverage metadata.")
    aggregate_checksum = aggregate_file_checksum(file_entries)
    runtime_manifest = {
        "artifact_version": artifact_version,
        "artifact_kind": "colombia-raster-custom-aoi/v1",
        "schema_version": "metrics-artifact-manifest/v1",
        "created_at": now,
        "checksum": {"algorithm": "sha256", "value": aggregate_checksum},
        "checksum_scope": "files/v1",
        "source_manifest": {
            "url": manifest.url,
            "public_blob_host": manifest.public_blob_host,
            "reference_grid_layer_id": reference_grid.name,
            "reference_grid_url": reference_source_url,
            "sample_solution_id": solution.get("id"),
            "sample_solution_name": solution.get("name"),
            "purpose": "Runtime source rasters for live custom AOI metrics on the VM backend.",
        },
        "reference_grid": resolved_reference_grid.manifest_metadata(),
        "aligned_sources": aligned_source_provenance(
            args.aligned_cache,
            aligned_by_url,
            layer_ids_by_url,
        ),
        "reference_raster_path": str(reference.path.relative_to(artifact_dir)),
        "reference_raster_checksum": {"algorithm": "sha256", "value": reference.sha256},
        "raster_layers": layer_entries,
        "species_matrices": species_entries,
        "species_bitset": species_bitset,
        "species_pool_sizes": species_pool_sizes,
        "ecosystem_inventory": ecosystem_inventory,
        **({"mesa_coverage": mesa_coverage} if mesa_coverage is not None else {}),
        "solution_rasters": solution_rasters,
        "metric_coverage": metric_coverage(layer_specs, species_specs),
        "files": file_entries,
    }

    _log("[hydrate] 8/8 writing runtime manifest")
    manifest_path = artifact_dir / "manifest.json"
    write_json(manifest_path, runtime_manifest)
    if final_release_dir is not None:
        artifact_dir.replace(final_release_dir)
        manifest_path = final_release_dir / "manifest.json"
        _log("[hydrate] release built but not activated")
    _log(f"[hydrate] done — wrote {manifest_path}")
    _log(f"[hydrate] files: {len(file_entries)}")
    _log(
        "[hydrate] implemented metrics: "
        f"{len(runtime_manifest['metric_coverage']['implemented_now'])}"
    )


def select_solution(solutions: list[dict[str, Any]], solution_id: str | None) -> dict[str, Any]:
    if solution_id is None:
        return solutions[0]
    for solution in solutions:
        if str(solution.get("id")) == solution_id:
            return solution
    raise SystemExit(f"Solution id not found in manifest: {solution_id}")


def _packaged_or_fallback_url(
    layer_id: str,
    fallback: str,
    hydration_package: Any | None,
) -> str:
    if hydration_package is None:
        return fallback
    packaged = hydration_package.metric_layer_url(layer_id)
    return packaged or fallback


def build_layer_specs(
    layers_by_id: dict[str, dict[str, Any]],
    reference_grid_name: str = "land-solution",
    parity_contract: CoverageParityContract | None = None,
    hydration_package: Any | None = None,
) -> list[LayerSpec]:
    specs: list[LayerSpec] = [
        LayerSpec(
            ECOSYSTEM_LAYER_ID,
            _packaged_or_fallback_url(
                ECOSYSTEM_LAYER_ID,
                off_manifest_url(ECOSYSTEM_LAYER_ID),
                hydration_package,
            ),
            "categorical",
            {"valueType": "categorical"},
            metric_ids_for_layer(ECOSYSTEM_LAYER_ID),
            "categorical",
        )
    ]
    if parity_contract is not None and reference_grid_name == "land-solution":
        specs.append(
            LayerSpec(
                MESA_ECOSYSTEM_LAYER_ID,
                str(parity_contract.document["ecosystems"]["raster"]["url"]),
                "categorical",
                {"valueType": "categorical"},
                (),
                "categorical",
            )
        )
    for layer_id in [
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
                alignment_class=ALIGNMENT_CLASS_BY_LAYER_ID[layer_id],
            )
        )

    specs.extend(
        [
            LayerSpec(
                "recarga_agua",
                _packaged_or_fallback_url(
                    "recarga_agua",
                    f"{PUBLIC_BLOB_HOST}/inputs/features/ground_water_recharge/recarga_agua_subterranea_moderado_alto.tif",
                    hydration_package,
                ),
                "binary",
                {"valueType": "binary", "selectedValue": 1},
                metric_ids_for_layer("recarga_agua"),
                ALIGNMENT_CLASS_BY_LAYER_ID["recarga_agua"],
            ),
            *[
                LayerSpec(
                    layer_id,
                    _packaged_or_fallback_url(
                        layer_id,
                        f"{PUBLIC_BLOB_HOST}/boundaries/coberturas.tif",
                        hydration_package,
                    ),
                    "categorical",
                    {
                        "valueType": "binary",
                        "selectedValue": COBERTURAS_SELECTED_VALUE_BY_LAYER_ID[layer_id],
                    },
                    metric_ids_for_layer(layer_id),
                    ALIGNMENT_CLASS_BY_LAYER_ID[layer_id],
                )
                for layer_id in (
                    "coberturas_artificial_surfaces",
                    "coberturas_agricultural_areas",
                    "coberturas_forests_and_semi_natural_areas",
                    "coberturas_wetlands",
                    "coberturas_water_bodies",
                    "coberturas_agriculture",
                )
            ],
            LayerSpec(
                "runap_protegidas",
                _packaged_or_fallback_url(
                    "runap_protegidas",
                    f"{PUBLIC_BLOB_HOST}/inputs/includes/runap_protected_areas.tif",
                    hydration_package,
                ),
                "categorical",
                {},
                metric_ids_for_layer("runap_protegidas"),
                ALIGNMENT_CLASS_BY_LAYER_ID["runap_protegidas"],
            ),
            LayerSpec(
                "runap_parques",
                _packaged_or_fallback_url(
                    "runap_parques",
                    f"{PUBLIC_BLOB_HOST}/inputs/includes/runap_protected_areas.tif",
                    hydration_package,
                ),
                "categorical",
                {"valueType": "binary", "selectedValue": 3},
                metric_ids_for_layer("runap_parques"),
                ALIGNMENT_CLASS_BY_LAYER_ID["runap_parques"],
            ),
            LayerSpec(
                "biomasa",
                _packaged_or_fallback_url(
                    "biomasa",
                    f"{PUBLIC_BLOB_HOST}/inputs/features/biomass/biomasa_areara+subterranea_1km.tif",
                    hydration_package,
                ),
                "continuous",
                {"valueType": "continuous"},
                metric_ids_for_layer("biomasa"),
                ALIGNMENT_CLASS_BY_LAYER_ID["biomasa"],
            ),
            LayerSpec(
                "carbono_organico",
                _packaged_or_fallback_url(
                    "carbono_organico",
                    f"{PUBLIC_BLOB_HOST}/inputs/features/carbon/carbono_organico.tif",
                    hydration_package,
                ),
                "continuous",
                {"valueType": "continuous"},
                metric_ids_for_layer("carbono_organico"),
                ALIGNMENT_CLASS_BY_LAYER_ID["carbono_organico"],
            ),
        ]
    )
    return specs


def metric_ids_for_layer(layer_id: str) -> tuple[str, ...]:
    return tuple(metric.metric_id for metric in METRIC_CATALOG if metric.layer_id == layer_id)


def off_manifest_url(layer_id: str) -> str:
    for metric in METRIC_CATALOG:
        if metric.layer_id == layer_id and metric.off_manifest_url:
            return str(metric.off_manifest_url)
    raise SystemExit(f"Metric catalog has no off-manifest URL for layer {layer_id!r}.")


def build_species_matrix_specs(
    reference_grid_name: str,
    parity_contract: CoverageParityContract | None = None,
    hydration_package: Any | None = None,
) -> list[SpeciesMatrixSpec]:
    """Resolve the species matrices published for one reference grid.

    The builder regenerates the bitset from whatever it downloads, so a grid
    mismatch here would silently discard the exact per-species range areas the
    9377 matrices carry and emit a cell-count bitset instead.
    """
    builtin_url_for = SPECIES_MATRIX_URL_BUILDERS[reference_grid_name]

    def url_for(group: str) -> str:
        if hydration_package is not None:
            return hydration_package.species_matrix_url(reference_grid_name, group)
        return builtin_url_for(group)

    if parity_contract is not None and reference_grid_name == "land-solution":
        bundles = parity_contract.document["species"]["runtimeBundles"]
        specs = [
            SpeciesMatrixSpec(
                group=str(bundle["group"]),
                url=str(bundle["url"]),
                metric_ids=metric_ids_for_species_group(str(bundle["group"])),
            )
            for bundle in bundles
        ]
        specs.append(
            SpeciesMatrixSpec(
                group="threatened",
                url=url_for("threatened"),
                metric_ids=metric_ids_for_species_group("threatened"),
            )
        )
        return specs
    return [
        SpeciesMatrixSpec(
            group=group,
            url=url_for(group),
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


def load_golden_amphibian_names(
    solutions: list[dict[str, Any]],
    destination: Path,
    *,
    golden_solution_id: str,
    force: bool,
) -> set[str]:
    """Read the 158 catalog 3.0.1 Amphibia names from golden-master goals."""

    solution = next(
        (
            entry
            for entry in solutions
            if str(entry.get("id") or "") == golden_solution_id
        ),
        None,
    )
    urls = solution.get("precomputedMetricUrls") if isinstance(solution, dict) else None
    goals_url = urls.get("goals") if isinstance(urls, dict) else None
    if not isinstance(goals_url, str) or not goals_url:
        raise SystemExit(
            f"{golden_solution_id} has no conservation goals URL for amphibian names."
        )
    downloaded = download_source(goals_url, destination, force=force)
    try:
        document = json.loads(downloaded.path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(
            f"{golden_solution_id} conservation goals are invalid: {exc}"
        ) from exc
    features = document.get("features")
    species = features.get("species") if isinstance(features, dict) else None
    if not isinstance(species, list):
        raise SystemExit(f"{golden_solution_id} has no species goals inventory.")
    names = {
        str(row.get("featureName") or "")
        for row in species
        if isinstance(row, dict) and str(row.get("taxonClass") or "") == "Amphibia"
    }
    names.discard("")
    if len(names) != CATALOG_301_AMPHIBIAN_COUNT:
        raise SystemExit(
            f"{golden_solution_id} must list {CATALOG_301_AMPHIBIAN_COUNT} Amphibia "
            f"rows; found {len(names)}."
        )
    destination.unlink(missing_ok=True)
    return names


def package_overlap_amphibians_matrix(
    destination: Path,
    *,
    overlap_cache: Path,
    species_exception: Path,
    amphibian_names: set[str],
    grid_template_path: Path | None = None,
) -> DownloadedSource:
    """Build the 158-amphibian national matrix from the 3.0.1 overlap cache."""

    if not amphibian_names:
        raise SystemExit("Catalog 3.0.1 amphibian names are required.")
    if not species_exception.is_file():
        raise SystemExit(f"Species exception is missing: {species_exception}")
    try:
        convert_overlap_species_matrices(
            cache_dir=overlap_cache,
            exception_path=species_exception,
            species_csv=SPECIES_CSV_PATH,
            output_dir=destination.parent,
            min_overlap_m2=CACHE_POSITIVE_AREA_EPSILON_M2,
            groups=("amphibians",),
            expect_catalog_total=8300,
            expect_available=8298,
            allowed_scientific_names=amphibian_names,
        )
    except ConversionError as exc:
        raise SystemExit(f"National amphibian overlap matrix failed: {exc}") from exc
    if not destination.is_file():
        raise SystemExit(f"Overlap amphibian matrix was not written: {destination}")
    if grid_template_path is not None:
        rewrite_species_matrix_grid(destination, grid_template_path)
    return DownloadedSource(
        destination,
        sha256_file(destination),
        destination.stat().st_size,
    )


def rewrite_species_matrix_grid(destination: Path, template_path: Path) -> None:
    """Copy Mesa bundle grid identity onto an overlap matrix with the same shape."""

    def read_toc(path: Path) -> tuple[bytes, dict[str, Any], bytes]:
        with gzip.open(path, "rb") as handle:
            magic = handle.read(4)
            toc_length = struct.unpack("<I", handle.read(4))[0]
            toc = json.loads(handle.read(toc_length).decode("utf-8"))
            body = handle.read()
        return magic, toc, body

    source_magic, source_toc, body = read_toc(destination)
    _, template_toc, _ = read_toc(template_path)
    source_grid = source_toc.get("grid") if isinstance(source_toc, dict) else None
    template_grid = template_toc.get("grid") if isinstance(template_toc, dict) else None
    if not isinstance(source_grid, dict) or not isinstance(template_grid, dict):
        raise SystemExit("Species matrix grid rewrite is missing a grid block.")
    if source_grid.get("width") != template_grid.get("width") or source_grid.get(
        "height"
    ) != template_grid.get("height"):
        raise SystemExit(
            "Overlap amphibian grid shape does not match the Mesa species bundles."
        )
    source_toc["grid"] = template_grid
    # Mesa runtime bundles omit exact area_km2. The bitset builder refuses a
    # mixed exact/cell-count set, so drop overlap-only areas and keep occupancy.
    species_rows = source_toc.get("species")
    if isinstance(species_rows, list):
        for row in species_rows:
            if isinstance(row, dict):
                row.pop("area_km2", None)
    toc_json = json.dumps(source_toc, separators=(",", ":")).encode("utf-8")
    temporary = destination.with_name(f".{destination.name}.grid.tmp")
    try:
        with temporary.open("wb") as raw_handle:
            with gzip.GzipFile(fileobj=raw_handle, mode="wb", mtime=0) as stream:
                stream.write(source_magic + struct.pack("<I", len(toc_json)) + toc_json)
                stream.write(body)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def _goals_targets_from_release(
    solutions: list[dict[str, Any]],
    scratch_dir: Path,
    *,
    force: bool,
    parity_contract: CoverageParityContract,
    packaged_species_count: int | None = None,
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, dict[str, Any]]]:
    targets: dict[str, list[dict[str, Any]]] = {}
    source_bindings: dict[str, dict[str, Any]] = {}
    expected_ecosystems = parity_contract.ecosystem_feature_count
    expected_species = packaged_species_count or parity_contract.species_feature_count

    try:
        for solution in solutions:
            finder_inputs = solution.get("finderInputs")
            if isinstance(finder_inputs, dict) and finder_inputs.get("domain") != "land":
                continue
            solution_id = str(solution.get("id") or "")
            urls = solution.get("precomputedMetricUrls")
            goals_url = urls.get("goals") if isinstance(urls, dict) else None
            if not solution_id or not isinstance(goals_url, str) or not goals_url:
                raise SystemExit(
                    f"{solution_id or 'unknown solution'} has no V3 conservation goals URL."
                )
            downloaded = download_source(
                goals_url,
                scratch_dir / f"{safe_filename(solution_id)}.goals.json",
                force=force,
            )
            try:
                document = json.loads(downloaded.path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise SystemExit(f"{solution_id} conservation goals are invalid: {exc}") from exc
            if document.get("solutionId") != solution_id:
                raise SystemExit(f"{solution_id} conservation goals identity is stale.")
            features = document.get("features")
            ecosystems = features.get("ecosystems") if isinstance(features, dict) else None
            species = features.get("species") if isinstance(features, dict) else None
            if not isinstance(ecosystems, list) or len(ecosystems) != expected_ecosystems:
                raise SystemExit(
                    f"{solution_id} must contain {expected_ecosystems} V3 ecosystem rows."
                )
            if not isinstance(species, list):
                raise SystemExit(f"{solution_id} has no V3 species goals inventory.")
            if (
                solution_id == parity_contract.solution_id
                and len(species) != expected_species
            ):
                raise SystemExit(
                    f"The golden solution must contain {expected_species} species "
                    f"rows; goals had {len(species)}."
                )
            canonical_rows: list[dict[str, Any]] = []
            for feature_type, raw_features in (
                ("ecosystem", ecosystems),
                ("species", species),
            ):
                for raw in raw_features:
                    if not isinstance(raw, dict):
                        raise SystemExit(
                            f"{solution_id} has an invalid {feature_type} goals row."
                        )
                    try:
                        canonical_rows.append(
                            {
                                "feature": raw["featureName"],
                                "feature_type": feature_type,
                                "class": raw.get("taxonClass"),
                                "relative_target": raw["relativeTarget"],
                                "evaluated": raw.get("evaluationSource"),
                            }
                        )
                    except KeyError as exc:
                        raise SystemExit(
                            f"{solution_id} has an invalid {feature_type} goals row."
                        ) from exc
            try:
                validated_rows = validate_coverage_targets(
                    canonical_rows,
                    solution_id=solution_id,
                    expected_ecosystem_count=expected_ecosystems,
                    expected_species_count=(
                        expected_species
                        if solution_id == parity_contract.solution_id
                        else None
                    ),
                )
            except CoverageTargetValidationError as exc:
                raise SystemExit(
                    f"{solution_id} conservation goals are invalid: {exc}"
                ) from exc
            rows = [row.as_dict() for row in validated_rows]
            ecosystem_count = sum(
                row.feature_type == "ecosystem" for row in validated_rows
            )
            species_count = sum(
                row.feature_type == "species" for row in validated_rows
            )
            targets[solution_id] = rows
            source_bindings[solution_id] = {
                "url": goals_url,
                "sha256": downloaded.sha256,
                "ecosystem_feature_count": ecosystem_count,
                "species_feature_count": species_count,
            }
    finally:
        shutil.rmtree(scratch_dir, ignore_errors=True)

    if not targets:
        raise SystemExit("The V3 release contains no land-solution coverage targets.")
    return targets, source_bindings


def build_mesa_coverage_artifact(
    reference_grid_name: str,
    solutions: list[dict[str, Any]],
    artifact_dir: Path,
    sources_dir: Path,
    file_entries: list[dict[str, Any]],
    *,
    force: bool,
    parity_contract: CoverageParityContract | None = None,
    resolved_reference_grid: ResolvedReferenceGrid,
    packaged_species_count: int | None = None,
) -> dict[str, Any] | None:
    """Package parity metadata only when v3 summary coverage is available."""

    if reference_grid_name != "land-solution":
        return None
    source_bindings: dict[str, dict[str, Any]] = {}
    if parity_contract is not None:
        targets, source_bindings = _goals_targets_from_release(
            solutions,
            sources_dir / ".mesa-goals-cache",
            force=force,
            parity_contract=parity_contract,
            packaged_species_count=packaged_species_count,
        )
    else:
        targets = {
            str(solution["id"]): [
                {
                    "feature": str(row["feature"]),
                    "feature_type": str(row.get("type") or "").strip().lower(),
                    "class": row.get("class"),
                    "relative_target": float(row["relativeTarget"]),
                    "evaluated": row.get("evaluated"),
                }
                for row in solution.get("coverage", [])
                if isinstance(row, dict)
                and row.get("feature")
                and row.get("relativeTarget") is not None
                and str(row.get("type") or "").strip().lower()
                in {"ecosystem", "species"}
            ]
            for solution in solutions
            if isinstance(solution.get("coverage"), list)
        }
        targets = {
            solution_id: rows
            for solution_id, rows in targets.items()
            if rows
        }
    if not targets:
        return None

    catalog_url = (
        str(parity_contract.document["ecosystems"]["catalog"]["url"])
        if parity_contract is not None
        else MESA_ECOSYSTEM_CATALOG_URL
    )
    raster_layer_id = (
        MESA_ECOSYSTEM_LAYER_ID
        if parity_contract is not None
        else ECOSYSTEM_LAYER_ID
    )
    catalog = download_source(
        catalog_url,
        sources_dir / "mesa-coverage" / "ecosistemas_IDs_IAVH_2024.csv",
        force=force,
    )
    if (
        parity_contract is not None
        and catalog.sha256
        != parity_contract.document["ecosystems"]["catalog"]["sha256"]
    ):
        raise SystemExit("Mesa ecosystem catalog checksum does not match the parity contract.")
    file_entries.append(
        file_entry(catalog.path, artifact_dir, catalog.sha256, catalog.bytes)
    )
    targets_path = sources_dir / "mesa-coverage" / "solution-targets.json"
    write_json(
        targets_path,
        {
            "format": "mesa-solution-targets-v1",
            "solutions": targets,
            "source_bindings": source_bindings,
        },
    )
    targets_sha256 = sha256_file(targets_path)
    targets_size = targets_path.stat().st_size
    file_entries.append(
        file_entry(targets_path, artifact_dir, targets_sha256, targets_size)
    )
    return {
        "format": "mesa-runtime-coverage-v1",
        "grid": "EPSG:9377",
        **(
            {
                "contract": {
                    "format": str(parity_contract.document["format"]),
                    "release_id": parity_contract.release_id,
                    "sha256": sha256_file(parity_contract.path),
                    "ecosystem_feature_count": parity_contract.ecosystem_feature_count,
                    "species_feature_count": (
                        packaged_species_count
                        if packaged_species_count is not None
                        else parity_contract.species_feature_count
                    ),
                    "golden_master_solution_id": parity_contract.solution_id,
                    "grid": resolved_reference_grid.parity_contract_grid(),
                }
            }
            if parity_contract is not None
            else {}
        ),
        "ecosystems": {
            "raster_layer_id": raster_layer_id,
            "catalog": {
                "path": str(catalog.path.relative_to(artifact_dir)),
                "source_url": catalog_url,
                "checksum": {"algorithm": "sha256", "value": catalog.sha256},
                "size_bytes": catalog.bytes,
            },
        },
        "species_groups": list(CLASS_BUCKETS),
        "targets": {
            "path": str(targets_path.relative_to(artifact_dir)),
            "checksum": {"algorithm": "sha256", "value": targets_sha256},
            "size_bytes": targets_size,
        },
    }


@dataclass(frozen=True)
class DownloadedSource:
    path: Path
    sha256: str
    bytes: int


def _download_and_align_layer(
    spec: LayerSpec,
    target: Path,
    *,
    reference_fingerprint: RasterFingerprint,
    force: bool,
) -> DownloadedSource:
    """Download a layer and warp it onto the reference grid when needed."""
    raw_target = target.with_name(f"raw_{target.name}")
    downloaded = download_source(spec.url, raw_target, force=force)
    if read_fingerprint(downloaded.path) == reference_fingerprint:
        if downloaded.path != target:
            return copy_source(downloaded.path, target)
        return downloaded
    _log(f"[hydrate] aligning {spec.layer_id} to {reference_fingerprint.crs}")
    try:
        align_layer_to_reference(
            downloaded.path,
            target,
            layer_id=spec.layer_id,
            layer_class=spec.alignment_class,
            reference=reference_fingerprint,
        )
    except AlignedCacheError as exc:
        raise SystemExit(str(exc)) from exc
    return DownloadedSource(target, sha256_file(target), target.stat().st_size)


def download_source(url: str, target: Path, *, force: bool) -> DownloadedSource:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and not force:
        size = target.stat().st_size
        _log(f"[hydrate] skip {target.name} (already have {_format_bytes(size)})")
        return DownloadedSource(target, sha256_file(target), size)

    _log(f"[hydrate] downloading {target.name}")
    tmp = target.with_name(f".{target.name}.part")
    req = urllib.request.Request(url, headers={"User-Agent": "dmt-runtime-artifact/0.1"})
    with urllib.request.urlopen(req, timeout=180) as response, tmp.open("wb") as handle:
        total_header = response.headers.get("Content-Length")
        total = int(total_header) if total_header and total_header.isdigit() else None
        done = 0
        last_report = 0
        _report_download(target.name, 0, total)
        while True:
            chunk = response.read(DOWNLOAD_CHUNK_BYTES)
            if not chunk:
                break
            handle.write(chunk)
            done += len(chunk)
            if (
                done - last_report >= DOWNLOAD_PROGRESS_INTERVAL_BYTES
                or (total is not None and done >= total)
            ):
                _report_download(target.name, done, total)
                last_report = done
        _report_download(target.name, done, total or done, final=True)
    tmp.replace(target)
    _log(f"[hydrate] checksum {target.name}")
    return DownloadedSource(target, sha256_file(target), target.stat().st_size)


def copy_source(source: Path, target: Path) -> DownloadedSource:
    """Copy an already prepared raster into the artifact so it stays self-contained."""
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f".{target.name}.part")
    shutil.copyfile(source, tmp)
    tmp.replace(target)
    return DownloadedSource(target, sha256_file(target), target.stat().st_size)


def fetch_source(location: str, target: Path, *, force: bool) -> DownloadedSource:
    """Materialize a source given either an http(s) URL or a local path."""
    parsed = urllib.parse.urlparse(location)
    if parsed.scheme in {"http", "https"}:
        return download_source(location, target, force=force)
    source = Path(location).expanduser().resolve()
    if not source.is_file():
        raise SystemExit(f"Reference raster not found: {location}")
    if target.exists() and not force:
        return DownloadedSource(target, sha256_file(target), target.stat().st_size)
    return copy_source(source, target)


def resolve_reference_source_url(
    args: argparse.Namespace,
    layers_by_id: dict[str, dict[str, Any]],
) -> str:
    if args.reference_grid == "land-solution":
        return str(args.reference_raster)
    layer = layers_by_id.get("ecosistemas")
    if not layer or not layer.get("displayUrl"):
        raise SystemExit("Manifest layer ecosistemas is required as the custom AOI reference grid.")
    return str(layer["displayUrl"])


def resolve_reference_grid(
    reference_grid: ReferenceGrid,
    source_url: str,
    source: DownloadedSource,
    fingerprint: Any,
    parity_contract: CoverageParityContract | None,
) -> ResolvedReferenceGrid:
    """Verify reference bytes and produce one canonical grid description."""

    with rasterio.open(source.path) as dataset:
        valid_cell_count = sum(
            int(np.count_nonzero(dataset.read_masks(1, window=window)))
            for _, window in dataset.block_windows(1)
        )

    release_id: str | None = None
    logical_path: str | None = None
    if parity_contract is not None:
        grid = parity_contract.document["grid"]
        template = grid["template"]
        expected_transform = tuple(float(value) for value in grid["transform"])
        mismatches: list[str] = []
        if source_url != str(template["url"]):
            mismatches.append("template URL")
        if source.sha256 != str(template["sha256"]):
            mismatches.append("template SHA-256")
        if fingerprint.crs != str(grid["crs"]):
            mismatches.append("CRS")
        if fingerprint.width != int(grid["width"]):
            mismatches.append("width")
        if fingerprint.height != int(grid["height"]):
            mismatches.append("height")
        if len(expected_transform) != len(fingerprint.transform) or any(
            abs(expected - actual) > 1e-6
            for expected, actual in zip(
                expected_transform,
                fingerprint.transform,
                strict=True,
            )
        ):
            mismatches.append("transform")
        if valid_cell_count != int(grid["validPlanningCellCount"]):
            mismatches.append("valid planning-cell count")
        if mismatches:
            raise SystemExit(
                "Mesa reference raster does not match the coverage-parity contract: "
                + ", ".join(mismatches)
                + "."
            )
        release_id = parity_contract.release_id
        logical_path = str(template.get("logicalPath") or "") or None
    elif reference_grid.name == "land-solution":
        try:
            LAND_SOLUTION_REFERENCE_PIN.verify(source.path, sha256=source.sha256)
        except ReferenceRasterPinError as exc:
            raise SystemExit(str(exc)) from exc

    return ResolvedReferenceGrid(
        name=reference_grid.name,
        summary=reference_grid.summary,
        source=source_url,
        sha256=source.sha256,
        size_bytes=source.bytes,
        crs=str(fingerprint.crs),
        width=int(fingerprint.width),
        height=int(fingerprint.height),
        transform=tuple(float(value) for value in fingerprint.transform),
        valid_cell_count=valid_cell_count,
        release_id=release_id,
        logical_path=logical_path,
    )


def reference_raster_pin(reference_grid_name: str) -> dict[str, Any] | None:
    """Record the pinned land domain so a built artifact declares its denominator."""
    if reference_grid_name != "land-solution":
        return None
    pin = LAND_SOLUTION_REFERENCE_PIN
    return {
        "blob_path": pin.blob_path,
        "sha256": pin.sha256,
        "size_bytes": pin.size_bytes,
        "valid_cell_count": pin.valid_cell_count,
        "rationale": pin.rationale,
    }


def aligned_source_provenance(
    cache_dir: Path | None,
    aligned_by_url: dict[str, AlignedRaster],
    layer_ids_by_url: dict[str, list[str]],
) -> dict[str, Any] | None:
    if cache_dir is None:
        return None
    return {
        "cache_dir": str(Path(cache_dir).resolve()),
        "sources": [
            {
                "layer_ids": layer_ids_by_url[url],
                "source_url": url,
                "source_sha256": aligned.source_sha256,
                "aligned_sha256": aligned.aligned_sha256,
                "cache_key": aligned.cache_key,
                "layer_class": aligned.layer_class,
                "resampling": aligned.resampling,
            }
            for url, aligned in aligned_by_url.items()
        ],
    }


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
            "metadata": "Manifest summary metrics are solution metadata and do not apply directly to arbitrary custom polygons.",
            "deferred": "Pairwise comparison metrics require two solutions. Threatened species secured requires a solution target percent that custom AOI requests do not currently provide.",
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
