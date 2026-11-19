"""Local visual-only Colombia outline source.

Set COLOMBIA_OUTLINE_LOCAL_PATH to the .shp file. Set
COLOMBIA_OUTLINE_SOURCE_URL when the source link should differ from that file.
"""

import os
from pathlib import Path


def _outline_local_path() -> str:
    return os.environ.get("COLOMBIA_OUTLINE_LOCAL_PATH", "").strip()


def _outline_source_url(local_path: str) -> str:
    configured = os.environ.get("COLOMBIA_OUTLINE_SOURCE_URL", "").strip()
    if configured:
        return configured
    if local_path:
        return Path(local_path).as_uri()
    return ""


_LOCAL_PATH = _outline_local_path()

ASSETS = (
    {
        "id": "colombia_outline_visual",
        "title": "Colombia national outline (visual only)",
        "organization": "DISES local boundary source",
        "kind": "shapefile",
        "source_url": _outline_source_url(_LOCAL_PATH),
        "local_path": _LOCAL_PATH,
        "source_crs": "EPSG:9377",
        "visual_only": True,
    },
)
