"""Species richness, threatened-species, and species-coverage calculators.

These eight Tier 1 metrics share a single underlying loop: for every
non-fish species in the IUCN range CSV, read its sparse exact source-grid
intersection areas and check which positive-area target cells fall inside
the solution at every geography scope.

Metrics implemented here
------------------------
  #3  — Threatened Species Secured
  #21 — Species Richness — Mammals
  #22 — Species Richness — Birds
  #23 — Species Richness — Amphibians
  #24 — Species Richness — Reptiles (Squamata + Crocodylia)
  #25 — Species Richness — Plants (Magnoliopsida)
  #26 — Threatened Species Count
  #28 — % of National Species Total

Algorithm
---------
For each species with at least one valid range pixel:

1.  Load sorted target indexes and exact intersection areas.
2.  Index the solution selection at those target indexes.
3.  Sum intersection area in selected cells. Zero means this species
    contributes nothing to presence/count metrics.
4.  For sub-national scopes, look up each ``boundary_id_per_pixel`` array at
    ``range_indices`` (and at the subset that's also selected) and use
    ``np.bincount`` to fan out to all boundaries simultaneously.

For the "secured" metric (#3), the per-scope coverage ratio is::

    exact_area_in_scope_selected / exact_area_in_scope_range >= solution_target_pct

i.e. "what fraction of this species's range *that exists in this region* is
captured by the priority area?".  That gives intuitive sub-national readouts
("the selection in dept X secures 25% of jaguar range in dept X") rather
than the much smaller alternative of dividing by the country-wide range.

The accumulator below is the single place that holds these counters.  It
supports incremental updates per species, then ``finalize`` produces the
final metric values.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

import numpy as np

from species_data import CLASS_BUCKETS, SpeciesPoolSizes, SpeciesRecord

IUCN_STATUS_ORDER: tuple[str, ...] = ("CR", "EN", "VU", "NT", "LC", "DD", "other", "unknown")
_GROUP_LABELS: dict[str, str] = {
    "mammals": "Mammals",
    "birds": "Birds",
    "amphibians": "Amphibians",
    "reptiles": "Reptiles",
    "plants": "Plants",
}


# ---------------------------------------------------------------------------
# Per-scope counters
# ---------------------------------------------------------------------------

@dataclass
class SpeciesScopeCounts:
    """Counters for one geography scope (national or one boundary feature)."""
    # Richness counts (#21–#25): species present per class bucket.
    by_bucket: dict[str, int] = field(default_factory=lambda: {b: 0 for b in CLASS_BUCKETS})
    # Species group coverage (#2): species with usable range, and subset meeting
    # the solution target in this scope.
    coverage_by_bucket: dict[str, "SpeciesCoverageCounts"] = field(
        default_factory=lambda: {b: SpeciesCoverageCounts() for b in CLASS_BUCKETS}
    )
    # Threatened metrics (#26 / #3).
    threatened_present: int = 0           # CR/EN/VU non-fish whose range overlaps selection
    threatened_secured: int = 0           # subset whose coverage ratio >= solution_target_pct
    # All-non-fish present (numerator of #28).
    all_present: int = 0


@dataclass
class SpeciesCoverageCounts:
    """Met/total counts for species target coverage, with IUCN breakdown."""
    met: int = 0
    total: int = 0
    by_status: dict[str, "SpeciesCoverageCounts"] = field(default_factory=dict)

    def record(self, met: bool, iucn_status: str | None = None) -> None:
        self.total += 1
        if met:
            self.met += 1
        if iucn_status is not None:
            normalized = _normalize_iucn_status(iucn_status)
            status_count = self.by_status.setdefault(normalized, SpeciesCoverageCounts())
            status_count.record(met)

    def as_dict(self) -> dict[str, int]:
        return {
            "metSpeciesCount": self.met,
            "totalSpeciesCount": self.total,
        }


@dataclass
class SpeciesAccumulator:
    """All species counters for one solution.

    One instance per solution; initialise with the boundary index sizes per
    level (e.g. 33 departments, ~1,100 municipalities, ~6 SIRAPs).
    """
    target_pct: float | None              # 17.0 or 30.0 — None means "skip secured"
    pool_sizes: SpeciesPoolSizes
    species_expected: int = 0
    species_processed: int = 0
    species_aligned: int = 0
    species_with_range: int = 0           # range raster had >=1 valid pixel
    species_missing_tif: int = 0          # raster could not be loaded
    national: SpeciesScopeCounts = field(default_factory=SpeciesScopeCounts)
    sub: dict[str, list[SpeciesScopeCounts]] = field(default_factory=dict)
    # ``sub[level][i]`` corresponds to boundary index ``i`` in the matching
    # ``BoundaryIdGrid.boundary_ids`` tuple.

    def init_sub(self, sub_sizes: dict[str, int]) -> None:
        """Allocate per-boundary counter arrays for each sub-national level."""
        self.sub = {
            level: [SpeciesScopeCounts() for _ in range(n)]
            for level, n in sub_sizes.items()
        }

    # -- per-species update --------------------------------------------------

    def record_species_national(
        self,
        sp: SpeciesRecord,
        selected_range_area_m2: float,
        total_range_area_m2: float,
    ) -> None:
        coverage_target_met = _species_coverage_target_met(
            selected_area_m2=selected_range_area_m2,
            total_area_m2=total_range_area_m2,
            target_pct=self.target_pct,
        )
        if sp.bucket is not None:
            self.national.coverage_by_bucket[sp.bucket].record(
                coverage_target_met,
                sp.iucn_status,
            )

        if selected_range_area_m2 <= 0:
            return
        self.national.all_present += 1
        if sp.bucket is not None:
            self.national.by_bucket[sp.bucket] += 1
        if sp.threatened:
            self.national.threatened_present += 1
            if (
                self.target_pct is not None
                and total_range_area_m2 > 0
                and (selected_range_area_m2 / total_range_area_m2) * 100.0
                >= self.target_pct
            ):
                self.national.threatened_secured += 1

    def record_species_sub_level(
        self,
        sp: SpeciesRecord,
        level: str,
        sel_per_boundary: np.ndarray,
        total_per_boundary: np.ndarray,
    ) -> None:
        """Update sub-national counters for one (species, level) combination.

        Both arrays have length equal to the number of boundaries at this level
        and are precomputed via ``np.bincount`` over ``boundary_id`` arrays.
        """
        scope_counts = self.sub[level]
        is_threatened = sp.threatened
        target = self.target_pct
        bucket = sp.bucket

        if bucket is not None:
            range_indices = np.flatnonzero(total_per_boundary > 0)
            for bidx in range_indices.tolist():
                denom = float(total_per_boundary[bidx])
                selected = float(sel_per_boundary[bidx])
                scope_counts[bidx].coverage_by_bucket[bucket].record(
                    _species_coverage_target_met(
                        selected_area_m2=selected,
                        total_area_m2=denom,
                        target_pct=target,
                    ),
                    sp.iucn_status,
                )

        present_indices = np.flatnonzero(sel_per_boundary > 0)
        if present_indices.size == 0:
            return
        for bidx in present_indices.tolist():
            counts = scope_counts[bidx]
            counts.all_present += 1
            if bucket is not None:
                counts.by_bucket[bucket] += 1
            if is_threatened:
                counts.threatened_present += 1
                if target is not None:
                    denom = float(total_per_boundary[bidx])
                    if denom > 0:
                        ratio_pct = (float(sel_per_boundary[bidx]) / denom) * 100.0
                        if ratio_pct >= target:
                            counts.threatened_secured += 1


# ---------------------------------------------------------------------------
# Per-scope metric value extraction (used by main.py to inject results)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SpeciesScopeMetrics:
    """Bundle of derived species metric values for one scope.

    Built from a ``SpeciesScopeCounts`` plus the relevant pool sizes; this is
    what main._build_metrics uses to fill in #3, #21–#26, #28.
    """
    mammals_present: int
    birds_present: int
    amphibians_present: int
    reptiles_present: int
    plants_present: int
    threatened_present: int               # #26
    threatened_secured: int               # #3
    pct_of_national: float                # #28: all_present / pool * 100
    species_group_coverage: dict[str, object]  # #2 details payload

    @classmethod
    def from_counts(
        cls,
        counts: SpeciesScopeCounts,
        pool_sizes: SpeciesPoolSizes,
    ) -> "SpeciesScopeMetrics":
        denom = pool_sizes.total_non_fish
        pct = (counts.all_present / denom) * 100.0 if denom else 0.0
        return cls(
            mammals_present=counts.by_bucket["mammals"],
            birds_present=counts.by_bucket["birds"],
            amphibians_present=counts.by_bucket["amphibians"],
            reptiles_present=counts.by_bucket["reptiles"],
            plants_present=counts.by_bucket["plants"],
            threatened_present=counts.threatened_present,
            threatened_secured=counts.threatened_secured,
            pct_of_national=pct,
            species_group_coverage=_species_group_coverage_details(counts),
        )


# ---------------------------------------------------------------------------
# Convenience helpers
# ---------------------------------------------------------------------------

def filter_records_with_pool(records: Iterable[SpeciesRecord]) -> list[SpeciesRecord]:
    """Return only records that contribute to at least one richness pool.

    Currently this matches the project decision to count only the five class
    buckets used by #21–#25.  Records with unmapped classes are excluded from
    *both* the bucket-specific counts and the all-species denominator (#28).

    The vast majority of CSV rows fall into one of the five buckets, so this
    is mostly a no-op safety filter.  If a future revision wants to broaden
    the pool, change ``CLASS_BUCKETS`` (and ``_CLASS_TO_BUCKET``) in
    ``species_data`` rather than here.
    """
    return [r for r in records if r.bucket is not None]


def _species_coverage_target_met(
    *,
    selected_area_m2: float,
    total_area_m2: float,
    target_pct: float | None,
) -> bool:
    return (
        target_pct is not None
        and total_area_m2 > 0
        and (selected_area_m2 / total_area_m2) * 100.0 >= target_pct
    )


def _species_group_coverage_details(counts: SpeciesScopeCounts) -> dict[str, object]:
    total = SpeciesCoverageCounts()
    groups: dict[str, object] = {}

    for group in CLASS_BUCKETS:
        group_count = counts.coverage_by_bucket[group]
        if group_count.total == 0:
            continue
        total.met += group_count.met
        total.total += group_count.total
        groups[group] = {
            "label": _GROUP_LABELS[group],
            **group_count.as_dict(),
            "iucnStatusBreakdown": {
                status: group_count.by_status[status].as_dict()
                for status in IUCN_STATUS_ORDER
                if status in group_count.by_status and group_count.by_status[status].total > 0
            },
        }

    return {
        "summary": total.as_dict(),
        "groups": groups,
    }


def _normalize_iucn_status(value: str) -> str:
    status = value.strip().upper()
    if status in {"CR", "EN", "VU", "NT", "LC", "DD"}:
        return status
    if status:
        return "other"
    return "unknown"
