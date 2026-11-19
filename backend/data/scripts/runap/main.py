"""Build `runap_identify.geojson` from the RUNAP shapefile in Vercel Blob.

Downloads `boundaries/runaps_vector/runap.{shp,shx,dbf,prj,cpg}`, reprojects to
EPSG:4326, keeps the eight UI/metrics attributes we care about, and writes
the GeoJSON to `--output`. Optionally uploads to
`inputs/includes/runap_identify.geojson` in Vercel Blob.

Run:
    python3 data/scripts/runap/main.py \
        --output data/inputs/includes/runap_identify.geojson [--upload]
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
sys.path.insert(0, str(SCRIPT_DIR))

from helpers.blob import (  # noqa: E402
    download_to,
    load_env_file,
    public_url,
    upload_via_vercel_cli,
)

SOURCE_PATHNAMES = [
    "boundaries/runaps_vector/runap.shp",
    "boundaries/runaps_vector/runap.shx",
    "boundaries/runaps_vector/runap.dbf",
    "boundaries/runaps_vector/runap.prj",
    "boundaries/runaps_vector/runap.cpg",
]

TARGET_BLOB_PATH = "inputs/includes/runap_identify.geojson"

# DBF field name → published GeoJSON property name. The DBF truncates names to
# 10 chars (`ap_categor`, `territor_1`), so we rename on the way out.
FIELD_MAP: dict[str, str] = {
    "ap_id": "runap_id",
    "ap_nombre": "runap_name",
    "ap_categor": "runap_category",
    "condicion": "runap_status",
    "area_ha_to": "runap_area_ha",
    "url": "runap_url",
    "sirap": "runap_sirap",
    "territor_1": "runap_dt",
}


def _check_ogr2ogr() -> None:
    if shutil.which("ogr2ogr") is None:
        raise RuntimeError(
            "ogr2ogr not found on PATH. Install GDAL (e.g. `brew install gdal`)."
        )


def build_geojson(
    shp_path: Path,
    output_path: Path,
    simplify_degrees: float,
) -> None:
    """Reproject and write the published GeoJSON via ogr2ogr.

    Uses a SQL SELECT to (1) rename DBF fields to clean property names and
    (2) drop attributes we don't need. Coordinate precision is trimmed to 5
    decimal places (~1 m at the equator) and geometry is simplified with a
    Douglas–Peucker tolerance to keep the file in the 10 MB range — the raw
    RUNAP polygons are over-detailed for country-scale display.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        output_path.unlink()
    select_clauses = ",\n  ".join(
        f"{src} AS {dst}" for src, dst in FIELD_MAP.items()
    )
    sql = f"SELECT\n  {select_clauses}\nFROM runap"
    cmd = [
        "ogr2ogr",
        "-f",
        "GeoJSON",
        str(output_path),
        str(shp_path),
        "-dialect",
        "OGRSQL",
        "-sql",
        sql,
        "-t_srs",
        "EPSG:4326",
        "-simplify",
        str(simplify_degrees),
        "-lco",
        "COORDINATE_PRECISION=5",
        "-nln",
        "runap_identify",
    ]
    print(f"[ogr] {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        sys.stderr.write(result.stdout + "\n" + result.stderr + "\n")
        raise RuntimeError(f"ogr2ogr failed (exit {result.returncode})")
    if result.stdout:
        print(result.stdout.strip())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=REPO_ROOT / "data" / "inputs" / "includes" / "runap_identify.geojson",
        help="Local output path for the published GeoJSON.",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=REPO_ROOT / "data" / "scripts" / "runap" / ".cache",
        help="Where to download the source shapefile sidecars.",
    )
    parser.add_argument(
        "--simplify",
        type=float,
        default=0.0001,
        help=(
            "Douglas–Peucker simplification tolerance in degrees "
            "(default 0.0001 ≈ ~11 m, keeps polygons smooth at country scale)."
        ),
    )
    parser.add_argument(
        "--upload",
        action="store_true",
        help="Upload the generated GeoJSON to inputs/includes/ in Vercel Blob.",
    )
    args = parser.parse_args()

    _check_ogr2ogr()
    load_env_file(REPO_ROOT / ".env.local")

    print(f"[runap] downloading shapefile to {args.cache_dir}")
    local_files = download_to(SOURCE_PATHNAMES, args.cache_dir)
    shp_path = local_files["boundaries/runaps_vector/runap.shp"]

    print(f"[runap] building {args.output} (simplify={args.simplify})")
    build_geojson(shp_path, args.output, args.simplify)

    size_mb = args.output.stat().st_size / (1024 * 1024)
    print(f"[runap] wrote {args.output} ({size_mb:.2f} MB)")

    if args.upload:
        upload_via_vercel_cli(args.output, TARGET_BLOB_PATH)
        print(f"[runap] published → {public_url(TARGET_BLOB_PATH)}")


if __name__ == "__main__":
    main()
