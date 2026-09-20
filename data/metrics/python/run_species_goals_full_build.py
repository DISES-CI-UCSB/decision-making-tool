"""Build and validate release-bound land species-goals sidecars with three workers."""

from __future__ import annotations

import argparse
import gc
import hashlib
import json
import multiprocessing as mp
import os
import queue
import re
import resource
import shutil
import subprocess
import sys
import time
import traceback
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

PIPELINE_DIR = Path(__file__).resolve().parent / "metrics_pipeline"
sys.path.insert(0, str(PIPELINE_DIR))

from boundaries.boundary_id_grid import build_boundary_id_grid  # noqa: E402
from boundaries.boundary_loader import load_all_boundaries  # noqa: E402
from boundaries.boundary_mask import BoundaryMaskCache  # noqa: E402
from local_io import DownloadError, cached_download  # noqa: E402
from main import _species_goals_provenance  # noqa: E402
from metrics_contract import build_metrics_provenance  # noqa: E402
from raster_align import grid_sha256  # noqa: E402
from raster_metrics import read_solution_raster, terrestrial_template_scope_mask  # noqa: E402
from species_data import load_species_records  # noqa: E402
from species_exception import load_species_exception  # noqa: E402
from species_goals import (  # noqa: E402
    DEFAULT_TERRESTRIAL_TEMPLATE_PATH,
    FLAG_CONFIGURED_TARGET_MET,
    FLAG_MET_17,
    FLAG_MET_30,
    GEOGRAPHY_LEVELS,
    SPECIES_GOALS_COVERAGE_ALGORITHM_VERSION,
    SPECIES_GOALS_COVERAGE_POLICY,
    SpeciesGoalsContractError,
    SpeciesGoalsPipeline,
    build_catalog,
    canonical_sha256,
    catalog_path,
    compact_partition_path,
    partition_is_resumable,
    record_species_goals_from_smsp,
    species_id,
    validate_catalog,
    validate_compact,
    write_catalog,
)
from species_target_policy import (  # noqa: E402
    SpeciesTargetPolicy,
    resolve_species_target_policy,
)

RELEASE_ID = os.environ.get(
    "METRICS_SPECIES_GOALS_RELEASE_ID",
    "solutions-v0-2-0-20260805",
)
CATALOG_VERSION = os.environ.get("METRICS_SPECIES_GOALS_CATALOG_VERSION", "0.2.0")
SOURCE_RELEASE_ID = os.environ.get(
    "METRICS_SPECIES_GOALS_SOURCE_RELEASE_ID",
    RELEASE_ID,
)
WORKER_COUNT = 3
MAX_NATIONAL_ONLY_WORKERS = 8
MIN_FREE_DISK_GIB = 60.0
MIN_FREE_MEMORY_PERCENT = 10
MAX_SYSTEMIC_FAILURES = 3
TARGET_GRID_SHA256 = "d558d3f39028e9dc4f83d42fd720f3d45081e3fdcdd2b0d5f72ccb1b6352f23e"
REPO_ROOT = Path(__file__).resolve().parents[3]
EXPECTED_SMSP_STEMS = frozenset(
    {"amphibians", "birds", "mammals", "plants", "reptiles"}
)
DEFAULT_SMSP_DIR = Path(
    os.environ.get(
        "METRICS_SPECIES_GOALS_SMSP_DIR",
        str(
            REPO_ROOT
            / "data/metrics/cache/mesa-v3/species-goals-calculator-a"
        ),
    )
)


def _species_goals_matrix_paths() -> list[Path]:
    directory = Path(DEFAULT_SMSP_DIR)
    if not directory.is_absolute():
        directory = REPO_ROOT / directory
    paths = sorted(directory.glob("*.smtx.gz"))
    stems = {path.name.removesuffix(".smtx.gz") for path in paths}
    if stems != EXPECTED_SMSP_STEMS:
        raise ValueError(
            f"SMSP cache {directory} must contain exactly "
            f"{sorted(EXPECTED_SMSP_STEMS)}, got {sorted(stems)}. Use "
            "data/metrics/cache/mesa-v3/species-goals-calculator-a, not "
            "species/ (stub amphibians and split plant matrices)."
        )
    missing = [path for path in paths if not path.is_file()]
    if missing:
        raise ValueError(f"SMSP matrix is not a readable file: {missing}")
    return paths


def _national_only() -> bool:
    return os.environ.get("METRICS_SPECIES_GOALS_NATIONAL_ONLY") == "1"


SKIP_PUBLISHED_FINGERPRINT_ENV = "METRICS_SPECIES_GOALS_SKIP_PUBLISHED_FINGERPRINT"
_LOCAL_CONTINUATION_INVENTORY = (8_300, 0)
_PUBLISHED_CONTINUATION_INVENTORY = (8_298, 2)


def _skip_published_fingerprint_enabled() -> bool:
    return os.environ.get(SKIP_PUBLISHED_FINGERPRINT_ENV) == "1"


def _available_excluded(document: Any) -> tuple[int, int] | None:
    """Read (available, excluded) from exception, completeness, or policy provenance."""

    if not isinstance(document, dict):
        return None
    available = document.get("availableExpected")
    excluded = document.get("excluded")
    if isinstance(available, int) and isinstance(excluded, int):
        return (available, excluded)
    matching = document.get("matchingInventory")
    if isinstance(matching, dict):
        available = matching.get("availableSpeciesCount")
        catalog = matching.get("catalogSpeciesCount")
        if isinstance(available, int) and isinstance(catalog, int):
            return (available, catalog - available)
    return None


def _published_inventory_document(published: dict[str, Any] | None) -> Any:
    if not isinstance(published, dict):
        return None
    completeness = published.get("speciesCompleteness")
    if isinstance(completeness, dict) and _available_excluded(completeness):
        return completeness
    provenance = published.get("metricsProvenance")
    if isinstance(provenance, dict):
        return provenance.get("speciesTargetPolicy")
    return None


def _skip_published_target_policy_fingerprint(
    *,
    local_provenance: Any = None,
    published_provenance: Any = None,
    national_only: bool | None = None,
) -> bool:
    """Skip the known 8300/0 vs published 8298/2 inventory fingerprint only.

    Requires ``METRICS_SPECIES_GOALS_SKIP_PUBLISHED_FINGERPRINT=1``. Unset stays
    fail-closed for both national-only and full-geography runs. Other inventory
    mismatches still raise.
    """

    _ = national_only
    if not _skip_published_fingerprint_enabled():
        return False
    return (
        _available_excluded(local_provenance) == _LOCAL_CONTINUATION_INVENTORY
        and _available_excluded(published_provenance)
        == _PUBLISHED_CONTINUATION_INVENTORY
    )


def _template_path() -> Path:
    raw = os.environ.get("METRICS_SPECIES_GOALS_TEMPLATE")
    return Path(raw) if raw else DEFAULT_TERRESTRIAL_TEMPLATE_PATH


