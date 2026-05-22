"""Shared helpers for inspect/publish CLIs."""

from __future__ import annotations

import re
import sys
from pathlib import Path

from local_io import DEFAULT_OUTPUT_DIR

BLOB_TOKEN_ENV_VAR = "BLOB_READ_WRITE_TOKEN"
_URL_RE = re.compile(r"https://\S+")


def find_repo_root(start: Path | None = None) -> Path:
    current = (start or Path.cwd()).resolve()
    for candidate in [current, *current.parents]:
        if (candidate / ".git").exists():
            return candidate
    return current


def load_env_value(repo_root: Path, key: str) -> str | None:
    for filename in (".env.local", ".env.production.local", ".env"):
        path = repo_root / filename
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            name, _, value = stripped.partition("=")
            if name.strip() != key:
                continue
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            return value
    return None


def resolve_output_dir(repo_root: Path, output_dir: Path) -> Path:
    if output_dir.is_absolute():
        return output_dir
    return repo_root / output_dir


def default_report_path(repo_root: Path, output_dir: Path) -> Path:
    return resolve_output_dir(repo_root, output_dir) / "publish-report.json"


def print_inspect_summary(result, *, prefix: str = "[tier1-inspect]") -> None:
    print(f"{prefix} report: {result.report_path}")
    print(
        f"{prefix} checked {result.entries_checked} solution(s); "
        f"{result.entries_ok} passed validation"
    )
    if result.national_status_totals:
        totals = ", ".join(
            f"{status}={count}"
            for status, count in sorted(result.national_status_totals.items())
        )
        print(f"{prefix} national metric statuses (summed across checked solutions): {totals}")
    if result.issues:
        print(f"{prefix} {len(result.issues)} issue(s):", file=sys.stderr)
        for issue in result.issues:
            print(f"{prefix}   {issue.solution_id}: {issue.message}", file=sys.stderr)


def extract_first_url(output: str) -> str | None:
    match = _URL_RE.search(output)
    return match.group(0) if match else None


def default_output_dir() -> Path:
    return DEFAULT_OUTPUT_DIR
