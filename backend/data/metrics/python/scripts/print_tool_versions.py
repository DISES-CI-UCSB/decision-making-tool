"""Print the geospatial tool versions the metrics pipeline stamps into cache manifests.

Aligned-raster manifests (``raster_align.tool_versions``) and species-overlap
manifests (``species_overlap.species_tool_versions``) are only reused when the
recorded versions equal the running ones. Run this on each machine and diff the
output: identical JSON means a copied cache can stay warm; any difference means
those caches will be rebuilt (cold).

Read-only: imports the pipeline functions and prints JSON to stdout.

Example (from data/metrics/python):

    .venv/bin/python scripts/print_tool_versions.py           # macOS
    .venv\\Scripts\\python.exe scripts\\print_tool_versions.py  # Windows
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "metrics_pipeline"))

from raster_align import tool_versions  # noqa: E402
from species_overlap import species_tool_versions  # noqa: E402


def main() -> int:
    versions = {
        "rasterAlign": tool_versions(),
        "speciesOverlap": species_tool_versions(),
    }
    rendered = json.dumps(versions, indent=2, sort_keys=True) + "\n"
    sys.stdout.buffer.write(rendered.encode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
