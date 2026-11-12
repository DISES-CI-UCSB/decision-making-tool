from __future__ import annotations

import json
from pathlib import Path

from app.downloads.catalog import FileObjectCatalog
from scripts.build_download_catalog import main

PUBLIC_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
NATIONAL_LAYER = "inputs/reference/ramsar/v0.1.0/ramsar.geojson"
SHARED_LAYER = "inputs/reference/orinoquia_savannas/v0.1.0/orinoquia_savannas.metadata.json"
ORINOQUIA_SOLUTION = "releases/sirap-test/orinoquia/solution.tif"
UNLISTED = "releases/catalog-v3-7-1/manifest.json"


def _write(path: Path, document: dict[str, object]) -> str:
    path.write_text(json.dumps(document), encoding="utf-8")
    return str(path)


def _manifests(tmp_path: Path) -> list[str]:
    national = _write(
        tmp_path / "national.json",
        {
            "layers": [
                {"blobPath": NATIONAL_LAYER},
                {"metadataUrl": f"{PUBLIC_HOST}/{SHARED_LAYER}"},
            ],
            "solutions": [],
        },
    )
    sirap = _write(
        tmp_path / "sirap.json",
        {
            "solutions": [
                {
                    "scope": "sirap",
                    "sirapId": "orinoquia",
                    "blobPath": ORINOQUIA_SOLUTION,
                    "metadataUrl": f"{PUBLIC_HOST}/{SHARED_LAYER}",
                }
            ]
        },
    )
    return [national, sirap]


def test_merged_catalog_keeps_national_and_restricted_tags(tmp_path: Path) -> None:
    national, sirap = _manifests(tmp_path)
    output = tmp_path / "out" / "download-catalog.json"

    exit_code = main(["--manifest", national, "--manifest", sirap, "--output", str(output)])

    assert exit_code == 0
    catalog = FileObjectCatalog(output)
    assert catalog.lookup(NATIONAL_LAYER).sirap_id is None
    assert catalog.lookup(ORINOQUIA_SOLUTION).sirap_id == "orinoquia"
    assert catalog.lookup(SHARED_LAYER).sirap_id == "orinoquia"
    assert catalog.lookup(UNLISTED) is None
    assert json.loads(output.read_text(encoding="utf-8"))["sources"] == [national, sirap]


def test_empty_manifests_write_no_catalog(tmp_path: Path) -> None:
    empty = _write(tmp_path / "empty.json", {"layers": [], "solutions": []})
    output = tmp_path / "download-catalog.json"

    assert main(["--manifest", empty, "--output", str(output)]) == 1
    assert not output.exists()
