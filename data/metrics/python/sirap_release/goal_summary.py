"""Build authoritative SIRAP target-progress artifacts from certified summaries."""

from __future__ import annotations

import csv
import hashlib
import math
import re
import unicodedata
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

GOAL_SUMMARY_FORMAT = "conservation-goals-v1"
EVALUATION_SOURCE = "prioritizr_model"
TOKEN_PATTERN = re.compile(r"(Estr|Bs|HuEC|Cong|Sab)(\d+)")


def build_goal_summary(
    solution: dict[str, Any],
    generated_at: str,
    *,
    published_summary_url: str | None = None,
) -> dict[str, Any]:
    """Convert one pinned regional summary into the frontend goals contract."""
    packet = solution["regionalInputPacket"]
    summary = packet["authoritativeSummary"]
    scenario_name = _scenario_name(solution)
    summary_path = _local_path(summary["url"])
    observed_sha256 = hashlib.sha256(summary_path.read_bytes()).hexdigest()
    if observed_sha256 != summary["sha256"]:
        raise ValueError(
            f"{solution['id']} summary checksum mismatch: "
            f"expected {summary['sha256']}, observed {observed_sha256}"
        )

    rows = _read_rows(summary_path)
    target_rows = [
        row
        for row in rows
        if _text(row.get("evaluated")) == EVALUATION_SOURCE
        and _text(row.get("scenario")) == scenario_name
    ]
    if not target_rows:
        raise ValueError(
            f"{solution['id']} has no solver-evaluated rows for {scenario_name}"
        )

    groups = _target_groups(solution, target_rows)
    features = _unique_features(groups)
    met_count = sum(feature["met"] is True for feature in features)
    total_count = len(features)
    target_percents = sorted({group["targetPercent"] for group in groups})

    return {
        "format": GOAL_SUMMARY_FORMAT,
        "solutionId": solution["id"],
        "solutionName": scenario_name,
        "generatedAt": generated_at,
        "source": {
            "metadataUrl": None,
            "summaryCsvUrl": published_summary_url or summary["url"],
            "summaryCsvSha256": summary["sha256"],
            "summaryCsvRows": len(rows),
            "solutionDomain": "land",
            "speciesLookupUrl": "",
            "summarySchema": summary["schema"],
        },
        "targetContext": {
            "finderTargetPercent": target_percents[0]
            if len(target_percents) == 1
            else None,
            "targetFeatureSet": f"sirap:{solution['sirapId']}:step-1",
            "targetFeatureIds": [group["id"] for group in groups],
            "relativeTargetsByType": {
                "strategicEcosystems": [percent / 100 for percent in target_percents]
            },
            "structuredTargets": {
                "format": "solution-target-metadata-v1",
                "sourceEvaluation": "final_summary_csv",
                "ecosystems": [],
                "strategicEcosystems": [
                    {
                        "featureId": feature["featureId"],
                        "targetPercent": feature["relativeTarget"] * 100,
                    }
                    for feature in features
                ],
                "ecosystemServices": [],
                "speciesRepresentation": [],
                "espRn": [],
            },
            "sirap": {
                "regionId": solution["sirapId"],
                "selectionStep": 1,
                "source": "certified-solution-name",
                "groups": [
                    {
                        "id": group["id"],
                        "targetPercent": group["targetPercent"],
                        "targetMode": group["targetMode"],
                    }
                    for group in groups
                ],
            },
        },
        "summary": {
            "metCount": met_count,
            "totalCount": total_count,
            "pctMet": met_count / total_count * 100 if total_count else None,
            "byType": {
                "species": {
                    "metSpeciesCount": 0,
                    "totalSpeciesCount": 0,
                    "pctMet": None,
                },
                "strategicEcosystems": {
                    "metCount": met_count,
                    "totalCount": total_count,
                    "pctMet": met_count / total_count * 100 if total_count else None,
                },
                "ecosystems": {"metCount": 0, "totalCount": 0, "pctMet": None},
                "other": {"metCount": 0, "totalCount": 0, "pctMet": None},
            },
        },
        "rollups": {
            "species": {
                "metSpeciesCount": 0,
                "totalSpeciesCount": 0,
                "pctMet": None,
                "byTaxa": {},
                "byIucnStatus": {},
                "unmatchedSpeciesCount": 0,
                "ignoredSpeciesRowCount": 0,
            },
            "strategicEcosystems": {
                "metCount": met_count,
                "totalCount": total_count,
                "pctMet": met_count / total_count * 100 if total_count else None,
            },
            "ecosystems": {"metCount": 0, "totalCount": 0, "pctMet": None},
        },
        "features": {
            "species": [],
            "strategicEcosystems": features,
            "ecosystems": [],
            "other": [],
        },
        "regionalTargetGroups": groups,
        "diagnostics": {
            "rawTypeCounts": {},
            "evaluationSourceCounts": {EVALUATION_SOURCE: len(target_rows)},
            "excludedEvaluationSourceCounts": {
                "post-hoc": sum(
                    _text(row.get("evaluated")) == "post-hoc" for row in rows
                )
            },
            "sourceRowCount": len(rows),
            "rowCounts": {
                "species": 0,
                "strategicEcosystems": total_count,
                "ecosystems": 0,
                "other": 0,
            },
        },
    }


