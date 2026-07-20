"""Local cache management, sidecar JSON writes, and publish-report writes.

All writes go under an ignored local artifact directory; the publish report
records the deterministic Blob path each sidecar should be uploaded to so the
upload step (run separately) does not have to re-derive paths.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from path_contracts import (
    solution_artifact_name,
    solution_artifact_path,
    solution_blob_path,
    solution_public_url,
)

DEFAULT_CACHE_DIR = Path("data/metrics/cache/tier1")
DEFAULT_OUTPUT_DIR = Path("data/metrics/generated/tier1")
# Legacy sidecar (national-only flat format kept for backwards compatibility).
SOLUTION_BLOB_DIRECTORY = "solutions/nacional"
SIDECAR_SUFFIX = ".tier1-metrics.json"
# Canonical multi-geography cache (T5+).
CACHE_BLOB_DIRECTORY = "metrics/cache"
CACHE_SUFFIX = ".metrics.json"


class DownloadError(RuntimeError):
    pass


@dataclass(frozen=True)
class CachedDownload:
    url: str
    path: Path
    sha256: str
    bytes: int


def cached_download(url: str, cache_dir: Path, *, force: bool = False) -> CachedDownload:
    cache_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
    suffix = _suffix_from_url(url)
    target = cache_dir / f"{digest}{suffix}"

    if target.exists() and not force:
        return CachedDownload(
            url=url,
            path=target,
            sha256=_sha256_file(target),
            bytes=target.stat().st_size,
        )

    tmp = target.with_name(f".{target.name}.{os.getpid()}.part")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "tier1-metrics/0.1"})
        with urllib.request.urlopen(req, timeout=120) as response, tmp.open("wb") as out:
            shutil.copyfileobj(response, out)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        raise DownloadError(f"Failed to download {url}: {exc}") from exc

    tmp.replace(target)
    return CachedDownload(
        url=url,
        path=target,
        sha256=_sha256_file(target),
        bytes=target.stat().st_size,
    )


def _suffix_from_url(url: str) -> str:
    leaf = url.rsplit("?", 1)[0].rsplit("/", 1)[-1]
    if "." in leaf:
        return "." + leaf.rsplit(".", 1)[-1]
    return ""


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def staged_sidecar_path(output_dir: Path, solution_basename: str) -> Path:
    return output_dir / "blob-staged" / SOLUTION_BLOB_DIRECTORY / f"{solution_basename}{SIDECAR_SUFFIX}"


def expected_blob_path(solution_basename: str) -> str:
    return f"{SOLUTION_BLOB_DIRECTORY}/{solution_basename}{SIDECAR_SUFFIX}"


def expected_public_url(public_blob_host: str, solution_basename: str) -> str:
    return f"{public_blob_host.rstrip('/')}/{expected_blob_path(solution_basename)}"


def write_solution_sidecar(
    output_dir: Path,
    solution_basename: str,
    response: dict[str, Any],
) -> Path:
    target = staged_sidecar_path(output_dir, solution_basename)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as handle:
        json.dump(response, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    return target


def cache_solution_path(output_dir: Path, solution_id: str) -> Path:
    return solution_artifact_path(output_dir, solution_id, suffix=CACHE_SUFFIX)


def expected_cache_blob_path(
    solution_id: str,
    *,
    cache_blob_directory: str = CACHE_BLOB_DIRECTORY,
) -> str:
    return solution_blob_path(
        solution_id,
        blob_directory=cache_blob_directory,
        suffix=CACHE_SUFFIX,
    )


def expected_cache_public_url(
    public_blob_host: str,
    solution_id: str,
    *,
    cache_blob_directory: str = CACHE_BLOB_DIRECTORY,
) -> str:
    return solution_public_url(
        public_blob_host,
        solution_id,
        blob_directory=cache_blob_directory,
        suffix=CACHE_SUFFIX,
    )


def write_solution_cache(
    output_dir: Path,
    solution_id: str,
    doc: dict[str, Any],
) -> Path:
    """Write the multi-geography wrapped metrics doc for one solution.

    Writes to output_dir/cache/{solution_id}.metrics.json.
    The Vercel blob target is metrics/cache/{solution_id}.metrics.json (T7).
    """
    target = cache_solution_path(output_dir, solution_id)
    _write_json_atomic(target, doc)
    return target


def write_publish_report(output_dir: Path, report: dict[str, Any]) -> Path:
    target = output_dir / "publish-report.json"
    _write_json_atomic(target, report)
    return target


def _write_json_atomic(target: Path, doc: dict[str, Any]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(doc, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    tmp.replace(target)


def write_example_output(
    examples_dir: Path,
    solution_id: str,
    national_metrics: list[dict[str, Any]],
    generated_at: str,
) -> Path:
    """Write a geography-wrapped example JSON for one solution.

    The file lives at examples_dir/{solution_id}.metrics.json and uses a
    geography-keyed structure so future boundary levels (departments,
    municipalities, SIRAPs) can be added without changing the shape:

        {
          "solutionId": "...",
          "generatedAt": "...",
          "geographies": {
            "national": {
              "colombia": { "metrics": [...] }
            }
          }
        }

    This file is for local inspection only; it is not published to Vercel.
    """
    doc = {
        "solutionId": solution_id,
        "generatedAt": generated_at,
        "geographies": {
            "national": {
                "colombia": {
                    "metrics": national_metrics,
                }
            }
        },
    }
    target = examples_dir / solution_artifact_name(solution_id, suffix=CACHE_SUFFIX)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as handle:
        json.dump(doc, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    return target
