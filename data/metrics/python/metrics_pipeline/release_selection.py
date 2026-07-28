"""Fail-closed solution selection and reconciliation for partitioned releases."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

RELEASE_PARTITION_FORMAT = "metric-release-partition-v1"
RELEASE_SELECTION_FORMAT = "metric-release-selection-v1"
RELEASE_RECONCILIATION_FORMAT = "metric-release-reconciliation-v1"


class ReleaseSelectionError(ValueError):
    """Raised when a release selection or partition report is inconsistent."""


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _require_string_list(value: Any, *, label: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not value:
        raise ReleaseSelectionError(f"{label} must be a non-empty JSON array.")
    if any(not isinstance(item, str) or not item.strip() for item in value):
        raise ReleaseSelectionError(f"{label} must contain non-empty strings.")
    result = tuple(item.strip() for item in value)
    if len(set(result)) != len(result):
        raise ReleaseSelectionError(f"{label} contains duplicate solution ids.")
    return result


def canonical_solution_ids(
    solution_ids: Iterable[str],
    *,
    label: str = "solution ids",
) -> tuple[str, ...]:
    """Return the authoritative lexical ID order, rejecting invalid catalogs."""

    values = tuple(solution_ids)
    if any(not isinstance(item, str) or not item.strip() for item in values):
        raise ReleaseSelectionError(f"{label} must contain non-empty strings.")
    normalized = tuple(item.strip() for item in values)
    if len(set(normalized)) != len(normalized):
        raise ReleaseSelectionError(f"{label} contains duplicate solution ids.")
    return tuple(sorted(normalized))


def _validate_partition_coordinates(
    partition_index: Any,
    partition_count: Any,
) -> tuple[int, int]:
    if (
        isinstance(partition_index, bool)
        or not isinstance(partition_index, int)
        or isinstance(partition_count, bool)
        or not isinstance(partition_count, int)
        or partition_count < 2
        or not 0 <= partition_index < partition_count
    ):
        raise ReleaseSelectionError(
            "partitionIndex/partitionCount must identify one of at least two partitions."
        )
    return partition_index, partition_count


def _partition_payload(
    *,
    release_id: str,
    partition_index: int,
    partition_count: int,
    expected_artifact_count: int,
    solution_ids: Iterable[str],
) -> dict[str, Any]:
    return {
        "format": RELEASE_PARTITION_FORMAT,
        "releaseId": release_id,
        "partitionIndex": partition_index,
        "partitionCount": partition_count,
        "expectedArtifactCount": expected_artifact_count,
        "solutionIds": list(solution_ids),
    }


def build_release_partition_descriptor(
    *,
    release_id: str,
    land_solution_ids: Iterable[str],
    partition_index: int,
    partition_count: int,
    artifact_levels: Iterable[str],
) -> dict[str, Any]:
    """Build one deterministic descriptor from lexically sorted land IDs."""

    partition_index, partition_count = _validate_partition_coordinates(
        partition_index,
        partition_count,
    )
    canonical_ids = canonical_solution_ids(
        land_solution_ids,
        label="land solution ids",
    )
    selected_ids = canonical_ids[partition_index::partition_count]
    return _partition_payload(
        release_id=release_id,
        partition_index=partition_index,
        partition_count=partition_count,
        expected_artifact_count=len(selected_ids) * len(tuple(artifact_levels)),
        solution_ids=selected_ids,
    )


@dataclass(frozen=True)
class ReleaseSelection:
    release_id: str
    solution_ids: tuple[str, ...]
    expected_artifact_count: int
    partition_index: int | None = None
    partition_count: int | None = None
    descriptor_sha256: str | None = None

    @property
    def is_partition(self) -> bool:
        return self.partition_index is not None

    def to_report(self) -> dict[str, Any]:
        return {
            "format": RELEASE_SELECTION_FORMAT,
            "mode": "partition" if self.is_partition else "full",
            "releaseId": self.release_id,
            "partitionIndex": self.partition_index,
            "partitionCount": self.partition_count,
            "descriptorSha256": self.descriptor_sha256,
            "expectedSolutionCount": len(self.solution_ids),
            "expectedArtifactCount": self.expected_artifact_count,
            "solutionIds": list(self.solution_ids),
        }


def full_release_selection(
    *,
    release_id: str,
    land_solution_ids: Iterable[str],
    expected_solution_count: int,
    artifact_levels: Iterable[str],
) -> ReleaseSelection:
    solution_ids = canonical_solution_ids(
        land_solution_ids,
        label="land solution ids",
    )
    if len(solution_ids) != expected_solution_count:
        raise ReleaseSelectionError(
            f"full release requires exactly {expected_solution_count} land solutions; "
            f"got {len(solution_ids)}"
        )
    levels = tuple(artifact_levels)
    return ReleaseSelection(
        release_id=release_id,
        solution_ids=solution_ids,
        expected_artifact_count=len(solution_ids) * len(levels),
    )


def load_release_partition(
    path: Path,
    *,
    release_id: str,
    known_solution_ids: Iterable[str],
    land_solution_ids: Iterable[str],
    artifact_levels: Iterable[str],
) -> ReleaseSelection:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ReleaseSelectionError(
            f"could not read release partition descriptor {path}: {exc}"
        ) from exc
    if not isinstance(raw, dict):
        raise ReleaseSelectionError("release partition descriptor must be a JSON object.")
    if raw.get("format") != RELEASE_PARTITION_FORMAT:
        raise ReleaseSelectionError(
            f"release partition format must be {RELEASE_PARTITION_FORMAT!r}."
        )
    if raw.get("releaseId") != release_id:
        raise ReleaseSelectionError(
            "release partition releaseId must exactly match --release-id."
        )

    partition_index = raw.get("partitionIndex")
    partition_count = raw.get("partitionCount")
    expected_artifact_count = raw.get("expectedArtifactCount")
    partition_index, partition_count = _validate_partition_coordinates(
        partition_index,
        partition_count,
    )
    if (
        isinstance(expected_artifact_count, bool)
        or not isinstance(expected_artifact_count, int)
        or expected_artifact_count <= 0
    ):
        raise ReleaseSelectionError("expectedArtifactCount must be a positive integer.")

    solution_ids = _require_string_list(raw.get("solutionIds"), label="solutionIds")
    known_ids = set(known_solution_ids)
    canonical_land_ids = canonical_solution_ids(
        land_solution_ids,
        label="land solution ids",
    )
    land_ids = set(canonical_land_ids)
    unknown = set(solution_ids) - known_ids
    non_land = set(solution_ids) - land_ids - unknown
    if unknown:
        raise ReleaseSelectionError(
            f"release partition contains unknown solution ids: {sorted(unknown)}"
        )
    if non_land:
        raise ReleaseSelectionError(
            f"release partition contains non-land solution ids: {sorted(non_land)}"
        )

    expected_partition_ids = canonical_land_ids[partition_index::partition_count]
    if solution_ids != expected_partition_ids:
        raise ReleaseSelectionError(
            "release partition solutionIds must exactly equal the deterministic "
            "lexically sorted partition selected by partitionIndex/partitionCount."
        )
    levels = tuple(artifact_levels)
    calculated_count = len(solution_ids) * len(levels)
    if expected_artifact_count != calculated_count:
        raise ReleaseSelectionError(
            "release partition expectedArtifactCount must equal solutionIds × "
            f"geography levels ({calculated_count}); got {expected_artifact_count}"
        )

    descriptor_payload = _partition_payload(
        release_id=release_id,
        partition_index=partition_index,
        partition_count=partition_count,
        expected_artifact_count=expected_artifact_count,
        solution_ids=solution_ids,
    )
    return ReleaseSelection(
        release_id=release_id,
        solution_ids=solution_ids,
        expected_artifact_count=expected_artifact_count,
        partition_index=partition_index,
        partition_count=partition_count,
        descriptor_sha256=_canonical_sha256(descriptor_payload),
    )


def validate_release_entries(
    entries: Iterable[dict[str, Any]],
    *,
    selection: ReleaseSelection,
    artifact_levels: Iterable[str],
) -> None:
    observed = [
        (str(entry.get("solutionId")), str(entry.get("geographyLevel")))
        for entry in entries
    ]
    expected = {
        (solution_id, level)
        for solution_id in selection.solution_ids
        for level in artifact_levels
    }
    if len(observed) != len(set(observed)):
        raise ReleaseSelectionError("release output contains duplicate artifacts.")
    observed_set = set(observed)
    if observed_set != expected:
        missing = sorted(expected - observed_set)
        unexpected = sorted(observed_set - expected)
        raise ReleaseSelectionError(
            "release output does not exactly match its declared selection; "
            f"missing={missing[:8]}, unexpected={unexpected[:8]}"
        )
    if len(observed) != selection.expected_artifact_count:
        raise ReleaseSelectionError(
            f"release output expected {selection.expected_artifact_count} artifacts; "
            f"got {len(observed)}"
        )


def reconcile_release_reports(
    reports: Iterable[dict[str, Any]],
    *,
    release_id: str,
    land_solution_ids: Iterable[str],
    artifact_levels: Iterable[str],
    expected_solution_count: int,
    expected_blob_directory: str | None = None,
) -> dict[str, Any]:
    reports = list(reports)
    if not reports:
        raise ReleaseSelectionError("at least one partition report is required.")
    land_ids = canonical_solution_ids(
        land_solution_ids,
        label="land solution ids",
    )
    levels = tuple(artifact_levels)
    selections: list[ReleaseSelection] = []
    all_entries: list[dict[str, Any]] = []

    for report in reports:
        raw = report.get("releaseSelection")
        if not isinstance(raw, dict) or raw.get("mode") != "partition":
            raise ReleaseSelectionError(
                "every reconciliation input must be a partition release report."
            )
        solution_ids = _require_string_list(
            raw.get("solutionIds"), label="releaseSelection.solutionIds"
        )
        selection = ReleaseSelection(
            release_id=str(raw.get("releaseId") or ""),
            solution_ids=solution_ids,
            expected_artifact_count=raw.get("expectedArtifactCount"),
            partition_index=raw.get("partitionIndex"),
            partition_count=raw.get("partitionCount"),
            descriptor_sha256=raw.get("descriptorSha256"),
        )
        if selection.release_id != release_id:
            raise ReleaseSelectionError("partition report releaseId mismatch.")
        if (
            isinstance(selection.partition_index, bool)
            or not isinstance(selection.partition_index, int)
            or isinstance(selection.partition_count, bool)
            or not isinstance(selection.partition_count, int)
            or selection.partition_count < 2
            or not 0 <= selection.partition_index < selection.partition_count
            or isinstance(selection.expected_artifact_count, bool)
            or not isinstance(selection.expected_artifact_count, int)
            or selection.expected_artifact_count <= 0
        ):
            raise ReleaseSelectionError("partition report selection metadata is invalid.")
        expected_descriptor_sha256 = _canonical_sha256(
            _partition_payload(
                release_id=selection.release_id,
                partition_index=selection.partition_index,
                partition_count=selection.partition_count,
                expected_artifact_count=selection.expected_artifact_count,
                solution_ids=selection.solution_ids,
            )
        )
        if selection.descriptor_sha256 != expected_descriptor_sha256:
            raise ReleaseSelectionError(
                "partition report descriptorSha256 does not match its selection."
            )
        if report.get("failures"):
            raise ReleaseSelectionError("partition report contains failures.")
        entries = report.get("entries")
        if not isinstance(entries, list):
            raise ReleaseSelectionError("partition report entries must be a list.")
        if expected_blob_directory is not None:
            directory = expected_blob_directory.strip("/")
            if report.get("blobDirectory") != directory:
                raise ReleaseSelectionError(
                    "partition report blobDirectory does not match the release prefix."
                )
            for entry in entries:
                blob_path = str(entry.get("expectedBlobPath") or "")
                public_url = str(entry.get("expectedPublicUrl") or "")
                if not blob_path.startswith(f"{directory}/"):
                    raise ReleaseSelectionError(
                        "partition artifact expectedBlobPath is outside the release prefix."
                    )
                if not public_url.endswith(f"/{blob_path}"):
                    raise ReleaseSelectionError(
                        "partition artifact expectedPublicUrl does not match expectedBlobPath."
                    )
        validate_release_entries(entries, selection=selection, artifact_levels=levels)
        selections.append(selection)
        all_entries.extend(entries)

    partition_counts = {selection.partition_count for selection in selections}
    if len(partition_counts) != 1:
        raise ReleaseSelectionError("partition reports disagree on partitionCount.")
    partition_count = partition_counts.pop()
    if not isinstance(partition_count, int) or partition_count != len(selections):
        raise ReleaseSelectionError(
            "partition report count must exactly equal declared partitionCount."
        )
    indexes = [selection.partition_index for selection in selections]
    if set(indexes) != set(range(partition_count)):
        raise ReleaseSelectionError(
            "partition indexes must be unique and cover 0..partitionCount-1."
        )
    selected_ids = [
        solution_id
        for selection in selections
        for solution_id in selection.solution_ids
    ]
    if len(selected_ids) != len(set(selected_ids)):
        raise ReleaseSelectionError("partition solution sets overlap.")
    if set(selected_ids) != set(land_ids):
        missing = sorted(set(land_ids) - set(selected_ids))
        unexpected = sorted(set(selected_ids) - set(land_ids))
        raise ReleaseSelectionError(
            "partition solution union does not equal the full land release; "
            f"missing={missing[:8]}, unexpected={unexpected[:8]}"
        )
    for selection in selections:
        assert selection.partition_index is not None
        expected_ids = land_ids[selection.partition_index::partition_count]
        if selection.solution_ids != expected_ids:
            raise ReleaseSelectionError(
                "partition report solutionIds do not match the canonical "
                "lexically sorted partition."
            )

    full_selection = full_release_selection(
        release_id=release_id,
        land_solution_ids=land_ids,
        expected_solution_count=expected_solution_count,
        artifact_levels=levels,
    )
    validate_release_entries(
        all_entries,
        selection=full_selection,
        artifact_levels=levels,
    )
    return {
        "format": RELEASE_RECONCILIATION_FORMAT,
        "releaseId": release_id,
        "partitionCount": partition_count,
        "solutionCount": len(land_ids),
        "artifactCount": len(all_entries),
        "descriptorSha256": sorted(
            selection.descriptor_sha256 for selection in selections
        ),
        "ok": True,
    }