def _active_geography_levels() -> tuple[str, ...]:
    if _national_only():
        return ("national",)
    return GEOGRAPHY_LEVELS


def _resolve_worker_count(*, national_only: bool, requested: int | None) -> int:
    if requested is None:
        return 6 if national_only else WORKER_COUNT
    if national_only:
        if not 1 <= requested <= MAX_NATIONAL_ONLY_WORKERS:
            raise ValueError(
                "--workers must be between 1 and "
                f"{MAX_NATIONAL_ONLY_WORKERS} for --national-only"
            )
        return requested
    if not 1 <= requested <= MAX_NATIONAL_ONLY_WORKERS:
        raise ValueError(
            "--workers must be between 1 and "
            f"{MAX_NATIONAL_ONLY_WORKERS} for full-geography"
        )
    return requested


PUBLIC_RELEASE_ROOT = (
    "https://aagibolq28slyfof.public.blob.vercel-storage.com/releases/"
    + SOURCE_RELEASE_ID
)
EXPECTED_SCOPE_COUNTS = {
    "departments": 33,
    "municipalities": 1_105,
    "siraps": 8,
    "runaps": 1_879,
    "omecs": 614,
}
GROUP_METRIC_IDS = {
    "mammals": "species_richness_mammals",
    "birds": "species_richness_birds",
    "amphibians": "species_richness_amphibians",
    "reptiles": "species_richness_reptiles",
    "plants": "species_richness_plants",
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_json_write(path: Path, document: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def _disk_free_gib(path: Path) -> float:
    return shutil.disk_usage(path).free / 1024**3


def _memory_free_percent() -> int | None:
    try:
        result = subprocess.run(
            ["/usr/bin/memory_pressure", "-Q"],
            capture_output=True,
            check=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    match = re.search(r"free percentage:\s*(\d+)%", result.stdout)
    return int(match.group(1)) if match else None


def _max_rss_bytes() -> int:
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(value)


def _solution_url(entry: dict[str, Any]) -> str:
    basename = quote(entry["solutionBasename"], safe="._-")
    return f"{PUBLIC_RELEASE_ROOT}/solutions/land/{basename}"


def _summary_url(entry: dict[str, Any]) -> str:
    basename = f"{Path(entry['solutionBasename']).stem}_summary.csv"
    return f"{PUBLIC_RELEASE_ROOT}/solutions/land/{quote(basename, safe='._-')}"


def _published_metrics_url(solution_id: str) -> str:
    return (
        f"{PUBLIC_RELEASE_ROOT}/regular/compact/"
        f"{solution_id}.metrics.compact.json"
    )


def _goals_url(solution_id: str) -> str:
    return f"{PUBLIC_RELEASE_ROOT}/goals/v4/{solution_id}.goals.json"


def _published_document(
    solution_id: str, cache_dir: Path
) -> tuple[dict[str, Any], str]:
    downloaded = cached_download(
        _published_metrics_url(solution_id), cache_dir, force=False
    )
    return json.loads(downloaded.path.read_text(encoding="utf-8")), downloaded.sha256


def _target_policy(
    solution_id: str,
    cache_dir: Path,
    catalog_records: list[Any],
    available_records: list[Any],
    *,
    national_only: bool,
) -> tuple[dict[str, Any], SpeciesTargetPolicy, str]:
    goals_download = cached_download(_goals_url(solution_id), cache_dir, force=False)
    goals = json.loads(goals_download.path.read_text(encoding="utf-8"))
    if goals.get("solutionId") != solution_id:
        raise ValueError(f"{solution_id}: goals solutionId is stale")
    target_context = goals.get("targetContext")
    if not isinstance(target_context, dict):
        raise ValueError(f"{solution_id}: goals target context is missing")
    structured_targets = target_context.get("structuredTargets")
    if not isinstance(structured_targets, dict):
        raise ValueError(f"{solution_id}: structured targets are missing")
    source_evaluation = structured_targets.get("sourceEvaluation")
    if source_evaluation != "final_summary_csv":
        raise ValueError(f"{solution_id}: goals source evaluation is invalid")
    solution = {
        "id": solution_id,
        "name": solution_id,
        "finderInputs": {
            "targetFeatureSet": target_context.get("targetFeatureSet"),
            "targetPercent": target_context.get("finderTargetPercent"),
            "structuredTargets": structured_targets,
        },
    }
    policy = resolve_species_target_policy(
        solution,
        catalog_records=catalog_records,
        available_records=available_records,
    )
    published, _ = _published_document(solution_id, cache_dir)
    expected = published.get("metricsProvenance", {}).get("speciesTargetPolicy")
    # Calculator A may now score the two former MAXENT-gap plants the published
    # compact still fingerprints as excluded (8300/0 vs 8298/2).
    if policy.provenance != expected:
        local_inventory = (
            policy.provenance
            if _available_excluded(policy.provenance)
            else {
                "availableExpected": len(available_records),
                "excluded": max(len(catalog_records) - len(available_records), 0),
            }
        )
        published_inventory = (
            expected
            if _available_excluded(expected)
            else _published_inventory_document(published)
        )
        if not _skip_published_target_policy_fingerprint(
            local_provenance=local_inventory,
            published_provenance=published_inventory,
            national_only=national_only,
        ):
            raise ValueError(f"{solution_id}: target provenance mismatch")
    alignment = published.get("metricsProvenance", {}).get("inputAlignment")
    alignment_sha256 = alignment.get("sha256") if isinstance(alignment, dict) else None
    if not isinstance(alignment_sha256, str) or len(alignment_sha256) != 64:
        raise ValueError(f"{solution_id}: input alignment provenance is invalid")
    return solution, policy, alignment_sha256


class _TransientBoundaryMaskCache(BoundaryMaskCache):
    def get(self, *args: Any, **kwargs: Any) -> Any:
        mask = super().get(*args, **kwargs)
        self._cache.clear()
        return mask


def _load_catalog_inputs(
    species_csv: Path, exception_path: Path
) -> tuple[list[Any], list[Any], Any, set[str]]:
    records = load_species_records(species_csv)
    exception = load_species_exception(
        exception_path,
        release_id=RELEASE_ID,
        catalog_version=CATALOG_VERSION,
    )
    available = exception.filter_available(records)
    excluded = set(exception.excluded_filenames)
    unavailable_ids = {
        species_id(record)
        for record in records
        if record.blob_filename in excluded
    }
    return records, available, exception, unavailable_ids


def _build_shared_catalog(
    output_root: Path, species_csv: Path, exception_path: Path
) -> dict[str, Any]:
    records, _, exception, unavailable_ids = _load_catalog_inputs(
        species_csv, exception_path
    )
    document = build_catalog(
        records,
        unavailable_species_ids=unavailable_ids,
        provenance={
            "releaseId": RELEASE_ID,
            "speciesCsvSha256": _sha256_path(species_csv),
            "exceptionSourceSha256": _sha256_path(exception_path),
            "exceptionPolicySha256": exception.binding["policySha256"],
            "exceptionBindingSha256": canonical_sha256(exception.binding),
            "inventory": {
                "catalogTotal": len(records),
                "unavailable": len(unavailable_ids),
                "zeroRange": sum(
                    record.range_km2 == 0
                    and species_id(record) not in unavailable_ids
                    for record in records
                ),
            },
        },
    )
    written, _ = write_catalog(catalog_path(output_root), document)
    if written["provenance"]["inventory"] != {
        "catalogTotal": 8_300,
        "unavailable": 0,
        "zeroRange": 166,
    }:
        raise ValueError("shared species catalog inventory is invalid")
    return written


def _compact_provenance(
    *,
    catalog: dict[str, Any],
    exception: Any,
    species_csv: Path,
    exception_path: Path,
    solution_sha256: str,
    target_policy: SpeciesTargetPolicy,
    alignment_inventory_sha256: str,
) -> dict[str, Any]:
    return _species_goals_provenance(
        release_id=RELEASE_ID,
        species_csv_sha256=_sha256_path(species_csv),
        species_exception_source_sha256=_sha256_path(exception_path),
        species_exception_binding=exception.binding,
        alignment_provenance={
            "targetGridSha256": TARGET_GRID_SHA256,
            "sha256": alignment_inventory_sha256,
        },
        solution_raster_sha256=solution_sha256,
        target_policy=target_policy,
        boundary_provenance_sha256=build_metrics_provenance(
            "land", release_id=RELEASE_ID
        )["boundaryProvenance"]["sha256"],
        catalog_sha256=catalog["catalogSha256"],
    )


def _partition_evidence(output_root: Path, solution_id: str) -> dict[str, Any]:
    evidence: dict[str, Any] = {}
    for level in _active_geography_levels():
        path = compact_partition_path(output_root, solution_id, level)
        completion = json.loads(
            path.with_name(f"{path.name}.complete.json").read_text(encoding="utf-8")
        )
        evidence[level] = {
            "bytes": path.stat().st_size,
            "rowCount": completion["rowCount"],
            "payloadSha256": completion["payloadSha256"],
            "artifactSha256": completion["artifactSha256"],
            "relativePath": path.relative_to(output_root).as_posix(),
        }
    return evidence


def _national_partition_is_untrusted(path: Path, catalog: dict[str, Any]) -> bool:
    if not path.is_file():
        return False
    expected_policy = canonical_sha256(SPECIES_GOALS_COVERAGE_POLICY)
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
        provenance = document.get("provenance") or {}
        if (
            provenance.get("exactOverlapAlgorithmVersion")
            != SPECIES_GOALS_COVERAGE_ALGORITHM_VERSION
            or provenance.get("exactOverlapPolicySha256") != expected_policy
        ):
            return True
        validate_compact(document, catalog=catalog)
    except (OSError, json.JSONDecodeError, SpeciesGoalsContractError, TypeError):
        return True
    return False


def _archive_untrusted_national_partitions(
    output_root: Path, catalog: dict[str, Any]
) -> dict[str, Any]:
    """Rename tautological / old-policy national sidecars so they cannot resume."""

    compact_root = output_root / "species-goals/compact/v1"
    archived: list[str] = []
    if not compact_root.is_dir():
        return {"archivedCount": 0, "paths": archived}
    suffix = ".invalid-selected-scope"
    for path in sorted(compact_root.glob("*/national.species-goals.compact.json")):
        if not _national_partition_is_untrusted(path, catalog):
            continue
        dest = path.with_name(path.name + suffix)
        os.replace(path, dest)
        archived.append(dest.relative_to(output_root).as_posix())
        completion = path.with_name(f"{path.name}.complete.json")
        if completion.is_file():
            os.replace(completion, completion.with_name(completion.name + suffix))
    return {"archivedCount": len(archived), "paths": archived[:8]}


def _archive_untrusted_complete_report(report_path: Path, output_root: Path) -> str | None:
    """Keep blocked reports; move complete-B or tautological-A so nothing skips."""

    if not report_path.is_file():
        return None
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    phase = report.get("phase")
    if phase != "complete":
        return None
    gold = (
        output_root
        / "species-goals/compact/v1"
        / "eco17_estr17_esprep17_runap_iheh2022"
        / "national.species-goals.compact.json"
    )
    reason = None
    if gold.is_file():
        try:
            compact = json.loads(gold.read_text(encoding="utf-8"))
            algo = (compact.get("provenance") or {}).get(
                "exactOverlapAlgorithmVersion"
            )
            if algo != SPECIES_GOALS_COVERAGE_ALGORITHM_VERSION:
                reason = f"complete-non-A-{algo}"
            else:
                expected_policy = canonical_sha256(SPECIES_GOALS_COVERAGE_POLICY)
                policy_sha = (compact.get("provenance") or {}).get(
                    "exactOverlapPolicySha256"
                )
                if policy_sha != expected_policy:
                    reason = "complete-stale-A-policy"
                else:
                    validate_compact(compact)
        except SpeciesGoalsContractError as exc:
            if "tautological" in str(exc):
                reason = "complete-tautological-A"
            else:
                reason = "complete-invalid-A"
        except (OSError, json.JSONDecodeError, TypeError):
            reason = "complete-unreadable-gold"
    if reason is None:
        return None
    stamped = output_root / (
        f"species-goals-full-build-report.{reason}-"
        f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}.json"
    )
    os.replace(report_path, stamped)
    return str(stamped)


def _worker_build(
    worker_index: int,
    entries: list[dict[str, Any]],
    output_root_text: str,
    cache_dir_text: str,
    release_cache_text: str,
    species_csv_text: str,
    exception_path_text: str,
    event_queue: Any,
    stop_event: Any,
) -> None:
    output_root = Path(output_root_text)
    cache_dir = Path(cache_dir_text)
    release_cache = Path(release_cache_text)
    species_csv = Path(species_csv_text)
    exception_path = Path(exception_path_text)
    log_path = output_root / "logs" / f"worker-{worker_index}.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8", buffering=1) as log:
        with redirect_stdout(log), redirect_stderr(log):
            try:
                catalog = validate_catalog(
                    json.loads(catalog_path(output_root).read_text(encoding="utf-8"))
                )
                records, available, exception, _ = _load_catalog_inputs(
                    species_csv, exception_path
                )
                national_only = _national_only()
                active_levels = _active_geography_levels()
                template_path = _template_path()
                if not template_path.is_file():
                    raise ValueError(f"terrestrial template missing: {template_path}")
                matrix_paths = _species_goals_matrix_paths()
                grids: dict[str, Any] = {}
                if not entries:
                    event_queue.put(
                        {
                            "type": "worker-ready",
                            "workerIndex": worker_index,
                            "pid": os.getpid(),
                        }
                    )
                    event_queue.put(
                        {"type": "worker-finished", "workerIndex": worker_index}
                    )
                    return
                if not national_only:
                    first_download = cached_download(
                        _solution_url(entries[0]), cache_dir, force=False
                    )
                    first_raster = read_solution_raster(first_download.path)
                    if grid_sha256(first_raster.fingerprint) != TARGET_GRID_SHA256:
                        raise ValueError("land target grid checksum changed")
                    boundaries, errors = load_all_boundaries(cache_dir)
                    if errors:
                        raise ValueError(f"boundary load errors: {errors}")
                    observed_counts = {
                        level: len(boundaries[level]) for level in EXPECTED_SCOPE_COUNTS
                    }
                    if observed_counts != EXPECTED_SCOPE_COUNTS:
                        raise ValueError(f"boundary counts changed: {observed_counts}")
                    for level in EXPECTED_SCOPE_COUNTS:
                        grids[level] = build_boundary_id_grid(
                            level,
                            boundaries[level],
                            first_raster.fingerprint,
                            _TransientBoundaryMaskCache(),
                        )
                event_queue.put(
                    {
                        "type": "worker-ready",
                        "workerIndex": worker_index,
                        "pid": os.getpid(),
                    }
                )
                for entry in entries:
                    if stop_event.is_set():
                        break
                    if _disk_free_gib(output_root) < MIN_FREE_DISK_GIB:
                        stop_event.set()
                        event_queue.put(
                            {
                                "type": "blocker",
                                "workerIndex": worker_index,
                                "reason": "disk-free-below-60-gib",
                            }
                        )
                        break
                    solution_id = entry["solutionId"]
                    event_queue.put(
                        {
                            "type": "solution-started",
                            "workerIndex": worker_index,
                            "solutionId": solution_id,
                            "startedAt": _utc_now(),
                        }
                    )
                    solution_started = time.monotonic()
                    try:
                        solution, target_policy, alignment_inventory_sha256 = _target_policy(
                            solution_id,
                            cache_dir,
                            records,
                            available,
                            national_only=national_only,
                        )
                        downloaded = cached_download(
                            _solution_url(entry), cache_dir, force=False
                        )
                        if downloaded.sha256 != entry["rasterSha256"]:
                            raise ValueError(
                                f"{solution_id}: solution raster checksum mismatch"
                            )
                        raster = read_solution_raster(downloaded.path)
                        if grid_sha256(raster.fingerprint) != TARGET_GRID_SHA256:
                            raise ValueError(f"{solution_id}: target grid changed")
                        scope_mask = terrestrial_template_scope_mask(
                            raster, template_path
                        )
                        provenance = _compact_provenance(
                            catalog=catalog,
                            exception=exception,
                            species_csv=species_csv,
                            exception_path=exception_path,
                            solution_sha256=downloaded.sha256,
                            target_policy=target_policy,
                            alignment_inventory_sha256=alignment_inventory_sha256,
                        )
                        resumable = {
                            level: partition_is_resumable(
                                compact_partition_path(
                                    output_root, solution_id, level
                                ),
                                catalog=catalog,
                                expected_solution_id=solution_id,
                                expected_level=level,
                                expected_catalog_sha256=catalog["catalogSha256"],
                                expected_provenance=provenance,
                            )
                            for level in active_levels
                        }
                        pending = {
                            level for level, is_resumable in resumable.items()
                            if not is_resumable
                        }
                        if pending:
                            pipeline = SpeciesGoalsPipeline(
                                catalog,
                                solution_id=solution_id,
                                target_policy=target_policy,
                                provenance=provenance,
                                spool_dir=output_root / ".spool" / f"worker-{worker_index}",
                                active_levels=pending,
                            )
                            try:
                                # Score from SMSP cell lists whenever the species
                                # is in the matrices and the catalog. Do not
                                # require MAXENT TIFFs on blob.
                                record_species_goals_from_smsp(
                                    pipeline,
                                    records=available,
                                    species_matrix_paths=matrix_paths,
                                    selected_mask=raster.selected_mask,
                                    scope_mask=scope_mask,
                                    pre_existing_mask=raster.pre_existing_mask,
                                    new_prioritizr_mask=raster.new_prioritizr_mask,
                                    boundary_indexes={} if national_only else grids,
                                )
                                for level in active_levels:
                                    if level not in pending:
                                        continue
                                    scopes = (
                                        [["colombia", "Colombia"]]
                                        if level == "national"
                                        else [
                                            [scope_id, scope_name]
                                            for scope_id, scope_name in zip(
                                                grids[level].boundary_ids,
                                                grids[level].boundary_names,
                                            )
                                        ]
                                    )
                                    pipeline.write_partition_streaming(
                                        compact_partition_path(
                                            output_root, solution_id, level
                                        ),
                                        geography_level=level,
                                        scope_catalog=scopes,
                                    )
                            finally:
                                pipeline.close()
                        event_queue.put(
                            {
                                "type": "solution-generated",
                                "workerIndex": worker_index,
                                "solutionId": solution_id,
                                "elapsedSeconds": round(
                                    time.monotonic() - solution_started, 3
                                ),
                                "resumed": not pending,
                                "retries": 0,
                                "peakRssBytes": _max_rss_bytes(),
                                "provenance": provenance,
                                "partitions": _partition_evidence(
                                    output_root, solution_id
                                ),
                            }
                        )
                    except Exception as exc:  # noqa: BLE001 - persisted worker failure
                        traceback.print_exc()
                        event_queue.put(
                            {
                                "type": "solution-failed",
                                "workerIndex": worker_index,
                                "solutionId": solution_id,
                                "elapsedSeconds": round(
                                    time.monotonic() - solution_started, 3
                                ),
                                "errorType": type(exc).__name__,
                                "error": str(exc),
                                "retries": 0,
                                "peakRssBytes": _max_rss_bytes(),
                            }
                        )
                event_queue.put(
                    {"type": "worker-finished", "workerIndex": worker_index}
                )
            except Exception as exc:  # noqa: BLE001 - persisted systemic failure
                traceback.print_exc()
                event_queue.put(
                    {
                        "type": "worker-failed",
                        "workerIndex": worker_index,
                        "errorType": type(exc).__name__,
                        "error": str(exc),
                    }
                )


def _metric_rows(document: dict[str, Any]) -> dict[str, list[Any]]:
    metric_ids = [row[0] for row in document["metricCatalog"]]
    rows = document["geographies"]["national"]["colombia"]["metrics"]
    return {metric_ids[row[0]]: row for row in rows}


def _validate_published_parity(
    catalog: dict[str, Any],
    national: dict[str, Any],
    published: dict[str, Any],
    policy: SpeciesTargetPolicy,
    threatened_species_ids: set[str],
) -> dict[str, Any]:
    metrics = _metric_rows(published)
    present_by_group: dict[str, int] = {}
    threatened_present = 0
    configured_met = 0
    configured_threatened_met = 0
    met_17 = 0
    met_30 = 0
    threatened_17 = 0
    threatened_30 = 0
    for row in national["rows"]:
        species = catalog["rows"][row[1]]
        if species[5] != "available":
            continue
        selected = row[3] or 0
        group = species[2]
        if group:
            present_by_group[group] = present_by_group.get(group, 0) + int(
                selected > 0
            )
        threatened = species[0] in threatened_species_ids
        threatened_present += int(threatened and selected > 0)
        configured_met += int(bool(row[7] & FLAG_CONFIGURED_TARGET_MET))
        configured_threatened_met += int(
            threatened
            and selected > 0
            and bool(row[7] & FLAG_CONFIGURED_TARGET_MET)
        )
        met_17 += int(bool(row[7] & FLAG_MET_17))
        met_30 += int(bool(row[7] & FLAG_MET_30))
        threatened_17 += int(threatened and bool(row[7] & FLAG_MET_17))
        threatened_30 += int(threatened and bool(row[7] & FLAG_MET_30))
    published_present = {
        group: metrics[metric_id][1]
        for group, metric_id in GROUP_METRIC_IDS.items()
    }
    if present_by_group != published_present:
        raise ValueError("published species richness rollups do not match sidecar")
    if metrics["threatened_species_count"][1] != threatened_present:
        raise ValueError("published threatened species count does not match sidecar")
    group_metric = metrics["species_groups_protected"]
    threatened_metric = metrics["threatened_species_secured"]
    if policy.kind == "dual_reference":
        group_outcomes = group_metric[5]["thresholdOutcomes"]
        threatened_outcomes = threatened_metric[5]["thresholdOutcomes"]
        if [outcome["value"] for outcome in group_outcomes] != [met_17, met_30]:
            raise ValueError("published dual-reference group outcomes do not match")
        if [outcome["value"] for outcome in threatened_outcomes] != [
            threatened_17,
            threatened_30,
        ]:
            raise ValueError("published dual-reference threatened outcomes do not match")
    else:
        if group_metric[1] != configured_met:
            raise ValueError("published configured group outcome does not match")
        if threatened_metric[1] != configured_threatened_met:
            raise ValueError("published configured threatened outcome does not match")
    return {
        "speciesPresent": sum(present_by_group.values()),
        "threatenedPresent": threatened_present,
        "met17": met_17,
        "met30": met_30,
        "configuredMet": configured_met,
        "publishedMetricsSha256": canonical_sha256(published),
    }


def _worker_validate(
    worker_index: int,
    entries: list[dict[str, Any]],
    output_root_text: str,
    cache_dir_text: str,
    species_csv_text: str,
    exception_path_text: str,
    event_queue: Any,
    stop_event: Any,
) -> None:
    output_root = Path(output_root_text)
    cache_dir = Path(cache_dir_text)
    species_csv = Path(species_csv_text)
    exception_path = Path(exception_path_text)
    log_path = output_root / "logs" / f"validator-{worker_index}.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8", buffering=1) as log:
        with redirect_stdout(log), redirect_stderr(log):
            try:
                catalog = validate_catalog(
                    json.loads(catalog_path(output_root).read_text(encoding="utf-8"))
                )
                records, available, exception, _ = _load_catalog_inputs(
                    species_csv, exception_path
                )
                threatened_species_ids = {
                    species_id(record)
                    for record in records
                    if record.threatened
                }
                event_queue.put(
                    {
                        "type": "validator-ready",
                        "workerIndex": worker_index,
                        "pid": os.getpid(),
                    }
                )
                for entry in entries:
                    if stop_event.is_set():
                        break
                    solution_id = entry["solutionId"]
                    event_queue.put(
                        {
                            "type": "validation-started",
                            "workerIndex": worker_index,
                            "solutionId": solution_id,
                        }
                    )
                    started = time.monotonic()
                    try:
                        _, policy, alignment_inventory_sha256 = _target_policy(
                            solution_id,
                            cache_dir,
                            records,
                            available,
                            national_only=_national_only(),
                        )
                        provenance = _compact_provenance(
                            catalog=catalog,
                            exception=exception,
                            species_csv=species_csv,
                            exception_path=exception_path,
                            solution_sha256=entry["rasterSha256"],
                            target_policy=policy,
                            alignment_inventory_sha256=alignment_inventory_sha256,
                        )
                        national = None
                        partition_evidence: dict[str, Any] = {}
                        for level in _active_geography_levels():
                            path = compact_partition_path(
                                output_root, solution_id, level
                            )
                            document = json.loads(path.read_text(encoding="utf-8"))
                            validate_compact(
                                document,
                                catalog=catalog,
                                expected_release_id=RELEASE_ID,
                            )
                            if document["provenance"] != provenance:
                                raise ValueError(
                                    f"{solution_id}/{level}: provenance mismatch"
                                )
                            completion = json.loads(
                                path.with_name(
                                    f"{path.name}.complete.json"
                                ).read_text(encoding="utf-8")
                            )
                            artifact_sha256 = _sha256_path(path)
                            if completion["artifactSha256"] != artifact_sha256:
                                raise ValueError(
                                    f"{solution_id}/{level}: artifact checksum mismatch"
                                )
                            partition_evidence[level] = {
                                "bytes": path.stat().st_size,
                                "rowCount": completion["rowCount"],
                                "artifactSha256": artifact_sha256,
                                "payloadSha256": completion["payloadSha256"],
                            }
                            if level == "national":
                                national = document
                            else:
                                del document
                                gc.collect()
                        if national is None:
                            raise ValueError(f"{solution_id}: national partition missing")
                        if _national_only():
                            parity = {
                                "publishedParity": (
                                    "skipped-calculator-b-exactextract-rollups"
                                )
                            }
                        else:
                            published, published_sha256 = _published_document(
                                solution_id, cache_dir
                            )
                            if _skip_published_target_policy_fingerprint(
                                local_provenance=exception.binding,
                                published_provenance=_published_inventory_document(
                                    published
                                ),
                            ):
                                parity = {
                                    "publishedParity": (
                                        "skipped-published-fingerprint-8300-vs-8298"
                                    ),
                                    "publishedMetricsSha256": published_sha256,
                                }
                            else:
                                parity = _validate_published_parity(
                                    catalog,
                                    national,
                                    published,
                                    policy,
                                    threatened_species_ids,
                                )
                                parity["publishedMetricsSha256"] = published_sha256
                        event_queue.put(
                            {
                                "type": "solution-validated",
                                "workerIndex": worker_index,
                                "solutionId": solution_id,
                                "elapsedSeconds": round(
                                    time.monotonic() - started, 3
                                ),
                                "peakRssBytes": _max_rss_bytes(),
                                "partitions": partition_evidence,
                                "parity": parity,
                            }
                        )
                    except Exception as exc:  # noqa: BLE001 - persisted validator failure
                        traceback.print_exc()
                        event_queue.put(
                            {
                                "type": "validation-failed",
                                "workerIndex": worker_index,
                                "solutionId": solution_id,
                                "elapsedSeconds": round(
                                    time.monotonic() - started, 3
                                ),
                                "errorType": type(exc).__name__,
                                "error": str(exc),
                                "peakRssBytes": _max_rss_bytes(),
                            }
                        )
                event_queue.put(
                    {"type": "validator-finished", "workerIndex": worker_index}
                )
            except Exception as exc:  # noqa: BLE001 - persisted systemic failure
                traceback.print_exc()
                event_queue.put(
                    {
                        "type": "validator-failed",
                        "workerIndex": worker_index,
                        "errorType": type(exc).__name__,
                        "error": str(exc),
                    }
                )


