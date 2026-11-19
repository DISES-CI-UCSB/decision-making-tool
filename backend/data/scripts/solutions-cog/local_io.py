"""Local cache management and publish-report writes for solution COGs."""

from __future__ import annotations

import hashlib
import json
import shutil
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_CACHE_DIR = Path("data/cog/cache")
DEFAULT_OUTPUT_DIR = Path("data/cog/generated")
SOLUTION_BLOB_DIRECTORY = "solutions/nacional"
COG_SUFFIX = ".cog.tif"


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
            sha256=sha256_file(target),
            bytes=target.stat().st_size,
        )

    tmp = target.with_suffix(target.suffix + ".part")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "solutions-cog/0.1"})
        with urllib.request.urlopen(req, timeout=120) as response, tmp.open("wb") as out:
            shutil.copyfileobj(response, out)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
        tmp.unlink(missing_ok=True)
        raise DownloadError(f"Failed to download {url}: {exc}") from exc

    tmp.replace(target)
    return CachedDownload(
        url=url,
        path=target,
        sha256=sha256_file(target),
        bytes=target.stat().st_size,
    )


def _suffix_from_url(url: str) -> str:
    leaf = url.rsplit("?", 1)[0].rsplit("/", 1)[-1]
    decoded_leaf = urllib.parse.unquote(leaf)
    if "." in decoded_leaf:
        return "." + decoded_leaf.rsplit(".", 1)[-1]
    return ""


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def staged_cog_path(output_dir: Path, solution_basename: str) -> Path:
    return output_dir / "blob-staged" / SOLUTION_BLOB_DIRECTORY / f"{solution_basename}{COG_SUFFIX}"


def expected_blob_path(solution_basename: str) -> str:
    return f"{SOLUTION_BLOB_DIRECTORY}/{solution_basename}{COG_SUFFIX}"


def expected_public_url(public_blob_host: str, solution_basename: str) -> str:
    blob_path = expected_blob_path(solution_basename)
    quoted_path = urllib.parse.quote(blob_path, safe="/")
    return f"{public_blob_host.rstrip('/')}/{quoted_path}"


def load_latest_publish_report(output_dir: Path) -> dict[str, Any] | None:
    target = output_dir / "publish-report.json"
    if not target.exists():
        return None
    with target.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return payload if isinstance(payload, dict) else None


def previous_entry_by_solution_id(report: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    if not report:
        return {}
    entries = report.get("entries")
    if not isinstance(entries, list):
        return {}
    return {
        str(entry.get("solutionId")): entry
        for entry in entries
        if isinstance(entry, dict) and entry.get("solutionId")
    }


def write_publish_report(output_dir: Path, report: dict[str, Any]) -> Path:
    target = output_dir / "publish-report.json"
    target.parent.mkdir(parents=True, exist_ok=True)

    if target.exists():
        runs_dir = output_dir / "runs"
        runs_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        archive_path = runs_dir / f"publish-report.{timestamp}.json"
        shutil.copy2(target, archive_path)

    with target.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    return target
