"""Upgrade a retained SIRAP packet manifest with approved metric bindings."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from goal_summary import build_goal_summary

LAND_COVER_CLASSES = {
    "coberturas_artificial_surfaces": 1,
    "coberturas_agriculture": 2,
    "coberturas_agricultural_areas": 2,
    "coberturas_forests_and_semi_natural_areas": 3,
    "coberturas_wetlands": 4,
    "coberturas_water_bodies": 5,
}
LAYER_CLASSES = {
    "ecosistemas_IAVH_2024": "categorical",
    "biomasa": "fraction_or_density",
    "recarga_agua": "binary",
    **{layer_id: "categorical" for layer_id in LAND_COVER_CLASSES},
    "paramos": "categorical",
    "bosque_seco": "binary",
    "wetlands": "categorical",
    "resguardos": "binary",
    "comunidades": "binary",
    "runap_protegidas": "categorical",
    "runap_parques": "categorical",
}
LAND_COVER_CLASS_MAP = {
    "1": "Artificial surfaces",
    "2": "Agricultural areas",
    "3": "Forests and semi-natural areas",
    "4": "Wetlands",
    "5": "Water bodies",
}
RUNAP_CLASS_MAP = {"3": "Parque Nacional Natural"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pinned_file(path: Path) -> dict[str, str]:
    resolved = path.resolve()
    if not resolved.is_file():
        raise ValueError(f"required input does not exist: {resolved}")
    return {"url": resolved.as_uri(), "sha256": sha256_file(resolved)}


def provenance(
    *,
    region_id: str,
    kind: str,
    source_scope: str,
    authority: str,
    artifact_id: str,
) -> dict[str, str]:
    return {
        "kind": kind,
        "sourceScope": source_scope,
        "authority": authority,
        "artifactId": artifact_id,
        "approvedForRegionId": region_id,
    }


def qualify_layer(
    layer_id: str,
    binding: dict[str, Any],
    *,
    region_id: str,
    source_scope: str,
    authority: str,
    artifact_id: str,
    target_grid_sha256: str,
) -> dict[str, Any]:
    layer_class = LAYER_CLASSES[layer_id]
    return {
        **binding,
        "provenance": provenance(
            region_id=region_id,
            kind=(
                "approved-national-reference-v1"
                if source_scope == "national"
                else "regional-authoritative-v1"
            ),
            source_scope=source_scope,
            authority=authority,
            artifact_id=artifact_id,
        ),
        "alignment": {
            "layerClass": layer_class,
            "resampling": "average" if layer_class == "fraction_or_density" else "nearest",
            "targetGridSha256": target_grid_sha256,
        },
    }


def upgrade_manifest(
    source: dict[str, Any],
    *,
    region_id: str,
    regional_carbon: Path,
    land_cover: Path,
    land_cover_legend: Path,
    species_lookup: Path,
    national_runap: Path,
    runap_legend: Path,
) -> dict[str, Any]:
    land_cover_binding = pinned_file(land_cover)
    land_cover_legend_binding = {
        **pinned_file(land_cover_legend),
        "classMap": LAND_COVER_CLASS_MAP,
    }
    carbon_binding = pinned_file(regional_carbon)
    species_binding = pinned_file(species_lookup)
    runap_binding = pinned_file(national_runap)
    runap_legend_binding = {
        **pinned_file(runap_legend),
        "classMap": RUNAP_CLASS_MAP,
    }

    document = json.loads(json.dumps(source))
    solutions = document.get("solutions")
    if not isinstance(solutions, list) or not solutions:
        raise ValueError("input manifest contains no solutions")
    for solution in solutions:
        if solution.get("sirapId") != region_id:
            raise ValueError(
                f"solution {solution.get('id')!r} does not belong to {region_id!r}"
            )
        packet = solution["regionalInputPacket"]
        packet["format"] = "sirap-metric-input-packet-v2"
        grid_sha256 = packet["grid"]["sha256"]
        old_layers = packet["layers"]
        old_layers.pop("carbono_organico", None)
        old_layers.pop("runap_parques", None)

        layers: dict[str, Any] = {}
        for layer_id, binding in old_layers.items():
            if layer_id not in LAYER_CLASSES:
                continue
            layers[layer_id] = qualify_layer(
                layer_id,
                binding,
                region_id=region_id,
                source_scope="regional",
                authority="Authoritative SIRAP regional delivery",
                artifact_id=Path(binding["url"]).name,
                target_grid_sha256=grid_sha256,
            )
        layers["biomasa"] = qualify_layer(
            "biomasa",
            carbon_binding,
            region_id=region_id,
            source_scope="regional",
            authority="Nick McManus / SIRAP regional delivery",
            artifact_id=regional_carbon.name,
            target_grid_sha256=grid_sha256,
        )
        for layer_id, selected_value in LAND_COVER_CLASSES.items():
            layers[layer_id] = qualify_layer(
                layer_id,
                {
                    **land_cover_binding,
                    "rendering": {
                        "valueType": "binary",
                        "selectedValue": selected_value,
                    },
                    "legend": land_cover_legend_binding,
                },
                region_id=region_id,
                source_scope="national",
                authority="IDEAM",
                artifact_id=land_cover.name,
                target_grid_sha256=grid_sha256,
            )
        layers["runap_parques"] = qualify_layer(
            "runap_parques",
            {
                **runap_binding,
                "rendering": {"valueType": "binary", "selectedValue": 3},
                "legend": runap_legend_binding,
            },
            region_id=region_id,
            source_scope="national",
            authority="PNNC / RUNAP",
            artifact_id=national_runap.name,
            target_grid_sha256=grid_sha256,
        )
        packet["layers"] = layers
        packet["species"].update(
            {
                "universePolicy": "regional-matrices-national-metadata",
                "metadataLookup": {
                    **species_binding,
                    "schema": "biomod-species-taxonomy-iucn-v1",
                },
                "nationalDenominator": {
                    "nonFishCount": 8300,
                    "excludedClasses": ["Actinopteri"],
                    "lookupSha256": species_binding["sha256"],
                },
                "joinPolicy": "normalized-formatting-only-fail-closed-v1",
            }
        )
        goal_summary = build_goal_summary(solution, "2026-08-31T00:00:00Z")
        target_context = goal_summary["targetContext"]
        solution["finderInputs"] = {
            "domain": "land",
            "scope": "sirap",
            "targetFeatureSet": target_context["targetFeatureSet"],
            "targetFeatureIds": target_context["targetFeatureIds"],
            "targetPercent": target_context["finderTargetPercent"],
            "structuredTargets": target_context["structuredTargets"],
            "costLayerId": None,
            "includeLayerIds": [],
            "excludeLayerIds": [],
        }
    document["format"] = "sirap-approved-packet-manifest-v2"
    document["regionId"] = region_id
    return document


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-manifest", type=Path, required=True)
    parser.add_argument("--output-manifest", type=Path, required=True)
    parser.add_argument("--region-id", choices=("eje-cafetero", "orinoquia"), required=True)
    parser.add_argument("--regional-carbon", type=Path, required=True)
    parser.add_argument("--land-cover", type=Path, required=True)
    parser.add_argument("--land-cover-legend", type=Path, required=True)
    parser.add_argument("--species-lookup", type=Path, required=True)
    parser.add_argument("--national-runap", type=Path, required=True)
    parser.add_argument("--runap-legend", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source = json.loads(args.input_manifest.read_text(encoding="utf-8"))
    output = upgrade_manifest(
        source,
        region_id=args.region_id,
        regional_carbon=args.regional_carbon,
        land_cover=args.land_cover,
        land_cover_legend=args.land_cover_legend,
        species_lookup=args.species_lookup,
        national_runap=args.national_runap,
        runap_legend=args.runap_legend,
    )
    args.output_manifest.parent.mkdir(parents=True, exist_ok=True)
    args.output_manifest.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "regionId": args.region_id,
                "solutionCount": len(output["solutions"]),
                "output": str(args.output_manifest),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
