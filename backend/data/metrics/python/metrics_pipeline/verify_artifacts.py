"""Emit local/remote integrity reports for regular and MEC metric artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any

from cli_utils import find_repo_root
from compact_metrics import to_verbose_document
from metrics_contract import PROVENANCE_KEY, regular_artifact_completeness_issues
from solution_domain import normalize_domain

MIN_CACHE_MAX_AGE_SECONDS = 2_592_000


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _cache_max_age_seconds(cache_control: str) -> int | None:
    for directive in cache_control.split(","):
        name, separator, value = directive.strip().partition("=")
        if separator and name.lower() == "max-age":
            try:
                return int(value)
            except ValueError:
                return None
    return None


def verify_entry(
    entry: dict[str, Any],
    *,
    repo_root: Path,
    fetch: Callable[[str], tuple[bytes, dict[str, str]]],
) -> dict[str, Any]:
    cache_path = entry.get("cachePath")
    if not isinstance(cache_path, str) or not cache_path:
        raise ValueError("publish report entry must declare canonical cachePath")
    local_path = Path(cache_path)
    if not local_path.is_absolute():
        local_path = repo_root / local_path
    local_bytes = local_path.read_bytes()
    document = json.loads(local_bytes)
    contract_issues: list[str] = []
    if document.get("format") in {None, "metrics-verbose-v1", "metrics-compact-v1"}:
        try:
            verbose = to_verbose_document(document)
            provenance = verbose.get(PROVENANCE_KEY)
            config = provenance.get("generationConfig") if isinstance(provenance, dict) else None
            domain = normalize_domain(
                provenance.get("solutionDomain") if isinstance(provenance, dict) else None
            )
            contract_issues = regular_artifact_completeness_issues(
                verbose,
                national_only=bool(config.get("nationalOnly")) if isinstance(config, dict) else False,
                domain=domain,
                skip_species=bool(config.get("speciesSkipped")) if isinstance(config, dict) else False,
                regional_packet=bool(config.get("regionalPacket"))
                if isinstance(config, dict)
                else False,
            )
        except (IndexError, KeyError, TypeError, ValueError) as exc:
            contract_issues = [f"invalid regular metrics artifact: {exc}"]
    remote_bytes, headers = fetch(str(entry["expectedPublicUrl"]))
    content_type = headers.get("content-type", "").split(";", 1)[0].lower()
    cache_control = headers.get("cache-control", "")
    result = {
        "solutionId": entry.get("solutionId"),
        "geographyLevel": entry.get("geographyLevel"),
        "url": entry["expectedPublicUrl"],
        "format": document.get("format", "metrics-verbose-v1"),
        "local": {"bytes": len(local_bytes), "sha256": _sha256(local_bytes)},
        "remote": {
            "bytes": len(remote_bytes),
            "sha256": _sha256(remote_bytes),
            "contentType": content_type,
            "cacheControl": cache_control,
        },
        "contractIssues": contract_issues,
    }
    result["ok"] = (
        result["local"] == {
            "bytes": result["remote"]["bytes"],
            "sha256": result["remote"]["sha256"],
        }
        and content_type in {"application/json", "application/geo+json"}
        and (_cache_max_age_seconds(cache_control) or 0)
        >= MIN_CACHE_MAX_AGE_SECONDS
        and not contract_issues
    )
    return result


def _fetch(
    url: str,
    *,
    max_attempts: int = 4,
    retry_base_seconds: float = 0.5,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[bytes, dict[str, str]]:
    request = urllib.request.Request(
        url, headers={"User-Agent": "dises-artifact-verifier/1.0"}
    )
    for attempt in range(1, max_attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read(), {
                    key.lower(): value for key, value in response.headers.items()
                }
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            if attempt == max_attempts:
                raise
            sleep(retry_base_seconds * (2 ** (attempt - 1)))

    raise AssertionError("artifact verification retry loop did not return or raise")


def verify_report(
    report_path: Path,
    *,
    repo_root: Path,
    fetch: Callable[[str], tuple[bytes, dict[str, str]]] = _fetch,
) -> dict[str, Any]:
    report = json.loads(report_path.read_text(encoding="utf-8"))
    entries = [
        verify_entry(entry, repo_root=repo_root, fetch=fetch)
        for entry in report.get("entries") or []
    ]
    return {
        "format": "metric-artifact-verification-v1",
        "sourceReport": str(report_path),
        "ok": bool(entries) and all(entry["ok"] for entry in entries),
        "entries": entries,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()
    result = verify_report(args.report, repo_root=find_repo_root())
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
