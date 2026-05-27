"""CLI: pack per-species ``.sparse.gz`` files into per-taxon ``.smtx.gz`` bundles.

The browser hot path doesn't fetch 8,300 individual sparse sidecars — that
would defeat the point of the data prep gate.  This builder runs after
``build_species_sparse.py`` and produces one ``.smtx.gz`` bundle per
taxonomic group:

    inputs/features/species-sparse/species_mammals.smtx.gz       (256 species)
    inputs/features/species-sparse/species_birds.smtx.gz       (1,552 species)
    inputs/features/species-sparse/species_amphibians.smtx.gz    (184 species)
    inputs/features/species-sparse/species_reptiles.smtx.gz      (160 species)
    inputs/features/species-sparse/species_plants.smtx.gz      (6,148 species)
    inputs/features/species-sparse/species_threatened.smtx.gz    (213 species,
        union of CR/EN/VU non-fish)

The threatened bundle is a deliberate duplicate set: those 213 species also
appear in their respective taxonomic bundles.  The duplication is cheap
(~1.4 MB total) and lets the JS loader fetch the much smaller threatened
bundle for #3 / #26 without paying the plants-bundle download cost.

For each species the builder prefers the locally cached ``.sparse.gz``
written by ``build_species_sparse.py``; if it's missing it falls back to
fetching the species blob over HTTPS.  Reading from local cache avoids
spurious bandwidth costs when re-running.

Usage::

    # Dry-run: report which species are missing per group, build nothing
    python data/metrics/python/metrics_pipeline/sparse/build_species_matrix.py --dry-run

    # Build local-only (no upload)
    python data/metrics/python/metrics_pipeline/sparse/build_species_matrix.py --no-upload

    # Build + upload (default)
    python data/metrics/python/metrics_pipeline/sparse/build_species_matrix.py

    # Only one group
    python data/metrics/python/metrics_pipeline/sparse/build_species_matrix.py --group plants
"""

from __future__ import annotations

import argparse
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

_PIPELINE_ROOT = Path(__file__).resolve().parent.parent
if str(_PIPELINE_ROOT) not in sys.path:
    sys.path.insert(0, str(_PIPELINE_ROOT))

from species_data import (  # noqa: E402
    CLASS_BUCKETS,
    SPECIES_CSV_URL,
    SPECIES_TIF_SUFFIX,
    SpeciesRecord,
    load_species_records,
)
from local_io import cached_download  # noqa: E402

from sparse.format import (  # noqa: E402
    SparseFormatError,
    SparseMetadata,
    SpeciesMatrixEntry,
    decode_sparse_bytes,
    encode_species_matrix,
)
from sparse.vercel_blob import (  # noqa: E402
    BlobError,
    load_token_from_env_file,
    public_url_for,
    upload_blob,
)

DEFAULT_LOCAL_SPARSE_DIR = Path("data/metrics/cache/sparse/species")
DEFAULT_LOCAL_OUTPUT_DIR = Path("data/metrics/cache/sparse/matrices")
DEFAULT_TIF_CACHE = Path("data/metrics/cache/tier1")

SPECIES_SPARSE_BLOB_DIRECTORY = "inputs/features/species/"
MATRIX_BLOB_DIRECTORY = "inputs/features/species-sparse/"

ALL_GROUPS: tuple[str, ...] = (*CLASS_BUCKETS, "threatened")


@dataclass
class GroupBuildResult:
    group: str
    species_count: int
    bundled_count: int
    missing_count: int = 0
    bytes_written: int = 0
    blob_pathname: str | None = None
    public_url: str | None = None
    status: str = "pending"  # pending | built | uploaded | error
    error: str | None = None
    missing_examples: list[str] = field(default_factory=list)


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--species-csv-url", default=SPECIES_CSV_URL,
        help="Vercel URL for biomod_spp_ranges_updatedIUCN.csv.",
    )
    parser.add_argument(
        "--cache-dir", type=Path, default=DEFAULT_TIF_CACHE,
        help="Local TIF download cache (used only for the species CSV).",
    )
    parser.add_argument(
        "--local-sparse-dir", type=Path, default=DEFAULT_LOCAL_SPARSE_DIR,
        help="Local directory containing per-species .sparse.gz files (build_species_sparse output).",
    )
    parser.add_argument(
        "--local-output-dir", type=Path, default=DEFAULT_LOCAL_OUTPUT_DIR,
        help="Where to write generated .smtx.gz files locally.",
    )
    parser.add_argument(
        "--group", action="append", default=None,
        help=f"Restrict to one or more groups: {', '.join(ALL_GROUPS)} "
             "(repeatable). Default: all groups.",
    )
    parser.add_argument(
        "--no-fetch-fallback", action="store_true",
        help="Don't fetch missing species sparse files from Vercel; require local copies.",
    )
    parser.add_argument(
        "--no-upload", action="store_true",
        help="Generate locally only; skip vercel blob put.",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Report what would be packed, build and upload nothing.",
    )
    return parser.parse_args(argv)


