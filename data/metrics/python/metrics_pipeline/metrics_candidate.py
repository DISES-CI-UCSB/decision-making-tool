"""Quarantined, atomically written metric candidates.

Candidates preserve expensive assembled documents before final validation. They
are deliberately stored outside ``cache/`` and are never publishable artifacts.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from path_contracts import safe_solution_id

CANDIDATE_FORMAT = "metrics-candidate-v1"
CANDIDATE_SUFFIX = ".metrics.candidate.json"
VALIDATION_CONTRACT_VERSION = "regular-metrics-validation-v1"


@dataclass(frozen=True)
class CandidateBinding:
    release_id: str | None
    catalog_binding: dict[str, Any] | None
    solution_id: str
    solution_domain: str
    raster_basename: str
    raster_sha256: str
    solution_input_signature: dict[str, str] | None
    metrics_schema_version: int
    catalog_signature: str
    species_target_policy: dict[str, Any] | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "releaseId": self.release_id,
            "catalogBinding": self.catalog_binding,
            "solution": {
                "id": safe_solution_id(self.solution_id),
                "domain": self.solution_domain,
                "raster": {
                    "basename": self.raster_basename,
                    "sha256": self.raster_sha256,
                },
            },
            "solutionInputSignature": self.solution_input_signature,
            "metricsContract": {
                "schemaVersion": self.metrics_schema_version,
                "catalogSignature": self.catalog_signature,
                "speciesTargetPolicy": self.species_target_policy,
            },
            "validationContractVersion": VALIDATION_CONTRACT_VERSION,
        }


@dataclass(frozen=True)
class VerifiedCandidate:
    path: Path
    envelope: dict[str, Any]
    payload: dict[str, Any]


def candidate_path(output_dir: Path, solution_id: str) -> Path:
    return (
        output_dir / "quarantine" / f"{safe_solution_id(solution_id)}{CANDIDATE_SUFFIX}"
    )


def canonical_payload_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def payload_sha256(payload: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_payload_bytes(payload)).hexdigest()


def build_candidate_envelope(
    payload: dict[str, Any],
    binding: CandidateBinding,
    *,
    validation_state: str,
    validation_issues: list[str],
) -> dict[str, Any]:
    complete = validation_state == "passed"
    return {
        "format": CANDIDATE_FORMAT,
        "publishable": False,
        "complete": complete,
        "payloadSha256": payload_sha256(payload),
        **binding.to_dict(),
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "validation": {
            "state": validation_state,
            "issues": list(validation_issues),
        },
        "payload": payload,
    }


def write_metrics_candidate(
    output_dir: Path,
    binding: CandidateBinding,
    payload: dict[str, Any],
    *,
    validation_state: str = "pending",
    validation_issues: list[str] | None = None,
) -> Path:
    if validation_state not in {"pending", "failed", "passed"}:
        raise ValueError(f"invalid candidate validation state {validation_state!r}")
    issues = list(validation_issues or [])
    if validation_state == "pending" and issues:
        raise ValueError("pending candidates cannot contain validation issues")
    if validation_state == "passed" and issues:
        raise ValueError("passed candidates cannot contain validation issues")

    target = candidate_path(output_dir, binding.solution_id)
    envelope = build_candidate_envelope(
        payload,
        binding,
        validation_state=validation_state,
        validation_issues=issues,
    )
    with _candidate_lock(target):
        _archive_incompatible_candidate(target, binding)
        _write_json_atomic(target, envelope)
    return target


def read_verified_candidate(
    output_dir: Path,
    binding: CandidateBinding,
) -> tuple[VerifiedCandidate | None, list[str]]:
    target = candidate_path(output_dir, binding.solution_id)
    if not target.is_file() or target.is_symlink():
        return None, []

    try:
        with _candidate_lock(target):
            raw = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return None, [f"candidate is unreadable: {exc}"]
    if not isinstance(raw, dict):
        return None, ["candidate envelope is not an object"]

    issues: list[str] = []
    if raw.get("format") != CANDIDATE_FORMAT:
        issues.append("candidate format mismatch")
    if raw.get("publishable") is not False:
        issues.append("candidate publishable flag must be false")
    if raw.get("validationContractVersion") != VALIDATION_CONTRACT_VERSION:
        issues.append("candidate validation contract mismatch")
    for key, expected in binding.to_dict().items():
        if raw.get(key) != expected:
            issues.append(f"candidate {key} binding mismatch")

    validation = raw.get("validation")
    if not isinstance(validation, dict):
        issues.append("candidate validation state is invalid")
    else:
        state = validation.get("state")
        validation_issues = validation.get("issues")
        if state not in {"pending", "failed", "passed"}:
            issues.append("candidate validation state is invalid")
        if not isinstance(validation_issues, list) or not all(
            isinstance(issue, str) for issue in validation_issues
        ):
            issues.append("candidate validation issues are invalid")
        if raw.get("complete") is not (state == "passed"):
            issues.append("candidate complete flag disagrees with validation state")

    payload = raw.get("payload")
    if not isinstance(payload, dict):
        issues.append("candidate payload is not an object")
    else:
        if raw.get("payloadSha256") != payload_sha256(payload):
            issues.append("candidate payload checksum mismatch")
        issues.extend(_payload_binding_issues(payload, binding))
    if issues:
        return None, issues
    return VerifiedCandidate(target, raw, payload), []


def promote_metrics_candidate(
    output_dir: Path,
    binding: CandidateBinding,
    payload: dict[str, Any],
    final_path: Path,
    *,
    final_already_written: bool = False,
) -> None:
    """Atomically write a validated final artifact, then remove only its candidate."""

    target = candidate_path(output_dir, binding.solution_id)
    expected_payload_sha256 = payload_sha256(payload)
    with _candidate_lock(target):
        if final_path.exists():
            try:
                final_payload = json.loads(final_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise ValueError("promoted metrics artifact is unreadable") from exc
            if (
                not isinstance(final_payload, dict)
                or payload_sha256(final_payload) != expected_payload_sha256
            ):
                raise FileExistsError(
                    "canonical metrics artifact differs from candidate; refusing overwrite"
                )
        elif final_already_written:
            raise ValueError("promoted metrics artifact is missing")
        else:
            _write_json_atomic(final_path, payload)
        try:
            current = json.loads(target.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if (
            isinstance(current, dict)
            and current.get("payloadSha256") == expected_payload_sha256
            and current.get("solution") == binding.to_dict()["solution"]
        ):
            target.unlink(missing_ok=True)
            _fsync_directory(target.parent)


@contextmanager
def _candidate_lock(target: Path) -> Iterator[None]:
    lock_path = target.with_suffix(target.suffix + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+b") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _payload_binding_issues(
    payload: dict[str, Any],
    binding: CandidateBinding,
) -> list[str]:
    issues: list[str] = []
    if payload.get("solutionId") != binding.solution_id:
        issues.append("candidate payload solution id mismatch")
    if payload.get("solutionRaster") != {
        "solutionBasename": binding.raster_basename,
        "sha256": binding.raster_sha256,
    }:
        issues.append("candidate payload raster binding mismatch")
    if payload.get("solutionInputSignature") != binding.solution_input_signature:
        issues.append("candidate payload input signature mismatch")
    if payload.get("solutionCatalogBinding") != binding.catalog_binding:
        issues.append("candidate payload catalog binding mismatch")

    provenance = payload.get("metricsProvenance")
    if not isinstance(provenance, dict):
        issues.append("candidate payload metrics provenance is invalid")
        return issues
    expected_provenance = {
        "schemaVersion": binding.metrics_schema_version,
        "solutionDomain": binding.solution_domain,
        "catalogSignature": binding.catalog_signature,
        "releaseId": binding.release_id,
        "speciesTargetPolicy": binding.species_target_policy,
    }
    for key, expected in expected_provenance.items():
        if provenance.get(key) != expected:
            issues.append(f"candidate payload metrics provenance {key} mismatch")
    return issues


def _archive_incompatible_candidate(
    target: Path,
    binding: CandidateBinding,
) -> None:
    if not target.is_file() or target.is_symlink():
        return
    try:
        current = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        current = None
    binding_matches = isinstance(current, dict) and all(
        current.get(key) == expected for key, expected in binding.to_dict().items()
    )
    payload = current.get("payload") if isinstance(current, dict) else None
    checksum_matches = isinstance(payload, dict) and current.get(
        "payloadSha256"
    ) == payload_sha256(payload)
    if binding_matches and checksum_matches:
        return

    archive_dir = target.parent / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    archive = archive_dir / (
        f"{safe_solution_id(binding.solution_id)}.{uuid.uuid4().hex}{CANDIDATE_SUFFIX}"
    )
    target.replace(archive)
    _fsync_directory(archive_dir)
    _fsync_directory(target.parent)


def _write_json_atomic(target: Path, document: dict[str, Any]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(document, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(target)
        _fsync_directory(target.parent)
    finally:
        temporary.unlink(missing_ok=True)


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
