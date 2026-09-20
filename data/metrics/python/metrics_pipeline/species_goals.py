"""Versioned per-species coverage catalog and compact sidecar pipeline.

The shared catalog contains immutable species identity/taxonomy. One compact
sidecar is written per solution and geography level. National rows are dense;
sub-national rows are sparse and omit the unambiguous ``no range in scope``
state. Writes are atomic and completed sidecars are safe to resume only when
their full provenance still matches.

Coverage percents and configured-target ``met`` flags use Mesa / Prioritizr
planning-unit cell counts (calculator A): held/total inside the valid template
mask. National compact km² columns are the catalog range scaled by that same
cell fraction. SIRAP compact km² columns use regional grid-cell area so
``rangeAreaKm2`` stays the range inside the SIRAP; the catalog
``nationalRangeKm2`` remains Colombia-wide. Exactextract source-cell-union
area is not used for coverage or met.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import sqlite3
import tempfile
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import numpy as np
from mesa_coverage import mesa_coverage_row
from species_data import SpeciesRecord
from species_target_policy import SpeciesTargetPolicy

CATALOG_FORMAT = "species-goals-catalog-v1"
COMPACT_FORMAT = "species-goals-compact-v1"
COMPLETION_FORMAT = "species-goals-completion-v1"
SPECIES_GOALS_COVERAGE_ALGORITHM_VERSION = "mesa-smsp-cell-count-v1"
# Scope is the Mesa terrestrial template valid mask (planning-unit cells),
# never solution_data_valid_mask. September GeoTIFFs store unselected PUs as
# nodata, so that mask equals selected_mask and collapses every ratio to 1.0.
# scopeMask is hashed into exactOverlapPolicySha256 so tautological sidecars
# stamped mesa-smsp-cell-count-v1 cannot resume.
SPECIES_GOALS_SCOPE_MASK = "terrestrial-template-valid"
SPECIES_GOALS_COVERAGE_POLICY = {
    "kernel": "mesa_coverage_row",
    "cellSource": "smsp-v1",
    "denominator": "valid-template-mask-cell-count",
    "scopeMask": SPECIES_GOALS_SCOPE_MASK,
    "areaScale": "catalog-range-km2-times-held-over-total",
}
SIRAP_SPECIES_GOALS_COVERAGE_POLICY = {
    **SPECIES_GOALS_COVERAGE_POLICY,
    "scopeMask": "regional-packet-grid",
    "areaScale": "regional-grid-cell-area-km2",
    "nationalRange": "catalog-nationalRangeKm2",
}
DEFAULT_TERRESTRIAL_TEMPLATE_PATH = (
    Path(__file__).resolve().parents[4]
    / "data/metrics/cache/mesa-v3/parity-inputs/template_terrestre.tif"
)
CATALOG_DIRECTORY = Path("species-goals/catalog/v1")
COMPACT_DIRECTORY = Path("species-goals/compact/v1")
CATALOG_ROW_LAYOUT = (
    "speciesId",
    "scientificName",
    "group",
    "iucnStatus",
    "nationalRangeKm2",
    "availability",
)
COMPACT_ROW_LAYOUT = (
    "scopeIndex",
    "speciesIndex",
    "rangeAreaKm2",
    "solutionCoveredAreaKm2",
    "preExistingCoveredAreaKm2",
    "newPrioritizrCoveredAreaKm2",
    "configuredTargetPercent",
    "flags",
)

FLAG_UNAVAILABLE = 1
FLAG_NO_RANGE = 2
FLAG_TARGET_CONFIGURED = 4
FLAG_MET_17 = 8
FLAG_MET_30 = 16
FLAG_CONFIGURED_TARGET_MET = 32
# Same fail-closed rule as SIRAP packets: clipping range to selected-only
# solution rasters (unselected PUs stored as nodata) makes every species 100%.
_SPECIES_GOALS_TAUTOLOGY_MIN_RANGED = 50
# Compact km² columns independently round(catalog_range * held/total, 6).
# Configured ``met`` follows Mesa cell counts, so selected can sit one
# millionth of a km² off the km²-implied target line after both roundings.
_KM2_ROUNDING_ABS = 1e-6

GeographyLevel = Literal[
    "national", "departments", "municipalities", "siraps", "runaps", "omecs"
]
GEOGRAPHY_LEVELS: tuple[GeographyLevel, ...] = (
    "national",
    "departments",
    "municipalities",
    "siraps",
    "runaps",
    "omecs",
)
PROVENANCE_KEYS = {
    "releaseId",
    "speciesCsvSha256",
    "exceptionSourceSha256",
    "exceptionPolicySha256",
    "exceptionBindingSha256",
    "exactOverlapAlgorithmVersion",
    "exactOverlapPolicySha256",
    "targetGridSha256",
    "speciesAlignmentInventorySha256",
    "solutionRasterSha256",
    "targetPolicySha256",
    "boundaryProvenanceSha256",
    "catalogSha256",
}


class SpeciesGoalsContractError(ValueError):
    """Raised when a species goals artifact violates its contract."""


class ProvenanceMismatchError(SpeciesGoalsContractError):
    """Raised when resume evidence belongs to different inputs."""


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    ).hexdigest()


def species_id(record: SpeciesRecord) -> str:
    return record.filename_stem.lower()


def catalog_path(output_root: Path) -> Path:
    return output_root / CATALOG_DIRECTORY / "catalog.json"


def compact_partition_path(
    output_root: Path, solution_id: str, geography_level: str
) -> Path:
    if geography_level not in GEOGRAPHY_LEVELS:
        raise SpeciesGoalsContractError(f"unsupported geography {geography_level!r}")
    return (
        output_root
        / COMPACT_DIRECTORY
        / solution_id
        / f"{geography_level}.species-goals.compact.json"
    )


def build_catalog(
    records: list[SpeciesRecord],
    *,
    unavailable_species_ids: set[str] | None = None,
    provenance: dict[str, Any],
    generated_at: str | None = None,
) -> dict[str, Any]:
    """Build the shared deterministic species catalog.

    ``unavailable_species_ids`` is explicit and fail-closed: every ID must bind
    to exactly one catalog row.
    """

    unavailable = unavailable_species_ids or set()
    rows: list[list[Any]] = []
    seen: set[str] = set()
    for record in sorted(records, key=lambda item: species_id(item)):
        identifier = species_id(record)
        if identifier in seen:
            raise SpeciesGoalsContractError(f"duplicate speciesId {identifier!r}")
        seen.add(identifier)
        rows.append(
            [
                identifier,
                record.scientific_name,
                record.bucket,
                record.iucn_status or None,
                record.range_km2,
                "unavailable" if identifier in unavailable else "available",
            ]
        )
    unknown = unavailable - seen
    if unknown:
        raise SpeciesGoalsContractError(
            f"unavailable species do not bind to catalog: {sorted(unknown)[:8]}"
        )
    _validate_catalog_provenance(provenance)
    catalog_sha256 = canonical_sha256(
        {
            "provenance": provenance,
            "rowLayout": list(CATALOG_ROW_LAYOUT),
            "rows": rows,
        }
    )
    document = {
        "format": CATALOG_FORMAT,
        "generatedAt": generated_at or datetime.now(timezone.utc).isoformat(),
        "catalogSha256": catalog_sha256,
        "provenance": provenance,
        "rowLayout": list(CATALOG_ROW_LAYOUT),
        "rows": rows,
    }
    validate_catalog(document)
    return document


def validate_catalog(document: Any) -> dict[str, Any]:
    if not isinstance(document, dict) or document.get("format") != CATALOG_FORMAT:
        raise SpeciesGoalsContractError("unsupported species goals catalog format")
    if set(document) != {
        "format",
        "generatedAt",
        "catalogSha256",
        "provenance",
        "rowLayout",
        "rows",
    }:
        raise SpeciesGoalsContractError("catalog fields are invalid")
    if document.get("rowLayout") != list(CATALOG_ROW_LAYOUT):
        raise SpeciesGoalsContractError("catalog rowLayout is invalid")
    rows = document.get("rows")
    if not isinstance(rows, list) or not rows:
        raise SpeciesGoalsContractError("catalog rows must be non-empty")
    ids: set[str] = set()
    for index, row in enumerate(rows):
        if not isinstance(row, list) or len(row) != len(CATALOG_ROW_LAYOUT):
            raise SpeciesGoalsContractError(f"catalog row {index} is invalid")
        identifier, name, group, status, range_km2, availability = row
        if (
            not isinstance(identifier, str)
            or not identifier
            or identifier in ids
            or not isinstance(name, str)
            or not name
            or (group is not None and not isinstance(group, str))
            or (status is not None and not isinstance(status, str))
            or (
                range_km2 is not None
                and (
                    isinstance(range_km2, bool)
                    or not isinstance(range_km2, (int, float))
                    or not math.isfinite(range_km2)
                    or range_km2 < 0
                )
            )
            or availability not in {"available", "unavailable"}
        ):
            raise SpeciesGoalsContractError(f"catalog row {index} is invalid")
        ids.add(identifier)
    provenance = document.get("provenance")
    _validate_catalog_provenance(provenance)
    inventory = provenance["inventory"]
    observed_inventory = {
        "catalogTotal": len(rows),
        "unavailable": sum(row[5] == "unavailable" for row in rows),
        "zeroRange": sum(row[5] == "available" and row[4] == 0 for row in rows),
    }
    if inventory != observed_inventory:
        raise SpeciesGoalsContractError("catalog inventory does not match rows")
    expected = canonical_sha256(
        {
            "provenance": provenance,
            "rowLayout": document["rowLayout"],
            "rows": rows,
        }
    )
    if document.get("catalogSha256") != expected:
        raise SpeciesGoalsContractError("catalogSha256 does not match catalog rows")
    return document


def write_catalog(path: Path, document: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Atomically write the shared catalog or resume identical validated bytes."""

    validate_catalog(document)
    if path.exists():
        existing = validate_catalog(json.loads(path.read_text(encoding="utf-8")))
        completion_path = _completion_path(path)
        completion = (
            json.loads(completion_path.read_text(encoding="utf-8"))
            if completion_path.is_file()
            else None
        )
        if (
            _resume_content(existing) != _resume_content(document)
            or not isinstance(completion, dict)
            or completion.get("format") != "species-goals-catalog-completion-v1"
            or completion.get("catalogSha256") != existing["catalogSha256"]
            or completion.get("artifactSha256") != _file_sha256(path)
        ):
            raise ProvenanceMismatchError(
                f"{path} does not match the current species catalog"
            )
        return existing, True
    _atomic_json_write(path, document)
    _atomic_json_write(
        _completion_path(path),
        {
            "format": "species-goals-catalog-completion-v1",
            "status": "complete",
            "releaseId": document["provenance"]["releaseId"],
            "catalogSha256": document["catalogSha256"],
            "artifactSha256": _file_sha256(path),
        },
    )
    return document, False


