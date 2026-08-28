"""Resumable builder and publisher for species distribution display COGs."""

from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
SPECIES_PREFIX = f"{PUBLIC_BLOB_HOST}/inputs/features/species"
DEFAULT_CATALOG_URL = f"{SPECIES_PREFIX}/biomod_spp_ranges_updatedIUCN.csv"
DEFAULT_OUTPUT_DIR = Path("data/metrics/generated/species-display-cogs")
CANONICAL_RELEASE_PREFIX = "releases/species-display-cogs-v1"
CANONICAL_TAXA = {
    "Mammalia": "mammals",
    "Aves": "birds",
    "Amphibia": "amphibians",
    "Squamata": "reptiles",
    "Crocodylia": "reptiles",
    "Magnoliopsida": "plants",
}
BATCH_3A_EXPECTED_TAXA = {"mammals": 256, "amphibians": 184, "reptiles": 160}
FULL_CATALOG_EXPECTED_NON_FISH = 8_300
DEFAULT_WORKERS = 4
APPROVED_EXCLUSIONS = frozenset(
    {
        "Hypericum_strictum_10_MAXENT.tif",
        "Paradrymonia_ciliosa_10_MAXENT.tif",
    }
)
EXCLUDED_CLASS = "Actinopteri"


class EmptySourceError(ValueError):
    """The source has no presence pixels, so a display distribution is impossible."""


@dataclass(frozen=True)
class SpeciesSource:
    scientific_name: str
    taxon_class: str
    filename: str

    @property
    def source_url(self) -> str:
        return f"{SPECIES_PREFIX}/{urllib.parse.quote(self.filename)}"

    @property
    def output_name(self) -> str:
        return self.filename.removesuffix(".tif") + ".epsg9377.cog.tif"

    @property
    def taxon_id(self) -> str:
        try:
            return CANONICAL_TAXA[self.taxon_class]
        except KeyError as error:
            raise ValueError(f"Unsupported Batch 3A class: {self.taxon_class}") from error

    @property
    def remote_pathname(self) -> str:
        return f"{CANONICAL_RELEASE_PREFIX}/{self.taxon_id}/{self.output_name}"

    @property
    def remote_url(self) -> str:
        return f"{PUBLIC_BLOB_HOST}/{self.remote_pathname}"


@dataclass(frozen=True)
class SpeciesShard:
    """A taxon-local, half-open alphabetical filename range."""

    taxon: str
    start: str | None
    end: str | None

    @property
    def slug(self) -> str:
        return "-".join((self.taxon, self.start or "start", self.end or "end"))


def parse_species_shard(value: str) -> SpeciesShard:
    """Parse `taxon:START:END`; `-` denotes an open range boundary."""
    pieces = value.split(":")
    if len(pieces) != 3:
        raise ValueError("Shard must be taxon:START:END (for example plants:A:G)")
    taxon, start, end = (piece.strip().lower() for piece in pieces)
    if taxon not in set(CANONICAL_TAXA.values()):
        raise ValueError(f"Unknown shard taxon: {taxon}")
    start = None if start in {"", "-"} else start.upper()
    end = None if end in {"", "-"} else end.upper()
    if start and end and start >= end:
        raise ValueError("Shard end must sort after its start")
    return SpeciesShard(taxon, start, end)


def select_species_shard(records: Iterable[SpeciesSource], shard: SpeciesShard) -> list[SpeciesSource]:
    """Select a deterministic, disjoint shard using source filenames."""
    return [
        record for record in records
        if record.taxon_id == shard.taxon
        and (shard.start is None or record.filename.upper() >= shard.start)
        and (shard.end is None or record.filename.upper() < shard.end)
    ]