def _counts(report: dict[str, Any], *, validation: bool = False) -> dict[str, int]:
    if validation:
        states = {
            "completed": {"completed"},
            "running": {"validating"},
            "failed": {"validation-failed"},
            "pending": {"pending", "generated"},
        }
    else:
        states = {
            "completed": {"generated", "validating", "completed"},
            "running": {"running"},
            "failed": {"generation-failed"},
            "pending": {"pending"},
        }
    return {
        label: sum(
            solution["status"] in accepted
            for solution in report["solutions"].values()
        )
        for label, accepted in states.items()
    }


def _update_report_runtime(
    report: dict[str, Any], output_root: Path, started: float
) -> None:
    report["updatedAt"] = _utc_now()
    report["elapsedSeconds"] = round(time.monotonic() - started, 3)
    report["generationCounts"] = _counts(report)
    report["validationCounts"] = _counts(report, validation=True)
    report["resources"]["diskFreeGiB"] = round(_disk_free_gib(output_root), 3)
    report["resources"]["memoryFreePercent"] = _memory_free_percent()
    report["resources"]["outputBytes"] = sum(
        path.stat().st_size for path in output_root.rglob("*") if path.is_file()
    )


def _record_event(
    report: dict[str, Any],
    event: dict[str, Any],
    failure_counts: dict[str, int],
    stop_event: Any,
) -> None:
    event_type = event["type"]
    worker_index = str(event.get("workerIndex"))
    if worker_index in report["workers"]:
        report["workers"][worker_index]["lastEvent"] = event_type
    solution_id = event.get("solutionId")
    if event_type in {"worker-ready", "validator-ready"}:
        report["workers"][worker_index].update(
            {"pid": event["pid"], "status": "ready"}
        )
    elif event_type in {"worker-finished", "validator-finished"}:
        report["workers"][worker_index]["status"] = "finished"
    elif event_type in {"worker-failed", "validator-failed"} and solution_id is None:
        report["workers"][worker_index].update(
            {"status": "failed", "error": event["error"]}
        )
        report["errors"].append(event)
        stop_event.set()
    elif event_type == "solution-started":
        report["workers"][worker_index].update(
            {"status": "running", "currentSolutionId": solution_id}
        )
        report["solutions"][solution_id].update(
            {
                "status": "running",
                "workerIndex": event["workerIndex"],
                "startedAt": event["startedAt"],
            }
        )
    elif event_type == "solution-generated":
        report["workers"][worker_index].update(
            {"status": "ready", "currentSolutionId": None}
        )
        report["solutions"][solution_id].update(
            {
                "status": "generated",
                "generation": {
                    key: value
                    for key, value in event.items()
                    if key not in {"type", "solutionId", "workerIndex"}
                },
            }
        )
        report["resources"]["peakWorkerRssBytes"] = max(
            report["resources"]["peakWorkerRssBytes"], event["peakRssBytes"]
        )
    elif event_type == "solution-failed":
        report["workers"][worker_index].update(
            {"status": "ready", "currentSolutionId": None}
        )
        report["solutions"][solution_id].update(
            {"status": "generation-failed", "generationError": event}
        )
        report["errors"].append(event)
        failure_counts[event["errorType"]] = (
            failure_counts.get(event["errorType"], 0) + 1
        )
        if failure_counts[event["errorType"]] >= MAX_SYSTEMIC_FAILURES:
            stop_event.set()
    elif event_type == "validation-started":
        report["workers"][worker_index].update(
            {"status": "validating", "currentSolutionId": solution_id}
        )
        report["solutions"][solution_id]["status"] = "validating"
    elif event_type == "solution-validated":
        report["workers"][worker_index].update(
            {"status": "ready", "currentSolutionId": None}
        )
        report["solutions"][solution_id].update(
            {
                "status": "completed",
                "validation": {
                    key: value
                    for key, value in event.items()
                    if key not in {"type", "solutionId", "workerIndex"}
                },
            }
        )
        report["resources"]["peakValidatorRssBytes"] = max(
            report["resources"]["peakValidatorRssBytes"], event["peakRssBytes"]
        )
    elif event_type == "validation-failed":
        report["workers"][worker_index].update(
            {"status": "ready", "currentSolutionId": None}
        )
        report["solutions"][solution_id].update(
            {"status": "validation-failed", "validationError": event}
        )
        report["errors"].append(event)
        failure_counts[event["errorType"]] = (
            failure_counts.get(event["errorType"], 0) + 1
        )
        if failure_counts[event["errorType"]] >= MAX_SYSTEMIC_FAILURES:
            stop_event.set()
    elif event_type == "blocker":
        report["blockers"].append(event)
        stop_event.set()


