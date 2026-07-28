"""Resolve Prioritizr summary CSVs from land CSV or marine JSON metadata."""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlsplit, urlunsplit


class SummaryMetadataError(RuntimeError):
    """Raised when metadata cannot identify a usable summary CSV."""


def resolve_summary_csv_url(
    metadata_url: str,
    *,
    metadata_document: dict[str, Any] | None = None,
    timeout: int = 30,
) -> str:
    """Return a direct summary CSV URL for land CSV or marine JSON metadata."""
    value = metadata_url.strip()
    if not value:
        raise SummaryMetadataError("Solution metadataUrl is empty.")

    parsed = urlsplit(value)
    if parsed.path.lower().endswith(".csv"):
        return value
    if not parsed.path.lower().endswith(".json"):
        raise SummaryMetadataError(
            f"Unsupported solution metadataUrl '{metadata_url}'; expected .csv or .json."
        )

    metadata = (
        metadata_document
        if metadata_document is not None
        else _load_metadata_document(value, timeout=timeout)
    )
    coverage_summary = metadata.get("coverage_summary")
    if not isinstance(coverage_summary, dict):
        raise SummaryMetadataError(
            f"JSON metadata '{metadata_url}' has no coverage_summary object."
        )
    summary_file = coverage_summary.get("summary_file")
    if not isinstance(summary_file, str) or not summary_file.strip():
        raise SummaryMetadataError(
            f"JSON metadata '{metadata_url}' has no coverage_summary.summary_file."
        )

    return _sibling_url(value, summary_file.strip())


def _load_metadata_document(metadata_url: str, *, timeout: int) -> dict[str, Any]:
    parsed = urlsplit(metadata_url)
    if parsed.scheme in {"http", "https"}:
        request = urllib.request.Request(
            metadata_url,
            headers={"User-Agent": "tier1-metrics/0.1"},
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    elif parsed.scheme == "file":
        payload = json.loads(Path(unquote(parsed.path)).read_text(encoding="utf-8"))
    elif not parsed.scheme:
        payload = json.loads(Path(metadata_url).read_text(encoding="utf-8"))
    else:
        raise SummaryMetadataError(
            f"Unsupported metadata URL scheme '{parsed.scheme}'."
        )

    if not isinstance(payload, dict):
        raise SummaryMetadataError(
            f"JSON metadata '{metadata_url}' is not an object."
        )
    return payload


def _sibling_url(metadata_url: str, summary_file: str) -> str:
    parsed = urlsplit(metadata_url)
    if parsed.scheme in {"http", "https"}:
        filename = quote(unquote(summary_file), safe="+-._~")
        parent = parsed.path.rsplit("/", 1)[0]
        return urlunsplit((
            parsed.scheme,
            parsed.netloc,
            f"{parent}/{filename}",
            parsed.query,
            "",
        ))
    if parsed.scheme == "file":
        sibling = Path(unquote(parsed.path)).parent / summary_file
        return sibling.resolve().as_uri()
    return str(Path(metadata_url).parent / summary_file)
