"""Audit SIRAP matrix species names without decoding matrix cell bodies."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import struct
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from species_data import load_species_records
from species_taxonomy import normalize_class_name
from sparse.format import SMSP_MAGIC


def normalize_species_name(value: str) -> str:
    return " ".join(value.replace("_", " ").strip().lower().split())


def local_path(url: str) -> Path:
    parsed = urlparse(url)
    if parsed.scheme != "file":
        raise ValueError(f"audit requires a local file URL, received {url!r}")
    return Path(unquote(parsed.path))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_toc(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rb") as source:
        header = source.read(8)
        if len(header) != 8 or header[:4] != SMSP_MAGIC:
            raise ValueError(f"{path} is not an SMSP matrix")
        toc_length = struct.unpack("<I", header[4:])[0]
        toc_bytes = source.read(toc_length)
    if len(toc_bytes) != toc_length:
        raise ValueError(f"{path} has a truncated SMSP table of contents")
    return json.loads(toc_bytes.decode("utf-8"))


def audit_manifest(path: Path) -> dict[str, Any]:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    solutions = manifest["solutions"]
    species = solutions[0]["regionalInputPacket"]["species"]
    expected_species = species["matrices"]
    if any(
        solution["regionalInputPacket"]["species"]["matrices"] != expected_species
        for solution in solutions[1:]
    ):
        raise ValueError("solutions in one regional manifest use different matrices")

    lookup_path = local_path(species["metadataLookup"]["url"])
    if sha256_file(lookup_path) != species["metadataLookup"]["sha256"]:
        raise ValueError("national species lookup checksum mismatch")
    national = load_species_records(lookup_path)
    national_by_name = {
        normalize_species_name(record.scientific_name): record for record in national
    }
    if len(national_by_name) != len(national):
        raise ValueError("national lookup has ambiguous normalized species names")

    regional_names: Counter[str] = Counter()
    matched_by_class: Counter[str] = Counter()
    unmatched_by_class: Counter[str] = Counter()
    class_mismatch_by_class: Counter[str] = Counter()
    matrix_reports = []
    for binding in expected_species:
        matrix_path = local_path(binding["url"])
        observed_sha256 = sha256_file(matrix_path)
        if observed_sha256 != binding["sha256"]:
            raise ValueError(f"matrix checksum mismatch: {matrix_path}")
        toc = read_toc(matrix_path)
        declared_class = normalize_class_name(binding["taxonomicClass"])
        entries = toc.get("species") or []
        for entry in entries:
            name = str(entry["name"])
            normalized_name = normalize_species_name(name)
            regional_names[normalized_name] += 1
            national_record = national_by_name.get(normalized_name)
            if national_record is None:
                unmatched_by_class[declared_class] += 1
            elif normalize_class_name(national_record.csv_class) != declared_class:
                class_mismatch_by_class[declared_class] += 1
            else:
                matched_by_class[declared_class] += 1
        matrix_reports.append(
            {
                "taxonomicClass": binding["taxonomicClass"],
                "speciesCount": len(entries),
                "sha256": observed_sha256,
            }
        )

    duplicate_names = sorted(
        name for name, count in regional_names.items() if count > 1
    )
    report = {
        "format": "sirap-species-name-join-audit-v1",
        "regionId": manifest["regionId"],
        "solutionCount": len(solutions),
        "nationalDenominator": len(national),
        "regionalSpeciesCount": sum(regional_names.values()),
        "uniqueRegionalSpeciesCount": len(regional_names),
        "matchedCount": sum(matched_by_class.values()),
        "unmatchedCount": sum(unmatched_by_class.values()),
        "duplicateNameCount": len(duplicate_names),
        "classMismatchCount": sum(class_mismatch_by_class.values()),
        "matchedByClass": dict(sorted(matched_by_class.items())),
        "unmatchedByClass": dict(sorted(unmatched_by_class.items())),
        "classMismatchByClass": dict(sorted(class_mismatch_by_class.items())),
        "duplicateNames": duplicate_names,
        "matrices": matrix_reports,
        "status": (
            "ready"
            if not unmatched_by_class
            and not duplicate_names
            and not class_mismatch_by_class
            else "blocked"
        ),
    }
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = audit_manifest(args.manifest)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["status"] != "ready":
        raise SystemExit(2)


if __name__ == "__main__":
    main()