def _target_groups(
    solution: dict[str, Any], rows: list[dict[str, str]]
) -> list[dict[str, Any]]:
    tokens = {
        name: int(value)
        for name, value in TOKEN_PATTERN.findall(_scenario_name(solution))
    }
    region_id = solution["sirapId"]
    strategic_rows = [
        row
        for row in rows
        if _normalize(row.get("feature_type")) == "strategic ecosystem"
    ]

    if region_id == "eje-cafetero":
        required = {"Estr", "HuEC"}
        if not required.issubset(tokens):
            raise ValueError(
                f"{solution['id']} lacks required Eje Cafetero target tokens"
            )
        dry_target = tokens.get("Bs", tokens["Estr"])
        return [
            _group(
                "strategic-ecosystems",
                tokens["Estr"],
                "configured",
                [
                    row
                    for row in strategic_rows
                    if _normalize(row.get("feature")) != "bosque seco"
                ],
            ),
            _group(
                "dry-forest",
                dry_target,
                "separate" if "Bs" in tokens else "inherits-strategic",
                _rows_named(rows, "bosque seco"),
            ),
            _group(
                "eje-wetlands",
                tokens["HuEC"],
                "configured",
                _rows_named(rows, "ec wetlands"),
            ),
        ]

    if region_id == "orinoquia":
        required = {"Estr", "Cong", "Sab"}
        if not required.issubset(tokens):
            raise ValueError(f"{solution['id']} lacks required Orinoquía target tokens")
        if tokens["Estr"] != tokens["Cong"]:
            raise ValueError(
                f"{solution['id']} violates the certified Estr/Cong target pairing"
            )
        return [
            _group("strategic-ecosystems", tokens["Estr"], "paired", strategic_rows),
            _group(
                "congriales",
                tokens["Cong"],
                "paired-with-strategic",
                _rows_named(rows, "congriales"),
            ),
            _group(
                "savannas", tokens["Sab"], "configured", _rows_named(rows, "savannas")
            ),
        ]

    raise ValueError(f"unsupported SIRAP target context: {region_id}")


def _group(
    group_id: str,
    target_percent: int,
    target_mode: str,
    rows: list[dict[str, str]],
) -> dict[str, Any]:
    if not rows:
        raise ValueError(f"certified summary lacks target rows for {group_id}")
    features = [_feature(row) for row in rows]
    expected_target = target_percent / 100
    for feature in features:
        if abs(feature["relativeTarget"] - expected_target) > 1e-9:
            raise ValueError(
                f"{feature['featureName']} target {feature['relativeTarget']} "
                f"does not match selected {group_id} target {expected_target}"
            )
    return {
        "id": group_id,
        "targetPercent": target_percent,
        "targetMode": target_mode,
        "evaluationSource": EVALUATION_SOURCE,
        "features": features,
    }


def _feature(row: dict[str, str]) -> dict[str, Any]:
    feature_name = _text(row.get("feature"))
    met = _boolean(row.get("met"))
    if not feature_name or met is None:
        raise ValueError("solver target row lacks feature or authoritative met status")
    return {
        "featureId": _normalize(feature_name).replace(" ", "-"),
        "featureName": feature_name,
        "featureType": "strategicEcosystems",
        "met": met,
        "totalAmount": _number(row, "total_amount"),
        "absoluteTarget": _number(row, "absolute_target"),
        "absoluteHeld": _number(row, "absolute_held"),
        "absoluteShortfall": _number(row, "absolute_shortfall"),
        "relativeTarget": _number(row, "relative_target"),
        "relativeHeld": _number(row, "relative_held"),
        "relativeShortfall": _number(row, "relative_shortfall"),
        "scenario": _text(row.get("scenario")),
        "evaluationSource": _text(row.get("evaluated")),
        "totalAmountKm2": _optional_number(row.get("total_amount_km2")),
        "absoluteHeldKm2": _optional_number(row.get("absolute_held_km2")),
    }


def _unique_features(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    for group in groups:
        for feature in group["features"]:
            if feature["featureId"] in by_id:
                raise ValueError(
                    f"target feature appears in multiple groups: {feature['featureId']}"
                )
            by_id[feature["featureId"]] = feature
    return list(by_id.values())


def _rows_named(rows: list[dict[str, str]], name: str) -> list[dict[str, str]]:
    return [row for row in rows if _normalize(row.get("feature")) == name]


def _read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    required = {
        "feature",
        "met",
        "total_amount",
        "absolute_target",
        "absolute_held",
        "absolute_shortfall",
        "relative_target",
        "relative_held",
        "relative_shortfall",
        "scenario",
        "evaluated",
        "feature_type",
    }
    if not rows or not required.issubset(rows[0]):
        missing = sorted(required.difference(rows[0] if rows else {}))
        raise ValueError(f"regional summary lacks required target columns: {missing}")
    return rows


def _local_path(url: str) -> Path:
    parsed = urlsplit(url)
    if parsed.scheme != "file":
        raise ValueError(
            f"release build requires a local pinned summary URL, got {url}"
        )
    return Path(unquote(parsed.path))


def _scenario_name(solution: dict[str, Any]) -> str:
    name = _text(solution.get("name"))
    if name:
        return name
    raster_file = _text(solution.get("rasterFile"))
    if raster_file:
        return Path(raster_file).stem
    raise ValueError(f"{solution.get('id', 'SIRAP solution')} lacks a scenario name")


def _normalize(value: object) -> str:
    normalized = unicodedata.normalize("NFKD", _text(value))
    return " ".join(
        "".join(
            character
            for character in normalized
            if not unicodedata.combining(character)
        )
        .replace("_", " ")
        .lower()
        .split()
    )


def _text(value: object) -> str:
    return str(value or "").strip()


def _number(row: dict[str, str], key: str) -> float:
    value = _optional_number(row.get(key))
    if value is None:
        raise ValueError(f"solver target row lacks numeric {key}")
    return value


def _optional_number(value: object) -> float | None:
    try:
        parsed = float(str(value))
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _boolean(value: object) -> bool | None:
    normalized = _text(value).lower()
    if normalized in {"true", "1"}:
        return True
    if normalized in {"false", "0"}:
        return False
    return None