class SpeciesGoalsPipeline:
    """Collect Mesa/SMSP cell-count observations and write resumable sidecars."""

    def __init__(
        self,
        catalog: dict[str, Any],
        *,
        solution_id: str,
        target_policy: SpeciesTargetPolicy,
        provenance: dict[str, Any],
        spool_dir: Path,
        active_levels: set[str] | None = None,
        primary_geography_level: GeographyLevel = "national",
    ) -> None:
        self.catalog = validate_catalog(catalog)
        self.solution_id = solution_id
        self.target_policy = target_policy
        self.provenance = validate_provenance(provenance, self.catalog)
        self.active_levels = (
            set(GEOGRAPHY_LEVELS) if active_levels is None else active_levels
        )
        if primary_geography_level not in GEOGRAPHY_LEVELS:
            raise SpeciesGoalsContractError(
                f"unsupported primary geography level {primary_geography_level!r}"
            )
        self.primary_geography_level = primary_geography_level
        self._index_by_name = {
            row[1]: index for index, row in enumerate(self.catalog["rows"])
        }
        spool_dir.mkdir(parents=True, exist_ok=True)
        self.spool_path = spool_dir / f"{solution_id}.species-goals.sqlite3"
        self.spool_path.unlink(missing_ok=True)
        self.spool_path.with_name(f"{self.spool_path.name}-wal").unlink(missing_ok=True)
        self.spool_path.with_name(f"{self.spool_path.name}-shm").unlink(missing_ok=True)
        self._connection = sqlite3.connect(self.spool_path)
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._connection.execute("PRAGMA synchronous=NORMAL")
        self._connection.execute(
            """
            CREATE TABLE observations (
                geography_level TEXT NOT NULL,
                scope_index INTEGER NOT NULL,
                species_index INTEGER NOT NULL,
                range_area_m2 REAL NOT NULL,
                selected_area_m2 REAL NOT NULL,
                pre_existing_area_m2 REAL NOT NULL,
                new_prioritizr_area_m2 REAL NOT NULL,
                configured_target_pct REAL,
                display_range_km2 REAL,
                PRIMARY KEY (geography_level, scope_index, species_index)
            ) WITHOUT ROWID
            """
        )
        self._writes_since_commit = 0
        self._closed = False

    def record_national(
        self,
        species: SpeciesRecord,
        selected_area_m2: float,
        total_area_m2: float,
        *,
        pre_existing_area_m2: float = 0.0,
        new_prioritizr_area_m2: float | None = None,
        display_range_km2: float | None = None,
    ) -> None:
        """Record national planning-unit cell counts for one species.

        Parameter names keep the historical ``*_m2`` suffix so callers and the
        SQLite spool stay compatible. Values are cell counts, not square metres.
        ``display_range_km2`` is the compact range column for SIRAP solutions
        (regional cell-area km²). National builds leave it unset and scale
        from the catalog range.
        """
        if self.primary_geography_level not in self.active_levels:
            return
        index = self._species_index(species)
        observation = self._observation(
            species,
            selected_area_m2,
            total_area_m2,
            pre_existing_area_m2,
            selected_area_m2
            if new_prioritizr_area_m2 is None
            else new_prioritizr_area_m2,
            display_range_km2=display_range_km2,
        )
        self._insert(self.primary_geography_level, 0, index, observation)

    def record_sub_level(
        self,
        species: SpeciesRecord,
        level: str,
        selected_per_boundary: np.ndarray,
        total_per_boundary: np.ndarray,
        *,
        pre_existing_per_boundary: np.ndarray | None = None,
        new_prioritizr_per_boundary: np.ndarray | None = None,
        display_range_km2_per_boundary: np.ndarray | None = None,
    ) -> None:
        if level not in self.active_levels:
            return
        if selected_per_boundary.shape != total_per_boundary.shape:
            raise SpeciesGoalsContractError("sub-national overlap arrays differ")
        pre_existing = (
            np.zeros_like(selected_per_boundary)
            if pre_existing_per_boundary is None
            else pre_existing_per_boundary
        )
        new_prioritizr = (
            selected_per_boundary
            if new_prioritizr_per_boundary is None
            else new_prioritizr_per_boundary
        )
        if (
            pre_existing.shape != total_per_boundary.shape
            or new_prioritizr.shape != total_per_boundary.shape
        ):
            raise SpeciesGoalsContractError("coverage component arrays differ")
        species_index = self._species_index(species)
        for scope_index in np.flatnonzero(total_per_boundary > 0).tolist():
            display_range = (
                None
                if display_range_km2_per_boundary is None
                else float(display_range_km2_per_boundary[scope_index])
            )
            observation = self._observation(
                species,
                float(selected_per_boundary[scope_index]),
                float(total_per_boundary[scope_index]),
                float(pre_existing[scope_index]),
                float(new_prioritizr[scope_index]),
                display_range_km2=display_range,
            )
            self._insert(level, scope_index, species_index, observation)

    def record_species_chunk(
        self,
        species_records: Sequence[SpeciesRecord],
        national_selected: np.ndarray,
        national_total: np.ndarray,
        national_pre_existing: np.ndarray,
        national_new_prioritizr: np.ndarray,
        boundary_channels: Mapping[
            str,
            tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray],
        ],
    ) -> None:
        """Insert one catalog-ordered species chunk in contiguous level batches."""

        count = len(species_records)
        national_arrays = (
            national_selected,
            national_total,
            national_pre_existing,
            national_new_prioritizr,
        )
        if any(array.shape != (count,) for array in national_arrays):
            raise SpeciesGoalsContractError("national chunk arrays differ")

        rows: list[tuple[Any, ...]] = []
        if self.primary_geography_level in self.active_levels:
            for row_index, species in enumerate(species_records):
                rows.append(
                    (
                        self.primary_geography_level,
                        0,
                        self._species_index(species),
                        *self._observation(
                            species,
                            float(national_selected[row_index]),
                            float(national_total[row_index]),
                            float(national_pre_existing[row_index]),
                            float(national_new_prioritizr[row_index]),
                        ),
                    )
                )
        for level, channels in boundary_channels.items():
            if level not in self.active_levels:
                continue
            selected, total, pre_existing, new_prioritizr = channels
            if (
                selected.ndim != 2
                or selected.shape[0] != count
                or any(array.shape != selected.shape for array in channels[1:])
            ):
                raise SpeciesGoalsContractError(
                    f"{level} buffered overlap arrays differ"
                )
            for row_index, species in enumerate(species_records):
                species_index = self._species_index(species)
                for scope_index in np.flatnonzero(total[row_index] > 0).tolist():
                    rows.append(
                        (
                            level,
                            scope_index,
                            species_index,
                            *self._observation(
                                species,
                                float(selected[row_index, scope_index]),
                                float(total[row_index, scope_index]),
                                float(pre_existing[row_index, scope_index]),
                                float(new_prioritizr[row_index, scope_index]),
                            ),
                        )
                    )
        if not rows:
            return

        self._connection.execute("SAVEPOINT buffered_species_chunk")
        try:
            self._connection.executemany(
                """
                INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(geography_level, scope_index, species_index)
                DO UPDATE SET
                    range_area_m2 = excluded.range_area_m2,
                    selected_area_m2 = excluded.selected_area_m2,
                    pre_existing_area_m2 = excluded.pre_existing_area_m2,
                    new_prioritizr_area_m2 = excluded.new_prioritizr_area_m2,
                    configured_target_pct = excluded.configured_target_pct,
                    display_range_km2 = excluded.display_range_km2
                """,
                rows,
            )
            self._connection.execute("RELEASE SAVEPOINT buffered_species_chunk")
        except Exception as exc:
            try:
                self._connection.execute("ROLLBACK TO SAVEPOINT buffered_species_chunk")
                self._connection.execute("RELEASE SAVEPOINT buffered_species_chunk")
            except Exception as rollback_exc:  # noqa: BLE001 - preserve insert failure
                exc.add_note(
                    "Buffered chunk rollback also failed: "
                    f"{type(rollback_exc).__name__}: {rollback_exc}"
                )
            raise
        self._writes_since_commit += len(rows)
        if self._writes_since_commit >= 2_000:
            self._connection.commit()
            self._writes_since_commit = 0

    def write_partition(
        self,
        path: Path,
        *,
        geography_level: GeographyLevel,
        scope_catalog: list[list[str]],
        generated_at: str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        """Atomically write a partition, or resume an identical completed one."""

        payload = self.build_partition(
            geography_level=geography_level,
            scope_catalog=scope_catalog,
            generated_at=generated_at,
        )
        if path.exists():
            existing = json.loads(path.read_text(encoding="utf-8"))
            validate_compact(existing, catalog=self.catalog)
            if existing["provenance"] != self.provenance:
                raise ProvenanceMismatchError(
                    f"{path} provenance does not match current exact inputs"
                )
            if _resume_content(existing) != _resume_content(payload):
                raise SpeciesGoalsContractError(
                    f"{path} is complete but content differs from current observations"
                )
            return existing, True
        _atomic_json_write(path, payload)
        return payload, False

    def write_partition_streaming(
        self,
        path: Path,
        *,
        geography_level: GeographyLevel,
        scope_catalog: list[list[str]],
        generated_at: str | None = None,
    ) -> bool:
        """Write one partition with bounded memory; return True when resumed."""

        _validate_scope_catalog(geography_level, scope_catalog)
        self._connection.commit()
        if partition_is_resumable(
            path,
            catalog=self.catalog,
            expected_solution_id=self.solution_id,
            expected_level=geography_level,
            expected_catalog_sha256=self.catalog["catalogSha256"],
            expected_provenance=self.provenance,
        ):
            return True

        body = {
            "format": COMPACT_FORMAT,
            "generatedAt": generated_at or datetime.now(timezone.utc).isoformat(),
            "solutionId": self.solution_id,
            "catalogSha256": self.catalog["catalogSha256"],
            "geographyLevel": geography_level,
            "encoding": (
                "dense" if geography_level == "national" else "sparse-no-range-omitted"
            ),
            "provenance": self.provenance,
            "scopeCatalog": scope_catalog,
            "rowLayout": list(COMPACT_ROW_LAYOUT),
        }
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temp_name = tempfile.mkstemp(
            dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
        )
        temp_path = Path(temp_name)
        row_count = 0
        payload_digest = hashlib.sha256()
        sorted_keys = sorted((*body.keys(), "rows"))
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                handle.write("{")
                for output_index, key in enumerate(body):
                    if output_index:
                        handle.write(",")
                    handle.write(json.dumps(key))
                    handle.write(":")
                    handle.write(_canonical_json(body[key]))
                handle.write(',"rows":[')

                payload_digest.update(b"{")
                for key_index, key in enumerate(sorted_keys):
                    if key_index:
                        payload_digest.update(b",")
                    payload_digest.update(json.dumps(key).encode("utf-8"))
                    payload_digest.update(b":")
                    if key != "rows":
                        payload_digest.update(_canonical_json(body[key]).encode("utf-8"))
                        continue
                    payload_digest.update(b"[")
                    for row in self._iter_rows(geography_level):
                        encoded = _canonical_json(row)
                        if row_count:
                            handle.write(",")
                            payload_digest.update(b",")
                        handle.write(encoded)
                        payload_digest.update(encoded.encode("utf-8"))
                        row_count += 1
                    payload_digest.update(b"]")
                payload_digest.update(b"}")
                handle.write("]")

                completion = {
                    "format": COMPLETION_FORMAT,
                    "status": "complete",
                    "rowCount": row_count,
                    "payloadSha256": payload_digest.hexdigest(),
                }
                handle.write(',"completion":')
                handle.write(_canonical_json(completion))
                handle.write("}")
                handle.flush()
                os.fsync(handle.fileno())
            streamed_document = json.loads(temp_path.read_text(encoding="utf-8"))
            validate_compact(
                streamed_document,
                catalog=self.catalog,
                expected_release_id=self.provenance["releaseId"],
            )
            os.replace(temp_path, path)
            artifact_sha256 = _file_sha256(path)
            _atomic_json_write(
                _completion_path(path),
                {
                    **completion,
                    "artifactSha256": artifact_sha256,
                    "solutionId": self.solution_id,
                    "geographyLevel": geography_level,
                    "catalogSha256": self.catalog["catalogSha256"],
                    "provenance": self.provenance,
                },
            )
        finally:
            temp_path.unlink(missing_ok=True)
        return False

    def _iter_rows(self, geography_level: str):
        if geography_level == "national":
            for species_index in range(len(self.catalog["rows"])):
                yield self._dense_national_row(species_index)
            return
        for scope_index, species_index, *observation in self._connection.execute(
            """
            SELECT scope_index, species_index, range_area_m2, selected_area_m2,
                   pre_existing_area_m2, new_prioritizr_area_m2,
                   configured_target_pct, display_range_km2
            FROM observations
            WHERE geography_level = ?
            ORDER BY scope_index, species_index
            """,
            (geography_level,),
        ):
            row = self._row(scope_index, species_index, observation)
            if row[2] > 0:
                yield row

    def build_partition(
        self,
        *,
        geography_level: GeographyLevel,
        scope_catalog: list[list[str]],
        generated_at: str | None = None,
    ) -> dict[str, Any]:
        _validate_scope_catalog(geography_level, scope_catalog)
        self._connection.commit()
        rows = list(self._iter_rows(geography_level))
        encoding = (
            "dense" if geography_level == "national" else "sparse-no-range-omitted"
        )
        body = {
            "format": COMPACT_FORMAT,
            "generatedAt": generated_at or datetime.now(timezone.utc).isoformat(),
            "solutionId": self.solution_id,
            "catalogSha256": self.catalog["catalogSha256"],
            "geographyLevel": geography_level,
            "encoding": encoding,
            "provenance": self.provenance,
            "scopeCatalog": scope_catalog,
            "rowLayout": list(COMPACT_ROW_LAYOUT),
            "rows": rows,
        }
        completion_hash = canonical_sha256(body)
        document = {
            **body,
            "completion": {
                "format": COMPLETION_FORMAT,
                "status": "complete",
                "rowCount": len(rows),
                "payloadSha256": completion_hash,
            },
        }
        validate_compact(document, catalog=self.catalog)
        return document

    def _dense_national_row(self, species_index: int) -> list[Any]:
        catalog_row = self.catalog["rows"][species_index]
        unavailable = catalog_row[5] == "unavailable"
        observation = self._connection.execute(
            """
            SELECT range_area_m2, selected_area_m2, pre_existing_area_m2,
                   new_prioritizr_area_m2, configured_target_pct,
                   display_range_km2
            FROM observations
            WHERE geography_level = 'national' AND scope_index = 0
              AND species_index = ?
            """,
            (species_index,),
        ).fetchone()
        if unavailable:
            return [
                0,
                species_index,
                None,
                None,
                None,
                None,
                None,
                FLAG_UNAVAILABLE,
            ]
        if observation is None:
            return [0, species_index, 0.0, 0.0, 0.0, 0.0, None, FLAG_NO_RANGE]
        return self._row(0, species_index, observation)

    def _row(
        self,
        scope_index: int,
        species_index: int,
        observation: list[float | None] | tuple[float | None, ...],
    ) -> list[Any]:
        (
            total_cells,
            selected_cells,
            pre_existing_cells,
            new_prioritizr_cells,
            target,
            *display_range_values,
        ) = observation
        display_range = display_range_values[0] if display_range_values else None
        catalog_range = self.catalog["rows"][species_index][4]
        range_km2 = 0.0 if catalog_range is None else float(catalog_range)
        national_total = self._national_total_cells(species_index)
        scale_total = national_total if national_total and national_total > 0 else total_cells
        if display_range is not None and float(display_range) > 0 and total_cells > 0:
            total = round(float(display_range), 6)
            selected = round(float(display_range) * (selected_cells / total_cells), 6)
            pre_existing = round(
                float(display_range) * (pre_existing_cells / total_cells), 6
            )
            new_prioritizr = round(selected - pre_existing, 6)
        elif scale_total <= 0 or range_km2 <= 0:
            total = 0.0
            selected = 0.0
            pre_existing = 0.0
            new_prioritizr = 0.0
        else:
            total = round(range_km2 * (total_cells / scale_total), 6)
            selected = round(range_km2 * (selected_cells / scale_total), 6)
            pre_existing = round(range_km2 * (pre_existing_cells / scale_total), 6)
            new_prioritizr = round(selected - pre_existing, 6)
        mesa = mesa_coverage_row(
            feature=str(self.catalog["rows"][species_index][1]),
            total_amount=total_cells,
            absolute_held=selected_cells,
            relative_target=None if target is None else target / 100.0,
        )
        flags = 0
        if total <= 0:
            flags |= FLAG_NO_RANGE
        if target is not None:
            flags |= FLAG_TARGET_CONFIGURED
        if total > 0:
            # Use the same predicate as validate_compact. selected/total*100
            # can cross 17/30 after 6-decimal km² rounding while
            # selected >= total * threshold/100 disagrees by more than 1e-6.
            if selected >= total * 0.17:
                flags |= FLAG_MET_17
            if selected >= total * 0.30:
                flags |= FLAG_MET_30
            if target is not None and mesa.met:
                flags |= FLAG_CONFIGURED_TARGET_MET
        return [
            scope_index,
            species_index,
            total,
            selected,
            pre_existing,
            new_prioritizr,
            target,
            flags,
        ]

    def _national_total_cells(self, species_index: int) -> float | None:
        observation = self._connection.execute(
            """
            SELECT range_area_m2
            FROM observations
            WHERE geography_level = ? AND scope_index = 0 AND species_index = ?
            """,
            (self.primary_geography_level, species_index),
        ).fetchone()
        return None if observation is None else float(observation[0])

    def _species_index(self, species: SpeciesRecord) -> int:
        try:
            return self._index_by_name[species.scientific_name]
        except KeyError as exc:
            raise SpeciesGoalsContractError(
                f"species {species.scientific_name!r} is absent from catalog"
            ) from exc

    def _observation(
        self,
        species: SpeciesRecord,
        selected: float,
        total: float,
        pre_existing: float,
        new_prioritizr: float,
        display_range_km2: float | None = None,
    ) -> tuple[float, float, float, float, float | None, float | None]:
        if not all(
            math.isfinite(value) and value >= 0
            for value in (selected, total, pre_existing, new_prioritizr)
        ):
            raise SpeciesGoalsContractError(
                "cell counts must be finite and nonnegative"
            )
        if selected > total + max(1e-6, total * 1e-9):
            raise SpeciesGoalsContractError(
                "selected species cells exceed range cells"
            )
        if abs(pre_existing + new_prioritizr - selected) > max(
            1e-6, selected * 1e-9
        ):
            raise SpeciesGoalsContractError(
                "coverage components do not reconcile to selected cells"
            )
        if display_range_km2 is not None and (
            not math.isfinite(display_range_km2) or display_range_km2 < 0
        ):
            raise SpeciesGoalsContractError(
                "display_range_km2 must be finite and nonnegative"
            )
        return (
            total,
            selected,
            pre_existing,
            new_prioritizr,
            self.target_policy.target_for(species.scientific_name),
            display_range_km2,
        )

    def _insert(
        self,
        level: str,
        scope_index: int,
        species_index: int,
        observation: tuple[float, float, float, float, float | None, float | None],
    ) -> None:
        self._connection.execute(
            """
            INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(geography_level, scope_index, species_index)
            DO UPDATE SET
                range_area_m2 = excluded.range_area_m2,
                selected_area_m2 = excluded.selected_area_m2,
                pre_existing_area_m2 = excluded.pre_existing_area_m2,
                new_prioritizr_area_m2 = excluded.new_prioritizr_area_m2,
                configured_target_pct = excluded.configured_target_pct,
                display_range_km2 = excluded.display_range_km2
            """,
            (level, scope_index, species_index, *observation),
        )
        self._writes_since_commit += 1
        if self._writes_since_commit >= 2_000:
            self._connection.commit()
            self._writes_since_commit = 0

    def close(self) -> None:
        """Finalize and release this owned spool exactly once."""

        if self._closed:
            return
        self._connection.commit()
        self._connection.close()
        self._closed = True
        self.spool_path.unlink(missing_ok=True)
        self.spool_path.with_name(f"{self.spool_path.name}-wal").unlink(missing_ok=True)
        self.spool_path.with_name(f"{self.spool_path.name}-shm").unlink(missing_ok=True)

    @property
    def closed(self) -> bool:
        """Whether the SQLite connection has already been finalized."""

        return self._closed


def validate_compact(
    document: Any,
    *,
    catalog: dict[str, Any] | None = None,
    expected_release_id: str | None = None,
) -> dict[str, Any]:
    if not isinstance(document, dict) or document.get("format") != COMPACT_FORMAT:
        raise SpeciesGoalsContractError("unsupported species goals compact format")
    if set(document) != {
        "format",
        "generatedAt",
        "solutionId",
        "catalogSha256",
        "geographyLevel",
        "encoding",
        "provenance",
        "scopeCatalog",
        "rowLayout",
        "rows",
        "completion",
    }:
        raise SpeciesGoalsContractError("compact fields are invalid")
    if document.get("rowLayout") != list(COMPACT_ROW_LAYOUT):
        raise SpeciesGoalsContractError("compact rowLayout is invalid")
    level = document.get("geographyLevel")
    if level not in {
        "national",
        "departments",
        "municipalities",
        "siraps",
        "runaps",
        "omecs",
    }:
        raise SpeciesGoalsContractError("geographyLevel is invalid")
    expected_encoding = "dense" if level == "national" else "sparse-no-range-omitted"
    if document.get("encoding") != expected_encoding:
        raise SpeciesGoalsContractError("partition encoding is invalid")
    scopes = document.get("scopeCatalog")
    _validate_scope_catalog(level, scopes)
    rows = document.get("rows")
    if not isinstance(rows, list):
        raise SpeciesGoalsContractError("rows must be an array")
    catalog_size = len(catalog["rows"]) if catalog is not None else None
    if catalog is not None and document.get("catalogSha256") != catalog["catalogSha256"]:
        raise ProvenanceMismatchError("compact catalogSha256 does not match catalog")
    previous_key: tuple[int, int] | None = None
    for index, row in enumerate(rows):
        if not isinstance(row, list) or len(row) != len(COMPACT_ROW_LAYOUT):
            raise SpeciesGoalsContractError(f"compact row {index} is invalid")
        (
            scope_index,
            species_index,
            total,
            selected,
            pre_existing,
            new_prioritizr,
            target,
            flags,
        ) = row
        key = (scope_index, species_index)
        if (
            not isinstance(scope_index, int)
            or isinstance(scope_index, bool)
            or not 0 <= scope_index < len(scopes)
            or not isinstance(species_index, int)
            or isinstance(species_index, bool)
            or species_index < 0
            or (catalog_size is not None and species_index >= catalog_size)
            or not isinstance(flags, int)
            or flags < 0
            or flags >= 64
            or (previous_key is not None and key <= previous_key)
        ):
            raise SpeciesGoalsContractError(f"compact row {index} indexes/flags are invalid")
        unavailable = bool(flags & FLAG_UNAVAILABLE)
        no_range = bool(flags & FLAG_NO_RANGE)
        target_configured = bool(flags & FLAG_TARGET_CONFIGURED)
        if unavailable:
            if any(
                value is not None
                for value in (
                    total,
                    selected,
                    pre_existing,
                    new_prioritizr,
                    target,
                )
            ):
                raise SpeciesGoalsContractError("unavailable rows must have null measures")
            if flags != FLAG_UNAVAILABLE:
                raise SpeciesGoalsContractError("unavailable rows cannot carry other flags")
            if catalog is not None and catalog["rows"][species_index][5] != "unavailable":
                raise SpeciesGoalsContractError("unavailable flag conflicts with catalog")
        else:
            if (
                not all(
                    _valid_measure(value)
                    for value in (total, selected, pre_existing, new_prioritizr)
                )
                or selected > total
                or abs(pre_existing + new_prioritizr - selected) > 1e-6
            ):
                raise SpeciesGoalsContractError(f"compact row {index} measures are invalid")
            if target is not None and not _valid_percent(target):
                raise SpeciesGoalsContractError(f"compact row {index} target is invalid")
            if target_configured != (target is not None):
                raise SpeciesGoalsContractError("configured target flag/value mismatch")
            if no_range != (total == 0):
                raise SpeciesGoalsContractError("no-range flag/measure mismatch")
            if not _threshold_flag_matches(
                bool(flags & FLAG_MET_17),
                selected=selected,
                total=total,
                threshold=17.0,
            ):
                raise SpeciesGoalsContractError("17 percent flag is invalid")
            if not _threshold_flag_matches(
                bool(flags & FLAG_MET_30),
                selected=selected,
                total=total,
                threshold=30.0,
            ):
                raise SpeciesGoalsContractError("30 percent flag is invalid")
            if not _threshold_flag_matches(
                bool(flags & FLAG_CONFIGURED_TARGET_MET),
                selected=selected,
                total=total,
                threshold=None if target is None else float(target),
                require_threshold=target is not None,
            ):
                raise SpeciesGoalsContractError("configured target result flag is invalid")
            if catalog is not None and catalog["rows"][species_index][5] == "unavailable":
                raise SpeciesGoalsContractError("available row conflicts with catalog")
        if level != "national" and (flags & (FLAG_UNAVAILABLE | FLAG_NO_RANGE)):
            raise SpeciesGoalsContractError("sparse partitions must omit unavailable/no-range rows")
        previous_key = key
    ranged_species = 0
    fully_covered_species = 0
    for row in rows:
        total = 0.0 if row[2] is None else float(row[2])
        selected = 0.0 if row[3] is None else float(row[3])
        if total <= 0:
            continue
        ranged_species += 1
        if selected + 1e-9 >= total:
            fully_covered_species += 1
    if (
        ranged_species >= _SPECIES_GOALS_TAUTOLOGY_MIN_RANGED
        and fully_covered_species == ranged_species
    ):
        raise SpeciesGoalsContractError(
            "species-goals coverage is tautological: every in-range species has "
            "selected area equal to range area. Scope must be the planning grid, "
            "not the solution-data valid mask."
        )
    if level == "national" and catalog_size is not None and len(rows) != catalog_size:
        raise SpeciesGoalsContractError("national partition must contain every catalog species")
    if level == "national" and any(
        row[0] != 0 or row[1] != index for index, row in enumerate(rows)
    ):
        raise SpeciesGoalsContractError("national rows must be dense catalog order")
    provenance = validate_provenance(document.get("provenance"), catalog)
    if expected_release_id is not None and provenance["releaseId"] != expected_release_id:
        raise ProvenanceMismatchError("compact releaseId is stale")
    completion = document.get("completion")
    if (
        not isinstance(completion, dict)
        or completion.get("format") != COMPLETION_FORMAT
        or completion.get("status") != "complete"
        or completion.get("rowCount") != len(rows)
    ):
        raise SpeciesGoalsContractError("completion metadata is invalid")
    body = {key: value for key, value in document.items() if key != "completion"}
    if completion.get("payloadSha256") != canonical_sha256(body):
        raise SpeciesGoalsContractError("completion payloadSha256 does not match")
    return document


def validate_provenance(
    provenance: Any, catalog: dict[str, Any] | None = None
) -> dict[str, Any]:
    if not isinstance(provenance, dict) or set(provenance) != PROVENANCE_KEYS:
        raise SpeciesGoalsContractError("compact provenance is invalid")
    if not isinstance(provenance["releaseId"], str) or not provenance["releaseId"]:
        raise SpeciesGoalsContractError("releaseId must be non-empty")
    if (
        not isinstance(provenance["exactOverlapAlgorithmVersion"], str)
        or not provenance["exactOverlapAlgorithmVersion"]
    ):
        raise SpeciesGoalsContractError("exactOverlapAlgorithmVersion must be non-empty")
    for field in PROVENANCE_KEYS - {
        "releaseId",
        "exactOverlapAlgorithmVersion",
        "exceptionSourceSha256",
        "exceptionPolicySha256",
        "exceptionBindingSha256",
    }:
        _require_sha256(provenance[field], field)
    for field in (
        "exceptionSourceSha256",
        "exceptionPolicySha256",
        "exceptionBindingSha256",
    ):
        if provenance[field] is not None:
            _require_sha256(provenance[field], field)
    if catalog is not None and provenance["catalogSha256"] != catalog["catalogSha256"]:
        raise ProvenanceMismatchError("provenance catalogSha256 does not match catalog")
    return provenance


def partition_is_resumable(
    path: Path,
    *,
    catalog: dict[str, Any],
    expected_solution_id: str,
    expected_level: str,
    expected_catalog_sha256: str,
    expected_provenance: dict[str, Any],
) -> bool:
    try:
        validated_catalog = validate_catalog(catalog)
    except SpeciesGoalsContractError:
        return False
    if validated_catalog["catalogSha256"] != expected_catalog_sha256:
        return False
    completion_path = _completion_path(path)
    if not path.is_file() or not completion_path.is_file():
        return False
    try:
        completion = json.loads(completion_path.read_text(encoding="utf-8"))
        document = json.loads(path.read_text(encoding="utf-8"))
        validate_compact(
            document,
            catalog=validated_catalog,
            expected_release_id=expected_provenance["releaseId"],
        )
    except (OSError, json.JSONDecodeError, SpeciesGoalsContractError):
        return False
    return (
        isinstance(completion, dict)
        and completion.get("format") == COMPLETION_FORMAT
        and completion.get("status") == "complete"
        and completion.get("solutionId") == expected_solution_id
        and completion.get("geographyLevel") == expected_level
        and completion.get("catalogSha256") == expected_catalog_sha256
        and completion.get("provenance") == expected_provenance
        and document.get("solutionId") == expected_solution_id
        and document.get("geographyLevel") == expected_level
        and document.get("catalogSha256") == expected_catalog_sha256
        and document.get("provenance") == expected_provenance
        and document.get("completion", {}).get("rowCount")
        == completion.get("rowCount")
        and document.get("completion", {}).get("payloadSha256")
        == completion.get("payloadSha256")
        and isinstance(completion.get("rowCount"), int)
        and completion["rowCount"] >= 0
        and _is_sha256(completion.get("payloadSha256"))
        and _is_sha256(completion.get("artifactSha256"))
        and _file_sha256(path) == completion["artifactSha256"]
    )


def write_release_inventory(
    output_root: Path,
    *,
    release_id: str,
    catalog: dict[str, Any],
    expected_provenance_by_solution: dict[str, dict[str, Any]],
    expected_levels_by_solution: dict[str, tuple[str, ...]] | None = None,
) -> dict[str, Any]:
    """Write opt-in evidence only for solutions with every expected shard."""

    validate_catalog(catalog)
    solutions: dict[str, Any] = {}
    for solution_id, provenance in sorted(expected_provenance_by_solution.items()):
        expected_levels = (
            expected_levels_by_solution.get(solution_id, GEOGRAPHY_LEVELS)
            if expected_levels_by_solution is not None
            else GEOGRAPHY_LEVELS
        )
        if all(
            partition_is_resumable(
                compact_partition_path(output_root, solution_id, level),
                catalog=catalog,
                expected_solution_id=solution_id,
                expected_level=level,
                expected_catalog_sha256=catalog["catalogSha256"],
                expected_provenance=provenance,
            )
            for level in expected_levels
        ):
            solutions[solution_id] = {
                "format": "species-goals-release-inventory-v1",
                "validated": True,
                "solutionId": solution_id,
                "releaseId": release_id,
                "catalogValidated": True,
                "validatedGeographyLevels": list(expected_levels),
            }
    document = {
        "format": "species-goals-release-inventory-index-v1",
        "releaseId": release_id,
        "catalogSha256": catalog["catalogSha256"],
        "solutions": solutions,
    }
    _atomic_json_write(
        output_root / "species-goals/release-inventory-v1.json", document
    )
    return document


def _validate_scope_catalog(level: str, scopes: Any) -> None:
    if (
        not isinstance(scopes, list)
        or not scopes
        or any(
            not isinstance(row, list)
            or len(row) != 2
            or not all(isinstance(value, str) and value for value in row)
            for row in scopes
        )
    ):
        raise SpeciesGoalsContractError("scopeCatalog is invalid")
    if level == "national" and scopes != [["colombia", "Colombia"]]:
        raise SpeciesGoalsContractError("national scopeCatalog must contain Colombia")
    if len({row[0] for row in scopes}) != len(scopes):
        raise SpeciesGoalsContractError("scopeCatalog IDs must be unique")


def _validate_catalog_provenance(provenance: Any) -> None:
    if not isinstance(provenance, dict) or set(provenance) != {
        "releaseId",
        "speciesCsvSha256",
        "exceptionSourceSha256",
        "exceptionPolicySha256",
        "exceptionBindingSha256",
        "inventory",
    }:
        raise SpeciesGoalsContractError("catalog provenance is invalid")
    if not isinstance(provenance["releaseId"], str) or not provenance["releaseId"]:
        raise SpeciesGoalsContractError("catalog releaseId must be non-empty")
    _require_sha256(provenance["speciesCsvSha256"], "speciesCsvSha256")
    for field in (
        "exceptionSourceSha256",
        "exceptionPolicySha256",
        "exceptionBindingSha256",
    ):
        if provenance[field] is not None:
            _require_sha256(provenance[field], field)
    inventory = provenance["inventory"]
    if not isinstance(inventory, dict) or set(inventory) != {
        "catalogTotal",
        "unavailable",
        "zeroRange",
    }:
        raise SpeciesGoalsContractError("catalog inventory is invalid")
    for field in inventory:
        if (
            not isinstance(inventory[field], int)
            or isinstance(inventory[field], bool)
            or inventory[field] < 0
        ):
            raise SpeciesGoalsContractError("catalog inventory counts are invalid")


def _valid_measure(value: Any) -> bool:
    return (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(value)
        and value >= 0
    )


def _valid_percent(value: Any) -> bool:
    return _valid_measure(value) and value <= 100


def _threshold_flag_matches(
    flag_set: bool,
    *,
    selected: float,
    total: float,
    threshold: float | None,
    require_threshold: bool = True,
) -> bool:
    """Accept Mesa cell-fraction flags when catalog-km² rounding crosses a threshold.

    Compare in km², not percentage points. ``selected / total * 100 >=
    threshold`` adds float error that can exceed a 5e-7-as-pp envelope even
    when the area shortfall is exactly one 6-decimal rounding step. EspRep30
    solutions sit on 30% cell coverage, so that noise rejected honest CSV
    ``met`` rows.
    """

    if threshold is None:
        return not flag_set if require_threshold else True
    if total <= 0:
        return not flag_set
    target_area = total * (threshold / 100.0)
    expected = selected >= target_area
    if flag_set == expected:
        return True
    return 0.0 < abs(selected - target_area) <= _KM2_ROUNDING_ABS


def _require_sha256(value: str, label: str) -> str:
    if not _is_sha256(value):
        raise SpeciesGoalsContractError(f"{label} must be a lowercase SHA-256")
    return value


def _is_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and not any(
        character not in "0123456789abcdef" for character in value
    )


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _completion_path(path: Path) -> Path:
    return path.with_name(f"{path.name}.complete.json")


def _atomic_json_write(path: Path, document: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
    )
    temp_path = Path(temp_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(
                document,
                handle,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            )
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    finally:
        temp_path.unlink(missing_ok=True)


def _resume_content(document: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in document.items()
        if key not in {"generatedAt", "completion"}
    }


def record_species_goals_from_smsp(
    pipeline: SpeciesGoalsPipeline,
    *,
    records: Sequence[SpeciesRecord],
    species_matrix_paths: Sequence[Path],
    selected_mask: np.ndarray,
    scope_mask: np.ndarray,
    pre_existing_mask: np.ndarray,
    new_prioritizr_mask: np.ndarray,
    boundary_indexes: Mapping[str, Any] | None = None,
) -> None:
    """Fill a species-goals spool from SMSP planning-unit cell lists.

    ``selected`` / ``total`` are Mesa cell counts inside ``scope_mask`` (the
    valid template). Compact km² values are applied later from the catalog
    range and ``held/total``.
    """

    from boundaries.boundary_id_grid import BoundaryIdGrid
    from boundaries.boundary_topology import (
        aggregate_prepared_sparse_boundary_weighted_sums,
        prepare_sparse_boundary_weighted_channels,
    )
    from sparse.format import iter_species_matrix_chunks

    records_by_name = _species_records_by_name(records)
    selected = np.asarray(selected_mask, dtype=bool).ravel()
    scope = np.asarray(scope_mask, dtype=bool).ravel()
    pre_existing = np.asarray(pre_existing_mask, dtype=bool).ravel()
    new_prioritizr = np.asarray(new_prioritizr_mask, dtype=bool).ravel()
    if not (selected.size == scope.size == pre_existing.size == new_prioritizr.size):
        raise SpeciesGoalsContractError("species-goals masks must share one planning grid")
    if np.array_equal(scope, selected):
        raise SpeciesGoalsContractError(
            "species-goals scope_mask equals selected_mask. Unselected planning "
            "units stored as nodata would clip range to selected cells and report "
            "100% coverage. Use the terrestrial template valid mask."
        )

    indexes = boundary_indexes or {}
    for matrix_path in species_matrix_paths:
        current_name: str | None = None
        current_record: SpeciesRecord | None = None
        totals = np.zeros(4, dtype=np.int64)
        per_level = {
            level: [
                np.zeros(index.num_boundaries, dtype=np.float64)
                for _ in range(4)
            ]
            for level, index in indexes.items()
        }

        def flush() -> None:
            nonlocal current_name, current_record, totals
            if current_record is None:
                return
            pipeline.record_national(
                current_record,
                float(totals[1]),
                float(totals[0]),
                pre_existing_area_m2=float(totals[2]),
                new_prioritizr_area_m2=float(totals[3]),
            )
            for level, channels in per_level.items():
                pipeline.record_sub_level(
                    current_record,
                    level,
                    channels[1],
                    channels[0],
                    pre_existing_per_boundary=channels[2],
                    new_prioritizr_per_boundary=channels[3],
                )
            totals[:] = 0
            for channels in per_level.values():
                for channel in channels:
                    channel[:] = 0
            current_name = None
            current_record = None

        for chunk, grid, _grid_raw in iter_species_matrix_chunks(matrix_path):
            if grid is not None and int(grid.width) * int(grid.height) != selected.size:
                raise SpeciesGoalsContractError(
                    f"SMSP grid does not match the planning raster: {matrix_path}"
                )
            if chunk.first:
                flush()
                current_name = chunk.name
                current_record = records_by_name.get(chunk.name)
            if current_record is None:
                continue
            cells = np.asarray(chunk.cell_ids, dtype=np.intp)
            if cells.size and (int(cells.min()) < 0 or int(cells.max()) >= selected.size):
                raise SpeciesGoalsContractError(
                    f"SMSP cell is outside the planning grid for {chunk.name!r}"
                )
            in_scope = cells[scope[cells]] if cells.size else cells
            if in_scope.size == 0:
                continue
            selected_at = selected[in_scope]
            pre_at = pre_existing[in_scope]
            new_at = new_prioritizr[in_scope]
            totals += (
                in_scope.size,
                int(np.count_nonzero(selected_at)),
                int(np.count_nonzero(pre_at)),
                int(np.count_nonzero(new_at)),
            )
            if not indexes:
                continue
            weights = np.ones(in_scope.size, dtype=np.float64)
            prepared = prepare_sparse_boundary_weighted_channels(
                in_scope,
                weights,
                selected=selected_at,
                pre_existing=pre_at,
                new_prioritizr=new_at,
                num_pixels=selected.size,
            )
            for level, index in indexes.items():
                if isinstance(index, BoundaryIdGrid):
                    bids = index.flat[in_scope]
                    n_levels = index.num_boundaries
                    in_boundary = bids >= 0
                    if not np.any(in_boundary):
                        continue
                    scoped_bids = bids[in_boundary]
                    per_level[level][0] += np.bincount(
                        scoped_bids, minlength=n_levels
                    )
                    per_level[level][1] += np.bincount(
                        bids[in_boundary & selected_at], minlength=n_levels
                    )
                    per_level[level][2] += np.bincount(
                        bids[in_boundary & pre_at], minlength=n_levels
                    )
                    per_level[level][3] += np.bincount(
                        bids[in_boundary & new_at], minlength=n_levels
                    )
                    continue
                grouped = aggregate_prepared_sparse_boundary_weighted_sums(
                    index, prepared
                )
                per_level[level][0] += grouped.total
                per_level[level][1] += grouped.selected
                per_level[level][2] += grouped.pre_existing
                per_level[level][3] += grouped.new_prioritizr
        flush()


def _species_records_by_name(
    records: Sequence[SpeciesRecord],
) -> dict[str, SpeciesRecord]:
    mapping: dict[str, SpeciesRecord] = {}
    for record in records:
        for key in (
            record.scientific_name,
            record.scientific_name.replace(" ", "_"),
            record.filename_stem,
        ):
            mapping[key] = record
    return mapping
