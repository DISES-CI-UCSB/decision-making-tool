"""Download live SIRAP compact (read-only) and append classic-IDEAM of-AOI percents.

Does not rewrite ``land_use_*_pct``. Does not write the live SIRAP blob prefix.
Never uses ``--in-place``.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backfill_land_use_of_aoi import (
    CLC_ENCODING_CLASSIC_IDEAM,
    LAND_USE_OF_AOI_METRIC_IDS,
    LAND_USE_SELECTED_PCT_METRIC_IDS,
    load_metric_document,
    run_backfill,
)
from cli_utils import find_repo_root
from compact_metrics import COMPACT_CACHE_SUFFIX
from local_io import DEFAULT_CACHE_DIR

PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
LIVE_SIRAP_MANIFEST_URL = f"{PUBLIC_BLOB_HOST}/releases/sirap-2026-09-02-v6/manifest.json"
LIVE_SIRAP_COMPACT_PREFIX = "releases/sirap-2026-09-02-v6/regular/compact/cache/"
DEFAULT_OUTPUT_REL = Path("data/metrics/generated/releases/sirap-2026-09-02-v6-land-use-of-aoi")
DEFAULT_PACKET_CLC_ROOT = Path("backend/runtime-artifacts/sirap")
ORINOQUIA_SAMPLE = "sirap-orinoquia-estr17-cong17-sab17-runap-iheh2022"
EJE_SAMPLE = "eje-cafetero-001"
EXISTING_SAMPLE_REL = Path(
    "data/metrics/generated/releases/sirap-2026-09-02-v6-land-use-encoding-report/work"
)

FOREST_OF_AOI = "land_use_forests_and_semi_natural_areas_pct_of_aoi"
AGRI_OF_AOI = "land_use_agricultural_areas_pct_of_aoi"
ARTIFICIAL_OF_AOI = "land_use_artificial_surfaces_pct_of_aoi"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _resolve(repo_root: Path, path: Path) -> Path:
    return path if path.is_absolute() else repo_root / path


def fetch_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": "dises-sirap-land-use-aoi/1"})
    with urllib.request.urlopen(request, timeout=180) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError(f"{url} is not a JSON object")
    return payload


def compact_blob_url(solution_id: str) -> str:
    return f"{PUBLIC_BLOB_HOST}/{LIVE_SIRAP_COMPACT_PREFIX}{solution_id}{COMPACT_CACHE_SUFFIX}"


def _download_one(url: str, destination: Path, *, attempts: int = 3) -> int:
    if LIVE_SIRAP_COMPACT_PREFIX not in url:
        raise RuntimeError(f"refusing compact URL outside live SIRAP prefix: {url}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            request = urllib.request.Request(
                url, headers={"User-Agent": "dises-sirap-land-use-aoi/1"}
            )
            with urllib.request.urlopen(request, timeout=180) as response:
                payload = response.read()
            destination.write_bytes(payload)
            return len(payload)
        except Exception as exc:  # noqa: BLE001 - retry transient blob reads
            last_error = exc
            if attempt == attempts:
                break
    raise RuntimeError(f"download failed after {attempts} attempts: {last_error}")


def download_live_compact(
    repo_root: Path,
    source_dir: Path,
    *,
    workers: int = 6,
) -> dict[str, Any]:
    manifest = fetch_json(LIVE_SIRAP_MANIFEST_URL)
    solutions = manifest.get("solutions")
    if not isinstance(solutions, list) or len(solutions) != 56:
        raise RuntimeError(
            f"live SIRAP manifest must have 56 solutions, found {len(solutions or [])}"
        )
    sample_dir = repo_root / EXISTING_SAMPLE_REL
    source_dir.mkdir(parents=True, exist_ok=True)
    copied = 0
    downloaded = 0
    pending: list[tuple[str, str, Path]] = []
    region_counts: dict[str, int] = {}
    for solution in solutions:
        solution_id = str(solution.get("id") or "")
        region_id = str(solution.get("sirapId") or "")
        if not solution_id:
            raise RuntimeError("SIRAP manifest solution is missing id")
        region_counts[region_id] = region_counts.get(region_id, 0) + 1
        destination = source_dir / f"{solution_id}{COMPACT_CACHE_SUFFIX}"
        sample = sample_dir / f"{solution_id}{COMPACT_CACHE_SUFFIX}"
        urls = solution.get("precomputedMetricUrls")
        compact_url = urls.get("compactCache") if isinstance(urls, dict) else None
        if compact_url != compact_blob_url(solution_id):
            raise RuntimeError(
                f"{solution_id} compactCache is not the live SIRAP prefix: {compact_url}"
            )
        if destination.exists() and destination.stat().st_size > 0:
            continue
        if sample.is_file():
            shutil.copy2(sample, destination)
            copied += 1
            continue
        pending.append((solution_id, str(compact_url), destination))

    failed: list[str] = []
    if pending:
        print(
            f"[sirap-land-use-aoi] downloading {len(pending)} live compact files "
            f"(read-only; workers={workers})",
            flush=True,
        )
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(_download_one, url, path): solution_id
                for solution_id, url, path in pending
            }
            done = 0
            for future in as_completed(futures):
                done += 1
                solution_id = futures[future]
                try:
                    size = future.result()
                    downloaded += 1
                    print(
                        f"[sirap-land-use-aoi] {done}/{len(pending)} downloaded "
                        f"{solution_id} ({size:,} B)",
                        flush=True,
                    )
                except Exception as exc:  # noqa: BLE001 - surface worker failures
                    failed.append(f"{solution_id}: {exc}")
                    print(
                        f"[sirap-land-use-aoi] {done}/{len(pending)} FAILED {solution_id}: {exc}",
                        file=sys.stderr,
                        flush=True,
                    )
    if failed:
        raise RuntimeError("compact download failed: " + "; ".join(failed))
    files = sorted(source_dir.glob(f"*{COMPACT_CACHE_SUFFIX}"))
    if len(files) != 56:
        raise RuntimeError(f"expected 56 compact files in {source_dir}, found {len(files)}")
    return {
        "copiedFromEncodingReport": copied,
        "downloaded": downloaded,
        "alreadyPresent": 56 - copied - downloaded,
        "regionCounts": region_counts,
        "sourceDir": str(source_dir),
    }


def _metric_values(document: dict[str, Any], level: str, scope_id: str) -> dict[str, Any]:
    scope = ((document.get("geographies") or {}).get(level) or {}).get(scope_id) or {}
    rows = scope.get("metrics") or []
    return {
        str(row.get("metricId")): row
        for row in rows
        if isinstance(row, dict) and row.get("metricId")
    }


def _selected_values(rows: dict[str, Any]) -> dict[str, Any]:
    return {
        metric_id: rows[metric_id].get("value")
        for metric_id in LAND_USE_SELECTED_PCT_METRIC_IDS
        if metric_id in rows
    }


def _of_aoi_values(rows: dict[str, Any]) -> dict[str, Any]:
    return {
        metric_id: rows[metric_id].get("value") if metric_id in rows else None
        for metric_id in LAND_USE_OF_AOI_METRIC_IDS
    }


def verify_backfill(source_dir: Path, output_dir: Path) -> dict[str, Any]:
    output_files = sorted(output_dir.glob(f"*{COMPACT_CACHE_SUFFIX}"))
    if len(output_files) != 56:
        raise RuntimeError(f"expected 56 written compact files, found {len(output_files)}")

    orinoquia_out, _ = load_metric_document(output_dir / f"{ORINOQUIA_SAMPLE}{COMPACT_CACHE_SUFFIX}")
    eje_out, _ = load_metric_document(output_dir / f"{EJE_SAMPLE}{COMPACT_CACHE_SUFFIX}")
    orinoquia_src, _ = load_metric_document(source_dir / f"{ORINOQUIA_SAMPLE}{COMPACT_CACHE_SUFFIX}")
    eje_src, _ = load_metric_document(source_dir / f"{EJE_SAMPLE}{COMPACT_CACHE_SUFFIX}")

    orinoquia_sirap = _metric_values(orinoquia_out, "sirap", "orinoquia")
    eje_sirap = _metric_values(eje_out, "sirap", "eje-cafetero")
    meta = _metric_values(orinoquia_out, "departments", "50")
    orinoquia_of_aoi = _of_aoi_values(orinoquia_sirap)
    eje_of_aoi = _of_aoi_values(eje_sirap)
    meta_of_aoi = _of_aoi_values(meta)

    orinoquia_selected_out = _selected_values(orinoquia_sirap)
    eje_selected_out = _selected_values(eje_sirap)
    orinoquia_selected_src = _selected_values(
        _metric_values(orinoquia_src, "sirap", "orinoquia")
    )
    eje_selected_src = _selected_values(_metric_values(eje_src, "sirap", "eje-cafetero"))

    orinoquia_forest = orinoquia_of_aoi[FOREST_OF_AOI]
    orinoquia_artificial = orinoquia_of_aoi[ARTIFICIAL_OF_AOI]
    eje_forest = eje_of_aoi[FOREST_OF_AOI]
    eje_agri = eje_of_aoi[AGRI_OF_AOI]
    eje_artificial = eje_of_aoi[ARTIFICIAL_OF_AOI]

    if isinstance(orinoquia_forest, (int, float)) and orinoquia_forest < 20:
        raise RuntimeError(
            "Orinoquia forest of_aoi is far below the classic class-3 majority; "
            "national remapped IDs may have been applied."
        )

    checks = {
        "compactCount56": len(output_files) == 56,
        "orinoquiaForestMajority": isinstance(orinoquia_forest, (int, float))
        and 68.0 <= float(orinoquia_forest) <= 76.0,
        "orinoquiaArtificialTiny": isinstance(orinoquia_artificial, (int, float))
        and float(orinoquia_artificial) < 2.0,
        "ejeForestAbout50": isinstance(eje_forest, (int, float))
        and 48.0 <= float(eje_forest) <= 53.0,
        "ejeAgriAbout46": isinstance(eje_agri, (int, float))
        and 44.0 <= float(eje_agri) <= 49.0,
        "ejeArtificialSmall": isinstance(eje_artificial, (int, float))
        and float(eje_artificial) < 4.0,
        "metaDepartment50OfAoiPresent": all(
            metric_id in meta and meta[metric_id].get("value") is not None
            for metric_id in LAND_USE_OF_AOI_METRIC_IDS
        ),
        "orinoquiaSelectedUnchanged": orinoquia_selected_out == orinoquia_selected_src,
        "ejeSelectedUnchanged": eje_selected_out == eje_selected_src,
    }
    passed = all(checks.values())
    report = {
        "generatedAt": _utc_now_iso(),
        "encoding": CLC_ENCODING_CLASSIC_IDEAM,
        "rewroteSelectedPct": False,
        "compactCount": len(output_files),
        "checks": checks,
        "passed": passed,
        "golden": {
            "orinoquiaSample": {
                "solutionId": ORINOQUIA_SAMPLE,
                "sirapScopeOfAoi": orinoquia_of_aoi,
                "selectedPct": orinoquia_selected_out,
                "departments50OfAoi": meta_of_aoi,
            },
            "ejeCafeteroSample": {
                "solutionId": EJE_SAMPLE,
                "sirapScopeOfAoi": eje_of_aoi,
                "selectedPct": eje_selected_out,
            },
        },
    }
    if not passed:
        raise RuntimeError("SIRAP land-use-of-AOI verification failed: " + json.dumps(checks))
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_REL)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    parser.add_argument("--packet-clc-root", type=Path, default=DEFAULT_PACKET_CLC_ROOT)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--skip-download", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = find_repo_root()
    output_root = _resolve(repo_root, args.output_dir)
    source_dir = output_root / "source-compact"
    compact_out = output_root / "regular" / "compact" / "cache"
    cache_dir = _resolve(repo_root, args.cache_dir)
    packet_clc_root = _resolve(repo_root, args.packet_clc_root)

    output_root.mkdir(parents=True, exist_ok=True)
    if args.skip_download:
        download_report = {"skipped": True, "sourceDir": str(source_dir)}
        files = sorted(source_dir.glob(f"*{COMPACT_CACHE_SUFFIX}"))
        if len(files) != 56:
            raise RuntimeError(f"--skip-download expected 56 compact files, found {len(files)}")
    else:
        download_report = download_live_compact(
            repo_root, source_dir, workers=args.workers
        )
    print("[sirap-land-use-aoi] " + json.dumps(download_report, indent=2, sort_keys=True))

    backfill_report = run_backfill(
        input_dir=source_dir,
        output_dir=compact_out,
        cache_dir=cache_dir,
        clc_encoding=CLC_ENCODING_CLASSIC_IDEAM,
        packet_clc_root=packet_clc_root,
        dry_run=args.dry_run,
    )
    print("[sirap-land-use-aoi] backfill uniqueSolutions=" + str(backfill_report["uniqueSolutions"]))

    if args.dry_run:
        print("[sirap-land-use-aoi] dry-run: skipping verify-report write")
        return 0

    verify_report = verify_backfill(source_dir, compact_out)
    verify_path = output_root / "verify-report.json"
    verify_path.write_text(json.dumps(verify_report, indent=2) + "\n", encoding="utf-8")
    status = {
        "backfillFinished": True,
        "clcEncoding": CLC_ENCODING_CLASSIC_IDEAM,
        "compactCounts": {
            "expected": 56,
            "ejeCafetero": 40,
            "orinoquia": 16,
            "written": backfill_report["uniqueSolutions"],
        },
        "devEnvironmentUnchanged": True,
        "generatedAt": _utc_now_iso(),
        "golden": verify_report["golden"],
        "goldenPassed": verify_report["passed"],
        "inPlace": False,
        "productionPathsUntouched": [
            "manifest/manifest.json",
            "catalog-releases/3.0.5/",
            "releases/sirap-2026-09-02-v6/",
        ],
        "rewroteSelectedPct": False,
        "verifyReport": str(verify_path),
    }
    status_path = output_root / "overnight-status.json"
    status_path.write_text(json.dumps(status, indent=2) + "\n", encoding="utf-8")
    print(f"[sirap-land-use-aoi] wrote {verify_path}")
    print(f"[sirap-land-use-aoi] wrote {status_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("[sirap-land-use-aoi] interrupted", file=sys.stderr)
        raise SystemExit(130)
