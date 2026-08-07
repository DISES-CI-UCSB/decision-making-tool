"""Build the six backend species group matrices on the EPSG:9377 land grid.

The precomputed metrics pipeline already resolved the hard geometry: for every
species it stored the exact fractional overlap of that species' modelled range
against the 1000 m EPSG:9377 land solution grid, as a
``species-exact-overlap-v1`` cache entry (sorted row-major flat target indices
plus float64 areas in m², with fully covered cells run-encoded). This script
reduces that cache to the binary presence artifact the backend runtime wants:
one ``.smtx.gz`` bundle per taxonomic group holding delta-encoded uint32
row-major cell IDs, with a single shared grid block in the table of contents.

Threshold policy
----------------
A cell is emitted when its overlap area exceeds ``--min-overlap-m2``, which
defaults to ``CACHE_POSITIVE_AREA_EPSILON_M2`` (1e-10 m²) — the same epsilon the
overlap cache itself used to decide a cell is covered at all. At that default
every cell recorded in the cache is emitted, which is a deliberate choice
rather than an inherited accident:

* The precomputed pipeline counts a species as present in a selection when any
  cache cell with positive area falls inside it (``selected_range_area_m2 > 0``
  in ``calculators/species.py``). The backend answers the same presence
  question for hand-drawn AOIs. Any stricter threshold would make live AOI
  answers systematically disagree with published metrics, in the false-negative
  direction, precisely for thin and coastal ranges.
* ``.smtx.gz`` is a presence format with no area channel, so dropping a cell
  discards the only signal it carries. Over-inclusion stays measurable;
  omission is silent.

The cost is that a range's cells cover more ground than the range itself,
because a reprojected range acquires a fringe of partially covered cells that
each count as a whole 1 km² cell. On this cache that is about +5% at the
median and over +100% for the thinnest ranges. Raising the threshold to half a
cell would trade that for dropping roughly 3% of range cells and shrinking the
thinnest ranges by more than half, which is why it is not the default. Instead
each table-of-contents entry records ``area_km2``, the summed exact overlap, so
that readers report the true range rather than the cell total.

The grid block records ``nodata`` 255 to match both the published 4326 bundles
and the target profile the overlap builder rasterised against.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import struct
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
METRICS_PIPELINE = REPO_ROOT / "data" / "metrics" / "python" / "metrics_pipeline"
if str(METRICS_PIPELINE) not in sys.path:
    sys.path.insert(0, str(METRICS_PIPELINE))

from species_data import CLASS_BUCKETS, SpeciesRecord, load_species_records  # noqa: E402
from sparse.format import SMSP_MAGIC, SparseMetadata  # noqa: E402

SPECIES_CSV_PATH = METRICS_PIPELINE / "artifacts" / "species" / "biomod_spp_ranges_updatedIUCN.csv"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "data" / "metrics" / "cache" / "sparse" / "matrices-9377"
DEFAULT_REPORT_PATH = (
    REPO_ROOT / "data" / "metrics" / "cache" / "sparse" / "validation-9377" / "conversion-report.json"
)

SPECIES_MATRIX_GROUPS: tuple[str, ...] = (*CLASS_BUCKETS, "threatened")
OVERLAP_FORMAT = "species-exact-overlap-v1"
CACHE_POSITIVE_AREA_EPSILON_M2 = 1e-5**2
GRID_NODATA = 255.0
SPECIES_EXCEPTION_FORMAT = "release-species-exception-v1"
REQUIRED_EXCEPTION_REASON = "upstream_source_missing"


class ConversionError(RuntimeError):
    """Raised when an input violates a fail-closed precondition."""


@dataclass(frozen=True)
class OverlapEntry:
    """One validated overlap cache artifact and the QA block that describes it."""

    blob_filename: str
    artifact_path: Path
    manifest_path: Path
    target_grid: dict[str, Any]
    target_grid_sha256: str
    authoritative_area_km2: float | None
    positive_cell_count: int
    intersected_area_km2: float


@dataclass(frozen=True)
class SpeciesConversion:
    """Per-species result recorded for downstream validation."""

    scientific_name: str
    group: str
    iucn_status: str
    csv_class: str
    cell_count: int
    exact_area_km2: float
    authoritative_area_km2: float | None


def read_overlap_cells(
    path: Path,
    *,
    grid_shape: tuple[int, int],
    min_overlap_m2: float,
    cell_area_m2: float,
) -> tuple[np.ndarray, float]:
    """Return sorted uint32 row-major cell IDs above threshold, plus exact area.

    The returned area is the exact fractional overlap of every cell the cache
    recorded, independent of the threshold, so callers can reconcile it against
    the manifest QA block and the species catalogue.
    """
    try:
        with np.load(path, allow_pickle=False) as archive:
            run_starts = np.asarray(archive["full_run_starts"], dtype=np.int64)
            run_lengths = np.asarray(archive["full_run_lengths"], dtype=np.int64)
            partial_indices = np.asarray(archive["partial_flat_indices"], dtype=np.int64)
            partial_areas = np.asarray(archive["partial_areas_m2"], dtype=np.float64)
            stored_shape = tuple(int(value) for value in archive["target_shape"].tolist())
    except (OSError, ValueError, KeyError) as exc:
        raise ConversionError(f"Unreadable overlap artifact {path}: {exc}") from exc

    if stored_shape != grid_shape:
        raise ConversionError(
            f"Overlap artifact {path} targets {stored_shape}, expected {grid_shape}."
        )
    if run_starts.shape != run_lengths.shape or partial_indices.shape != partial_areas.shape:
        raise ConversionError(f"Overlap artifact {path} has mismatched sparse arrays.")
    if np.any(run_lengths <= 0):
        raise ConversionError(f"Overlap artifact {path} has a non-positive full-cell run.")

    full_indices = (
        np.concatenate(
            [
                np.arange(start, start + length, dtype=np.int64)
                for start, length in zip(run_starts, run_lengths, strict=True)
            ]
        )
        if run_starts.size
        else np.empty(0, dtype=np.int64)
    )
    indices = np.concatenate([full_indices, partial_indices])
    areas = np.concatenate(
        [np.full(full_indices.size, cell_area_m2, dtype=np.float64), partial_areas]
    )
    order = np.argsort(indices, kind="stable")
    indices = indices[order]
    areas = areas[order]

    height, width = grid_shape
    if indices.size and (
        indices[0] < 0
        or indices[-1] >= height * width
        or np.any(indices[1:] <= indices[:-1])
    ):
        raise ConversionError(
            f"Overlap artifact {path} indices must be sorted, unique, and inside the grid."
        )
    if np.any(~np.isfinite(areas)) or np.any(areas <= CACHE_POSITIVE_AREA_EPSILON_M2):
        raise ConversionError(f"Overlap artifact {path} has non-finite or sub-epsilon areas.")

    exact_area_km2 = float(areas.sum(dtype=np.float64)) / 1_000_000.0
    selected = indices[areas > min_overlap_m2]
    return selected.astype(np.uint32, copy=False), exact_area_km2


def index_overlap_cache(cache_dir: Path) -> dict[str, OverlapEntry]:
    """Index every overlap manifest by species blob filename, failing on drift."""
    manifest_paths = sorted(cache_dir.glob("*/*.json"))
    if not manifest_paths:
        raise ConversionError(f"No overlap manifests found under {cache_dir}.")

    entries: dict[str, OverlapEntry] = {}
    for manifest_path in manifest_paths:
        try:
            document = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ConversionError(f"Unreadable overlap manifest {manifest_path}: {exc}") from exc
        if document.get("format") != OVERLAP_FORMAT:
            raise ConversionError(
                f"Overlap manifest {manifest_path} is not {OVERLAP_FORMAT!r}."
            )
        source_url = document.get("sourceUrl")
        if not isinstance(source_url, str) or not source_url:
            raise ConversionError(f"Overlap manifest {manifest_path} has no sourceUrl.")
        blob_filename = source_url.rsplit("/", 1)[-1]

        artifact_path = manifest_path.with_suffix(".npz")
        if not artifact_path.is_file():
            raise ConversionError(f"Overlap manifest {manifest_path} has no .npz sibling.")
        qa = document.get("qa")
        if not isinstance(qa, dict):
            raise ConversionError(f"Overlap manifest {manifest_path} has no qa block.")

        entry = OverlapEntry(
            blob_filename=blob_filename,
            artifact_path=artifact_path,
            manifest_path=manifest_path,
            target_grid=document["targetGrid"],
            target_grid_sha256=str(document["targetGridSha256"]),
            authoritative_area_km2=document.get("authoritativeAreaKm2"),
            positive_cell_count=int(qa["positiveTargetCellCount"]),
            intersected_area_km2=float(qa["intersectedAreaKm2"]),
        )
        if blob_filename in entries:
            raise ConversionError(f"Overlap cache holds two entries for {blob_filename}.")
        entries[blob_filename] = entry

    reference = next(iter(entries.values()))
    reference_grid = _canonical_json(reference.target_grid)
    for entry in entries.values():
        if _canonical_json(entry.target_grid) != reference_grid:
            raise ConversionError(
                f"Overlap target grid for {entry.blob_filename} differs from "
                f"{reference.blob_filename}; refusing to mix grids."
            )
        if entry.target_grid_sha256 != reference.target_grid_sha256:
            raise ConversionError(
                f"Overlap targetGridSha256 for {entry.blob_filename} differs from "
                f"{reference.blob_filename}."
            )
    return entries


def load_species_exception(path: Path) -> dict[str, Any]:
    """Load and structurally validate a signed release species exception."""
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConversionError(f"Unreadable species exception {path}: {exc}") from exc
    if not isinstance(document, dict) or document.get("format") != SPECIES_EXCEPTION_FORMAT:
        raise ConversionError(f"Species exception {path} is not {SPECIES_EXCEPTION_FORMAT!r}.")
    if document.get("reason") != REQUIRED_EXCEPTION_REASON:
        raise ConversionError(
            f"Species exception reason must be {REQUIRED_EXCEPTION_REASON!r}."
        )
    approval = document.get("approval")
    if not isinstance(approval, dict) or approval.get("approved") is not True:
        raise ConversionError("Species exception lacks explicit approval.")
    resolution = document.get("patchResolution")
    if not isinstance(resolution, dict) or resolution.get("wildcardSkipAllowed") is not False:
        raise ConversionError("Species exception must forbid wildcard species skipping.")
    if resolution.get("required") is not True:
        raise ConversionError("Species exception must require a patch resolution.")

    inventory = document.get("inventory")
    excluded = document.get("excludedSpecies")
    if not isinstance(inventory, dict) or not isinstance(excluded, list):
        raise ConversionError("Species exception inventory or excludedSpecies is malformed.")
    if len(excluded) != inventory.get("excluded"):
        raise ConversionError("Species exception entry count disagrees with its inventory.")
    if inventory.get("catalogTotal") != inventory.get("availableExpected") + inventory.get(
        "excluded"
    ):
        raise ConversionError("Species exception inventory counts are not self-consistent.")

    filenames = [entry.get("filename") for entry in excluded]
    if any(not isinstance(name, str) or not name for name in filenames):
        raise ConversionError("Species exception has an entry without a filename.")
    if filenames != sorted(filenames) or len(filenames) != len(set(filenames)):
        raise ConversionError("Species exception filenames must be unique and sorted.")
    return document


def resolve_available_records(
    records: Sequence[SpeciesRecord],
    exception: dict[str, Any],
    available_filenames: Iterable[str],
    *,
    expect_catalog_total: int | None = None,
    expect_available: int | None = None,
) -> list[SpeciesRecord]:
    """Filter the catalogue to the species the cache is expected to contain.

    The signed exception says which species may be absent. This additionally
    proves the cache is missing *exactly* those species, so an unrelated gap can
    never ride along under an approved exception. Callers that know the release
    they are building pin the two inventory totals as well, which is what stops a
    tampered contract from authorising a third absent species.
    """
    inventory = exception["inventory"]
    if expect_catalog_total is not None and inventory["catalogTotal"] != expect_catalog_total:
        raise ConversionError(
            f"Species exception declares catalogTotal {inventory['catalogTotal']}; "
            f"caller pinned {expect_catalog_total}."
        )
    if expect_available is not None and inventory["availableExpected"] != expect_available:
        raise ConversionError(
            f"Species exception declares availableExpected {inventory['availableExpected']}; "
            f"caller pinned {expect_available}."
        )
    if len(records) != inventory["catalogTotal"]:
        raise ConversionError(
            f"Species catalogue has {len(records)} non-fish records; the exception "
            f"expects {inventory['catalogTotal']}."
        )

    by_filename = {record.blob_filename: record for record in records}
    excluded_filenames = []
    for entry in exception["excludedSpecies"]:
        filename = entry["filename"]
        record = by_filename.get(filename)
        if record is None:
            raise ConversionError(f"Approved species {filename!r} is absent from the catalogue.")
        metadata = entry.get("metadata") or {}
        if (
            record.scientific_name != entry.get("scientificName")
            or record.csv_class != metadata.get("class")
            or record.iucn_status != metadata.get("iucnStatus")
            or record.range_km2 != metadata.get("rangeKm2")
        ):
            raise ConversionError(f"Catalogue metadata drifted for approved species {filename!r}.")
        excluded_filenames.append(filename)

    excluded = set(excluded_filenames)
    available = [record for record in records if record.blob_filename not in excluded]
    if len(available) != inventory["availableExpected"]:
        raise ConversionError(
            f"{len(available)} species remain after the exception; expected "
            f"{inventory['availableExpected']}."
        )

    cached = set(available_filenames)
    expected = {record.blob_filename for record in available}
    missing = sorted(expected - cached)
    unexpected = sorted(cached - expected)
    if missing:
        raise ConversionError(
            f"{len(missing)} species have no overlap cache entry and are not covered by "
            f"the exception, starting with {missing[:5]}."
        )
    if unexpected:
        raise ConversionError(
            f"Overlap cache holds {len(unexpected)} species outside the catalogue, "
            f"starting with {unexpected[:5]}."
        )

    unmapped = [record.scientific_name for record in available if record.bucket is None]
    if unmapped:
        raise ConversionError(
            f"{len(unmapped)} species have no taxonomic group, starting with {unmapped[:5]}."
        )
    return available


def grid_from_target_grid(target_grid: dict[str, Any]) -> SparseMetadata:
    """Translate an overlap manifest ``targetGrid`` into a matrix grid block."""
    transform = target_grid.get("transform")
    if not isinstance(transform, list) or len(transform) != 6:
        raise ConversionError("Overlap targetGrid transform must be six numbers.")
    x_scale, row_rotation, x_origin, column_rotation, y_scale, y_origin = (
        float(value) for value in transform
    )
    if abs(row_rotation) > 1e-12 or abs(column_rotation) > 1e-12:
        raise ConversionError("Overlap targetGrid must be north-up and unrotated.")
    crs = target_grid.get("crs")
    if not isinstance(crs, str) or not crs:
        raise ConversionError("Overlap targetGrid has no CRS.")
    return SparseMetadata(
        width=int(target_grid["width"]),
        height=int(target_grid["height"]),
        x_origin=x_origin,
        y_origin=y_origin,
        x_scale=x_scale,
        y_scale=y_scale,
        nodata=GRID_NODATA,
        crs=crs,
        count=0,
    )


def records_for_group(records: Sequence[SpeciesRecord], group: str) -> list[SpeciesRecord]:
    if group == "threatened":
        return [record for record in records if record.threatened]
    return [record for record in records if record.bucket == group]


def write_species_matrix(
    destination: Path,
    grid: SparseMetadata,
    entries: Sequence[tuple[SpeciesRecord, int, float]],
    cells_for: Callable[[SpeciesRecord], np.ndarray],
) -> int:
    """Stream one ``.smtx.gz`` bundle in the ``encode_species_matrix`` layout.

    The table of contents needs every byte offset up front, so counts are
    supplied by the caller from its validation pass and re-checked here as the
    body is written. Streaming keeps the plants bundle, whose body is several
    gigabytes before compression, off the heap.

    Each entry also records ``area_km2``, the summed exact fractional overlap
    the cache holds for that species. The cell IDs alone cannot express it —
    presence is emitted for any positive overlap — so without it every reader
    is forced to approximate a range by the whole cells it touches.

    Writing the body in per-species chunks lets zlib pick different deflate
    block boundaries than a single-shot ``encode_species_matrix`` call, so the
    compressed bytes are not identical to that helper's output even though the
    decoded content is. Chunk boundaries are a deterministic function of the
    inputs, so repeated runs still reproduce the same file byte for byte.
    """
    if not entries:
        raise ConversionError(f"Refusing to write an empty species matrix: {destination}")

    grid_block = grid.to_json()
    grid_block.pop("count", None)
    toc_entries: list[dict[str, Any]] = []
    cursor = 0
    for record, count, area_km2 in entries:
        toc_entries.append(
            {
                "name": record.scientific_name,
                "iucn": record.iucn_status,
                "class": record.csv_class,
                "offset": cursor,
                "count": int(count),
                "area_km2": float(area_km2),
            }
        )
        cursor += 4 * int(count)

    toc_json = json.dumps(
        {"grid": grid_block, "species": toc_entries}, separators=(",", ":")
    ).encode("utf-8")

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.tmp")
    try:
        with temporary.open("wb") as raw_handle:
            with gzip.GzipFile(fileobj=raw_handle, mode="wb", mtime=0) as stream:
                stream.write(SMSP_MAGIC + struct.pack("<I", len(toc_json)) + toc_json)
                for record, count, _ in entries:
                    cell_ids = cells_for(record)
                    if cell_ids.size != count:
                        raise ConversionError(
                            f"{record.scientific_name} yielded {cell_ids.size} cells on the "
                            f"write pass but {count} while planning."
                        )
                    stream.write(delta_encode(cell_ids).tobytes())
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination.stat().st_size


def delta_encode(cell_ids: np.ndarray) -> np.ndarray:
    """Delta-encode ascending cell IDs exactly as the sparse format expects."""
    if cell_ids.size == 0:
        return cell_ids.astype(np.uint32, copy=False)
    encoded = np.empty_like(cell_ids, dtype=np.uint32)
    encoded[0] = cell_ids[0]
    if cell_ids.size > 1:
        np.subtract(cell_ids[1:], cell_ids[:-1], out=encoded[1:], dtype=np.uint32)
    return encoded


def convert(
    *,
    cache_dir: Path,
    exception_path: Path,
    species_csv: Path,
    output_dir: Path,
    min_overlap_m2: float,
    groups: Sequence[str],
    expect_catalog_total: int | None = None,
    expect_available: int | None = None,
) -> dict[str, Any]:
    overlap_index = index_overlap_cache(cache_dir)
    exception = load_species_exception(exception_path)
    records = load_species_records(species_csv)
    available = resolve_available_records(
        records,
        exception,
        overlap_index.keys(),
        expect_catalog_total=expect_catalog_total,
        expect_available=expect_available,
    )

    reference = next(iter(overlap_index.values()))
    grid = grid_from_target_grid(reference.target_grid)
    grid_shape = (grid.height, grid.width)
    cell_area_m2 = abs(grid.x_scale * grid.y_scale)
    print(
        f"[species-9377] grid {grid.width}x{grid.height} {grid.crs} "
        f"cell_area={cell_area_m2:,.4f} m^2; species available={len(available):,}"
    )
    print(f"[species-9377] threshold: overlap area > {min_overlap_m2:g} m^2")

    strict_counts = min_overlap_m2 <= CACHE_POSITIVE_AREA_EPSILON_M2
    conversions: dict[str, SpeciesConversion] = {}
    counts: dict[str, int] = {}
    exact_areas: dict[str, float] = {}
    for position, record in enumerate(available, start=1):
        if position % 1000 == 0:
            print(f"[species-9377]   validated {position:,}/{len(available):,}")
        entry = overlap_index[record.blob_filename]
        cell_ids, exact_area_km2 = read_overlap_cells(
            entry.artifact_path,
            grid_shape=grid_shape,
            min_overlap_m2=min_overlap_m2,
            cell_area_m2=cell_area_m2,
        )
        if strict_counts and cell_ids.size != entry.positive_cell_count:
            raise ConversionError(
                f"{record.scientific_name} decoded {cell_ids.size} cells but its manifest "
                f"records {entry.positive_cell_count}."
            )
        if cell_ids.size > entry.positive_cell_count:
            raise ConversionError(
                f"{record.scientific_name} decoded more cells than its manifest records."
            )
        if abs(exact_area_km2 - entry.intersected_area_km2) > 1e-9 * max(
            1.0, entry.intersected_area_km2
        ):
            raise ConversionError(
                f"{record.scientific_name} exact area {exact_area_km2} disagrees with its "
                f"manifest QA {entry.intersected_area_km2}."
            )
        counts[record.blob_filename] = int(cell_ids.size)
        exact_areas[record.blob_filename] = exact_area_km2
        conversions[record.scientific_name] = SpeciesConversion(
            scientific_name=record.scientific_name,
            group=str(record.bucket),
            iucn_status=record.iucn_status,
            csv_class=record.csv_class,
            cell_count=int(cell_ids.size),
            exact_area_km2=exact_area_km2,
            authoritative_area_km2=entry.authoritative_area_km2,
        )

    def cells_for(record: SpeciesRecord) -> np.ndarray:
        cell_ids, _ = read_overlap_cells(
            overlap_index[record.blob_filename].artifact_path,
            grid_shape=grid_shape,
            min_overlap_m2=min_overlap_m2,
            cell_area_m2=cell_area_m2,
        )
        return cell_ids

    group_report: dict[str, Any] = {}
    for group in groups:
        selected = records_for_group(available, group)
        planned = [
            (record, counts[record.blob_filename], exact_areas[record.blob_filename])
            for record in selected
        ]
        destination = output_dir / f"species_{group}.smtx.gz"
        size_bytes = write_species_matrix(destination, grid, planned, cells_for)
        cell_references = sum(count for _, count, _ in planned)
        group_report[group] = {
            "species_count": len(planned),
            "cell_references": cell_references,
            "zero_cell_species": sum(1 for _, count, _ in planned if count == 0),
            "bytes": size_bytes,
            "path": str(destination),
        }
        print(
            f"[species-9377] {group:>11}: species={len(planned):>5,} "
            f"cell_refs={cell_references:>13,} bytes={size_bytes:>12,} -> {destination.name}"
        )

    return {
        "format": "species-overlap-to-matrix-report/v1",
        "grid": {**grid.to_json(), "count": None},
        "threshold_m2": min_overlap_m2,
        "cache_epsilon_m2": CACHE_POSITIVE_AREA_EPSILON_M2,
        "species_exception": {
            "path": str(exception_path),
            "policy_id": exception.get("policyId"),
            "release_id": exception.get("releaseId"),
            "policy_sha256": _canonical_sha256(exception),
            "excluded": [entry["filename"] for entry in exception["excludedSpecies"]],
        },
        "species_available": len(available),
        "groups": group_report,
        "species": [
            {
                "scientific_name": item.scientific_name,
                "group": item.group,
                "iucn_status": item.iucn_status,
                "class": item.csv_class,
                "cell_count": item.cell_count,
                "exact_area_km2": item.exact_area_km2,
                "authoritative_area_km2": item.authoritative_area_km2,
            }
            for item in conversions.values()
        ],
    }


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _canonical_sha256(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--overlap-cache-dir",
        type=Path,
        required=True,
        help="species-overlap directory of the metrics pipeline tier1 cache (read only).",
    )
    parser.add_argument(
        "--species-exception",
        type=Path,
        required=True,
        help="Signed release species-exception.json listing approved missing species.",
    )
    parser.add_argument("--species-csv", type=Path, default=SPECIES_CSV_PATH)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT_PATH)
    parser.add_argument(
        "--min-overlap-m2",
        type=float,
        default=CACHE_POSITIVE_AREA_EPSILON_M2,
        help="Emit a cell when its overlap area exceeds this many square metres.",
    )
    parser.add_argument(
        "--group",
        action="append",
        dest="groups",
        choices=SPECIES_MATRIX_GROUPS,
        help="Restrict to one or more groups (repeatable). Default: all six.",
    )
    parser.add_argument(
        "--expect-catalog-total",
        type=int,
        default=None,
        help="Require the exception to declare this catalogTotal.",
    )
    parser.add_argument(
        "--expect-available-species",
        type=int,
        default=None,
        help="Require the exception to declare this availableExpected count.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    groups = tuple(args.groups) if args.groups else SPECIES_MATRIX_GROUPS
    try:
        report = convert(
            cache_dir=args.overlap_cache_dir,
            exception_path=args.species_exception,
            species_csv=args.species_csv,
            output_dir=args.output_dir,
            min_overlap_m2=args.min_overlap_m2,
            groups=groups,
            expect_catalog_total=args.expect_catalog_total,
            expect_available=args.expect_available_species,
        )
    except ConversionError as exc:
        print(f"[species-9377] ERROR: {exc}", file=sys.stderr)
        return 1

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"[species-9377] wrote report {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