def _monitor_processes(
    *,
    processes: list[Any],
    event_queue: Any,
    stop_event: Any,
    report: dict[str, Any],
    report_path: Path,
    output_root: Path,
    started: float,
) -> None:
    failure_counts: dict[str, int] = {}
    last_write = 0.0
    unsafe_memory_checks = 0
    while any(process.is_alive() for process in processes):
        try:
            event = event_queue.get(timeout=5)
            _record_event(report, event, failure_counts, stop_event)
        except queue.Empty:
            pass
        now = time.monotonic()
        if now - last_write >= 30:
            _update_report_runtime(report, output_root, started)
            _atomic_json_write(report_path, report)
            last_write = now
            if report["resources"]["diskFreeGiB"] < MIN_FREE_DISK_GIB:
                report["blockers"].append(
                    {"type": "blocker", "reason": "disk-free-below-60-gib"}
                )
                stop_event.set()
            memory_free = report["resources"]["memoryFreePercent"]
            unsafe_memory_checks = (
                unsafe_memory_checks + 1
                if memory_free is not None
                and memory_free < MIN_FREE_MEMORY_PERCENT
                else 0
            )
            if unsafe_memory_checks >= 3:
                report["blockers"].append(
                    {"type": "blocker", "reason": "unsafe-memory-pressure"}
                )
                stop_event.set()
    for process in processes:
        process.join()
    while True:
        try:
            _record_event(
                report, event_queue.get_nowait(), failure_counts, stop_event
            )
        except queue.Empty:
            break
    for index, process in enumerate(processes):
        if process.exitcode not in (0, None):
            report["workers"][str(index)].update(
                {"status": "failed", "exitCode": process.exitcode}
            )
    _update_report_runtime(report, output_root, started)
    _atomic_json_write(report_path, report)