def validate_species_shards(records: Iterable[SpeciesSource], shards: Iterable[SpeciesShard]) -> dict[str, int]:
    """Prove shard coverage and non-overlap for a full catalog partition."""
    records = list(records)
    assignments: Counter[str] = Counter()
    sizes: dict[str, int] = {}
    for shard in shards:
        selected = select_species_shard(records, shard)
        sizes[shard.slug] = len(selected)
        assignments.update(record.filename for record in selected)
    overlap = sorted(filename for filename, count in assignments.items() if count > 1)
    missing = sorted({record.filename for record in records} - set(assignments))
    if overlap or missing:
        raise ValueError(f"Invalid shard partition: overlap={overlap[:5]}, missing={missing[:5]}")
    return sizes


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def atomic_download(url: str, destination: Path, *, force: bool = False) -> Path:
    """Download once into a cache without leaving partial source files."""
    if destination.exists() and not force:
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.download")
    temporary.unlink(missing_ok=True)
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "species-display-cogs/1"})
        with urllib.request.urlopen(request) as response, temporary.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def load_species_catalog(catalog_path: Path) -> list[SpeciesSource]:
    """Derive every expected non-fish source deterministically from the CSV."""
    records: list[SpeciesSource] = []
    filenames: set[str] = set()
    with catalog_path.open(newline="", encoding="utf-8") as source:
        reader = csv.DictReader(source)
        required = {"scientific_name", "class"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError(f"Catalog must contain {sorted(required)}: {catalog_path}")
        for row in reader:
            name = (row.get("scientific_name") or "").strip()
            taxon_class = (row.get("class") or "").strip()
            if not name or taxon_class == EXCLUDED_CLASS:
                continue
            filename = f"{name.replace(' ', '_')}_10_MAXENT.tif"
            if filename in filenames:
                raise ValueError(f"Catalog has duplicate source filename: {filename}")
            filenames.add(filename)
            records.append(SpeciesSource(name, taxon_class, filename))
    return sorted(records, key=lambda record: record.filename)


def split_approved_exclusions(
    records: Iterable[SpeciesSource],
) -> tuple[list[SpeciesSource], list[SpeciesSource]]:
    expected, exclusions = [], []
    for record in records:
        (exclusions if record.filename in APPROVED_EXCLUSIONS else expected).append(record)
    actual = {record.filename for record in exclusions}
    if actual != APPROVED_EXCLUSIONS:
        raise ValueError(
            "Approved exclusion mismatch: "
            f"expected {sorted(APPROVED_EXCLUSIONS)}, found {sorted(actual)}"
        )
    return expected, exclusions


def cross_taxon_benchmark(records: list[SpeciesSource], count: int = 100) -> list[SpeciesSource]:
    """Pick a stable round-robin sample across taxonomy classes."""
    by_class: dict[str, list[SpeciesSource]] = defaultdict(list)
    for record in records:
        by_class[record.taxon_class].append(record)
    for class_records in by_class.values():
        class_records.sort(key=lambda record: record.filename)
    classes = sorted(by_class)
    selected: list[SpeciesSource] = []
    index = 0
    while len(selected) < count:
        added = False
        for taxon_class in classes:
            if index < len(by_class[taxon_class]):
                selected.append(by_class[taxon_class][index])
                added = True
                if len(selected) == count:
                    return selected
        if not added:
            break
        index += 1
    return selected


def validate_display_cog(output_path: Path, template_path: Path) -> dict[str, Any]:
    import numpy as np
    import rasterio
    from rasterio.enums import ColorInterp

    with rasterio.open(template_path) as template, rasterio.open(output_path) as output:
        grid_matches = (
            output.crs == template.crs
            and output.transform == template.transform
            and output.width == template.width
            and output.height == template.height
        )
        if not grid_matches:
            raise ValueError("output does not exactly match the canonical land grid")
        if output.count != 1 or output.dtypes[0] != "float32":
            raise ValueError("output must be a single Float32 band")
        if output.nodata is None or not math.isnan(output.nodata):
            raise ValueError("output NoData must be NaN")
        if output.colorinterp[0] is not ColorInterp.gray:
            raise ValueError("output band must use grayscale color interpretation")
        try:
            has_color_table = bool(output.colormap(1))
        except ValueError:
            has_color_table = False
        if has_color_table:
            raise ValueError("output must not have a color table")
        overview_levels = output.overviews(1)
        if not overview_levels:
            raise ValueError("output must have internal overviews")
        values = output.read(1, masked=False)
        finite_values = np.unique(values[np.isfinite(values)]).tolist()
        if finite_values != [1.0]:
            raise ValueError(f"finite output values must be [1.0], found {finite_values}")
        return {
            "exactGridMatch": True,
            "dtype": output.dtypes[0],
            "nodataIsNan": True,
            "colorInterp": output.colorinterp[0].name,
            "hasColorTable": False,
            "overviewLevels": overview_levels,
            "finiteValues": finite_values,
            "presenceCells": int(np.isfinite(values).sum()),
        }


def build_species_cog(
    record: SpeciesSource,
    *,
    template_path: Path,
    cache_dir: Path,
    output_dir: Path,
    force_download: bool = False,
) -> dict[str, Any]:
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.shutil import copy as rasterio_copy
    from rasterio.warp import reproject

    source_path = atomic_download(record.source_url, cache_dir / record.filename, force=force_download)
    output_path = output_dir / record.output_name
    source_sha256 = sha256_file(source_path)
    if output_path.exists():
        validation = validate_display_cog(output_path, template_path)
        return {
            "status": "cached",
            "sourceSha256": source_sha256,
            "outputPath": str(output_path),
            "outputSha256": sha256_file(output_path),
            "outputBytes": output_path.stat().st_size,
            "validation": validation,
        }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    aligned_path = output_path.with_name(f".{output_path.stem}.aligned.tif")
    temporary_cog = output_path.with_name(f".{output_path.name}.tmp")
    aligned_path.unlink(missing_ok=True)
    temporary_cog.unlink(missing_ok=True)
    try:
        with rasterio.open(template_path) as template, rasterio.open(source_path) as source:
            if source.crs is None:
                raise ValueError("source has no CRS")
            source_values = np.unique(source.read(1, masked=True).compressed()).tolist()
            unexpected_values = sorted(set(source_values) - {0, 1, 255})
            if unexpected_values:
                raise ValueError(f"source has unexpected finite values: {unexpected_values}")
            if 1 not in source_values:
                raise EmptySourceError("source has no finite presence (1) pixels")
            destination = np.full((template.height, template.width), np.nan, dtype=np.float32)
            reproject(
                source=rasterio.band(source, 1),
                destination=destination,
                src_transform=source.transform,
                src_crs=source.crs,
                src_nodata=source.nodata,
                dst_transform=template.transform,
                dst_crs=template.crs,
                dst_nodata=np.nan,
                resampling=Resampling.nearest,
                init_dest_nodata=True,
            )
            display = np.where(destination == 1, 1.0, np.nan).astype(np.float32)
            profile = template.profile.copy()
            profile.update(
                driver="GTiff", count=1, dtype="float32", nodata=np.nan, photometric="MINISBLACK",
                tiled=True, blockxsize=512, blockysize=512, compress="LZW", bigtiff="IF_SAFER",
            )
            with rasterio.open(aligned_path, "w", **profile) as aligned:
                aligned.write(display, 1)
        rasterio_copy(
            aligned_path, temporary_cog, driver="COG", COMPRESS="LZW", BLOCKSIZE=512,
            OVERVIEW_RESAMPLING="NEAREST", RESAMPLING="NEAREST", OVERVIEWS="IGNORE_EXISTING",
            BIGTIFF="IF_SAFER",
        )
        validation = validate_display_cog(temporary_cog, template_path)
        temporary_cog.replace(output_path)
    finally:
        aligned_path.unlink(missing_ok=True)
        temporary_cog.unlink(missing_ok=True)
    return {
        "status": "built",
        "sourceSha256": source_sha256,
        "outputPath": str(output_path),
        "outputSha256": sha256_file(output_path),
        "outputBytes": output_path.stat().st_size,
        "validation": validation,
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def batch_3a_records(catalog: list[SpeciesSource]) -> list[SpeciesSource]:
    """Return precisely the 600 authorized mammal, amphibian, and reptile records."""
    selected = [record for record in catalog if record.taxon_class in CANONICAL_TAXA]
    counts = Counter(record.taxon_id for record in selected)
    if dict(sorted(counts.items())) != BATCH_3A_EXPECTED_TAXA:
        raise ValueError(
            f"Batch 3A catalog counts changed: expected {BATCH_3A_EXPECTED_TAXA}, "
            f"found {dict(sorted(counts.items()))}"
        )
    return sorted(selected, key=lambda record: (record.taxon_id, record.filename))


def _read_progress(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    entries: dict[str, dict[str, Any]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        entry = json.loads(line)
        if filename := entry.get("filename"):
            entries[filename] = entry
    return entries


def _download_sha256(url: str, destination: Path) -> str:
    atomic_download(url, destination, force=True)
    return sha256_file(destination)


def _remote_status(record: SpeciesSource, local_sha256: str, cache_dir: Path) -> str:
    """Return verified when immutable remote bytes match, missing on a 404."""
    try:
        remote_sha256 = _download_sha256(
            record.remote_url,
            cache_dir / "remote-verify" / record.output_name,
        )
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return "missing"
        raise
    if remote_sha256 != local_sha256:
        raise ValueError(
            f"immutable remote blob exists with a different checksum: {record.remote_pathname}"
        )
    return "verified"


def publish_species_cog(record: SpeciesSource, entry: dict[str, Any], cache_dir: Path) -> dict[str, Any]:
    """Upload only a missing immutable pathname, then reopen and checksum it."""
    token = os.environ.get("BLOB_READ_WRITE_TOKEN")
    if not token:
        raise RuntimeError("BLOB_READ_WRITE_TOKEN is required for --publish")
    output_path = Path(entry["outputPath"])
    local_sha256 = str(entry["outputSha256"])
    remote_status = _remote_status(record, local_sha256, cache_dir)
    if remote_status == "missing":
        completed = subprocess.run(
            [
                "vercel", "blob", "put", str(output_path), "--pathname", record.remote_pathname,
                "--rw-token", token, "--no-color",
            ],
            text=True,
            capture_output=True,
            check=False,
        )
        if completed.returncode:
            # A concurrent writer can make this fail. Reopen below to distinguish
            # a matching completed upload from a conflicting object.
            try:
                remote_status = _remote_status(record, local_sha256, cache_dir)
            except Exception:
                raise RuntimeError(
                    f"upload failed for {record.remote_pathname}: {completed.stderr.strip()}"
                ) from None
            if remote_status != "verified":
                raise RuntimeError(f"upload failed for {record.remote_pathname}")
        else:
            remote_status = _remote_status(record, local_sha256, cache_dir)
    return {
        **entry,
        "status": "uploaded_verified" if entry["status"] == "built" else "resumed_verified",
        "remotePathname": record.remote_pathname,
        "remoteUrl": record.remote_url,
        "remoteSha256": local_sha256,
    }


def run_batch_3a(
    *,
    catalog_url: str,
    template_url: str,
    output_dir: Path,
    publish: bool,
    force_download: bool,
) -> tuple[dict[str, Any], int]:
    """Build the fixed Batch 3A scope and optionally publish immutable COGs."""
    started = time.monotonic()
    output_dir = output_dir.resolve()
    cache_dir = output_dir / "cache"
    catalog_path = atomic_download(catalog_url, cache_dir / "biomod_spp_ranges_updatedIUCN.csv", force=force_download)
    all_records, approved_missing = split_approved_exclusions(load_species_catalog(catalog_path))
    selected = batch_3a_records(all_records)
    template_path = atomic_download(template_url, cache_dir / "template_terrestre.tif", force=force_download)
    progress_path = output_dir / "batch-3a-progress.jsonl"
    prior_entries = _read_progress(progress_path)
    report: dict[str, Any] = {
        "format": "species-display-cog-batch-3a-v1",
        "generatedAt": utc_now(),
        "catalogUrl": catalog_url,
        "templateUrl": template_url,
        "publish": publish,
        "expected": len(selected),
        "expectedTaxa": BATCH_3A_EXPECTED_TAXA,
        "approvedMissingOutsideBatch": [record.filename for record in approved_missing],
        "entries": [],
    }
    unexpected_failures = 0
    for record in selected:
        item_started = time.monotonic()
        entry: dict[str, Any] = {
            "filename": record.filename, "scientificName": record.scientific_name,
            "class": record.taxon_class, "taxon": record.taxon_id, "startedAt": utc_now(),
        }
        try:
            previous = prior_entries.get(record.filename)
            if previous and previous.get("status") in {"uploaded_verified", "resumed_verified"}:
                entry.update(previous)
                if publish:
                    entry = publish_species_cog(record, entry, cache_dir)
                else:
                    entry["status"] = "resumed"
            else:
                entry.update(build_species_cog(
                    record, template_path=template_path, cache_dir=cache_dir, output_dir=output_dir,
                    force_download=force_download,
                ))
                if publish:
                    entry = publish_species_cog(record, entry, cache_dir)
            entry["elapsedSeconds"] = round(time.monotonic() - item_started, 3)
            _append_progress(progress_path, entry)
            report["entries"].append(entry)
            print(f"[species-display-cogs] {entry['status']}: {record.filename}")
        except EmptySourceError as error:
            source_path = cache_dir / record.filename
            entry.update(
                status="empty_source",
                sourceSha256=sha256_file(source_path),
                exclusion="no-displayable-range",
                reason=str(error),
                elapsedSeconds=round(time.monotonic() - item_started, 3),
            )
            _append_progress(progress_path, entry)
            report["entries"].append(entry)
            print(f"[species-display-cogs] empty_source: {record.filename}")
        except Exception as error:
            entry.update(status="failed", error=str(error),
                         elapsedSeconds=round(time.monotonic() - item_started, 3))
            source_path = cache_dir / record.filename
            if source_path.exists():
                entry["sourceSha256"] = sha256_file(source_path)
            _append_progress(progress_path, entry)
            report["entries"].append(entry)
            unexpected_failures += 1
            print(f"[species-display-cogs] failed: {record.filename}: {error}")
            break
    status_counts = Counter(entry["status"] for entry in report["entries"])
    report["statusCounts"] = dict(sorted(status_counts.items()))
    report["built"] = sum(
        entry["status"] in {"built", "cached", "uploaded_verified", "resumed_verified", "resumed"}
        for entry in report["entries"]
    )
    report["uploadedOrVerified"] = status_counts["uploaded_verified"] + status_counts["resumed_verified"]
    report["approvedMissing"] = 0
    report["emptySource"] = status_counts["empty_source"]
    report["skippedOrResumed"] = status_counts["cached"] + status_counts["resumed_verified"]
    report["unexpectedFailures"] = unexpected_failures
    report["elapsedSeconds"] = round(time.monotonic() - started, 3)
    _write_report(output_dir / "batch-3a-report.json", report)
    return report, 1 if unexpected_failures else 0


def all_non_fish_records(catalog: list[SpeciesSource], exclusions: list[SpeciesSource]) -> list[SpeciesSource]:
    """Validate and return the authoritative full individual-species scope."""
    if len(catalog) + len(exclusions) != FULL_CATALOG_EXPECTED_NON_FISH:
        raise ValueError(
            f"Non-fish catalog count changed: expected {FULL_CATALOG_EXPECTED_NON_FISH}, "
            f"found {len(catalog) + len(exclusions)}"
        )
    unsupported_classes = sorted({record.taxon_class for record in catalog} - set(CANONICAL_TAXA))
    if unsupported_classes:
        raise ValueError(f"Unsupported non-fish classes: {unsupported_classes}")
    return sorted(catalog, key=lambda record: (record.taxon_id, record.filename))


def run_full_species_catalog(
    *,
    catalog_url: str,
    template_url: str,
    output_dir: Path,
    publish: bool,
    force_download: bool,
    workers: int = DEFAULT_WORKERS,
    shard: SpeciesShard | None = None,
) -> tuple[dict[str, Any], int]:
    """Build all available non-fish species with bounded parallel workers.

    A completed item is appended to JSONL immediately. The aggregate report is
    atomically refreshed every 25 completions and on every hard failure.
    """
    if workers < 1:
        raise ValueError("workers must be at least 1")
    started = time.monotonic()
    output_dir = output_dir.resolve()
    cache_dir = output_dir / "cache"
    catalog_path = atomic_download(catalog_url, cache_dir / "biomod_spp_ranges_updatedIUCN.csv", force=force_download)
    available, approved_missing = split_approved_exclusions(load_species_catalog(catalog_path))
    selected = all_non_fish_records(available, approved_missing)
    all_records = selected + approved_missing
    scoped_records = select_species_shard(all_records, shard) if shard else all_records
    scoped_available = [record for record in scoped_records if record.filename not in APPROVED_EXCLUSIONS]
    scoped_missing = [record for record in scoped_records if record.filename in APPROVED_EXCLUSIONS]
    template_path = atomic_download(template_url, cache_dir / "template_terrestre.tif", force=force_download)
    progress_name = f"full-catalog-{shard.slug}-progress.jsonl" if shard else "full-catalog-progress.jsonl"
    report_name = f"full-catalog-{shard.slug}-report.json" if shard else "full-catalog-report.json"
    progress_path = output_dir / progress_name
    prior_entries = _read_progress(progress_path)
    # Batch 3A was published earlier into this same output directory. Seed its
    # verified entries so they are reopened and verified, never uploaded twice.
    prior_entries.update(_read_progress(output_dir / "batch-3a-progress.jsonl"))
    report_path = output_dir / report_name
    report: dict[str, Any] = {
        "format": "species-display-cog-full-catalog-v1",
        "generatedAt": utc_now(),
        "catalogUrl": catalog_url,
        "templateUrl": template_url,
        "publish": publish,
        "workers": workers,
        "catalogExpected": FULL_CATALOG_EXPECTED_NON_FISH,
        "expected": len(scoped_records),
        "shard": shard.slug if shard else None,
        "approvedMissing": len(scoped_missing),
        "entries": [
            {
                "filename": item.filename,
                "scientificName": item.scientific_name,
                "class": item.taxon_class,
                "taxon": item.taxon_id,
                "status": "approved_missing",
                "exclusion": "known-absent-source",
            }
            for item in scoped_missing
        ],
    }

    def process(record: SpeciesSource) -> dict[str, Any]:
        item_started = time.monotonic()
        entry: dict[str, Any] = {
            "filename": record.filename, "scientificName": record.scientific_name,
            "class": record.taxon_class, "taxon": record.taxon_id, "startedAt": utc_now(),
        }
        previous = prior_entries.get(record.filename)
        try:
            if previous and previous.get("status") in {"uploaded_verified", "resumed_verified"}:
                entry.update(previous)
                if publish:
                    entry = publish_species_cog(record, entry, cache_dir)
                else:
                    entry["status"] = "resumed"
            else:
                entry.update(build_species_cog(
                    record, template_path=template_path, cache_dir=cache_dir, output_dir=output_dir,
                    force_download=force_download,
                ))
                if publish:
                    entry = publish_species_cog(record, entry, cache_dir)
        except EmptySourceError as error:
            entry.update(
                status="empty_source",
                sourceSha256=sha256_file(cache_dir / record.filename),
                exclusion="no-displayable-range",
                reason=str(error),
            )
        except Exception as error:
            source_path = cache_dir / record.filename
            entry.update(status="failed", error=str(error))
            if source_path.exists():
                entry["sourceSha256"] = sha256_file(source_path)
        entry["elapsedSeconds"] = round(time.monotonic() - item_started, 3)
        return entry

    def write_aggregate() -> None:
        status_counts = Counter(entry["status"] for entry in report["entries"])
        report["statusCounts"] = dict(sorted(status_counts.items()))
        report["validBuilt"] = sum(
            entry["status"] in {"built", "cached", "uploaded_verified", "resumed_verified", "resumed"}
            for entry in report["entries"]
        )
        report["uploadedReopenedVerified"] = (
            status_counts["uploaded_verified"] + status_counts["resumed_verified"]
        )
        report["resumedVerified"] = status_counts["resumed_verified"]
        report["emptySource"] = status_counts["empty_source"]
        report["failed"] = status_counts["failed"]
        report["totalCogBytes"] = sum(int(entry.get("outputBytes", 0)) for entry in report["entries"])
        report["processed"] = len(report["entries"])
        report["elapsedSeconds"] = round(time.monotonic() - started, 3)
        _write_report(report_path, report)

    pending = iter(scoped_available)
    active: dict[Future[dict[str, Any]], SpeciesSource] = {}
    hard_failure = False
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="species-cog") as executor:
        for _ in range(workers):
            try:
                record = next(pending)
            except StopIteration:
                break
            active[executor.submit(process, record)] = record
        completed_since_report = 0
        while active:
            done, _ = wait(active, return_when=FIRST_COMPLETED)
            for future in done:
                record = active.pop(future)
                entry = future.result()
                _append_progress(progress_path, entry)
                report["entries"].append(entry)
                completed_since_report += 1
                print(f"[species-display-cogs] {entry['status']}: {record.filename}")
                if entry["status"] == "failed":
                    hard_failure = True
                if completed_since_report >= 25 or hard_failure:
                    write_aggregate()
                    completed_since_report = 0
                if not hard_failure:
                    try:
                        next_record = next(pending)
                    except StopIteration:
                        continue
                    active[executor.submit(process, next_record)] = next_record
            if hard_failure:
                # Running workers finish and record their state, but no further
                # source is started after the first integrity failure.
                for future, record in list(active.items()):
                    entry = future.result()
                    _append_progress(progress_path, entry)
                    report["entries"].append(entry)
                    print(f"[species-display-cogs] {entry['status']}: {record.filename}")
                active.clear()
    write_aggregate()
    if not hard_failure and len(report["entries"]) != len(scoped_records):
        raise RuntimeError(f"Shard incomplete: recorded {len(report['entries'])} of {len(scoped_records)}")
    if not hard_failure:
        index = {
            entry["filename"]: {
                key: entry[key]
                for key in ("scientificName", "class", "taxon", "status", "remotePathname", "remoteUrl",
                            "sourceSha256", "outputSha256", "remoteSha256", "validation")
                if key in entry
            }
            for entry in report["entries"]
        }
        index_name = f"full-catalog-{shard.slug}-cog-index.json" if shard else "full-catalog-cog-index.json"
        _write_report(output_dir / index_name, {
            "format": "species-display-cog-index-v1",
            "generatedAt": utc_now(),
            "shard": shard.slug if shard else None,
            "entries": index,
        })
    return report, 1 if hard_failure else 0


def _append_progress(path: Path, entry: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as progress:
        progress.write(json.dumps(entry, sort_keys=True) + "\n")


def run_species_preflight(
    *,
    catalog_url: str,
    template_url: str,
    output_dir: Path,
    dry_run: bool,
    benchmark_count: int | None,
    force_download: bool,
) -> tuple[dict[str, Any], int]:
    """Run metadata-only preflight or a local benchmark. This function never uploads."""
    started = time.monotonic()
    output_dir = output_dir.resolve()
    cache_dir = output_dir / "cache"
    catalog_path = atomic_download(catalog_url, cache_dir / "biomod_spp_ranges_updatedIUCN.csv", force=force_download)
    catalog, exclusions = split_approved_exclusions(load_species_catalog(catalog_path))
    selected = cross_taxon_benchmark(catalog, benchmark_count) if benchmark_count else catalog
    report: dict[str, Any] = {
        "format": "species-display-cog-preflight-v1",
        "generatedAt": utc_now(),
        "mode": "dry-run" if dry_run else f"benchmark-{benchmark_count}",
        "uploadsAttempted": 0,
        "catalogUrl": catalog_url,
        "templateUrl": template_url,
        "catalogNonFish": len(catalog) + len(exclusions),
        "approvedExclusions": [item.filename for item in exclusions],
        "expectedSources": len(catalog),
        "selected": len(selected),
        "selectedTaxa": dict(sorted(Counter(item.taxon_class for item in selected).items())),
        "entries": [],
    }
    if dry_run:
        report["statusCounts"] = {"planned": len(selected), "approved_missing": len(exclusions)}
        report["elapsedSeconds"] = round(time.monotonic() - started, 3)
        _write_report(output_dir / "preflight-report.json", report)
        return report, 0

    template_path = atomic_download(template_url, cache_dir / "template_terrestre.tif", force=force_download)
    progress_path = output_dir / "progress.jsonl"
    for record in selected:
        entry: dict[str, Any] = {"filename": record.filename, "class": record.taxon_class, "startedAt": utc_now()}
        item_started = time.monotonic()
        try:
            entry.update(build_species_cog(
                record, template_path=template_path, cache_dir=cache_dir, output_dir=output_dir,
                force_download=force_download,
            ))
        except urllib.error.HTTPError as error:
            entry.update(status="missing_source" if error.code == 404 else "failed", error=f"HTTP {error.code}")
        except EmptySourceError as error:
            entry.update(status="empty_source", error=str(error))
        except Exception as error:  # Continue so the report is useful for a preflight.
            entry.update(status="failed", error=str(error))
        entry["elapsedSeconds"] = round(time.monotonic() - item_started, 3)
        _append_progress(progress_path, entry)
        report["entries"].append(entry)
        print(f"[species-display-cogs] {entry['status']}: {record.filename}")
    status_counts = Counter(entry["status"] for entry in report["entries"])
    status_counts["approved_missing"] = len(exclusions)
    report["statusCounts"] = dict(sorted(status_counts.items()))
    report["totalCogBytes"] = sum(int(entry.get("outputBytes", 0)) for entry in report["entries"])
    report["elapsedSeconds"] = round(time.monotonic() - started, 3)
    _write_report(output_dir / "benchmark-report.json", report)
    failures = status_counts["failed"] + status_counts["missing_source"] + status_counts["empty_source"]
    return report, 1 if failures else 0


def _write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)
