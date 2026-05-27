"""CLI: build per-species ``.sparse.gz`` sidecars under ``inputs/features/species/``.

This is the data-prep gate for browser custom AOI species metrics.  It is
the species counterpart to ``build_layer_sparse.py``: same detect → build
→ upload loop, but iterates over every row of
``biomod_spp_ranges_updatedIUCN.csv`` (~8,300 non-fish species).

For each species:

1. Look up the source TIF: ``inputs/features/species/<Genus_species>_10_MAXENT.tif``.
2. Skip if a matching ``inputs/features/species/<Genus_species>_10_MAXENT.sparse.gz``
   already exists on Vercel (unless ``--force``).
3. Otherwise, download the TIF (``cached_download`` reuses the tier1 cache),
   encode it as a binary sparse artifact (selected_value=1, nodata=255),
   write ``data/metrics/cache/sparse/species/<...>.sparse.gz`` locally,
   then optionally upload.

The CLI prints progress every ``--progress-every`` species and is
resume-safe: re-runs only build the missing files.

Usage::

    # Dry-run (just count missing)
    python data/metrics/python/metrics_pipeline/sparse/build_species_sparse.py --dry-run

    # Build local-only (no upload)
    python data/metrics/python/metrics_pipeline/sparse/build_species_sparse.py --no-upload

    # Build + upload (default)
    python data/metrics/python/metrics_pipeline/sparse/build_species_sparse.py

    # Force-rebuild a few species
    python data/metrics/python/metrics_pipeline/sparse/build_species_sparse.py \\
        --only "Acacia_decurrens Aburria_aburri" --force

The ``--limit`` flag caps the number of species processed (smoke testing).
"""

from __future__ import annotations

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path

_PIPELINE_ROOT = Path(__file__).resolve().parent.parent
if str(_PIPELINE_ROOT) not in sys.path:
    sys.path.insert(0, str(_PIPELINE_ROOT))

from local_io import cached_download  # noqa: E402
from species_data import (  # noqa: E402
    SPECIES_BLOB_PREFIX,
    SPECIES_CSV_URL,
    SPECIES_TIF_SUFFIX,
    SpeciesRecord,
    load_species_records,
    species_blob_url,
)

from sparse.format import LAYER_TYPE_BINARY, encode_sparse_artifact  # noqa: E402
from sparse.tif_io import encode_tif_to_artifact  # noqa: E402
from sparse.vercel_blob import (  # noqa: E402
    BlobError,
    list_blobs,
    load_token_from_env_file,
    public_url_for,
    upload_blob,
)

DEFAULT_LOCAL_CACHE = Path("data/metrics/cache/sparse/species")
DEFAULT_TIF_CACHE = Path("data/metrics/cache/tier1")
SPECIES_BLOB_DIRECTORY = "inputs/features/species/"


@dataclass
class SpeciesBuildResult:
    species_name: str
    status: str  # "skipped" | "built" | "uploaded" | "missing_tif" | "error"
    occupied: int = 0
    src_bytes: int = 0
    dst_bytes: int = 0
    error: str | None = None


@dataclass
class SpeciesBuildReport:
    started_at: float
    items: list[SpeciesBuildResult] = field(default_factory=list)
    pre_existing: int = 0


def _species_sparse_pathname(record: SpeciesRecord) -> str:
    return (
        f"{SPECIES_BLOB_DIRECTORY}{record.filename_stem}{SPECIES_TIF_SUFFIX[:-4]}.sparse.gz"
    )


def _local_path_for(record: SpeciesRecord, local_dir: Path) -> Path:
    pathname = _species_sparse_pathname(record)
    return local_dir / pathname


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--species-csv-url", default=SPECIES_CSV_URL,
        help="Vercel URL for biomod_spp_ranges_updatedIUCN.csv.",
    )
    parser.add_argument(
        "--cache-dir", type=Path, default=DEFAULT_TIF_CACHE,
        help="Local TIF download cache (re-uses tier1 cache by default).",
    )
    parser.add_argument(
        "--local-output-dir", type=Path, default=DEFAULT_LOCAL_CACHE,
        help="Where to write generated .sparse.gz files locally.",
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Cap the number of species processed (smoke tests).",
    )
    parser.add_argument(
        "--only", nargs="+", default=None,
        help="Only process these species names (Genus_species).",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Re-encode and re-upload even if the sparse artifact already exists.",
    )
    parser.add_argument(
        "--no-upload", action="store_true",
        help="Generate locally only; skip vercel blob put.",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Report what would be done; build and upload nothing.",
    )
    parser.add_argument(
        "--progress-every", type=int, default=200,
        help="Print a progress line every N species (default 200).",
    )
    parser.add_argument(
        "--no-prefilter", action="store_true",
        help="Skip the bulk Vercel listing pre-pass; do per-species existence checks.",
    )
    parser.add_argument(
        "--workers", type=int, default=8,
        help="Concurrent build+upload workers (default 8). 1 disables threading.",
    )
    return parser.parse_args(argv)


