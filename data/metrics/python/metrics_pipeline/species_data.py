"""Species CSV loading and species range raster I/O.

The Tier 1 species metrics (#3, #21–#26, #28) are powered by two artifacts in
Vercel Blob:

1.  ``inputs/features/species/biomod_spp_ranges_updatedIUCN.csv``
    A taxonomy + IUCN status lookup table with one row per modelled species
    (~8,750 rows, ~8,300 of which are non-fish).  No per-solution overlap
    information lives in this CSV — overlap must be computed by reading each
    species's range raster.

2.  ``inputs/features/species/<Genus_species>_10_MAXENT.tif``
    Per-species 1 km binary range rasters (uint8, values ``{0, 1, 255}`` with
    255 = nodata).  Each raster is pixel-snapped to the solution raster grid
    but cropped to a tighter Colombia bounding box, so it is offset from the
    solution grid by an integer number of pixels and must be placed into a
    zero-padded array of the solution grid shape before any boolean overlap.

This module exposes:

- ``SpeciesRecord``    — CSV row + computed metric flags (class bucket, IUCN).
- ``load_species_records``  — read the CSV and return non-fish records.
- ``species_blob_url``      — build the public Vercel Blob URL for a species's
                               range raster from its scientific name.
- ``read_species_mask``     — read a species range raster from disk and return
                               a boolean mask aligned to the solution grid.

The five class buckets used by the richness metrics (#21–#25) are:

============== =====================================================
Bucket         Pool size  CSV ``class`` values
============== =====================================================
mammals        256        ``Mammalia``
birds          1,552      ``Aves``
amphibians     184        ``Amphibia``
reptiles       160        ``Squamata``, ``Crocodylia``
plants         6,148      ``Magnoliopsida``
============== =====================================================

``Actinopteri`` (fish) rows are excluded from every species metric per the
project decision recorded in T10 — the species range models are unreliable
for fish.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import rasterio

from raster_metrics import RasterError, RasterFingerprint

PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
SPECIES_BLOB_PREFIX = f"{PUBLIC_BLOB_HOST}/inputs/features/species"
SPECIES_CSV_URL = f"{SPECIES_BLOB_PREFIX}/biomod_spp_ranges_updatedIUCN.csv"
SPECIES_TIF_SUFFIX = "_10_MAXENT.tif"

# Solution-name regex parts for parsing solution target percent.
# The Solution Finder writes IDs like "Ecos17+ESTR30+RUNAP_HF",
# "ESTR30+RUNAP+OMEC_HF", or Nick-run species solutions like "Esp17+RUNAP".
# When multiple target tokens appear we prefer the most specific species/strategic
# token before falling back to the broad ecosystem token.
_TARGET_TOKEN_PRIORITY: tuple[tuple[str, ...], ...] = (
    ("ESTR17", "estr17"),
    ("ESTR30", "estr30"),
    ("Esp17", "esp17"),
    ("Esp30", "esp30"),
    ("Ecos17", "ecos17"),
    ("Ecos30", "ecos30"),
)

THREATENED_IUCN_STATUSES = frozenset({"CR", "EN", "VU"})

EXCLUDED_CLASSES = frozenset({"Actinopteri"})

# CSV class string → bucket key used by the richness metrics.
_CLASS_TO_BUCKET: dict[str, str] = {
    "Mammalia": "mammals",
    "Aves": "birds",
    "Amphibia": "amphibians",
    "Squamata": "reptiles",
    "Crocodylia": "reptiles",
    "Magnoliopsida": "plants",
}

CLASS_BUCKETS: tuple[str, ...] = ("mammals", "birds", "amphibians", "reptiles", "plants")


@dataclass(frozen=True)
class SpeciesRecord:
    scientific_name: str
    csv_class: str
    iucn_status: str
    range_km2: float | None
    bucket: str | None       # one of CLASS_BUCKETS, or None if class is unmapped
    threatened: bool         # iucn_status in {CR, EN, VU} (and not excluded class)

    @property
    def filename_stem(self) -> str:
        """Filename stem expected on Vercel Blob (no extension, no suffix)."""
        return self.scientific_name.replace(" ", "_")

    @property
    def blob_filename(self) -> str:
        return f"{self.filename_stem}{SPECIES_TIF_SUFFIX}"

    @property
    def blob_url(self) -> str:
        return f"{SPECIES_BLOB_PREFIX}/{self.blob_filename}"


def parse_solution_target_percent(solution_name_or_id: str) -> float | None:
    """Return the solution target as a percent (e.g. 17.0 or 30.0) or None.

    Looks for the first matching ``ESTR<NN>``/``Esp<NN>`` token, falling back to
    ``Ecos<NN>``.  Both casings are accepted.  Returns ``None`` if no token
    matches — the caller should mark target-dependent species metrics as
    ``derivation_needed`` in that case.
    """
    if not solution_name_or_id:
        return None
    for tokens in _TARGET_TOKEN_PRIORITY:
        for tok in tokens:
            if tok in solution_name_or_id:
                # Tokens are "ESTR17", "estr30", etc. — last two chars are the percent.
                return float(tok[-2:])
    return None


def species_blob_url(scientific_name: str) -> str:
    """Build the public Vercel Blob URL for a species's range raster."""
    stem = scientific_name.replace(" ", "_")
    return f"{SPECIES_BLOB_PREFIX}/{stem}{SPECIES_TIF_SUFFIX}"


