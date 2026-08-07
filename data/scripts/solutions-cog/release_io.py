"""Release-scoped inputs, guards, and report writing for solution display COGs.

The batch entry point in ``main.py`` targets the live Blob manifest and its
``solutions/nacional/`` layout. This module supports the release-scoped variant
in ``release_main.py``, which stages COGs beside the immutable solution rasters
already published under ``releases/<releaseId>/solutions/<domain>/``.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import urllib.parse
from pathlib import Path
from typing import Any

import numpy as np
import rasterio

UPLOAD_PLAN_FORMAT = "solution-source-upload-plan-v1"
BUILD_REPORT_FORMAT = "solution-display-cog-build-report-v1"


class ReleaseCogError(RuntimeError):
    """The release COG build cannot proceed safely."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("w", encoding="utf-8") as target:
        json.dump(value, target, indent=2, ensure_ascii=False, sort_keys=True)
        target.write("\n")
        target.flush()
        os.fsync(target.fileno())
    temporary.replace(path)


def cog_basename(raster_file: str, epsg: int) -> str:
    """``Eco17+RUNAP.tif`` -> ``Eco17+RUNAP.epsg9377.cog.tif``.

    The ``.epsg<code>`` marker matches the published production COGs so the two
    generations are recognisably the same artifact class. It asserts the CRS of
    the output, not that a warp was performed.
    """
    stem = raster_file.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    return f"{stem}.epsg{epsg}.cog.tif"


def cog_blob_path(release_id: str, domain: str, raster_file: str, epsg: int) -> str:
    return f"releases/{release_id}/solutions/{domain}/{cog_basename(raster_file, epsg)}"


def cog_public_url(public_blob_host: str, blob_path: str) -> str:
    # Release source rasters publish unencoded "+" in their paths, and the
    # uploader's plan check round-trips through unquote(). Matching that keeps
    # displayCogUrl textually consistent with the sibling displayUrl.
    return f"{public_blob_host.rstrip('/')}/{blob_path}"


def load_solutions(manifest_path: Path, plan_path: Path, domain: str) -> list[dict[str, Any]]:
    """Join runtime-manifest solution identity with local, checksum-pinned sources."""
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    if plan.get("format") != UPLOAD_PLAN_FORMAT:
        raise ReleaseCogError(f"source upload plan format must be {UPLOAD_PLAN_FORMAT!r}.")

    sources = {
        entry["solutionId"]: entry
        for entry in plan["entries"]
        if entry.get("artifactType") == "raster"
    }

    selected: list[dict[str, Any]] = []
    for solution in manifest["solutions"]:
        if solution.get("domain") != domain:
            continue
        source = sources.get(solution["id"])
        if source is None:
            raise ReleaseCogError(f"no source raster in the upload plan for {solution['id']}.")
        if source["artifactSha256"] != solution.get("rasterSha256"):
            raise ReleaseCogError(
                f"upload plan and manifest disagree on the source checksum for {solution['id']}."
            )
        selected.append(
            {
                "solutionId": solution["id"],
                "solutionName": solution.get("name"),
                "domain": solution["domain"],
                "rasterFile": solution["rasterFile"],
                "sourcePath": Path(source["sourcePath"]),
                "sourceSha256": source["artifactSha256"],
                "sourceBlobPath": solution["blobPath"],
            }
        )
    if not selected:
        raise ReleaseCogError(f"no {domain} solutions found in {manifest_path}.")
    return selected


def verify_local_source(source: dict[str, Any]) -> int:
    path: Path = source["sourcePath"]
    if not path.is_file():
        raise ReleaseCogError(f"local source raster is missing: {path}")
    observed = sha256_file(path)
    if observed != source["sourceSha256"]:
        raise ReleaseCogError(
            f"local source raster does not match its published checksum: {path}"
        )
    return path.stat().st_size


def assert_source_needs_no_warp(metadata: dict[str, Any], *, epsg: int, source_path: Path) -> None:
    """Refuse to silently reproject.

    These rasters are already in the display CRS, so the COG step is a pure
    repackaging. A source in any other CRS is a change in upstream assumptions
    that a human should look at rather than something to quietly warp.
    """
    if metadata.get("epsg") != epsg:
        raise ReleaseCogError(
            f"expected an EPSG:{epsg} source but {source_path} reports EPSG:{metadata.get('epsg')}; "
            "reprojection would resample categorical selection values, so this needs a human decision."
        )