def _run_phase(
    *,
    target: Any,
    entries: list[dict[str, Any]],
    output_root: Path,
    cache_dir: Path,
    release_cache: Path,
    species_csv: Path,
    exception_path: Path,
    report: dict[str, Any],
    report_path: Path,
    started: float,
    worker_count: int,
) -> bool:
    context = mp.get_context("spawn")
    event_queue = context.Queue()
    stop_event = context.Event()
    slices = [entries[index::worker_count] for index in range(worker_count)]
    processes = []
    for worker_index, worker_entries in enumerate(slices):
        common = (
            worker_index,
            worker_entries,
            str(output_root),
            str(cache_dir),
        )
        if target is _worker_build:
            args = (
                *common,
                str(release_cache),
                str(species_csv),
                str(exception_path),
                event_queue,
                stop_event,
            )
        else:
            args = (
                *common,
                str(species_csv),
                str(exception_path),
                event_queue,
                stop_event,
            )
        process = context.Process(target=target, args=args)
        process.start()
        processes.append(process)
        report["workers"][str(worker_index)] = {
            "pid": process.pid,
            "status": "starting",
            "assignedSolutions": len(worker_entries),
            "currentSolutionId": None,
        }
    _monitor_processes(
        processes=processes,
        event_queue=event_queue,
        stop_event=stop_event,
        report=report,
        report_path=report_path,
        output_root=output_root,
        started=started,
    )
    return not stop_event.is_set() and all(process.exitcode == 0 for process in processes)