def load_species_records(csv_path: Path) -> list[SpeciesRecord]:
    """Read the species CSV and return non-fish records.

    Filters out ``EXCLUDED_CLASSES`` rows (currently just ``Actinopteri``).
    All other rows are returned regardless of whether they have a recognised
    class bucket — the calling code uses ``record.bucket`` to decide which
    richness metrics they contribute to.

    The CSV is expected to have these columns (per the T10 inspection):
    ``scientific_name, class, iucn_status, range_km2, range_pct_country,
    range_runap_km2, range_pct_runap, range_omec_km2, range_pct_omec``.
    """
    if not csv_path.exists():
        raise FileNotFoundError(f"Species CSV not found at {csv_path}")

    records: list[SpeciesRecord] = []
    with csv_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            cls = (row.get("class") or "").strip()
            if cls in EXCLUDED_CLASSES:
                continue
            name = (row.get("scientific_name") or "").strip()
            if not name:
                continue
            iucn = (row.get("iucn_status") or "").strip()
            try:
                range_km2: float | None = float(row.get("range_km2") or "")
            except ValueError:
                range_km2 = None
            records.append(
                SpeciesRecord(
                    scientific_name=name,
                    csv_class=cls,
                    iucn_status=iucn,
                    range_km2=range_km2,
                    bucket=_CLASS_TO_BUCKET.get(cls),
                    threatened=iucn in THREATENED_IUCN_STATUSES,
                )
            )
    return records


# ---------------------------------------------------------------------------
# Species range raster I/O
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _Window:
    """Pixel-snapped placement of a species TIF inside the solution grid."""
    row_offset: int        # solution row index where the species TIF row 0 begins
    col_offset: int        # solution col index where the species TIF col 0 begins
    src_rows: int          # number of rows actually copied (may clip at edges)
    src_cols: int          # number of cols actually copied
    src_row_start: int     # first row of the species TIF that's copied (>= 0)
    src_col_start: int     # first col of the species TIF that's copied


def _compute_window(
    species_transform: tuple[float, ...],
    species_w: int,
    species_h: int,
    target: RasterFingerprint,
    *,
    abs_tol: float = 1e-7,
) -> _Window:
    """Compute the integer-pixel offset that places the species TIF inside the
    solution grid.  Raises RasterError if the pixel sizes don't match (different
    resolution → resampling required, which this MVP does not do).
    """
    sp_a, sp_b, sp_c, sp_d, sp_e, sp_f = species_transform
    sol_a, sol_b, sol_c, sol_d, sol_e, sol_f = target.transform

    if not (
        abs(sp_a - sol_a) < abs_tol
        and abs(sp_e - sol_e) < abs_tol
        and abs(sp_b) < abs_tol
        and abs(sp_d) < abs_tol
    ):
        raise RasterError(
            "Species raster pixel size does not match solution grid; resampling not supported.\n"
            f"  species transform: {species_transform}\n"
            f"  solution transform: {target.transform}"
        )

    col_offset = round((sp_c - sol_c) / sol_a)
    row_offset = round((sp_f - sol_f) / sol_e)

    src_row_start = max(0, -row_offset)
    src_col_start = max(0, -col_offset)
    out_row_start = max(0, row_offset)
    out_col_start = max(0, col_offset)
    src_rows = min(species_h - src_row_start, target.height - out_row_start)
    src_cols = min(species_w - src_col_start, target.width - out_col_start)
    if src_rows <= 0 or src_cols <= 0:
        raise RasterError(
            f"Species raster does not overlap the solution grid (offset row={row_offset} col={col_offset})."
        )

    return _Window(
        row_offset=out_row_start,
        col_offset=out_col_start,
        src_rows=src_rows,
        src_cols=src_cols,
        src_row_start=src_row_start,
        src_col_start=src_col_start,
    )


def read_species_mask(path: Path, expected: RasterFingerprint) -> np.ndarray:
    """Read a species range TIF and return a 2D bool mask aligned to *expected*.

    Returns a ``(height, width)`` boolean array of the solution grid shape
    where ``True`` marks species range presence.  Cells outside the species
    raster's bounding box are ``False``.  Per the species TIF convention, a
    cell is "in range" iff it equals ``1`` (not ``0`` or ``255`` nodata).
    """
    with rasterio.open(path) as dataset:
        transform = dataset.transform
        species_transform = (
            transform.a, transform.b, transform.c, transform.d, transform.e, transform.f,
        )
        window = _compute_window(
            species_transform=species_transform,
            species_w=dataset.width,
            species_h=dataset.height,
            target=expected,
        )

        rasterio_window = rasterio.windows.Window(
            col_off=window.src_col_start,
            row_off=window.src_row_start,
            width=window.src_cols,
            height=window.src_rows,
        )
        sub = dataset.read(1, window=rasterio_window, masked=False)

    mask = np.zeros((expected.height, expected.width), dtype=bool)
    mask[
        window.row_offset : window.row_offset + window.src_rows,
        window.col_offset : window.col_offset + window.src_cols,
    ] = (sub == 1)
    return mask


# ---------------------------------------------------------------------------
# Species pool sizes (used as denominators / static metric metadata)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SpeciesPoolSizes:
    """Static counts of how many species are in each metric pool.

    These come from a single pass over the loaded ``SpeciesRecord`` list and
    are used as the denominator for metric #28 (species count / total) and as
    upper-bound metadata in source notes for #21–#26.
    """
    total_non_fish: int                    # denominator for #28
    threatened_total: int                  # CR/EN/VU non-fish (#26 pool, #3 pool)
    by_bucket: dict[str, int]              # one of CLASS_BUCKETS → pool size


def compute_pool_sizes(records: list[SpeciesRecord]) -> SpeciesPoolSizes:
    by_bucket: dict[str, int] = {b: 0 for b in CLASS_BUCKETS}
    threatened = 0
    for sp in records:
        if sp.bucket is not None:
            by_bucket[sp.bucket] += 1
        if sp.threatened:
            threatened += 1
    return SpeciesPoolSizes(
        total_non_fish=len(records),
        threatened_total=threatened,
        by_bucket=by_bucket,
    )