def _nodata_matches(left: float | None, right: float | None) -> bool:
    if left is None or right is None:
        return left is right
    if math.isnan(left) and math.isnan(right):
        return True
    return left == right


def assert_grid_preserved(source_path: Path, cog_path: Path) -> dict[str, Any]:
    """Confirm COG creation repackaged the raster without moving or retyping it."""
    with rasterio.open(source_path) as source, rasterio.open(cog_path) as cog:
        mismatches = []
        if (source.width, source.height) != (cog.width, cog.height):
            mismatches.append("size")
        if source.crs != cog.crs:
            mismatches.append("crs")
        if not all(
            math.isclose(a, b, rel_tol=0.0, abs_tol=1e-9)
            for a, b in zip(source.transform, cog.transform)
        ):
            mismatches.append("transform")
        if source.dtypes != cog.dtypes:
            mismatches.append("dtype")
        if not _nodata_matches(source.nodata, cog.nodata):
            mismatches.append("nodata")
        if mismatches:
            raise ReleaseCogError(
                f"COG creation altered {', '.join(mismatches)} for {cog_path}; "
                "the display COG must be pixel-identical to its source."
            )
        return {
            "width": cog.width,
            "height": cog.height,
            "epsg": cog.crs.to_epsg() if cog.crs else None,
            "dtype": cog.dtypes[0],
            "nodataIsNan": cog.nodata is not None and math.isnan(cog.nodata),
        }


def _valid_values(band: np.ndarray, nodata: float | None) -> set[float]:
    finite = band[np.isfinite(band)]
    if nodata is not None and not math.isnan(nodata):
        finite = finite[finite != nodata]
    return {float(value) for value in np.unique(finite)}


def assert_categorical_overviews(cog_path: Path) -> dict[str, Any]:
    """Fail loudly if any overview level invented a value the solver never produced.

    Averaging resamplers blend neighbouring classes into values like 1.5, which
    would render as a class the solution does not contain. Every overview level
    must therefore be a strict subset of the full-resolution valid values.
    """
    with rasterio.open(cog_path) as dataset:
        levels = dataset.overviews(1)
        source_values = _valid_values(dataset.read(1), dataset.nodata)

    if not levels:
        raise ReleaseCogError(f"{cog_path} has no internal overviews to verify.")
    if not source_values:
        raise ReleaseCogError(f"{cog_path} has no valid values at full resolution.")

    checked = []
    for index, level in enumerate(levels):
        with rasterio.open(cog_path, OVERVIEW_LEVEL=index) as overview:
            values = _valid_values(overview.read(1), overview.nodata)
            shape = [overview.height, overview.width]
        invented = sorted(values - source_values)
        if invented:
            raise ReleaseCogError(
                f"{cog_path} overview /{level} contains values absent from the source: {invented}; "
                "overviews must use nearest-neighbour or mode resampling for categorical rasters."
            )
        checked.append(
            {
                "level": level,
                "shape": shape,
                "values": sorted(values),
            }
        )

    return {
        "sourceValues": sorted(source_values),
        "overviews": checked,
        "resamplingIsCategoricalSafe": True,
    }


def build_upload_plan(release_id: str, entries: list[dict[str, Any]]) -> dict[str, Any]:
    """Emit a plan the existing ``upload_solution_sources.py`` can execute verbatim."""
    plan_entries = [
        {
            "artifactSha256": entry["cogSha256"],
            "artifactType": "raster",
            "bytes": entry["cogBytes"],
            "expectedBlobPath": entry["expectedBlobPath"],
            "expectedPublicUrl": entry["expectedPublicUrl"],
            "solutionId": entry["solutionId"],
            "sourcePath": entry["stagedPath"],
            "status": "upload-required",
        }
        for entry in entries
    ]
    return {
        "artifactCount": len(plan_entries),
        "counts": {"alreadyPresent": 0, "uploadRequired": len(plan_entries)},
        "entries": plan_entries,
        "format": UPLOAD_PLAN_FORMAT,
        "prefix": f"releases/{release_id}/solutions/",
        "releaseId": release_id,
    }


def load_previous_build_report(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    entries = payload.get("entries") if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        return {}
    return {str(entry.get("solutionId")): entry for entry in entries if isinstance(entry, dict)}


def quote_public_url(url: str) -> str:
    """Percent-encoded form, used only for report readability."""
    parts = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit(parts._replace(path=urllib.parse.quote(parts.path, safe="/")))