def _local_sparse_path(record: SpeciesRecord, local_dir: Path) -> Path:
    return (
        local_dir
        / SPECIES_SPARSE_BLOB_DIRECTORY
        / f"{record.filename_stem}{SPECIES_TIF_SUFFIX[:-4]}.sparse.gz"
    )


def _public_sparse_url(record: SpeciesRecord) -> str:
    pathname = (
        f"{SPECIES_SPARSE_BLOB_DIRECTORY}"
        f"{record.filename_stem}{SPECIES_TIF_SUFFIX[:-4]}.sparse.gz"
    )
    return public_url_for(pathname)


def _records_for_group(records: list[SpeciesRecord], group: str) -> list[SpeciesRecord]:
    if group == "threatened":
        return [r for r in records if r.threatened]
    return [r for r in records if r.bucket == group]


def _matrix_pathname(group: str) -> str:
    return f"{MATRIX_BLOB_DIRECTORY}species_{group}.smtx.gz"


def _matrix_local_path(group: str, local_output_dir: Path) -> Path:
    return local_output_dir / f"species_{group}.smtx.gz"


def _load_species_artifact(
    record: SpeciesRecord,
    *,
    local_sparse_dir: Path,
    fetch_fallback: bool,
) -> bytes | None:
    local_path = _local_sparse_path(record, local_sparse_dir)
    if local_path.exists():
        return local_path.read_bytes()
    if not fetch_fallback:
        return None
    url = _public_sparse_url(record)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "smtx-builder/0.1"})
        with urllib.request.urlopen(req, timeout=60) as response:
            return response.read()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
        return None


def _entry_from_artifact(blob: bytes, record: SpeciesRecord) -> SpeciesMatrixEntry:
    artifact = decode_sparse_bytes(blob)
    grid_meta = artifact.metadata
    # Replace ``count`` with the actual cell count of THIS species — matrix
    # entries carry their own count.
    matrix_grid = SparseMetadata(
        width=grid_meta.width,
        height=grid_meta.height,
        x_origin=grid_meta.x_origin,
        y_origin=grid_meta.y_origin,
        x_scale=grid_meta.x_scale,
        y_scale=grid_meta.y_scale,
        nodata=grid_meta.nodata,
        crs=grid_meta.crs,
        count=int(artifact.cell_ids.size),
    )
    return SpeciesMatrixEntry(
        name=record.scientific_name,
        iucn=record.iucn_status,
        csv_class=record.csv_class,
        cell_ids=artifact.cell_ids,
        metadata=matrix_grid,
    )


def _normalise_grid(meta: SparseMetadata) -> tuple:
    """Return a hashable grid identity (ignoring per-species count)."""
    return (
        meta.width,
        meta.height,
        meta.x_origin,
        meta.y_origin,
        meta.x_scale,
        meta.y_scale,
        meta.crs,
    )


def _split_grid_groups(entries: list[SpeciesMatrixEntry]) -> dict[tuple, list[SpeciesMatrixEntry]]:
    """Bucket entries by grid identity so we can detect cross-grid mixing."""
    groups: dict[tuple, list[SpeciesMatrixEntry]] = {}
    for entry in entries:
        key = _normalise_grid(entry.metadata)
        groups.setdefault(key, []).append(entry)
    return groups


def _print_summary(report: list[GroupBuildResult], *, mode: str, started: float) -> None:
    elapsed = time.time() - started
    print(f"[species-matrix] {mode} complete in {elapsed:.1f}s")
    total_bytes = 0
    total_species = 0
    for item in report:
        line = (
            f"[species-matrix]   {item.group:>10}  "
            f"status={item.status:>8}  "
            f"species={item.bundled_count:>5}/{item.species_count:<5}  "
            f"bytes={item.bytes_written:>10,}  "
            f"missing={item.missing_count:>5}"
        )
        if item.public_url:
            line += f"  → {item.blob_pathname}"
        print(line)
        if item.missing_examples:
            preview = ", ".join(item.missing_examples[:5])
            extra = "" if item.missing_count <= 5 else f" (+{item.missing_count - 5} more)"
            print(f"[species-matrix]     missing examples: {preview}{extra}")
        total_bytes += item.bytes_written
        total_species += item.bundled_count
    if total_bytes:
        print(
            f"[species-matrix] total bundled species: {total_species:,}; "
            f"total smtx bytes: {total_bytes:,}"
        )
    for item in report:
        if item.error:
            print(f"[species-matrix]   ERROR {item.group}: {item.error}", file=sys.stderr)


