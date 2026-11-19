"""Build and immutably upload approved display-only reference layers.

Examples:
    python main.py build
    python main.py upload
    python main.py all
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
sys.path.insert(0, str(SCRIPT_DIR))

from helpers.blob import load_token, upload_immutable
from helpers.pipeline import build_asset, utc_now, write_json
from sources.ant_zrc.source import ASSETS as ANT_ASSETS
from sources.colombia_outline.source import ASSETS as OUTLINE_ASSETS
from sources.mads_distincion.source import ASSETS as MADS_DISTINCION_ASSETS
from sources.mads_ley2.source import ASSETS as MADS_LEY2_ASSETS

ASSETS = (
    *ANT_ASSETS,
    *MADS_DISTINCION_ASSETS,
    *MADS_LEY2_ASSETS,
    *OUTLINE_ASSETS,
)
DEFAULT_WORK_DIR = SCRIPT_DIR / "work"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("build", "upload", "all"))
    parser.add_argument("--work-dir", type=Path, default=DEFAULT_WORK_DIR)
    parser.add_argument(
        "--asset",
        action="append",
        choices=tuple(asset["id"] for asset in ASSETS),
        help="Process only this stable layer ID; repeat to select multiple.",
    )
    return parser.parse_args(argv)


def selected_assets(ids: list[str] | None) -> tuple[dict[str, object], ...]:
    selected = set(ids or ())
    return tuple(asset for asset in ASSETS if not selected or asset["id"] in selected)


def build(assets: tuple[dict[str, object], ...], work_dir: Path) -> dict[str, object]:
    entries = []
    for asset in assets:
        print(f"[reference-layers] building {asset['id']}")
        entries.append(build_asset(asset, work_dir))
    report = {
        "generatedAt": utc_now(),
        "status": "passed",
        "roleInMetricCalculation": "none",
        "entries": entries,
    }
    write_json(work_dir / "validation-report.json", report)
    return report


def load_report(work_dir: Path) -> dict[str, object]:
    path = work_dir / "validation-report.json"
    if not path.is_file():
        raise RuntimeError(f"build report does not exist: {path}")
    report = json.loads(path.read_text(encoding="utf-8"))
    if report.get("status") != "passed":
        raise RuntimeError("validation report is not in passed state")
    return report


def upload(
    assets: tuple[dict[str, object], ...],
    work_dir: Path,
) -> dict[str, object]:
    report = load_report(work_dir)
    selected = {asset["id"] for asset in assets}
    entries = [
        entry for entry in report["entries"] if entry["layerId"] in selected
    ]
    if len(entries) != len(selected):
        missing = selected - {entry["layerId"] for entry in entries}
        raise RuntimeError(f"build report is missing selected assets: {sorted(missing)}")

    token = load_token(REPO_ROOT)
    uploads = []
    for entry in entries:
        print(f"[reference-layers] uploading {entry['layerId']}")
        uploads.append(
            upload_immutable(
                Path(entry["geojsonPath"]), entry["geojsonBlobPath"], token
            )
        )
        uploads.append(
            upload_immutable(
                Path(entry["metadataPath"]), entry["metadataBlobPath"], token
            )
        )
    upload_report = {
        "verifiedAt": utc_now(),
        "status": "passed",
        "uploads": uploads,
    }
    write_json(work_dir / "upload-report.json", upload_report)
    return upload_report


def main(argv: list[str] | None = None) -> int:
    arguments = parse_args(argv)
    work_dir = arguments.work_dir.resolve()
    assets = selected_assets(arguments.asset)
    try:
        if arguments.stage in {"build", "all"}:
            build(assets, work_dir)
        if arguments.stage in {"upload", "all"}:
            upload(assets, work_dir)
    except (OSError, RuntimeError, ValueError) as error:
        print(f"[reference-layers] ERROR: {error}", file=sys.stderr)
        return 1
    print(f"[reference-layers] {arguments.stage} passed for {len(assets)} assets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
