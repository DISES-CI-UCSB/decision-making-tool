"""Publish the EPSG:9377 land-solution inputs the custom AOI backend needs.

Two bundles go up, both to the ``land-solution-9377/`` sub-prefixes declared in
``land_solution_inputs.py``:

- the ecosystem bundle — the aligned MEC composite raster, the unchanged
  crosswalk, and a provenance document regenerated so its
  ``outputs.compositeRaster`` checksum matches the aligned raster instead of the
  EPSG:4326 one;
- the six species matrices built on the 9377 grid, which carry an exact
  ``area_km2`` per species that the published 4326 matrices lack.

The script refuses to write any pathname that already exists and asserts that no
target collides with the EPSG:4326 objects the deployed backend rebuilds from.
Every upload is verified by downloading the published bytes and comparing
checksums. The read/write token is read from ``.env.local`` and never printed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
METRICS_PIPELINE = REPO_ROOT / "data" / "metrics" / "python" / "metrics_pipeline"
for _import_root in (BACKEND_ROOT, METRICS_PIPELINE):
    if str(_import_root) not in sys.path:
        sys.path.insert(0, str(_import_root))

import rasterio  # noqa: E402

from sparse.vercel_blob import (  # noqa: E402
    BlobError,
    blob_exists,
    load_token_from_env_file,
    upload_blob,
)

from scripts.aligned_cache import (  # noqa: E402
    AlignedCacheError,
    AlignedRasterCache,
    sha256_file,
)
from scripts.land_solution_inputs import (  # noqa: E402
    ECOSYSTEM_BLOB_PATHS,
    LAND_SOLUTION_REFERENCE_PIN,
    LEGACY_4326_BLOB_PATHS,
    MEC_CROSSWALK_BLOB_PATH,
    MEC_PROVENANCE_BLOB_PATH,
    MEC_SOURCE_BLOB_PATH,
    MEC_SOURCE_SHA256,
    public_url,
    species_matrix_blob_path,
)

SPECIES_GROUPS = ("amphibians", "birds", "mammals", "plants", "reptiles", "threatened")
DEFAULT_SPECIES_MATRIX_DIR = REPO_ROOT / "data" / "metrics" / "cache" / "sparse" / "matrices-9377"
DEFAULT_STAGING_DIR = REPO_ROOT / "backend" / "runtime-artifacts" / "publish-staging"

# Outputs of the 4326 ingestion that are not reprojected onto the land grid.
# Kept for the audit trail but moved out of ``outputs`` so nothing in the 9377
# provenance claims to describe a raster on the 9377 grid.
UNPROJECTED_4326_OUTPUTS = (
    "derivedBiomeRegionRaster",
    "gapMaskRaster",
    "hitCountRaster",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--aligned-cache",
        type=Path,
        required=True,
        help="Metrics pipeline cache directory holding aligned/<key[:2]>/<key>.tif.",
    )
    parser.add_argument("--species-matrix-dir", type=Path, default=DEFAULT_SPECIES_MATRIX_DIR)
    parser.add_argument("--staging-dir", type=Path, default=DEFAULT_STAGING_DIR)
    parser.add_argument("--env-file", type=Path, default=REPO_ROOT / ".env.local")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Stage and validate every payload without uploading anything.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    staging = args.staging_dir.resolve()
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)

    targets = {
        **{f"ecosystem:{name}": path for name, path in ECOSYSTEM_BLOB_PATHS.items()},
        **{f"species:{group}": species_matrix_blob_path(group) for group in SPECIES_GROUPS},
    }
    assert_no_legacy_collision(targets.values())

    payloads: dict[str, Path] = {}
    payloads.update(stage_ecosystem_bundle(args.aligned_cache, staging / "ecosystems"))
    payloads.update(stage_species_matrices(args.species_matrix_dir, staging / "species-sparse"))

    print("\nStaged payloads:")
    for key, path in payloads.items():
        print(f"  {key:<24} {path.stat().st_size:>12,} bytes  {sha256_file(path)}")

    if args.dry_run:
        print("\nDry run: nothing uploaded.")
        return

    token = load_token_from_env_file(args.env_file)
    print(f"\nBLOB_READ_WRITE_TOKEN present: {bool(token)}")

    print("\nChecking that no target pathname already exists:")
    for key, blob_path in targets.items():
        if blob_exists(blob_path, token=token):
            raise SystemExit(
                f"Refusing to overwrite an existing blob object: {blob_path}. "
                "Publish to a new pathname instead."
            )
        print(f"  free  {blob_path}")

    print("\nUploading:")
    published: list[dict[str, Any]] = []
    for key, blob_path in targets.items():
        local = payloads[key]
        expected = sha256_file(local)
        upload_blob(local, blob_path, token=token)
        actual = download_sha256(public_url(blob_path))
        if actual != expected:
            raise SystemExit(
                f"Published object {blob_path} has sha256 {actual}, expected {expected}."
            )
        published.append(
            {
                "key": key,
                "blob_path": blob_path,
                "url": public_url(blob_path),
                "size_bytes": local.stat().st_size,
                "sha256": expected,
            }
        )
        print(f"  ok    {blob_path}  {expected[:16]}  {local.stat().st_size:,} bytes")

    report_path = staging / "publish-report.json"
    report_path.write_text(
        json.dumps(
            {
                "format": "land-solution-9377-publish/v1",
                "publishedAt": _utc_now(),
                "referenceRasterPin": {
                    "blobPath": LAND_SOLUTION_REFERENCE_PIN.blob_path,
                    "sha256": LAND_SOLUTION_REFERENCE_PIN.sha256,
                    "validCellCount": LAND_SOLUTION_REFERENCE_PIN.valid_cell_count,
                },
                "objects": published,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"\nPublished {len(published)} objects. Report: {report_path}")


def assert_no_legacy_collision(blob_paths: Any) -> None:
    legacy = set(LEGACY_4326_BLOB_PATHS)
    collisions = sorted(set(blob_paths) & legacy)
    if collisions:
        raise SystemExit(
            "Publish targets collide with the EPSG:4326 objects production rebuilds "
            f"from: {', '.join(collisions)}."
        )


def stage_ecosystem_bundle(cache_dir: Path, staging: Path) -> dict[str, Path]:
    """Copy the aligned MEC raster and crosswalk, and regenerate the provenance."""
    staging.mkdir(parents=True, exist_ok=True)
    try:
        cache = AlignedRasterCache(cache_dir)
        aligned = cache.lookup(
            "ecosistemas_IDEAM_MEC_2024",
            source_url=public_url(MEC_SOURCE_BLOB_PATH),
            layer_class="categorical",
            target=LAND_SOLUTION_REFERENCE_PIN.fingerprint,
        )
    except AlignedCacheError as exc:
        raise SystemExit(str(exc)) from exc
    if aligned.source_sha256 != MEC_SOURCE_SHA256:
        raise SystemExit(
            f"Aligned MEC raster derives from source sha256 {aligned.source_sha256}, "
            f"but the pin expects {MEC_SOURCE_SHA256}."
        )

    raster_path = staging / Path(ECOSYSTEM_BLOB_PATHS["raster"]).name
    shutil.copyfile(aligned.path, raster_path)
    raster_sha256 = sha256_file(raster_path)
    LAND_SOLUTION_REFERENCE_PIN.verify(raster_path, sha256=raster_sha256)
    print(f"Aligned MEC raster verified against the land-solution pin: {aligned.cache_key[:12]}")

    crosswalk_bytes = fetch_bytes(public_url(MEC_CROSSWALK_BLOB_PATH))
    crosswalk_path = staging / Path(ECOSYSTEM_BLOB_PATHS["crosswalk"]).name
    crosswalk_path.write_bytes(crosswalk_bytes)
    crosswalk_sha256 = hashlib.sha256(crosswalk_bytes).hexdigest()

    source_provenance_bytes = fetch_bytes(public_url(MEC_PROVENANCE_BLOB_PATH))
    provenance = build_land_solution_provenance(
        json.loads(source_provenance_bytes.decode("utf-8-sig")),
        source_provenance_sha256=hashlib.sha256(source_provenance_bytes).hexdigest(),
        aligned_raster=raster_path,
        aligned_raster_sha256=raster_sha256,
        aligned_cache_key=aligned.cache_key,
        aligned_source_sha256=aligned.source_sha256,
        aligned_resampling=aligned.resampling,
    )
    provenance_path = staging / Path(ECOSYSTEM_BLOB_PATHS["provenance"]).name
    provenance_path.write_text(json.dumps(provenance, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    validate_regenerated_provenance(
        provenance,
        crosswalk_bytes=crosswalk_bytes,
        raster_sha256=raster_sha256,
        crosswalk_sha256=crosswalk_sha256,
    )
    print("Regenerated provenance passes validate_composite_provenance.")

    return {
        "ecosystem:raster": raster_path,
        "ecosystem:crosswalk": crosswalk_path,
        "ecosystem:provenance": provenance_path,
    }


def build_land_solution_provenance(
    source: dict[str, Any],
    *,
    source_provenance_sha256: str,
    aligned_raster: Path,
    aligned_raster_sha256: str,
    aligned_cache_key: str,
    aligned_source_sha256: str,
    aligned_resampling: str,
) -> dict[str, Any]:
    """Rewrite the 4326 ingestion record for the aligned land-grid raster.

    The ingestion itself is unchanged — same IDEAM query, same OID pages, same
    crosswalk — so those blocks are carried across verbatim. Only the grid, the
    composite raster checksum, and the tool versions describe the reprojection.
    """
    provenance = json.loads(json.dumps(source))
    outputs = dict(provenance.get("outputs") or {})
    unprojected = {name: outputs.pop(name) for name in UNPROJECTED_4326_OUTPUTS if name in outputs}

    with rasterio.open(aligned_raster) as dataset:
        grid = {
            "width": dataset.width,
            "height": dataset.height,
            "transform": [float(value) for value in tuple(dataset.transform)[:6]],
            "crs": dataset.crs.to_string() if dataset.crs else "",
            "nodata": dataset.nodata,
            "dtype": dataset.dtypes[0],
            "validation_raster_sha256": (provenance.get("grid") or {}).get(
                "validation_raster_sha256", ""
            ),
        }
    grid["fingerprintSha256"] = _canonical_sha256(grid)

    outputs["compositeRaster"] = {
        "path": Path(ECOSYSTEM_BLOB_PATHS["raster"]).name,
        "bytes": aligned_raster.stat().st_size,
        "sha256": aligned_raster_sha256,
    }

    provenance["generatedAt"] = _utc_now()
    provenance["grid"] = grid
    provenance["outputs"] = dict(sorted(outputs.items()))
    provenance["tools"] = _tool_versions()
    provenance["alignment"] = {
        "format": "metrics-raster-alignment-v3",
        "referenceGrid": "land-solution",
        "cacheKey": aligned_cache_key,
        "layerClass": "categorical",
        "resampling": aligned_resampling,
        "sourceUrl": public_url(MEC_SOURCE_BLOB_PATH),
        "sourceSha256": aligned_source_sha256,
        "alignedSha256": aligned_raster_sha256,
        "validCellCount": LAND_SOLUTION_REFERENCE_PIN.valid_cell_count,
    }
    provenance["derivedFrom"] = {
        "provenanceUrl": public_url(MEC_PROVENANCE_BLOB_PATH),
        "provenanceSha256": source_provenance_sha256,
        "generatedAt": source.get("generatedAt"),
        "grid": source.get("grid"),
        # These describe the EPSG:4326 rasterization and are not reprojected.
        "outputs": dict(sorted(unprojected.items())),
        "diagnostics": source.get("diagnostics"),
    }
    return provenance


def validate_regenerated_provenance(
    provenance: dict[str, Any],
    *,
    crosswalk_bytes: bytes,
    raster_sha256: str,
    crosswalk_sha256: str,
) -> None:
    from mec_compact import (
        SOURCE_MODE_COMPOSITE,
        build_composite_taxonomy,
        load_composite_crosswalk,
        validate_composite_provenance,
        validate_taxonomy_partition,
    )

    rows = load_composite_crosswalk(crosswalk_bytes.decode("utf-8-sig"))
    taxonomy = build_composite_taxonomy(rows)
    validate_taxonomy_partition(taxonomy)
    if taxonomy.source_mode != SOURCE_MODE_COMPOSITE:
        raise SystemExit(f"Crosswalk yields source mode {taxonomy.source_mode!r}, expected composite.")
    validate_composite_provenance(
        provenance,
        raster_sha256=raster_sha256,
        crosswalk_sha256=crosswalk_sha256,
        crosswalk_row_count=len(rows),
    )


def stage_species_matrices(matrix_dir: Path, staging: Path) -> dict[str, Path]:
    """Copy the 9377 matrices, checking each declares the land grid and exact areas."""
    import gzip
    import struct

    from sparse.format import SMSP_MAGIC

    staging.mkdir(parents=True, exist_ok=True)
    matrix_dir = matrix_dir.resolve()
    staged: dict[str, Path] = {}
    for group in SPECIES_GROUPS:
        source = matrix_dir / f"species_{group}.smtx.gz"
        if not source.is_file():
            raise SystemExit(f"Species matrix is missing: {source}")
        with gzip.open(source, "rb") as handle:
            header = handle.read(8)
            if len(header) < 8 or header[:4] != SMSP_MAGIC:
                raise SystemExit(f"Species matrix {source} is not an SMSP bundle.")
            toc = json.loads(handle.read(struct.unpack_from("<I", header, 4)[0]).decode("utf-8"))

        grid = toc.get("grid") or {}
        pin = LAND_SOLUTION_REFERENCE_PIN
        declared = (grid.get("crs"), grid.get("width"), grid.get("height"))
        if declared != (pin.crs, pin.width, pin.height):
            raise SystemExit(
                f"Species matrix {source.name} declares {declared}, expected "
                f"{(pin.crs, pin.width, pin.height)}."
            )
        species = toc.get("species") or []
        without_area = [entry for entry in species if entry.get("area_km2") is None]
        if not species or without_area:
            raise SystemExit(
                f"Species matrix {source.name} has {len(without_area)} of {len(species)} "
                "species without an exact area_km2; the bitset would fall back to cell counts."
            )

        target = staging / source.name
        shutil.copyfile(source, target)
        print(f"Species matrix staged: {source.name} ({len(species)} species, exact areas)")
        staged[f"species:{group}"] = target
    return staged


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "dmt-publish-9377/0.1"})
    with urllib.request.urlopen(request, timeout=600) as response:
        return response.read()


def download_sha256(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "dmt-publish-9377/0.1"})
    digest = hashlib.sha256()
    with urllib.request.urlopen(request, timeout=1800) as response:
        while chunk := response.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _tool_versions() -> dict[str, str]:
    import numpy

    return {
        "gdal": rasterio.__gdal_version__,
        "numpy": numpy.__version__,
        "python": sys.version.split()[0],
        "rasterio": rasterio.__version__,
    }


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


if __name__ == "__main__":
    try:
        main()
    except BlobError as exc:
        raise SystemExit(f"Blob operation failed: {exc}") from exc