def _build_one_group(
    group: str,
    records: list[SpeciesRecord],
    *,
    local_sparse_dir: Path,
    local_output_dir: Path,
    fetch_fallback: bool,
    dry_run: bool,
) -> GroupBuildResult:
    species = _records_for_group(records, group)
    result = GroupBuildResult(
        group=group,
        species_count=len(species),
        bundled_count=0,
    )

    if not species:
        result.status = "built"
        result.error = "no species in group"
        return result

    if dry_run:
        # Estimate availability without parsing artifacts.
        for record in species:
            if _local_sparse_path(record, local_sparse_dir).exists():
                result.bundled_count += 1
            else:
                result.missing_count += 1
                if len(result.missing_examples) < 10:
                    result.missing_examples.append(record.scientific_name)
        result.status = "built"
        return result

    entries: list[SpeciesMatrixEntry] = []
    for record in species:
        blob = _load_species_artifact(
            record,
            local_sparse_dir=local_sparse_dir,
            fetch_fallback=fetch_fallback,
        )
        if blob is None:
            result.missing_count += 1
            if len(result.missing_examples) < 10:
                result.missing_examples.append(record.scientific_name)
            continue
        try:
            entry = _entry_from_artifact(blob, record)
        except SparseFormatError as exc:
            result.missing_count += 1
            if len(result.missing_examples) < 10:
                result.missing_examples.append(f"{record.scientific_name} ({exc})")
            continue
        entries.append(entry)

    if not entries:
        result.status = "error"
        result.error = "no species artifacts could be loaded"
        return result

    grid_groups = _split_grid_groups(entries)
    if len(grid_groups) > 1:
        sizes = sorted((len(v), k) for k, v in grid_groups.items())
        majority_key = sizes[-1][1]
        majority_entries = grid_groups[majority_key]
        dropped = len(entries) - len(majority_entries)
        print(
            f"[species-matrix]   WARN {group}: {len(grid_groups)} distinct grids; "
            f"keeping the majority ({len(majority_entries):,}) and dropping {dropped:,}",
            file=sys.stderr,
        )
        result.missing_count += dropped
        for entry in entries:
            if _normalise_grid(entry.metadata) != majority_key:
                if len(result.missing_examples) < 10:
                    result.missing_examples.append(f"{entry.name} (grid mismatch)")
        entries = majority_entries

    encoded = encode_species_matrix(entries)
    out_path = _matrix_local_path(group, local_output_dir)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(encoded)

    result.bundled_count = len(entries)
    result.bytes_written = len(encoded)
    result.blob_pathname = _matrix_pathname(group)
    result.status = "built"
    return result


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    started = time.time()

    upload_enabled = not args.no_upload and not args.dry_run
    token: str | None = None
    if upload_enabled:
        try:
            token = load_token_from_env_file(Path(".env.local"))
        except BlobError as exc:
            print(f"[species-matrix] ERROR: {exc}", file=sys.stderr)
            return 2

    print(f"[species-matrix] fetching species CSV: {args.species_csv_url}")
    csv_dl = cached_download(args.species_csv_url, args.cache_dir)
    records = load_species_records(csv_dl.path)
    print(f"[species-matrix] CSV records: {len(records):,} (non-fish)")

    selected_groups: tuple[str, ...]
    if args.group:
        unknown = [g for g in args.group if g not in ALL_GROUPS]
        if unknown:
            print(f"[species-matrix] ERROR: unknown group(s) {unknown}", file=sys.stderr)
            return 2
        selected_groups = tuple(args.group)
    else:
        selected_groups = ALL_GROUPS

    print(f"[species-matrix] groups to build: {selected_groups}")

    fetch_fallback = not args.no_fetch_fallback
    report: list[GroupBuildResult] = []
    for group in selected_groups:
        print(f"[species-matrix] building group: {group}")
        item = _build_one_group(
            group,
            records,
            local_sparse_dir=args.local_sparse_dir,
            local_output_dir=args.local_output_dir,
            fetch_fallback=fetch_fallback,
            dry_run=args.dry_run,
        )
        if item.status == "built" and not args.dry_run and upload_enabled and token:
            local_path = _matrix_local_path(group, args.local_output_dir)
            blob_path = item.blob_pathname or _matrix_pathname(group)
            try:
                public_url = upload_blob(local_path, blob_path, token=token)
                item.status = "uploaded"
                item.public_url = public_url
                print(
                    f"[species-matrix]   uploaded {group} "
                    f"({item.bytes_written:,} B; {item.bundled_count:,} species) "
                    f"→ {blob_path}"
                )
            except BlobError as exc:
                item.status = "error"
                item.error = f"upload failed: {exc}"
                print(f"[species-matrix]   ERROR {group} upload: {exc}", file=sys.stderr)
        elif item.status == "built" and not args.dry_run:
            local_path = _matrix_local_path(group, args.local_output_dir)
            print(
                f"[species-matrix]   built    {group} "
                f"({item.bytes_written:,} B; {item.bundled_count:,} species) "
                f"→ {local_path}"
            )
        report.append(item)

    mode = "dry-run" if args.dry_run else ("upload" if upload_enabled else "local-only")
    _print_summary(report, mode=mode, started=started)

    has_errors = any(item.status == "error" for item in report)
    return 0 if not has_errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
