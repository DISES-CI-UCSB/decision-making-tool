from __future__ import annotations

import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

MESA_V3_ECOSYSTEM_TARGET_COUNT = 417
MESA_V3_GOLDEN_SPECIES_TARGET_COUNT = 7_980


class CoverageTargetValidationError(ValueError):
    pass


@dataclass(frozen=True)
class ValidatedCoverageTarget:
    feature: str
    feature_type: str
    feature_class: str | None
    relative_target: float
    evaluated: str | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "feature": self.feature,
            "feature_type": self.feature_type,
            "class": self.feature_class,
            "relative_target": self.relative_target,
            "evaluated": self.evaluated,
        }


def normalize_feature_name(value: str) -> str:
    """Match Mesa coverage names across case, underscores, and whitespace."""

    return re.sub(r"\s+", " ", value.replace("_", " ").strip().casefold())


def validate_coverage_targets(
    rows: Any,
    *,
    solution_id: str,
    expected_ecosystem_count: int | None = None,
    expected_species_count: int | None = None,
) -> tuple[ValidatedCoverageTarget, ...]:
    """Validate one solution's canonical target rows.

    ``relative_target`` is a proportion consumed directly by Mesa coverage
    calculations, so its scientifically valid range is [0, 1]. Zero is valid
    for goals with no required representation.
    """

    if not isinstance(rows, Sequence) or isinstance(rows, (str, bytes, bytearray)):
        raise CoverageTargetValidationError(
            f"{solution_id} coverage targets must be a list."
        )

    validated: list[ValidatedCoverageTarget] = []
    normalized_features: set[str] = set()
    counts = {"ecosystem": 0, "species": 0}
    for index, raw in enumerate(rows):
        if not isinstance(raw, Mapping):
            raise CoverageTargetValidationError(
                f"{solution_id} coverage target {index} must be an object."
            )

        feature = raw.get("feature")
        if not isinstance(feature, str):
            raise CoverageTargetValidationError(
                f"{solution_id} coverage target {index} feature must be a string."
            )
        normalized_feature = normalize_feature_name(feature)
        if not normalized_feature:
            raise CoverageTargetValidationError(
                f"{solution_id} coverage target {index} feature is blank."
            )
        if normalized_feature in normalized_features:
            raise CoverageTargetValidationError(
                f"{solution_id} has duplicate normalized feature {normalized_feature!r}."
            )
        normalized_features.add(normalized_feature)

        raw_feature_type = raw.get("feature_type")
        if not isinstance(raw_feature_type, str):
            raise CoverageTargetValidationError(
                f"{solution_id} coverage target {index} feature_type must be a string."
            )
        feature_type = raw_feature_type.strip().lower()
        if feature_type not in counts:
            raise CoverageTargetValidationError(
                f"{solution_id} coverage target {index} has invalid feature_type."
            )

        raw_target = raw.get("relative_target")
        if isinstance(raw_target, bool) or not isinstance(raw_target, (int, float)):
            raise CoverageTargetValidationError(
                f"{solution_id} coverage target {index} relative_target must be numeric."
            )
        relative_target = float(raw_target)
        if not math.isfinite(relative_target) or not 0.0 <= relative_target <= 1.0:
            raise CoverageTargetValidationError(
                f"{solution_id} coverage target {index} relative_target "
                "must be finite and between 0 and 1 inclusive."
            )

        feature_class = _nullable_string(raw.get("class"), "class", solution_id, index)
        evaluated = _nullable_string(
            raw.get("evaluated"), "evaluated", solution_id, index
        )
        validated.append(
            ValidatedCoverageTarget(
                feature=feature.strip(),
                feature_type=feature_type,
                feature_class=feature_class,
                relative_target=relative_target,
                evaluated=evaluated,
            )
        )
        counts[feature_type] += 1

    if (
        expected_ecosystem_count is not None
        and counts["ecosystem"] != expected_ecosystem_count
    ):
        raise CoverageTargetValidationError(
            f"{solution_id} must contain exactly "
            f"{expected_ecosystem_count} ecosystem targets."
        )
    if (
        expected_species_count is not None
        and counts["species"] != expected_species_count
    ):
        raise CoverageTargetValidationError(
            f"{solution_id} must contain exactly {expected_species_count} species targets."
        )
    return tuple(validated)


def _nullable_string(
    value: Any,
    field: str,
    solution_id: str,
    index: int,
) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise CoverageTargetValidationError(
            f"{solution_id} coverage target {index} {field} must be a string or null."
        )
    return value.strip()
