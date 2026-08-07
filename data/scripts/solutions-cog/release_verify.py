"""Verify published release display COGs against their staged bytes.

Reads every URL out of the build report, downloads it, and confirms the remote
object matches the local COG byte-for-byte and is served with the headers the
map client needs. Writes a verification document beside the release's other
verification reports and exits non-zero on any discrepancy.

    data/metrics/python/.venv/bin/python data/scripts/solutions-cog/release_verify.py \
        --build-report data/metrics/generated/releases/<releaseId>/display-cogs/cog-build-report.json \
        --output data/metrics/generated/releases/<releaseId>/verification/display-cogs-verification.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from release_io import atomic_write_json

VERIFICATION_FORMAT = "solution-display-cog-verification-v1"
EXPECTED_CONTENT_TYPE = "image/tiff"
EXPECTED_CACHE_CONTROL = "public, max-age=2592000"


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=8)
    return parser.parse_args(argv)


def _verify_one(entry: dict[str, Any]) -> dict[str, Any]:
    url = entry["expectedPublicUrl"]
    request = urllib.request.Request(url, headers={"User-Agent": "dises-display-cog-verifier/1"})
    problems: list[str] = []
    remote: dict[str, Any] = {}
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            body = response.read()
            headers = response.headers
        remote = {
            "status": 200,
            "bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest(),
            "contentType": headers.get("Content-Type"),
            "cacheControl": headers.get("Cache-Control"),
            "etag": headers.get("ETag"),
            "acceptRanges": headers.get("Accept-Ranges"),
        }
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
        code = getattr(exc, "code", None)
        remote = {"status": code, "bytes": None, "sha256": None}
        problems.append(f"request failed: {exc}")

    if remote.get("sha256") is not None:
        if remote["sha256"] != entry["cogSha256"]:
            problems.append("remote SHA-256 differs from the staged COG")
        if remote["bytes"] != entry["cogBytes"]:
            problems.append("remote byte length differs from the staged COG")
        if remote.get("contentType") != EXPECTED_CONTENT_TYPE:
            problems.append(f"content type is {remote.get('contentType')!r}")
        if remote.get("cacheControl") != EXPECTED_CACHE_CONTROL:
            problems.append(f"cache control is {remote.get('cacheControl')!r}")
        # ImageryTileLayer fetches COG tiles with HTTP range requests.
        if remote.get("acceptRanges") != "bytes":
            problems.append(f"accept-ranges is {remote.get('acceptRanges')!r}")

    return {
        "solutionId": entry["solutionId"],
        "url": url,
        "blobPath": entry["expectedBlobPath"],
        "ok": not problems,
        "problems": problems,
        "local": {"bytes": entry["cogBytes"], "sha256": entry["cogSha256"]},
        "remote": remote,
    }


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    report = json.loads(args.build_report.read_text(encoding="utf-8"))
    entries = report["entries"]
    print(f"[display-cog-verify] verifying {len(entries)} published COG(s)")

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(_verify_one, entries))
    results.sort(key=lambda result: result["solutionId"])

    failures = [result for result in results if not result["ok"]]
    atomic_write_json(
        args.output,
        {
            "format": VERIFICATION_FORMAT,
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "releaseId": report["releaseId"],
            "domain": report["domain"],
            "ok": not failures,
            "artifactCount": len(results),
            "totalRemoteBytes": sum(r["remote"].get("bytes") or 0 for r in results),
            "expectations": {
                "contentType": EXPECTED_CONTENT_TYPE,
                "cacheControl": EXPECTED_CACHE_CONTROL,
                "acceptRanges": "bytes",
            },
            "entries": results,
        },
    )
    print(f"[display-cog-verify] wrote {args.output}")

    if failures:
        for failure in failures[:10]:
            print(
                f"[display-cog-verify] FAILED {failure['solutionId']}: {'; '.join(failure['problems'])}",
                file=sys.stderr,
            )
        print(f"[display-cog-verify] {len(failures)} of {len(results)} failed", file=sys.stderr)
        return 1

    print(f"[display-cog-verify] all {len(results)} COG(s) match their staged bytes and headers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
