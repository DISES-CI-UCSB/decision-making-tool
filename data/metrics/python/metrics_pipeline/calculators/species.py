"""Species richness, threatened-species, and species-coverage calculators.

These eight Tier 1 metrics share a single underlying loop: for every
non-fish species in the IUCN range CSV, read the species's range raster
and check whether any of its range pixels fall inside the solution-selected
pixels at every geography scope.

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

1.  Place its range raster into the solution grid (zero-padded) and flatten
    to ``range_indices`` — a 1-D array of pixel positions.
2.  ``selected_at_range = solution.selected_flat[range_indices]`` — a small
    boolean array marking which range pixels are inside the priority area.
3.  ``n_selected_in_range = selected_at_range.sum()`` — total cells in
    (range ∩ selected).  Zero means this species contributes nothing.
4.  For sub-national scopes, look up each ``boundary_id_per_pixel`` array at
    ``range_indices`` (and at the subset that's also selected) and use
    ``np.bincount`` to fan out to all boundaries simultaneously.

For the "secured" metric (#3), the per-scope coverage ratio is::

    cells_in_scope_selected / cells_in_scope_range >= scenario_target_pct

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


# ---------------------------------------------------------------------------
# Per-scope counters
# ---------------------------------------------------------------------------

@dataclass
class SpeciesScopeCounts:
    """Counters for one geography scope (national or one boundary feature)."""
    # Richness counts (#21–#25): species present per class bucket.
    by_bucket: dict[str, int] = field(default_factory=lambda: {b: 0 for b in CLASS_BUCKETS})
    # Threatened metrics (#26 / #3).
    threatened_present: int = 0           # CR/EN/VU non-fish whose range overlaps selection
    threatened_secured: int = 0           # subset whose coverage ratio >= scenario_target_pct
    # All-non-fish present (numerator of #28).
    all_present: int = 0


@dataclass
class SpeciesAccumulator:
    """All species counters for one solution.

    One instance per solution; initialise with the boundary index sizes per
    level (e.g. 33 departments, ~1,100 municipalities, ~6 SIRAPs).
    """
    target_pct: float | None              # 17.0 or 30.0 — None means "skip secured"
    pool_sizes: SpeciesPoolSizes
    species_processed: int = 0
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
        n_selected_in_range: int,
        total_range: int,
    ) -> None:
        if n_selected_in_range == 0:
            return
        self.national.all_present += 1
        if sp.bucket is not None:
            self.national.by_bucket[sp.bucket] += 1
        if sp.threatened:
            self.national.threatened_present += 1
            if (
                self.target_pct is not None
                and total_range > 0
                and (n_selected_in_range / total_range) * 100.0 >= self.target_pct
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
        present_indices = np.flatnonzero(sel_per_boundary > 0)
        if present_indices.size == 0:
            return
        scope_counts = self.sub[level]
        is_threatened = sp.threatened
        target = self.target_pct
        bucket = sp.bucket
        for bidx in present_indices.tolist():
            counts = scope_counts[bidx]
            counts.all_present += 1
            if bucket is not None:
                counts.by_bucket[bucket] += 1
            if is_threatened:
                counts.threatened_present += 1
                if target is not None:
                    denom = int(total_per_boundary[bidx])
                    if denom > 0:
                        ratio_pct = (int(sel_per_boundary[bidx]) / denom) * 100.0
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