def _write_release_inventory(
    output_root: Path, catalog: dict[str, Any], solution_ids: list[str]
) -> Path:
    path = output_root / "species-goals/release-inventory-v1.json"
    document = {
        "format": "species-goals-release-inventory-index-v1",
        "releaseId": RELEASE_ID,
        "catalogSha256": catalog["catalogSha256"],
        "solutions": {
            solution_id: {
                "format": "species-goals-release-inventory-v1",
                "validated": True,
                "solutionId": solution_id,
                "releaseId": RELEASE_ID,
                "catalogValidated": True,
                "validatedGeographyLevels": list(_active_geography_levels()),
            }
            for solution_id in sorted(solution_ids)
        },
    }
    _atomic_json_write(path, document)
    return path


def _preflight(
    entries: list[dict[str, Any]],
    cache_dir: Path,
    species_csv: Path,
    exception_path: Path,
    *,
    national_only: bool,
) -> dict[str, Any]:
    records, available, _, _ = _load_catalog_inputs(species_csv, exception_path)
    policies = {"scalar17": 0, "scalar30": 0, "perSpecies": 0, "dualReference": 0}
    for entry in entries:
        solution_id = entry["solutionId"]
        _, policy, _ = _target_policy(
            solution_id,
            cache_dir,
            records,
            available,
            national_only=national_only,
        )
        if policy.kind == "per_species":
            policies["perSpecies"] += 1
        elif policy.kind == "dual_reference":
            policies["dualReference"] += 1
        elif policy.scalar_target_pct == 17:
            policies["scalar17"] += 1
        elif policy.scalar_target_pct == 30:
            policies["scalar30"] += 1
        else:
            raise ValueError(f"{solution_id}: unsupported scalar target")
    expected = {
        "scalar17": 0,
        "scalar30": 0,
        "perSpecies": 144,
        "dualReference": 24,
    }
    if policies != expected:
        raise ValueError(f"target policy distribution changed: {policies}")
    return policies


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-id", default=RELEASE_ID)
    parser.add_argument("--catalog-version", default=CATALOG_VERSION)
    parser.add_argument("--source-release-id", default=SOURCE_RELEASE_ID)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--release-cache", type=Path, required=True)
    parser.add_argument("--species-csv", type=Path, required=True)
    parser.add_argument("--species-exception", type=Path, required=True)
    parser.add_argument("--solution-catalog", type=Path, required=True)
    parser.add_argument(
        "--workers",
        type=int,
        default=None,
        help=(
            "Worker processes. Full-geography builds require 3. "
            f"--national-only defaults to 6 and allows 1-{MAX_NATIONAL_ONLY_WORKERS}."
        ),
    )
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument(
        "--national-only",
        action="store_true",
        help=(
            "Rebuild land national species-goals sidecars only. Skips departments, "
            "municipalities, siraps, runaps, omecs, and custom AOI jobs."
        ),
    )
    parser.add_argument(
        "--species-goals-template",
        type=Path,
        default=DEFAULT_TERRESTRIAL_TEMPLATE_PATH,
        help=(
            "Mesa terrestrial planning-unit template whose valid mask is the "
            "species-range denominator."
        ),
    )
    args = parser.parse_args(argv)
    try:
        args.workers = _resolve_worker_count(
            national_only=args.national_only,
            requested=args.workers,
        )
    except ValueError as exc:
        parser.error(str(exc))
    return args