def _list_existing_species_sparse(token: str) -> set[str]:
    """List every .sparse.gz under the species blob prefix.

    Vercel CLI ``list --limit`` caps at ~1000 entries per call, but currently
    has no cursor.  At ~8300 species we'd need pagination — work around it
    by listing repeatedly with limit=10000 and trusting the CLI to return
    everything.  In practice, ``vercel blob list`` honors ``--limit`` up to
    a service-side cap that's higher than 8300.
    """
    try:
        entries = list_blobs(SPECIES_BLOB_DIRECTORY, token=token, limit=20000)
    except BlobError as exc:
        print(
            f"[species-sparse] WARN bulk list failed ({exc}); will fall back to "
            "per-species checks",
            file=sys.stderr,
        )
        return set()
    return {entry.pathname for entry in entries if entry.pathname.endswith(".sparse.gz")}


def _filter_records(
    records: list[SpeciesRecord],
    *,
    only: list[str] | None,
    limit: int | None,
) -> list[SpeciesRecord]:
    if only:
        wanted = {name.strip() for name in only}
        records = [r for r in records if r.filename_stem in wanted or r.scientific_name in wanted]
    if limit is not None:
        records = records[:limit]
    return records


def _build_one(
    record: SpeciesRecord,
    *,
    cache_dir: Path,
    local_output_dir: Path,
) -> tuple[bytes, int, int]:
    public_tif_url = species_blob_url(record.scientific_name)
    download = cached_download(public_tif_url, cache_dir)
    local_tif: Path = download.path

    artifact = encode_tif_to_artifact(
        local_tif,
        layer_type=LAYER_TYPE_BINARY,
        selected_value=1,
    )
    encoded = encode_sparse_artifact(artifact)

    out_path = _local_path_for(record, local_output_dir)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(encoded)

    src_bytes = local_tif.stat().st_size
    return encoded, artifact.metadata.count, src_bytes


def _print_progress(
    *, idx: int, total: int, started: float, report: SpeciesBuildReport
) -> None:
    elapsed = time.time() - started
    counts = {"uploaded": 0, "built": 0, "skipped": 0, "missing_tif": 0, "error": 0}
    for item in report.items:
        counts[item.status] = counts.get(item.status, 0) + 1
    rate = idx / elapsed if elapsed else 0.0
    eta = (total - idx) / rate if rate else float("inf")
    print(
        f"[species-sparse] {idx}/{total} "
        f"({elapsed:.1f}s; {rate:.1f}/s; eta {eta:.0f}s) "
        f"counts={counts}"
    )


