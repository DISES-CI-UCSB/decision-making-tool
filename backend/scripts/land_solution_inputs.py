"""Published EPSG:9377 land-solution inputs and the pinned reference raster.

The custom AOI backend can run on two reference grids. The legacy ``ecosistemas``
grid is EPSG:4326 and reads the blob objects directly under
``inputs/features/ecosystems/`` and ``inputs/features/species-sparse/``. The
``land-solution`` grid is the EPSG:9377 1353x1838 1 km grid shared with the
precomputed v0.2 metrics, and reads its own objects under the
``land-solution-9377/`` sub-prefix of those same directories. The two sets never
share a pathname, so republishing one cannot disturb the other.

Reference raster
----------------
``build_custom_aoi_raster`` clips a drawn polygon with ``selected &=
base.valid_mask``, so the reference raster's valid footprint is both the land
domain a drawn AOI can occupy and the denominator of ``national_contribution``.
The pinned raster is the aligned MEC composite — the same object the ecosystem
inventory reads. That is deliberate: the ecosystem section derives every
``national_area_km2`` from ``np.isfinite(ecosystem_values)`` over this raster, so
sharing one object makes "percent of national land area" and "percent of the
national area of this ecosystem class" quote the same Colombia.

The alternatives were rejected on evidence, not preference. The land solution
rasters cannot supply a domain: they carry only values {1, 2} with NaN elsewhere,
so each one's valid mask equals its own selection and no footprint is shared
across the 168 land solutions. The aligned carbon and biomass rasters report a
larger footprint (1,157,149 cells) only because they are resampled with
``average``, which spreads values into partially covered coastal cells; that is a
resampling artifact rather than a land domain. Aligned ``ecosistemas_IAVH_2024``
(1,126,415 cells) is neither the inventory's raster nor as complete.

Changing the grid therefore means editing this pin, which is a reviewable event.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import rasterio

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
METRICS_PIPELINE = REPO_ROOT / "data" / "metrics" / "python" / "metrics_pipeline"
if str(METRICS_PIPELINE) not in sys.path:
    sys.path.insert(0, str(METRICS_PIPELINE))

from raster_metrics import RasterFingerprint  # noqa: E402

PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"

# Names the grid in the pathname so a 9377 object can never be mistaken for, or
# collide with, the EPSG:4326 object of the same filename one directory up.
LAND_SOLUTION_BLOB_PREFIX = "land-solution-9377"
ECOSYSTEM_BLOB_DIR = f"inputs/features/ecosystems/{LAND_SOLUTION_BLOB_PREFIX}"
SPECIES_SPARSE_BLOB_DIR = f"inputs/features/species-sparse/{LAND_SOLUTION_BLOB_PREFIX}"

ECOSYSTEM_BLOB_PATHS = {
    "raster": f"{ECOSYSTEM_BLOB_DIR}/ecosistemas_IDEAM_MEC_2024.tif",
    "crosswalk": f"{ECOSYSTEM_BLOB_DIR}/ecosistemas_IDs_IDEAM_MEC_2024.csv",
    "provenance": f"{ECOSYSTEM_BLOB_DIR}/ecosistemas_IDEAM_MEC_2024.provenance.json",
}

# The EPSG:4326 objects the currently deployed backend rebuilds itself from.
# Recorded here so the publish step can assert it is not writing over them.
LEGACY_4326_BLOB_PATHS = (
    "inputs/features/ecosystems/ecosistemas_IDEAM_MEC_2024.tif",
    "inputs/features/ecosystems/ecosistemas_IDs_IDEAM_MEC_2024.csv",
    "inputs/features/ecosystems/ecosistemas_IDEAM_MEC_2024.provenance.json",
    *(
        f"inputs/features/species-sparse/species_{group}.smtx.gz"
        for group in ("amphibians", "birds", "mammals", "plants", "reptiles", "threatened")
    ),
)

# The 4326 MEC composite the aligned raster is reprojected from. Pinned so a
# republished 4326 bundle cannot silently change what the 9377 grid means.
MEC_SOURCE_BLOB_PATH = "inputs/features/ecosystems/ecosistemas_IDEAM_MEC_2024.tif"
MEC_SOURCE_SHA256 = "655c4d6fa15da3fadbce215bdff0188765e8b168fba84d944eb62a1a7abd5590"
MEC_CROSSWALK_BLOB_PATH = "inputs/features/ecosystems/ecosistemas_IDs_IDEAM_MEC_2024.csv"
MEC_PROVENANCE_BLOB_PATH = "inputs/features/ecosystems/ecosistemas_IDEAM_MEC_2024.provenance.json"


def public_url(blob_path: str) -> str:
    return f"{PUBLIC_BLOB_HOST}/{blob_path.lstrip('/')}"


def species_matrix_blob_path(group: str) -> str:
    return f"{SPECIES_SPARSE_BLOB_DIR}/species_{group}.smtx.gz"


class ReferenceRasterPinError(RuntimeError):
    """Raised when a reference raster does not match the pinned land domain."""


@dataclass(frozen=True)
class ReferenceRasterPin:
    """Exact identity of the raster that defines the land-solution domain."""

    blob_path: str
    sha256: str
    size_bytes: int
    crs: str
    width: int
    height: int
    transform: tuple[float, float, float, float, float, float]
    valid_cell_count: int
    rationale: str

    @property
    def url(self) -> str:
        return public_url(self.blob_path)

    @property
    def fingerprint(self) -> RasterFingerprint:
        return RasterFingerprint(
            width=self.width,
            height=self.height,
            transform=self.transform,
            crs=self.crs,
        )

    def verify(self, path: Path, *, sha256: str) -> None:
        """Fail loudly when a candidate reference raster is not the pinned one."""
        if sha256 != self.sha256:
            raise ReferenceRasterPinError(
                f"Reference raster {path} has sha256 {sha256}; the land-solution pin "
                f"requires {self.sha256}. Update land_solution_inputs.py deliberately "
                "if the land domain is meant to change."
            )
        with rasterio.open(path) as dataset:
            observed = RasterFingerprint(
                width=dataset.width,
                height=dataset.height,
                transform=tuple(dataset.transform)[:6],
                crs=str(dataset.crs) if dataset.crs else None,
            )
            valid_cells = int((dataset.read_masks(1) > 0).sum())
        if not observed.matches(self.fingerprint):
            raise ReferenceRasterPinError(
                f"Reference raster {path} sits on {observed}; the land-solution pin "
                f"requires {self.fingerprint}."
            )
        if valid_cells != self.valid_cell_count:
            raise ReferenceRasterPinError(
                f"Reference raster {path} has {valid_cells:,} valid cells; the "
                f"land-solution pin requires {self.valid_cell_count:,}."
            )


LAND_SOLUTION_REFERENCE_PIN = ReferenceRasterPin(
    blob_path=ECOSYSTEM_BLOB_PATHS["raster"],
    sha256="f0c964382576da10dccd55fe49cc740f3825f796bcc8297c2189ce58d9f33e64",
    size_bytes=503836,
    crs="EPSG:9377",
    width=1353,
    height=1838,
    transform=(
        1000.0,
        0.0,
        4331309.911856957,
        0.0,
        -999.9999999999999,
        2933186.9308051495,
    ),
    valid_cell_count=1140924,
    rationale=(
        "Aligned IDEAM MEC 2024 composite on the v0.2 land solution grid. Its "
        "1,140,924 valid 1 km cells are the national land domain and the "
        "national_contribution denominator, and it is the same object the "
        "ecosystem inventory uses for its per-class national areas."
    ),
)
