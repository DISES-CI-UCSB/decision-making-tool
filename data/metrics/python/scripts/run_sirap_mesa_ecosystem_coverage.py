"""Resumable Mesa ecosystem-coverage compute + compact for SIRAP catalog solutions.

Computes mesa-ecosystem-coverage-compact-v1 shards for every SIRAP solution in
sirap-2026-09-09-v7-endemic, using the 417-row national Mesa feature list on
each packet grid. Geography denominators are real boundary masks (or the full
packet grid for the "national" level). solution_data_valid_mask is never used
as a denominator.

The "national" compact geography id stays "colombia" so the existing UI overlay
can resolve it. That id is packet-wide (the regional SIRAP grid), not
catalog-v3-7-0 Colombia parity.

Resume reads STATUS.json and skips entries already marked done. Atomic STATUS
writes happen after each (solutionId, level). This script does not upload or
patch the live manifest.

Examples (from the repository root):

    PYTHONPATH=data/metrics/python/metrics_pipeline \\
      data/metrics/python/.venv/bin/python \\
      data/metrics/python/scripts/run_sirap_mesa_ecosystem_coverage.py --smoke

    PYTHONPATH=data/metrics/python/metrics_pipeline \\
      data/metrics/python/.venv/bin/python \\
      data/metrics/python/scripts/run_sirap_mesa_ecosystem_coverage.py
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
import traceback
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

import numpy as np

PIPELINE_DIR = Path(__file__).resolve().parents[1] / "metrics_pipeline"
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from blob_manifest import solution_blob_basename  # noqa: E402
from boundaries.boundary_loader import BoundaryFeature, load_all_boundaries  # noqa: E402
from boundaries.boundary_mask import rasterize_boundary  # noqa: E402
from mesa_ecosystem_coverage import (  # noqa: E402
    ALGORITHM_VERSION,
    MesaEcosystemCoverageError,
    _feature_specs,
    evaluate_aoi_rows,
    evaluate_national_rows,
    load_ecosystem_catalog,
    load_ecosystem_values,
    load_summary_ecosystems,
)
from raster_metrics import RasterFingerprint, SolutionRaster, read_solution_raster  # noqa: E402

REPO = Path(__file__).resolve().parents[4]
RELEASE_ID = "sirap-2026-09-09-v7-endemic"
MANIFEST_URL = (
    "https://aagibolq28slyfof.public.blob.vercel-storage.com/"
    f"releases/{RELEASE_ID}/manifest.json"
)
DEFAULT_OUTPUT = REPO / "data/metrics/generated/local/sirap-mesa-ecosystem-coverage"
STATUS_FORMAT = "sirap-mesa-ecosystem-coverage-status-v1"
COMPACT_FORMAT = "mesa-ecosystem-coverage-compact-v1"
RELATIVE_HELD_DEFINITION = "held_e1_planning_cells / e1_planning_cells_in_geography"
ROW_LAYOUT = ["geographyIndex", "featureIndex", "totalAmount", "absoluteHeld", "relativeHeld"]
GEOGRAPHY_LEVELS = (
    "national",
    "departments",
    "municipalities",
    "siraps",
    "runaps",
    "omecs",
)
CALCULATOR_LEVELS = frozenset({"national", "departments", "siraps"})
SHARED_NPZ_LEVELS = frozenset({"municipalities", "runaps", "omecs"})
LOCAL_TIF_DIRS = {
    "eje-cafetero": Path.home() / "Downloads/sirap/eje_cafetero",
    "orinoquia": Path.home() / "Downloads/sirap/orinoquia",
}
NATIONAL_TEMPLATE_CANDIDATES = (
    Path.home()
    / "Downloads/solutions-latest-sept3rd-2026"
    / "Eco17+Estr17+EspRep17+RUNAP_IHEH2022_summary.csv",
)
EXPECTED_FEATURE_COUNT = 417
OROBIOMA_ANDINO_CC = "Orobioma Andino Cordillera Central"
PACKET_NATIONAL_NOTE = (
    "Packet-wide relative_held on the regional SIRAP grid. "
    "geographyId colombia is the packet extent, not catalog-v3-7-0 Colombia parity."
)


@dataclass(frozen=True)
class FeatureTemplate:
    path: Path
    feature_ids: list[int]
    feature_names: list[str]
    relative_targets: list[float | None]
    evaluated: list[str | None]

    @property
    def features(self) -> list[list[Any]]:
        return [
            [name, int(feature_id), target, ev]
            for name, feature_id, target, ev in zip(
                self.feature_names,
                self.feature_ids,
                self.relative_targets,
                self.evaluated,
                strict=True,
            )
        ]


@dataclass
class SolutionSpec:
    solution_id: str
    sirap_id: str
    raster_file: str
    display_url: str
    tif_path: Path | None = None


@dataclass
class PacketContext:
    sirap_id: str
    ecosystem_raster: Path
    catalog_path: Path
    fingerprint: RasterFingerprint
    category_values: np.ndarray
    feature_index: np.ndarray
    n_features: int


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def log(message: str, log_path: Path | None = None) -> None:
    line = f"{utc_now()}  {message}"
    print(line, flush=True)
    if log_path is not None:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def atomic_write_json(path: Path, payload: Any, *, pretty: bool = False) -> None:
    if pretty:
        text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    else:
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    atomic_write_text(path, text)


def compact_path(output_root: Path, solution_id: str, level: str) -> Path:
    return output_root / "publish" / solution_id / f"{level}.mesa-ecosystem-coverage.compact.json"


def find_national_template() -> tuple[Path, list[dict[str, str]]]:
    downloads = Path.home() / "Downloads/solutions-latest-sept3rd-2026"
    cache_v3 = REPO / "data/metrics/cache/mesa-v3"
    candidates: list[Path] = list(NATIONAL_TEMPLATE_CANDIDATES)
    if downloads.is_dir():
        candidates.extend(sorted(downloads.glob("*_summary.csv")))
    if cache_v3.is_dir():
        candidates.extend(sorted(cache_v3.rglob("*_summary.csv")))
    seen: set[Path] = set()
    for path in candidates:
        resolved = path.resolve() if path.exists() else path
        if resolved in seen or not path.exists():
            continue
        seen.add(resolved)
        rows = load_summary_ecosystems(path)
        if len(rows) == EXPECTED_FEATURE_COUNT:
            return path, rows
    raise SystemExit(
        "No national *_summary.csv with 417 ecosystem rows was found. "
        "Looked in ~/Downloads/solutions-latest-sept3rd-2026 and data/metrics/cache/mesa-v3."
    )


def load_feature_template(output_root: Path) -> FeatureTemplate:
    source, rows = find_national_template()
    cached = output_root / "cache" / "summaries" / source.name
    cached.parent.mkdir(parents=True, exist_ok=True)
    if not cached.exists() or cached.stat().st_size != source.stat().st_size:
        shutil.copy2(source, cached)
    catalog = load_ecosystem_catalog(mesa_v3_catalog())
    feature_ids, feature_names, targets, evaluated = _feature_specs(rows, catalog)
    if len(feature_names) != EXPECTED_FEATURE_COUNT:
        raise SystemExit(f"Feature template has {len(feature_names)} rows, expected 417.")
    return FeatureTemplate(
        path=cached,
        feature_ids=feature_ids,
        feature_names=feature_names,
        relative_targets=targets,
        evaluated=evaluated,
    )


def mesa_v3_catalog() -> Path:
    path = REPO / "data/metrics/cache/mesa-v3/parity-inputs/ecosistemas_IDs_IAVH_2024.csv"
    if not path.exists():
        raise SystemExit(f"Missing mesa-v3 catalog: {path}")
    return path


def packet_catalog(sirap_id: str) -> Path:
    packet = (
        REPO
        / "backend/runtime-artifacts/sirap"
        / sirap_id
        / "sources/sirap-coverage/ecosistemas_IDs_IAVH_2024.csv"
    )
    return packet if packet.exists() else mesa_v3_catalog()


def packet_ecosystem_raster(sirap_id: str) -> Path:
    path = (
        REPO
        / "backend/runtime-artifacts/sirap"
        / sirap_id
        / "sources/ecosistemas_IAVH_2024.tif"
    )
    if not path.exists():
        raise SystemExit(f"Missing packet ecosystem raster: {path}")
    return path


def download_manifest(output_root: Path, url: str) -> dict[str, Any]:
    dest = output_root / "manifest.snapshot.json"
    req = urllib.request.Request(url, headers={"User-Agent": "sirap-mesa-ecosystem-coverage/1"})
    with urllib.request.urlopen(req, timeout=60) as response:
        payload = json.loads(response.read().decode("utf-8"))
    atomic_write_json(dest, payload, pretty=True)
    return payload


def load_solutions(manifest: dict[str, Any]) -> list[SolutionSpec]:
    solutions = []
    for raw in manifest.get("solutions") or []:
        if not isinstance(raw, dict):
            continue
        if str(raw.get("scope") or "").strip().lower() != "sirap":
            continue
        solution_id = str(raw.get("id") or "")
        sirap_id = str(raw.get("sirapId") or "")
        if not solution_id or not sirap_id:
            raise SystemExit(f"SIRAP solution missing id/sirapId: {raw!r}")
        solutions.append(
            SolutionSpec(
                solution_id=solution_id,
                sirap_id=sirap_id,
                raster_file=solution_blob_basename(raw),
                display_url=str(raw.get("displayUrl") or ""),
            )
        )
    if len(solutions) != 56:
        raise SystemExit(f"Expected 56 SIRAP solutions, found {len(solutions)}.")
    return solutions


def resolve_tif(spec: SolutionSpec, output_root: Path) -> Path:
    local_dir = LOCAL_TIF_DIRS.get(spec.sirap_id)
    if local_dir is not None:
        local = local_dir / spec.raster_file
        if local.exists():
            return local
    cached = output_root / "cache" / "solutions" / spec.raster_file
    if cached.exists():
        return cached
    if not spec.display_url:
        raise FileNotFoundError(f"No local tif or displayUrl for {spec.solution_id}")
    cached.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(
        spec.display_url,
        headers={"User-Agent": "sirap-mesa-ecosystem-coverage/1"},
    )
    tmp = cached.with_name(f".{cached.name}.{os.getpid()}.part")
    try:
        with urllib.request.urlopen(req, timeout=180) as response, tmp.open("wb") as out:
            shutil.copyfileobj(response, out)
        tmp.replace(cached)
    finally:
        tmp.unlink(missing_ok=True)
    return cached


def write_resume_txt(output_root: Path) -> None:
    compute = (
        "Resume SIRAP Mesa ecosystem-coverage from STATUS.json.\n"
        "Skips done entries; retries pending and error.\n"
        "Does not upload or patch the live manifest.\n\n"
        f"cd {REPO}\n"
        "PYTHONPATH=data/metrics/python/metrics_pipeline \\\n"
        "  data/metrics/python/.venv/bin/python \\\n"
        "  data/metrics/python/scripts/run_sirap_mesa_ecosystem_coverage.py\n"
    )
    publish = (
        "Upload + live-manifest patch (STATUS.json is compute-only).\n"
        "doNotRetarget: only adds precomputedMetricUrls.mesaEcosystemByGeography.\n"
        "Refuses to patch a solution until all 6 local compact files exist.\n\n"
        f"cd {REPO}\n"
        "data/metrics/python/.venv/bin/python \\\n"
        "  data/metrics/python/scripts/publish_sirap_mesa_ecosystem_coverage.py --dry-run\n\n"
        "data/metrics/python/.venv/bin/python \\\n"
        "  data/metrics/python/scripts/publish_sirap_mesa_ecosystem_coverage.py --upload\n\n"
        "data/metrics/python/.venv/bin/python \\\n"
        "  data/metrics/python/scripts/publish_sirap_mesa_ecosystem_coverage.py --manifest\n\n"
        "data/metrics/python/.venv/bin/python \\\n"
        "  data/metrics/python/scripts/publish_sirap_mesa_ecosystem_coverage.py --all\n"
    )
    atomic_write_text(output_root / "RESUME.txt", f"{compute}\n{publish}")


def empty_status(solutions: Sequence[SolutionSpec]) -> dict[str, Any]:
    entries = [
        {
            "solutionId": spec.solution_id,
            "sirapId": spec.sirap_id,
            "level": level,
            "status": "pending",
            "outputPath": None,
            "error": None,
        }
        for spec in solutions
        for level in GEOGRAPHY_LEVELS
    ]
    return {
        "format": STATUS_FORMAT,
        "releaseId": RELEASE_ID,
        "updatedAt": utc_now(),
        "entries": entries,
    }


def load_or_init_status(output_root: Path, solutions: Sequence[SolutionSpec]) -> dict[str, Any]:
    path = output_root / "STATUS.json"
    if not path.exists():
        status = empty_status(solutions)
        atomic_write_json(path, status, pretty=True)
        return status
    status = json.loads(path.read_text(encoding="utf-8"))
    if status.get("format") != STATUS_FORMAT or status.get("releaseId") != RELEASE_ID:
        status = empty_status(solutions)
        atomic_write_json(path, status, pretty=True)
        return status
    by_key = {
        (entry["solutionId"], entry["level"]): entry for entry in status.get("entries") or []
    }
    merged = []
    for spec in solutions:
        for level in GEOGRAPHY_LEVELS:
            existing = by_key.get((spec.solution_id, level))
            if existing is None:
                merged.append(
                    {
                        "solutionId": spec.solution_id,
                        "sirapId": spec.sirap_id,
                        "level": level,
                        "status": "pending",
                        "outputPath": None,
                        "error": None,
                    }
                )
            else:
                merged.append(existing)
    status["entries"] = merged
    status["updatedAt"] = utc_now()
    atomic_write_json(path, status, pretty=True)
    return status


def entry_key(solution_id: str, level: str) -> tuple[str, str]:
    return (solution_id, level)


def status_map(status: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    return {(entry["solutionId"], entry["level"]): entry for entry in status["entries"]}


def write_status(output_root: Path, status: dict[str, Any]) -> None:
    status["updatedAt"] = utc_now()
    atomic_write_json(output_root / "STATUS.json", status, pretty=True)


def mark_entry(
    status: dict[str, Any],
    *,
    solution_id: str,
    level: str,
    state: str,
    output_path: Path | None = None,
    error: str | None = None,
) -> None:
    for entry in status["entries"]:
        if entry["solutionId"] == solution_id and entry["level"] == level:
            entry["status"] = state
            entry["outputPath"] = None if output_path is None else str(output_path)
            entry["error"] = error
            return
    raise KeyError(f"STATUS missing {solution_id} {level}")


def status_counts(status: dict[str, Any]) -> dict[str, int]:
    counts = {"pending": 0, "done": 0, "skipped": 0, "error": 0}
    for entry in status["entries"]:
        counts[str(entry.get("status") or "pending")] = (
            counts.get(str(entry.get("status") or "pending"), 0) + 1
        )
    return counts


def build_feature_index(category_values: np.ndarray, feature_ids: Sequence[int]) -> np.ndarray:
    id_to_index = {int(fid): index for index, fid in enumerate(feature_ids)}
    max_id = max(id_to_index)
    remap = np.full(max_id + 1, -1, dtype=np.int32)
    for fid, index in id_to_index.items():
        remap[fid] = index
    flat = category_values.ravel()
    feature_index = np.full(flat.size, -1, dtype=np.int32)
    finite = np.isfinite(flat)
    eco_ids = np.zeros(flat.size, dtype=np.int32)
    eco_ids[finite] = flat[finite].astype(np.int32, copy=False)
    in_catalog = finite & (eco_ids >= 0) & (eco_ids <= max_id)
    feature_index[in_catalog] = remap[eco_ids[in_catalog]]
    return feature_index


def open_packet(sirap_id: str, template: FeatureTemplate, probe_tif: Path) -> PacketContext:
    catalog_path = packet_catalog(sirap_id)
    catalog = load_ecosystem_catalog(catalog_path)
    _feature_specs(
        [
            {
                "feature": name,
                "relative_target": "" if target is None else str(target),
                "evaluated": ev or "",
            }
            for name, target, ev in zip(
                template.feature_names,
                template.relative_targets,
                template.evaluated,
                strict=True,
            )
        ],
        catalog,
    )
    probe = read_solution_raster(probe_tif)
    raster = packet_ecosystem_raster(sirap_id)
    values = load_ecosystem_values(raster, probe.fingerprint)
    return PacketContext(
        sirap_id=sirap_id,
        ecosystem_raster=raster,
        catalog_path=catalog_path,
        fingerprint=probe.fingerprint,
        category_values=values,
        feature_index=build_feature_index(values, template.feature_ids),
        n_features=len(template.feature_ids),
    )


def write_compact(
    *,
    output_root: Path,
    solution_id: str,
    level: str,
    features: list[list[Any]],
    geographies: list[list[str]],
    rows: list[list[Any]],
) -> Path:
    document: dict[str, Any] = {
        "format": COMPACT_FORMAT,
        "algorithmVersion": ALGORITHM_VERSION,
        "relativeHeldDefinition": RELATIVE_HELD_DEFINITION,
        "relativeHeldAlias": "coverage_within_aoi",
        "releaseId": RELEASE_ID,
        "solutionId": solution_id,
        "geographyLevel": level,
        "features": features,
        "geographies": geographies,
        "rowLayout": ROW_LAYOUT,
        "rows": rows,
    }
    if level == "national":
        document["geographyNote"] = PACKET_NATIONAL_NOTE
    path = compact_path(output_root, solution_id, level)
    atomic_write_json(path, document, pretty=False)
    return path


def sparse_rows_from_counts(
    geo_index: int,
    totals: np.ndarray,
    held: np.ndarray,
) -> list[list[Any]]:
    rows: list[list[Any]] = []
    for feat_i, total in enumerate(totals):
        total_i = int(total)
        if total_i <= 0:
            continue
        abs_held = int(held[feat_i])
        rows.append([geo_index, feat_i, total_i, abs_held, abs_held / total_i])
    return rows


def sparse_rows_from_aoi(
    geo_index: int,
    feature_names: Sequence[str],
    name_to_index: dict[str, int],
    aoi_rows: Sequence[Any],
) -> list[list[Any]]:
    rows: list[list[Any]] = []
    for row in aoi_rows:
        total = int(row.total_amount_aoi)
        if total <= 0:
            continue
        held = int(row.absolute_held_aoi)
        rel = row.coverage_within_aoi
        rows.append([geo_index, name_to_index[row.feature], total, held, rel])
    return rows


def refuse_if_tautology(aoi_mask: np.ndarray, selected_mask: np.ndarray) -> None:
    if np.array_equal(np.asarray(aoi_mask, dtype=bool), np.asarray(selected_mask, dtype=bool)):
        raise MesaEcosystemCoverageError(
            "AOI mask equals the solution selected mask; refusing a tautological "
            "relative_held denominator."
        )


def cells_match_selected(aoi_cells: np.ndarray, selected_flat: np.ndarray) -> bool:
    selected_cells = np.flatnonzero(selected_flat)
    return aoi_cells.size == selected_cells.size and bool(
        np.array_equal(aoi_cells, selected_cells)
    )


def load_solution_checked(path: Path, fingerprint: RasterFingerprint) -> SolutionRaster:
    raster = read_solution_raster(path)
    if not raster.fingerprint.matches(fingerprint):
        raise MesaEcosystemCoverageError(
            f"Solution raster {path} does not match the packet ecosystem grid."
        )
    return raster


def compute_national(
    packet: PacketContext,
    template: FeatureTemplate,
    solution: SolutionRaster,
) -> tuple[list[list[str]], list[list[Any]]]:
    rows = evaluate_national_rows(
        category_values=packet.category_values,
        selected_mask=solution.selected_mask,
        feature_ids=template.feature_ids,
        feature_names=template.feature_names,
        relative_targets=template.relative_targets,
        evaluated=template.evaluated,
    )
    name_to_index = {name: index for index, name in enumerate(template.feature_names)}
    compact_rows: list[list[Any]] = []
    for row in rows:
        total = int(row.total_amount)
        if total <= 0:
            continue
        compact_rows.append(
            [
                0,
                name_to_index[row.feature],
                total,
                int(row.absolute_held or 0),
                row.relative_held,
            ]
        )
    return [["colombia", "Colombia"]], compact_rows


def rasterize_one(
    feature: BoundaryFeature,
    fingerprint: RasterFingerprint,
) -> np.ndarray:
    return rasterize_boundary(
        feature.geometry,
        fingerprint,
        source_crs=feature.source_crs,
    )


def compute_level_with_calculator(
    *,
    packet: PacketContext,
    template: FeatureTemplate,
    level: str,
    boundaries: Sequence[BoundaryFeature],
    solutions: Sequence[tuple[SolutionSpec, SolutionRaster]],
    output_root: Path,
    status: dict[str, Any],
    log_path: Path,
) -> None:
    name_to_index = {name: index for index, name in enumerate(template.feature_names)}
    geographies = [[feat.boundary_id, feat.name] for feat in boundaries]
    collected: dict[str, list[list[Any]]] = {spec.solution_id: [] for spec, _raster in solutions}
    errors: dict[str, str] = {}
    for geo_i, feat in enumerate(boundaries):
        aoi_mask = rasterize_one(feat, packet.fingerprint)
        for spec, raster in solutions:
            if spec.solution_id in errors:
                continue
            try:
                refuse_if_tautology(aoi_mask, raster.selected_mask)
                aoi_rows = evaluate_aoi_rows(
                    category_values=packet.category_values,
                    selected_mask=raster.selected_mask,
                    aoi_mask=aoi_mask,
                    feature_ids=template.feature_ids,
                    feature_names=template.feature_names,
                    relative_targets=template.relative_targets,
                    pre_existing_mask=raster.pre_existing_mask,
                    new_prioritizr_mask=raster.new_prioritizr_mask,
                )
                collected[spec.solution_id].extend(
                    sparse_rows_from_aoi(geo_i, template.feature_names, name_to_index, aoi_rows)
                )
            except Exception as exc:
                errors[spec.solution_id] = f"{type(exc).__name__}: {exc}"
        del aoi_mask
    for spec, _raster in solutions:
        if spec.solution_id in errors:
            mark_entry(
                status,
                solution_id=spec.solution_id,
                level=level,
                state="error",
                error=errors[spec.solution_id],
            )
            write_status(output_root, status)
            log(f"ERROR {spec.solution_id} {level}: {errors[spec.solution_id]}", log_path)
            continue
        path = write_compact(
            output_root=output_root,
            solution_id=spec.solution_id,
            level=level,
            features=template.features,
            geographies=geographies,
            rows=collected[spec.solution_id],
        )
        mark_entry(
            status,
            solution_id=spec.solution_id,
            level=level,
            state="done",
            output_path=path,
        )
        write_status(output_root, status)
        log(f"DONE {spec.solution_id} {level} rows={len(collected[spec.solution_id])}", log_path)


def compute_level_with_npz(
    *,
    packet: PacketContext,
    template: FeatureTemplate,
    level: str,
    boundaries: Sequence[BoundaryFeature],
    solutions: Sequence[tuple[SolutionSpec, SolutionRaster]],
    output_root: Path,
    status: dict[str, Any],
    log_path: Path,
) -> None:
    n_features = packet.n_features
    geo_ids = [feat.boundary_id for feat in boundaries]
    geo_names = [feat.name for feat in boundaries]
    totals_stack = np.zeros((len(boundaries), n_features), dtype=np.int64)
    held_stack = np.zeros((len(solutions), len(boundaries), n_features), dtype=np.int32)
    errors: dict[str, str] = {}
    verified = False
    for geo_i, feat in enumerate(boundaries):
        aoi_mask = rasterize_one(feat, packet.fingerprint)
        aoi_flat = np.asarray(aoi_mask, dtype=bool).ravel()
        cells = np.flatnonzero(aoi_flat)
        in_feature = cells[packet.feature_index[cells] >= 0]
        totals_stack[geo_i] = np.bincount(
            packet.feature_index[in_feature], minlength=n_features
        ).astype(np.int64)
        for sol_i, (spec, raster) in enumerate(solutions):
            if spec.solution_id in errors:
                continue
            selected_flat = np.asarray(raster.selected_mask, dtype=bool).ravel()
            try:
                if cells_match_selected(cells, selected_flat):
                    raise MesaEcosystemCoverageError(
                        "AOI mask equals the solution selected mask; refusing a tautological "
                        "relative_held denominator."
                    )
                if not verified and in_feature.size > 0:
                    refuse_if_tautology(aoi_mask, raster.selected_mask)
                    calculator_rows = evaluate_aoi_rows(
                        category_values=packet.category_values,
                        selected_mask=raster.selected_mask,
                        aoi_mask=aoi_mask,
                        feature_ids=template.feature_ids,
                        feature_names=template.feature_names,
                        relative_targets=template.relative_targets,
                    )
                    held_probe = np.bincount(
                        packet.feature_index[cells][selected_flat[cells] & (packet.feature_index[cells] >= 0)],
                        minlength=n_features,
                    )
                    for feat_i, row in enumerate(calculator_rows):
                        if int(row.total_amount_aoi) != int(totals_stack[geo_i, feat_i]) or int(
                            row.absolute_held_aoi
                        ) != int(held_probe[feat_i]):
                            raise MesaEcosystemCoverageError(
                                f"NPZ counts missed evaluate_aoi_rows on {feat.boundary_id} "
                                f"{row.feature}."
                            )
                    verified = True
                held_stack[sol_i, geo_i] = np.bincount(
                    packet.feature_index[cells][selected_flat[cells] & (packet.feature_index[cells] >= 0)],
                    minlength=n_features,
                ).astype(np.int32)
            except Exception as exc:
                errors[spec.solution_id] = f"{type(exc).__name__}: {exc}"
        del aoi_mask
        if (geo_i + 1) % 200 == 0 or geo_i + 1 == len(boundaries):
            log(f"  {packet.sirap_id} {level} rasterized {geo_i + 1}/{len(boundaries)}", log_path)

    npz_path = output_root / "checkpoint" / packet.sirap_id / f"{level}.relative-held.npz"
    npz_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        npz_path,
        solutionIds=np.array([spec.solution_id for spec, _raster in solutions]),
        geographyIds=np.array(geo_ids),
        geographyNames=np.array(geo_names),
        featureIds=np.array(template.feature_ids, dtype=np.int32),
        featureNames=np.array(template.feature_names),
        totals=totals_stack.astype(np.int32),
        held=held_stack,
    )
    geographies = [[gid, name] for gid, name in zip(geo_ids, geo_names, strict=True)]
    for sol_i, (spec, _raster) in enumerate(solutions):
        if spec.solution_id in errors:
            mark_entry(
                status,
                solution_id=spec.solution_id,
                level=level,
                state="error",
                error=errors[spec.solution_id],
            )
            write_status(output_root, status)
            log(f"ERROR {spec.solution_id} {level}: {errors[spec.solution_id]}", log_path)
            continue
        rows: list[list[Any]] = []
        for geo_i in range(len(geographies)):
            rows.extend(
                sparse_rows_from_counts(geo_i, totals_stack[geo_i], held_stack[sol_i, geo_i])
            )
        path = write_compact(
            output_root=output_root,
            solution_id=spec.solution_id,
            level=level,
            features=template.features,
            geographies=geographies,
            rows=rows,
        )
        mark_entry(
            status,
            solution_id=spec.solution_id,
            level=level,
            state="done",
            output_path=path,
        )
        write_status(output_root, status)
        log(f"DONE {spec.solution_id} {level} rows={len(rows)}", log_path)


def summarize_compact(path: Path) -> dict[str, Any]:
    document = json.loads(path.read_text(encoding="utf-8"))
    rels = [row[4] for row in document["rows"] if row[4] is not None]
    features = document["features"]
    orobioma = None
    for name, _fid, _target, _ev in features:
        if name == OROBIOMA_ANDINO_CC:
            feat_i = next(
                index for index, feat in enumerate(features) if feat[0] == name
            )
            geo_rows = [row for row in document["rows"] if row[1] == feat_i]
            orobioma = {
                "feature": name,
                "rowCount": len(geo_rows),
                "relativeHeld": [row[4] for row in geo_rows],
                "totalAmount": [row[2] for row in geo_rows],
                "absoluteHeld": [row[3] for row in geo_rows],
            }
            eje_rows = [
                row
                for row in geo_rows
                if document["geographies"][row[0]][0] == "thematic_eje_cafetero_1"
                or "eje" in document["geographies"][row[0]][1].lower()
            ]
            if eje_rows:
                orobioma["ejeRelativeHeld"] = eje_rows[0][4]
                orobioma["ejeTotalAmount"] = eje_rows[0][2]
                orobioma["ejeAbsoluteHeld"] = eje_rows[0][3]
            break
    return {
        "solutionId": document["solutionId"],
        "geographyLevel": document["geographyLevel"],
        "featureCount": len(features),
        "geographyCount": len(document["geographies"]),
        "rowCount": len(document["rows"]),
        "maxRelativeHeld": max(rels) if rels else None,
        "minRelativeHeld": min(rels) if rels else None,
        "allNearOne": bool(rels) and all(rel >= 0.99 for rel in rels),
        "orobiomaAndinoCordilleraCentral": orobioma,
        "outputPath": str(path),
    }


def smoke_ok(summary: dict[str, Any]) -> tuple[bool, str]:
    if summary["rowCount"] <= 0:
        return False, "smoke produced no compact rows"
    if summary["allNearOne"]:
        return False, "all relative_held values are ~1.0; denominator looks tautological"
    orobioma = summary.get("orobiomaAndinoCordilleraCentral") or {}
    eje_rel = orobioma.get("ejeRelativeHeld")
    if eje_rel is not None and eje_rel >= 0.95:
        return False, (
            f"{OROBIOMA_ANDINO_CC} Eje relative_held={eje_rel} looks like the "
            "MEC nodata-as-unselected tautology (national Eje was ~0.202)"
        )
    return True, "smoke relative_held is not collapsed to ~1.0"


def ordered_packet_levels(smoke: bool) -> list[tuple[str, str]]:
    if smoke:
        return [("eje-cafetero", "siraps")]
    pairs: list[tuple[str, str]] = []
    pairs.append(("eje-cafetero", "siraps"))
    for level in GEOGRAPHY_LEVELS:
        if level != "siraps":
            pairs.append(("eje-cafetero", level))
    pairs.append(("orinoquia", "siraps"))
    for level in GEOGRAPHY_LEVELS:
        if level != "siraps":
            pairs.append(("orinoquia", level))
    return pairs


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--manifest-url", default=MANIFEST_URL)
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--solution-id", action="append", dest="solution_ids")
    parser.add_argument("--level", action="append", dest="levels", choices=GEOGRAPHY_LEVELS)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    output_root = args.output_root if args.output_root.is_absolute() else REPO / args.output_root
    output_root.mkdir(parents=True, exist_ok=True)
    log_path = output_root / "compute.log"
    write_resume_txt(output_root)
    log(f"output_root={output_root}", log_path)

    template = load_feature_template(output_root)
    log(
        f"feature_template={template.path.name} features={len(template.feature_names)}",
        log_path,
    )
    manifest = download_manifest(output_root, args.manifest_url)
    solutions = load_solutions(manifest)
    status = load_or_init_status(output_root, solutions)
    log(f"status_entries={len(status['entries'])} counts={status_counts(status)}", log_path)

    wanted_ids = set(args.solution_ids or [])
    wanted_levels = set(args.levels or [])
    if args.smoke:
        wanted_ids = {"eje-cafetero-001"}
        wanted_levels = {"siraps"}

    by_packet: dict[str, list[SolutionSpec]] = {}
    for spec in solutions:
        if wanted_ids and spec.solution_id not in wanted_ids:
            continue
        by_packet.setdefault(spec.sirap_id, []).append(spec)

    cache_dir = REPO / "data/metrics/cache/tier1"
    boundaries_by_level, boundary_errors = load_all_boundaries(cache_dir)
    if boundary_errors:
        log(f"boundary load errors: {boundary_errors}", log_path)
    for level in GEOGRAPHY_LEVELS:
        if level == "national":
            continue
        log(f"  boundaries {level}: {len(boundaries_by_level.get(level) or [])}", log_path)

    packets: dict[str, PacketContext] = {}
    rasters: dict[str, SolutionRaster] = {}

    for packet_id, level in ordered_packet_levels(args.smoke):
        if wanted_levels and level not in wanted_levels:
            continue
        packet_solutions = by_packet.get(packet_id) or []
        if not packet_solutions:
            continue
        entries = status_map(status)
        pending = [
            spec
            for spec in packet_solutions
            if entries[entry_key(spec.solution_id, level)]["status"] != "done"
        ]
        if not pending:
            log(f"SKIP {packet_id} {level}: all done", log_path)
            continue

        if packet_id == "orinoquia":
            log(f"resolving {len(packet_solutions)} orinoquia tifs (download missing)", log_path)
        for spec in pending:
            if spec.tif_path is None:
                log(f"resolve tif {spec.solution_id} {spec.raster_file}", log_path)
                spec.tif_path = resolve_tif(spec, output_root)

        if packet_id not in packets:
            probe = pending[0].tif_path
            assert probe is not None
            log(f"open packet {packet_id} probe={probe.name}", log_path)
            packets[packet_id] = open_packet(packet_id, template, probe)
        packet = packets[packet_id]

        loaded: list[tuple[SolutionSpec, SolutionRaster]] = []
        for spec in pending:
            assert spec.tif_path is not None
            if spec.solution_id not in rasters:
                rasters[spec.solution_id] = load_solution_checked(spec.tif_path, packet.fingerprint)
            loaded.append((spec, rasters[spec.solution_id]))

        started = time.perf_counter()
        log(f"COMPUTE {packet_id} {level} solutions={len(loaded)}", log_path)
        try:
            if level == "national":
                for spec, raster in loaded:
                    try:
                        geographies, rows = compute_national(packet, template, raster)
                        path = write_compact(
                            output_root=output_root,
                            solution_id=spec.solution_id,
                            level=level,
                            features=template.features,
                            geographies=geographies,
                            rows=rows,
                        )
                        mark_entry(
                            status,
                            solution_id=spec.solution_id,
                            level=level,
                            state="done",
                            output_path=path,
                        )
                        write_status(output_root, status)
                        log(f"DONE {spec.solution_id} {level} rows={len(rows)}", log_path)
                    except Exception as exc:
                        mark_entry(
                            status,
                            solution_id=spec.solution_id,
                            level=level,
                            state="error",
                            error=f"{type(exc).__name__}: {exc}",
                        )
                        write_status(output_root, status)
                        log(
                            f"ERROR {spec.solution_id} {level}: {type(exc).__name__}: {exc}",
                            log_path,
                        )
            else:
                boundaries = boundaries_by_level.get(level) or []
                if not boundaries:
                    for spec, _raster in loaded:
                        mark_entry(
                            status,
                            solution_id=spec.solution_id,
                            level=level,
                            state="skipped",
                            error=f"no boundaries for {level}",
                        )
                    write_status(output_root, status)
                    log(f"SKIP {packet_id} {level}: no boundaries", log_path)
                    continue
                if level in CALCULATOR_LEVELS:
                    compute_level_with_calculator(
                        packet=packet,
                        template=template,
                        level=level,
                        boundaries=boundaries,
                        solutions=loaded,
                        output_root=output_root,
                        status=status,
                        log_path=log_path,
                    )
                elif level in SHARED_NPZ_LEVELS:
                    compute_level_with_npz(
                        packet=packet,
                        template=template,
                        level=level,
                        boundaries=boundaries,
                        solutions=loaded,
                        output_root=output_root,
                        status=status,
                        log_path=log_path,
                    )
                else:
                    raise MesaEcosystemCoverageError(f"Unsupported level {level}")
        except Exception as exc:
            tb = traceback.format_exc()
            log(f"LEVEL ERROR {packet_id} {level}: {exc}\n{tb}", log_path)
            for spec, _raster in loaded:
                if status_map(status)[entry_key(spec.solution_id, level)]["status"] != "done":
                    mark_entry(
                        status,
                        solution_id=spec.solution_id,
                        level=level,
                        state="error",
                        error=f"{type(exc).__name__}: {exc}",
                    )
            write_status(output_root, status)
        log(
            f"ELAPSED {packet_id} {level} {time.perf_counter() - started:.1f}s "
            f"counts={status_counts(status)}",
            log_path,
        )

        if args.smoke and packet_id == "eje-cafetero" and level == "siraps":
            smoke_entry = status_map(status)[("eje-cafetero-001", "siraps")]
            if smoke_entry["status"] != "done":
                log(f"SMOKE FAILED: {smoke_entry.get('error')}", log_path)
                return 1
            summary = summarize_compact(Path(smoke_entry["outputPath"]))
            atomic_write_json(output_root / "smoke.eje-cafetero-001.siraps.json", summary, pretty=True)
            ok, reason = smoke_ok(summary)
            log(f"SMOKE {json.dumps(summary, ensure_ascii=False)}", log_path)
            log(f"SMOKE verdict: {reason}", log_path)
            if not ok:
                mark_entry(
                    status,
                    solution_id="eje-cafetero-001",
                    level="siraps",
                    state="error",
                    output_path=Path(smoke_entry["outputPath"]),
                    error=reason,
                )
                write_status(output_root, status)
                return 1

    log(f"finished counts={status_counts(status)}", log_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