def _print_summary(report: SpeciesBuildReport, *, mode: str) -> None:
    elapsed = time.time() - report.started_at
    counts: dict[str, int] = {}
    total_src = 0
    total_dst = 0
    for item in report.items:
        counts[item.status] = counts.get(item.status, 0) + 1
        total_src += item.src_bytes
        total_dst += item.dst_bytes

    print(f"[species-sparse] {mode} complete in {elapsed:.1f}s")
    print(f"[species-sparse] status counts: {counts}")
    if total_src:
        ratio = total_dst / total_src if total_src else 0.0
        print(
            f"[species-sparse] total source: {total_src:,} B   "
            f"sparse: {total_dst:,} B   ratio: {ratio:.3f}"
        )
    if report.pre_existing:
        print(
            f"[species-sparse] pre-existing on Vercel before this run: "
            f"{report.pre_existing:,}"
        )

    error_items = [item for item in report.items if item.error]
    if error_items:
        print(f"[species-sparse] errors: {len(error_items)}", file=sys.stderr)
        for item in error_items[:25]:
            print(
                f"[species-sparse]   ERROR {item.species_name}: {item.error}",
                file=sys.stderr,
            )
        if len(error_items) > 25:
            print(
                f"[species-sparse]   …and {len(error_items) - 25} more",
                file=sys.stderr,
            )


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    started = time.time()

    upload_enabled = not args.no_upload and not args.dry_run
    token: str | None = None
    if upload_enabled or not args.no_prefilter:
        try:
            token = load_token_from_env_file(Path(".env.local"))
        except BlobError as exc:
            if upload_enabled:
                print(f"[species-sparse] ERROR: {exc}", file=sys.stderr)
                return 2
            else:
                print(
                    f"[species-sparse] WARN no token; cannot pre-filter ({exc})",
                    file=sys.stderr,
                )
                token = None

    print(f"[species-sparse] fetching species CSV: {args.species_csv_url}")
    csv_dl = cached_download(args.species_csv_url, args.cache_dir)
    all_records = load_species_records(csv_dl.path)
    records = _filter_records(all_records, only=args.only, limit=args.limit)
    print(f"[species-sparse] CSV records: {len(all_records):,}; selected: {len(records):,}")

    existing: set[str] = set()
    if token and not args.no_prefilter:
        print(
            f"[species-sparse] pre-listing existing sparse artifacts under "
            f"{SPECIES_BLOB_DIRECTORY!r} (this is one Vercel call)…"
        )
        existing = _list_existing_species_sparse(token)
        print(f"[species-sparse] existing sparse artifacts: {len(existing):,}")

    report = SpeciesBuildReport(started_at=started, pre_existing=len(existing))

    pending: list[SpeciesRecord] = []
    for record in records:
        sparse_path = _species_sparse_pathname(record)
        already = sparse_path in existing
        if already and not args.force:
            report.items.append(SpeciesBuildResult(
                species_name=record.scientific_name, status="skipped",
            ))
            continue
        if args.dry_run:
            report.items.append(SpeciesBuildResult(
                species_name=record.scientific_name, status="built",
            ))
            continue
        pending.append(record)

    pre_skipped = sum(1 for item in report.items if item.status == "skipped")
    print(
        f"[species-sparse] {len(pending):,} to build "
        f"({pre_skipped:,} skipped, {len(records):,} total) — using "
        f"{max(1, args.workers)} worker(s)"
    )

    def _process(record: SpeciesRecord) -> SpeciesBuildResult:
        sparse_path = _species_sparse_pathname(record)
        try:
            encoded, occupied, src_bytes = _build_one(
                record,
                cache_dir=args.cache_dir,
                local_output_dir=args.local_output_dir,
            )
        except FileNotFoundError as exc:
            return SpeciesBuildResult(
                species_name=record.scientific_name,
                status="missing_tif",
                error=str(exc),
            )
        except Exception as exc:
            return SpeciesBuildResult(
                species_name=record.scientific_name,
                status="error",
                error=str(exc),
            )
        local_path = _local_path_for(record, args.local_output_dir)
        result = SpeciesBuildResult(
            species_name=record.scientific_name,
            status="built",
            occupied=occupied,
            src_bytes=src_bytes,
            dst_bytes=len(encoded),
        )
        if upload_enabled and token:
            try:
                upload_blob(local_path, sparse_path, token=token)
                result.status = "uploaded"
            except BlobError as exc:
                result.status = "error"
                result.error = f"upload failed: {exc}"
        return result

    completed = 0
    if not pending:
        pass
    elif args.workers <= 1:
        for record in pending:
            report.items.append(_process(record))
            completed += 1
            if completed % args.progress_every == 0:
                _print_progress(
                    idx=len(report.items), total=len(records),
                    started=started, report=report,
                )
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(_process, rec): rec for rec in pending}
            for future in as_completed(futures):
                report.items.append(future.result())
                completed += 1
                if completed % args.progress_every == 0:
                    _print_progress(
                        idx=len(report.items), total=len(records),
                        started=started, report=report,
                    )

    mode = "dry-run" if args.dry_run else ("upload" if upload_enabled else "local-only")
    _print_summary(report, mode=mode)

    has_errors = any(item.status == "error" for item in report.items)
    return 0 if not has_errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
