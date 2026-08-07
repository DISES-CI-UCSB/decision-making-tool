"""Derive strategic-ecosystem outcomes from existing national metric values."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cli_utils import find_repo_root

OUTCOMES_FORMAT = "strategic-ecosystem-outcomes-v1"
DENOMINATORS_FORMAT = "strategic-ecosystem-denominators-v1"
COMPACT_FORMAT = "metrics-compact-v1"
MEASUREMENT_METHOD = "post-hoc-raster-derived"
AREA_UNIT = "km2"
EXPECTED_CHECKPOINTS = [17, 30]
MAX_COMPACT_PREFIX_BYTES = 2 * 1024 * 1024


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_json_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"expected a JSON object: {path}")
    return value


def validate_denominators(spec: dict[str, Any], *, release_id: str) -> list[dict[str, Any]]:
    if spec.get("format") != DENOMINATORS_FORMAT:
        raise ValueError("strategic denominator format mismatch")
    if spec.get("releaseId") != release_id:
        raise ValueError("strategic denominators do not match the metrics release")
    if spec.get("measurementMethod") != MEASUREMENT_METHOD:
        raise ValueError("strategic denominator measurement method mismatch")
    if spec.get("areaUnit") != AREA_UNIT:
        raise ValueError("strategic denominator area unit must be km2")
    if spec.get("featurePresenceValue") != 1:
        raise ValueError("strategic feature presence must be value 1")
    if spec.get("solutionSelectedValues") != [1, 2]:
        raise ValueError("strategic outcomes require solution values 1 and 2")
    if spec.get("checkpointsPercent") != EXPECTED_CHECKPOINTS:
        raise ValueError("strategic outcome checkpoints must be 17% and 30%")

    grid = spec.get("alignedGrid")
    if not isinstance(grid, dict) or (
        grid.get("crs"),
        grid.get("width"),
        grid.get("height"),
        grid.get("pixelSizeMeters"),
        grid.get("resampling"),
    ) != ("EPSG:9377", 1353, 1838, 1000, "nearest"):
        raise ValueError("strategic denominator aligned-grid policy mismatch")
    if not _is_sha256(grid.get("targetGridSha256")):
        raise ValueError("strategic denominator target-grid checksum is invalid")

    features = spec.get("features")
    if not isinstance(features, list) or len(features) != 4:
        raise ValueError("strategic denominators must define exactly four features")
    expected_ids = {"paramos", "wetlands", "bosque_seco", "mangroves"}
    if {feature.get("featureId") for feature in features if isinstance(feature, dict)} != expected_ids:
        raise ValueError("strategic denominator feature inventory mismatch")
    for feature in features:
        if not isinstance(feature, dict):
            raise ValueError("strategic denominator feature is malformed")
        cells = feature.get("totalAlignedFeatureValue1Cells")
        area = feature.get("totalAlignedFeatureValue1AreaKm2")
        if not isinstance(cells, int) or cells <= 0 or area != cells:
            raise ValueError(
                f"{feature.get('featureId')} denominator must equal its 1 km2 value-1 cell count"
            )
        for field in ("sourceSha256", "alignedSha256", "alignmentPolicySha256"):
            if not _is_sha256(feature.get(field)):
                raise ValueError(f"{feature.get('featureId')} {field} is invalid")
        source_path = feature.get("sourcePath")
        if not isinstance(source_path, str) or not source_path.startswith(
            "inputs/features/strategic/"
        ):
            raise ValueError(f"{feature.get('featureId')} source identity is invalid")
    return features


def _is_sha256(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )


def _compact_prefix_value(prefix: str, key: str) -> Any:
    marker = f'"{key}":'
    start = prefix.find(marker)
    if start < 0:
        raise ValueError(f"compact metrics prefix is missing {key}")
    try:
        value, _ = json.JSONDecoder().raw_decode(prefix, start + len(marker))
    except json.JSONDecodeError as exc:
        raise ValueError(f"compact metrics prefix contains incomplete {key}") from exc
    return value


def read_compact_national(path: Path) -> tuple[str, list[dict[str, Any]]]:
    """Read only the small national prefix from a pipeline-produced compact document."""

    prefix = path.open("rb").read(MAX_COMPACT_PREFIX_BYTES).decode("utf-8")
    if _compact_prefix_value(prefix, "format") != COMPACT_FORMAT:
        raise ValueError(f"unsupported compact metrics format: {path}")
    solution_id = _compact_prefix_value(prefix, "solutionId")
    metric_catalog = _compact_prefix_value(prefix, "metricCatalog")
    status_catalog = _compact_prefix_value(prefix, "statusCatalog")
    source_catalog = _compact_prefix_value(prefix, "sourceCatalog")
    notes_catalog = _compact_prefix_value(prefix, "notesCatalog")

    national_marker = '"geographies":{"national":'
    start = prefix.find(national_marker)
    if start < 0:
        raise ValueError(f"compact metrics prefix is missing national geographies: {path}")
    try:
        national, _ = json.JSONDecoder().raw_decode(
            prefix,
            start + len(national_marker),
        )
    except json.JSONDecodeError as exc:
        raise ValueError(f"national compact metrics exceed prefix limit: {path}") from exc
    colombia = national.get("colombia") if isinstance(national, dict) else None
    rows = colombia.get("metrics") if isinstance(colombia, dict) else None
    if not isinstance(rows, list):
        raise ValueError(f"compact metrics have no national Colombia rows: {path}")

    metrics: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, list) or len(row) < 5:
            raise ValueError(f"compact national metric row is malformed: {path}")
        metric_index, value, status_index, source_index, notes_index = row[:5]
        metric_id, unit, label_key, format_hint = metric_catalog[metric_index]
        metrics.append(
            {
                "metricId": metric_id,
                "value": value,
                "unit": unit,
                "status": status_catalog[status_index],
                "source": source_catalog[source_index],
                "notes": notes_catalog[notes_index],
                "labelKey": label_key,
                "formatHint": format_hint,
            }
        )
    return str(solution_id), metrics


def derive_solution_outcomes(
    metrics: list[dict[str, Any]],
    features: list[dict[str, Any]],
) -> dict[str, Any]:
    metrics_by_id = {metric.get("metricId"): metric for metric in metrics}
    outcomes: dict[str, Any] = {}
    for feature in features:
        feature_id = feature["featureId"]
        metric = metrics_by_id.get(feature["metricId"])
        if not isinstance(metric, dict):
            raise ValueError(f"missing national metric for {feature_id}")
        if metric.get("unit") != AREA_UNIT:
            raise ValueError(f"{feature_id} covered-area metric unit must be km2")
        if metric.get("status") != "ready":
            raise ValueError(f"{feature_id} covered-area metric must be ready")
        covered_area = metric.get("value")
        if (
            isinstance(covered_area, bool)
            or not isinstance(covered_area, (int, float))
            or not math.isfinite(covered_area)
            or covered_area < 0
        ):
            raise ValueError(f"{feature_id} covered area is invalid")
        expected_source = {
            "wetlands": "raster:wetlands",
            "mangroves": "raster:mangroves",
        }.get(feature_id, f"raster:{feature_id}")
        if metric.get("source") != expected_source:
            raise ValueError(f"{feature_id} covered-area metric source mismatch")

        denominator = feature["totalAlignedFeatureValue1AreaKm2"]
        fraction = covered_area / denominator
        if fraction > 1 + 1e-9:
            raise ValueError(f"{feature_id} covered area exceeds its denominator")
        outcomes[feature_id] = {
            "coveredAreaKm2": covered_area,
            "coverageFraction": fraction,
            "coveragePercent": fraction * 100,
            "checkpoints": {
                str(checkpoint): fraction + 1e-12 >= checkpoint / 100
                for checkpoint in EXPECTED_CHECKPOINTS
            },
        }
    return outcomes


def build_outcomes_document(
    *,
    input_report_path: Path,
    denominators_path: Path,
    generated_at: str | None = None,
) -> dict[str, Any]:
    report = _read_json_object(input_report_path)
    release_id = report.get("releaseId")
    if not isinstance(release_id, str) or not release_id:
        release_id = (report.get("solutionCatalog") or {}).get("releaseId")
    if not isinstance(release_id, str) or not release_id:
        raise ValueError("compact publish report has no release id")

    denominator_spec = _read_json_object(denominators_path)
    features = validate_denominators(denominator_spec, release_id=release_id)
    repo_root = find_repo_root(input_report_path)
    solutions: dict[str, Any] = {}
    for entry in report.get("entries") or []:
        if entry.get("solutionDomain") == "marine":
            continue
        raw_path = Path(str(entry.get("cachePath") or ""))
        compact_path = raw_path if raw_path.is_absolute() else repo_root / raw_path
        solution_id, metrics = read_compact_national(compact_path)
        if solution_id != entry.get("solutionId"):
            raise ValueError(f"compact solution id mismatch for {compact_path}")
        solutions[solution_id] = {
            "features": derive_solution_outcomes(metrics, features),
        }
    if not solutions:
        raise ValueError("compact publish report produced no land strategic outcomes")

    timestamp = generated_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "format": OUTCOMES_FORMAT,
        "releaseId": release_id,
        "generatedAt": timestamp,
        "measurementMethod": MEASUREMENT_METHOD,
        "areaUnit": AREA_UNIT,
        "checkpointsPercent": EXPECTED_CHECKPOINTS,
        "denominatorSpecSha256": _sha256_path(denominators_path),
        "sourceMetricsReportSha256": _sha256_path(input_report_path),
        "alignedGrid": denominator_spec["alignedGrid"],
        "featurePresenceValue": denominator_spec["featurePresenceValue"],
        "solutionSelectedValues": denominator_spec["solutionSelectedValues"],
        "features": {
            feature["featureId"]: {
                key: value
                for key, value in feature.items()
                if key != "featureId"
            }
            for feature in features
        },
        "solutions": solutions,
    }


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def point_manifest_at_outcomes(
    manifest_path: Path,
    *,
    outcomes_url: str,
    solution_ids: set[str],
) -> None:
    manifest = _read_json_object(manifest_path)
    if manifest.get("releaseId") is None:
        raise ValueError("runtime manifest has no release id")
    updated = 0
    for solution in manifest.get("solutions") or []:
        if solution.get("id") not in solution_ids:
            continue
        urls = solution.setdefault("precomputedMetricUrls", {})
        urls["strategicOutcomes"] = outcomes_url
        updated += 1
    if updated != len(solution_ids):
        raise ValueError(
            f"runtime manifest contains {updated} of {len(solution_ids)} outcome solutions"
        )
    write_json(manifest_path, manifest)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-report", type=Path, required=True)
    parser.add_argument("--denominators", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--manifest-url")
    args = parser.parse_args()
    if (args.manifest is None) != (args.manifest_url is None):
        parser.error("--manifest and --manifest-url must be provided together")
    return args


def main() -> int:
    args = _parse_args()
    document = build_outcomes_document(
        input_report_path=args.input_report,
        denominators_path=args.denominators,
    )
    write_json(args.output, document)
    if args.manifest is not None:
        point_manifest_at_outcomes(
            args.manifest,
            outcomes_url=args.manifest_url,
            solution_ids=set(document["solutions"]),
        )
    print(
        f"[strategic-outcomes] wrote {len(document['solutions'])} solution(s) -> "
        f"{args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