def main() -> int:
    global CATALOG_VERSION, PUBLIC_RELEASE_ROOT, RELEASE_ID, SOURCE_RELEASE_ID

    args = _parse_args()
    RELEASE_ID = args.release_id
    CATALOG_VERSION = args.catalog_version
    SOURCE_RELEASE_ID = args.source_release_id
    PUBLIC_RELEASE_ROOT = (
        "https://aagibolq28slyfof.public.blob.vercel-storage.com/releases/"
        + SOURCE_RELEASE_ID
    )
    os.environ["METRICS_SPECIES_GOALS_RELEASE_ID"] = RELEASE_ID
    os.environ["METRICS_SPECIES_GOALS_CATALOG_VERSION"] = CATALOG_VERSION
    os.environ["METRICS_SPECIES_GOALS_SOURCE_RELEASE_ID"] = SOURCE_RELEASE_ID
    os.environ["METRICS_SPECIES_GOALS_NATIONAL_ONLY"] = (
        "1" if args.national_only else "0"
    )
    template_path = Path(args.species_goals_template)
    if not template_path.is_file():
        raise ValueError(
            "species-goals terrestrial template is missing: "
            f"{template_path}. Expected data/metrics/cache/mesa-v3/"
            "parity-inputs/template_terrestre.tif"
        )
    os.environ["METRICS_SPECIES_GOALS_TEMPLATE"] = str(template_path.resolve())
    print(
        "species-goals full build starting "
        f"nationalOnly={args.national_only} workers={args.workers}",
        flush=True,
    )
    started = time.monotonic()
    source_catalog = json.loads(args.solution_catalog.read_text(encoding="utf-8"))
    if (
        source_catalog.get("releaseId") != RELEASE_ID
        or source_catalog.get("expectedLandSolutionCount") != 168
        or source_catalog.get("expectedMarineSolutionCount") != 4
    ):
        raise ValueError("solution catalog release inventory is invalid")
    land_entries = sorted(
        (
            entry
            for entry in source_catalog["solutions"]
            if entry["domain"] == "land"
        ),
        key=lambda entry: entry["solutionId"],
    )
    marine_entries = sorted(
        (
            entry
            for entry in source_catalog["solutions"]
            if entry["domain"] == "marine"
        ),
        key=lambda entry: entry["solutionId"],
    )
    if len(land_entries) != 168 or len(marine_entries) != 4:
        raise ValueError("solution catalog domain counts are invalid")
    args.output_root.mkdir(parents=True, exist_ok=True)
    report_path = args.output_root / "species-goals-full-build-report.json"
    archived_report = _archive_untrusted_complete_report(report_path, args.output_root)
    previous_attempts: list[dict[str, Any]] = []
    if report_path.is_file():
        previous = json.loads(report_path.read_text(encoding="utf-8"))
        previous_attempts.append(
            {
                "phase": previous.get("phase"),
                "elapsedSeconds": previous.get("elapsedSeconds"),
                "generationCounts": previous.get("generationCounts"),
                "validationCounts": previous.get("validationCounts"),
                "errors": previous.get("errors", []),
                "blockers": previous.get("blockers", []),
                "geographyLevels": previous.get("geographyLevels"),
            }
        )
    print("building shared catalog", flush=True)
    catalog = _build_shared_catalog(
        args.output_root, args.species_csv, args.species_exception
    )
    print("archiving untrusted national partitions", flush=True)
    archived_nationals = _archive_untrusted_national_partitions(
        args.output_root, catalog
    )
    print("running preflight", flush=True)
    policies = _preflight(
        land_entries,
        args.cache_dir,
        args.species_csv,
        args.species_exception,
        national_only=args.national_only,
    )
    print("preflight ok", policies, flush=True)
    report: dict[str, Any] = {
        "format": "species-goals-full-build-report-v1",
        "releaseId": RELEASE_ID,
        "outputRoot": str(args.output_root),
        "workerCount": args.workers,
        "phase": "preflight",
        "geographyLevels": list(_active_geography_levels()),
        "nationalOnly": _national_only(),
        "speciesGoalsScope": "terrestrial-template-valid",
        "speciesGoalsTemplate": str(template_path),
        "speciesGoalsSmspDir": str(DEFAULT_SMSP_DIR),
        "publishedParity": (
            "skipped-calculator-b-exactextract-rollups"
            if args.national_only
            else (
                "skipped-published-fingerprint-8300-vs-8298"
                if _skip_published_fingerprint_enabled()
                else "required"
            )
        ),
        "archivedUntrustedCompleteReport": archived_report,
        "archivedUntrustedNationalPartitions": archived_nationals,
        "startedAt": _utc_now(),
        "updatedAt": _utc_now(),
        "elapsedSeconds": 0,
        "catalog": {
            "catalogSha256": catalog["catalogSha256"],
            "inventory": catalog["provenance"]["inventory"],
            "relativePath": catalog_path(args.output_root)
            .relative_to(args.output_root)
            .as_posix(),
        },
        "targetPolicyDistribution": policies,
        "marineSkipped": [
            {
                "solutionId": entry["solutionId"],
                "reason": "species-sidecars-apply-to-land-solutions-only",
            }
            for entry in marine_entries
        ],
        "solutions": {
            entry["solutionId"]: {
                "status": "pending",
                "domain": "land",
                "deterministicWorkerIndex": index % args.workers,
            }
            for index, entry in enumerate(land_entries)
        },
        "workers": {},
        "generationCounts": {
            "completed": 0,
            "running": 0,
            "failed": 0,
            "pending": 168,
        },
        "validationCounts": {
            "completed": 0,
            "running": 0,
            "failed": 0,
            "pending": 168,
        },
        "resources": {
            "diskFreeGiB": round(_disk_free_gib(args.output_root), 3),
            "memoryFreePercent": _memory_free_percent(),
            "outputBytes": 0,
            "peakWorkerRssBytes": 0,
            "peakValidatorRssBytes": 0,
        },
        "errors": [],
        "blockers": [],
        "previousAttempts": previous_attempts,
        "retries": len(previous_attempts),
    }
    _update_report_runtime(report, args.output_root, started)
    _atomic_json_write(report_path, report)
    if args.preflight_only:
        report["phase"] = "preflight-complete"
        _update_report_runtime(report, args.output_root, started)
        _atomic_json_write(report_path, report)
        print(json.dumps({"preflight": "complete", "policies": policies}, sort_keys=True))
        return 0
    if not args.validate_only:
        report["phase"] = "generating"
        if not _run_phase(
            target=_worker_build,
            entries=land_entries,
            output_root=args.output_root,
            cache_dir=args.cache_dir,
            release_cache=args.release_cache,
            species_csv=args.species_csv,
            exception_path=args.species_exception,
            report=report,
            report_path=report_path,
            started=started,
            worker_count=args.workers,
        ):
            report["phase"] = "blocked"
            _update_report_runtime(report, args.output_root, started)
            _atomic_json_write(report_path, report)
            return 2
        if _counts(report)["completed"] != 168:
            report["phase"] = "blocked"
            report["blockers"].append(
                {"reason": "generation-did-not-complete-all-land-solutions"}
            )
            _atomic_json_write(report_path, report)
            return 2
    else:
        for solution in report["solutions"].values():
            solution["status"] = "generated"
    report["phase"] = "validating"
    report["workers"] = {}
    if not _run_phase(
        target=_worker_validate,
        entries=land_entries,
        output_root=args.output_root,
        cache_dir=args.cache_dir,
        release_cache=args.release_cache,
        species_csv=args.species_csv,
        exception_path=args.species_exception,
        report=report,
        report_path=report_path,
        started=started,
        worker_count=args.workers,
    ):
        report["phase"] = "blocked"
        _update_report_runtime(report, args.output_root, started)
        _atomic_json_write(report_path, report)
        return 2
    completed = [
        solution_id
        for solution_id, result in report["solutions"].items()
        if result["status"] == "completed"
    ]
    if len(completed) != 168:
        report["phase"] = "blocked"
        report["blockers"].append(
            {"reason": "validation-did-not-complete-all-land-solutions"}
        )
        _atomic_json_write(report_path, report)
        return 2
    inventory_path = _write_release_inventory(args.output_root, catalog, completed)
    report["phase"] = "complete"
    report["releaseInventory"] = {
        "relativePath": inventory_path.relative_to(args.output_root).as_posix(),
        "sha256": _sha256_path(inventory_path),
        "solutionCount": len(completed),
    }
    _update_report_runtime(report, args.output_root, started)
    _atomic_json_write(report_path, report)
    print(
        json.dumps(
            {
                "phase": "complete",
                "elapsedSeconds": report["elapsedSeconds"],
                "outputBytes": report["resources"]["outputBytes"],
                "diskFreeGiB": report["resources"]["diskFreeGiB"],
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
