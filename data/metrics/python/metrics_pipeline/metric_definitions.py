"""Tier 1 metric catalog.

Stable IDs, labels, units, format hints, and source notes for all Tier 1
metrics emitted by this batch. Metric numbers reference rows in
docs/design/DISES Metrics - Finalized Metrics.csv.

T2 metrics (9 single-solution, computed in this MVP):
  4, 17, 18, 30, 31, 32, 36, 59, 60

Marine ecosystem metrics:
  35, 36, 37       (categorical classes from marine_ecosystems.tif)

T6 metrics added (17 additional):
  Carbon:             5, 39, 41, 43
  Water:              6, 44
  Protected areas:    63, 64, 66
  AOI percentage:     19
  Land cover:         9, 51, 52/53, 54  (coberturas.tif — class IDs 1=forest, 2=agri, 3=wetland, 4=water, 5=urban)
  Comparison:         70, 71, 72  (deferred pairwise)

T10 metrics added (8 additional, species):
  Richness:           21, 22, 23, 24, 25  (per-class species counts)
  Threatened:         26, 3                (CR/EN/VU non-fish; secured @ solution target %)
  Country share:      28                   (selected species count / non-fish pool × 100)

Edit METRIC_CATALOG below if the Tier 1 scope changes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from solution_domain import SolutionDomain

_PUBLIC_BLOB_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"

MetricFormatHint = Literal["number", "percent", "currency", "ratio", "index"]
MetricKind = Literal[
    "metadata_summary",
    "metadata_coverage",
    "selected_area",
    "national_percent",
    # Percentage of the current boundary (or nation) that is selected.
    # Not_applicable at national scope (overlaps #17); computable at sub-national.
    "aoi_percent",
    "binary_overlap_area",
    "binary_overlap_percent_of_selected",
    # Categorical layer: selected area whose class ID belongs to the metric's class set.
    "categorical_overlap_area",
    # Continuous layer: sum(pixel_value × pixel_area_km²) for selected cells.
    "weighted_sum",
    # Continuous layer: (selected weighted_sum / valid weighted_sum) × 100.
    "weighted_percent_of_national",
    # Species range overlap (computed by the species accumulator, not per-scope rasters).
    # Distinct kinds let the frontend label/format each consistently with its number.
    "species_group_coverage",             # #2: species meeting target by taxonomic group/IUCN
    "species_richness",                  # #21–#25: count of species in a class bucket
    "species_threatened_count",          # #26: count of CR/EN/VU non-fish present
    "species_threatened_secured",        # #3:  threatened species with coverage >= solution target %
    "species_pct_of_national",           # #28: present species / non-fish pool × 100
    # Metric defined but required data layer not yet available.
    "blocked_no_data",
    "deferred_pairwise",
]

# Class-bucket discriminator for the five richness metrics (#21–#25).
# Aligned with species_data.CLASS_BUCKETS.  Values are the keys main.py uses
# to look up SpeciesScopeMetrics fields.
SpeciesBucket = Literal["mammals", "birds", "amphibians", "reptiles", "plants"]


@dataclass(frozen=True)
class MetricDefinition:
    metric_id: str
    metric_number: int
    label_key: str
    english_label: str
    spanish_label: str
    unit: str | None
    format_hint: MetricFormatHint
    source_note: str
    kind: MetricKind
    layer_id: str | None = None
    # URL used when the layer is NOT registered in the Vercel manifest.
    off_manifest_url: str | None = None
    # Rendering hint for off-manifest layers (e.g. {"valueType":"binary","selectedValue":3}).
    # Falls back to manifest rendering when the layer IS in the manifest.
    off_manifest_rendering: dict[str, Any] | None = field(default=None, compare=False)
    # For species_richness metrics (#21–#25): which class bucket this entry counts.
    # Ignored for all other kinds.
    species_bucket: SpeciesBucket | None = None
    # Domains where this metric may be computed. Existing metrics default to land.
    applicable_domains: frozenset[SolutionDomain] = frozenset({"land"})


# Order here is the order written into the per-solution JSON output.
METRIC_CATALOG: tuple[MetricDefinition, ...] = (
    # --- T2: originally ported metrics ---
    MetricDefinition(
        metric_id="conservation_goals_met",
        metric_number=1,
        label_key="metrics.tier1.conservation_goals_met",
        english_label="Conservation Goals Met",
        spanish_label="Metas de conservación cumplidas",
        unit="%",
        format_hint="percent",
        source_note="Reads pctTargetsMet from solution summaryMetrics in the manifest.",
        kind="metadata_summary",
        applicable_domains=frozenset({"land", "marine"}),
    ),
    MetricDefinition(
        metric_id="species_groups_protected",
        metric_number=2,
        label_key="metrics.tier1.species_groups_protected",
        english_label="Species Groups Protected",
        spanish_label="Grupos de especies protegidos",
        unit="count",
        format_hint="number",
        source_note=(
            "Counts modeled non-fish species with usable range rasters whose "
            "solution coverage meets the solution target, grouped by taxonomic "
            "bucket and IUCN status in metric.details."
        ),
        kind="species_group_coverage",
    ),
    MetricDefinition(
        metric_id="ecosystem_coverage",
        metric_number=4,
        label_key="metrics.tier1.ecosystem_coverage",
        english_label="Ecosystem Coverage",
        spanish_label="Cobertura de ecosistemas",
        unit="km2",
        format_hint="number",
        source_note=(
            "Selected area intersected with valid biome_id classes 1–430 in the "
            "authoritative IAvH 2024 ecosystem raster."
        ),
        kind="categorical_overlap_area",
        layer_id="ecosistemas_IAVH_2024",
        off_manifest_url=(
            f"{_PUBLIC_BLOB_HOST}/inputs/features/ecosystems/"
            "ecosistemas_IAVH_2024.tif"
        ),
    ),
    # --- T10: species (#3 grouped with the other threatened-species metric) ---
    MetricDefinition(
        metric_id="threatened_species_secured",
        metric_number=3,
        label_key="metrics.tier1.threatened_species_secured",
        english_label="Threatened Species Secured",
        spanish_label="Especies amenazadas aseguradas",
        unit="count",
        format_hint="number",
        source_note=(
            "Count of CR/EN/VU non-fish species (Actinopteri excluded) where "
            "(species range ∩ priority area within scope) / (species range within scope) "
            "× 100 ≥ the solution target percent (structured species metadata is "
            "authoritative, with legacy solution-token fallback).  Pool of 213 threatened "
            "species from biomod_spp_ranges_updatedIUCN.csv.  Per-scope denominator "
            "means a species is 'secured in this region' when ≥ target % of its "
            "range *within this region* falls inside the priority area."
        ),
        kind="species_threatened_secured",
    ),
    # --- T6: additional metrics ---
    MetricDefinition(
        metric_id="carbon_storage_biomass",
        metric_number=5,
        label_key="metrics.tier1.carbon_storage_biomass",
        english_label="Carbon Storage Capacity",
        spanish_label="Capacidad de almacenamiento de carbono",
        unit="Mg·km²",
        format_hint="number",
        source_note=(
            "Weighted sum: pixel_value × pixel_area_km² for selected cells. "
            "Layer: biomasa_areara+subterranea_1km.tif (above + below-ground biomass). "
            "Unit is native raster units (assumed Mg/ha) × km² per pixel; "
            "multiply by 100 to convert to total Mg if layer is in Mg/ha."
        ),
        kind="weighted_sum",
        layer_id="biomasa",
        off_manifest_url=(
            f"{_PUBLIC_BLOB_HOST}/inputs/features/biomass/"
            "biomasa_areara+subterranea_1km.tif"
        ),
    ),
    MetricDefinition(
        metric_id="water_regulation_area",
        metric_number=6,
        label_key="metrics.tier1.water_regulation_area",
        english_label="Water Regulation Services Area",
        spanish_label="Área con regulación hídrica",
        unit="km2",
        format_hint="number",
        source_note=(
            "km² of selected area overlapping the moderate-to-high groundwater recharge "
            "zone (recarga_agua_subterranea_moderado_alto.tif). Binary presence/absence "
            "layer — not a continuous capacity index."
        ),
        kind="binary_overlap_area",
        layer_id="recarga_agua",
        off_manifest_url=(
            f"{_PUBLIC_BLOB_HOST}/inputs/features/ground_water_recharge/"
            "recarga_agua_subterranea_moderado_alto.tif"
        ),
    ),
    MetricDefinition(
        metric_id="agricultural_area",
        metric_number=9,
        label_key="metrics.tier1.agricultural_area",
        english_label="Affected Agricultural Area",
        spanish_label="Área agrícola afectada",
        unit="km2",
        format_hint="number",
        source_note=(
            "km² of selected area classified as Territorios Agrícolas (class 2) in coberturas.tif. "
            "CORINE Land Cover Level 1 adapted for Colombia. "
            "Note: original CSV had classes 1 and 3 swapped; corrected version in blob. "
            "Class 2 = agriculture (pasture + crops combined at Level 1 resolution)."
        ),
        kind="binary_overlap_area",
        layer_id="coberturas_agriculture",
        off_manifest_url=f"{_PUBLIC_BLOB_HOST}/boundaries/coberturas.tif",
        off_manifest_rendering={"valueType": "binary", "selectedValue": 2},
    ),
    # --- T2 (continued) ---
    MetricDefinition(
        metric_id="national_contribution",
        metric_number=17,
        label_key="metrics.tier1.national_contribution",
        english_label="National Contribution",
        spanish_label="Contribución nacional",
        unit="%",
        format_hint="percent",
        source_note="Selected km² divided by total valid km² in the solution raster.",
        kind="national_percent",
        applicable_domains=frozenset({"land", "marine"}),
    ),
    MetricDefinition(
        metric_id="priority_area_in_region",
        metric_number=18,
        label_key="metrics.tier1.priority_area_total",
        english_label="Priority Area (Selected)",
        spanish_label="Área prioritaria seleccionada",
        unit="km2",
        format_hint="number",
        source_note="Total selected km² from the solution raster (national scope).",
        kind="selected_area",
        applicable_domains=frozenset({"land", "marine"}),
    ),
    # --- T6 (continued) ---
    MetricDefinition(
        metric_id="priority_area_pct_of_region",
        metric_number=19,
        label_key="metrics.tier1.priority_area_pct_of_region",
        english_label="Priority Area % of Region",
        spanish_label="Área prioritaria como % de la región",
        unit="%",
        format_hint="percent",
        source_note=(
            "Selected area / valid area in the current scope × 100. "
            "Meaningful only at sub-national boundary scope (departments, municipalities, SIRAPs); "
            "marked not_applicable at national scope where #17 already provides this value."
        ),
        kind="aoi_percent",
        applicable_domains=frozenset({"land", "marine"}),
    ),
    # --- T2 (continued) ---
    MetricDefinition(
        metric_id="ecosystem_coverage_paramo",
        metric_number=30,
        label_key="metrics.tier1.ecosystem_paramo",
        english_label="Ecosystem Coverage - Páramo",
        spanish_label="Cobertura de páramo",
        unit="km2",
        format_hint="number",
        source_note="Selected area intersected with the manifest 'paramos' layer.",
        kind="binary_overlap_area",
        layer_id="paramos",
    ),
    MetricDefinition(
        metric_id="ecosystem_coverage_dry_forest",
        metric_number=31,
        label_key="metrics.tier1.ecosystem_dry_forest",
        english_label="Ecosystem Coverage - Dry Forest",
        spanish_label="Cobertura de bosque seco",
        unit="km2",
        format_hint="number",
        source_note="Selected area intersected with the manifest 'bosque_seco' layer.",
        kind="binary_overlap_area",
        layer_id="bosque_seco",
    ),
    MetricDefinition(
        metric_id="ecosystem_coverage_wetlands",
        metric_number=32,
        label_key="metrics.tier1.ecosystem_wetlands",
        english_label="Ecosystem Coverage - Wetlands",
        spanish_label="Cobertura de humedales",
        unit="km2",
        format_hint="number",
        source_note="Selected area intersected with the manifest 'wetlands' layer.",
        kind="binary_overlap_area",
        layer_id="wetlands",
    ),
    MetricDefinition(
        metric_id="coral_reef_coverage",
        metric_number=35,
        label_key="metrics.tier1.coral_reef_coverage",
        english_label="Coral Reef Coverage",
        spanish_label="Cobertura de arrecifes coralinos",
        unit="km2",
        format_hint="number",
        source_note=(
            "Selected area classified as coral formations (class IDs "
            "23, 32, 89, 108, 118, 140) in marine_ecosystems.tif."
        ),
        kind="categorical_overlap_area",
        layer_id="marine_ecosystems",
        off_manifest_url=(
            f"{_PUBLIC_BLOB_HOST}/inputs/features/marine/marine_ecosystems.tif"
        ),
        applicable_domains=frozenset({"marine"}),
    ),
    MetricDefinition(
        metric_id="mangrove_coverage",
        metric_number=36,
        label_key="metrics.tier1.ecosystem_mangroves",
        english_label="Mangrove Coverage",
        spanish_label="Cobertura de manglares",
        unit="km2",
        format_hint="number",
        source_note="Selected area intersected with the manifest 'mangroves' layer.",
        kind="binary_overlap_area",
        layer_id="mangroves",
    ),
    MetricDefinition(
        metric_id="marine_mangrove_coverage",
        metric_number=36,
        label_key="metrics.tier1.marine_mangrove_coverage",
        english_label="Marine Mangrove Coverage",
        spanish_label="Cobertura de manglares marinos",
        unit="km2",
        format_hint="number",
        source_note=(
            "Selected area classified as mangroves (class IDs 55, 56, 72, 80) "
            "in marine_ecosystems.tif. This is separate from the strategic "
            "binary-layer mangrove_coverage metric."
        ),
        kind="categorical_overlap_area",
        layer_id="marine_ecosystems",
        off_manifest_url=(
            f"{_PUBLIC_BLOB_HOST}/inputs/features/marine/marine_ecosystems.tif"
        ),
        applicable_domains=frozenset({"marine"}),
    ),
    MetricDefinition(
        metric_id="seagrass_coverage",
        metric_number=37,
        label_key="metrics.tier1.seagrass_coverage",
        english_label="Seagrass Bed Coverage",
        spanish_label="Cobertura de pastos marinos",
        unit="km2",
        format_hint="number",
        source_note=(
            "Selected area classified as seagrass beds (class IDs 86, 88, 117) "
            "in marine_ecosystems.tif."
        ),
        kind="categorical_overlap_area",
        layer_id="marine_ecosystems",
        off_manifest_url=(
            f"{_PUBLIC_BLOB_HOST}/inputs/features/marine/marine_ecosystems.tif"
        ),
        applicable_domains=frozenset({"marine"}),
    ),
    # --- T10: species richness (#21–#25) ---
    # Each entry counts how many species of one taxonomic class have any range
    # pixel inside the priority area within the current geography scope. Pool
    # sizes match biomod_spp_ranges_updatedIUCN.csv (Actinopteri excluded).
    MetricDefinition(
        metric_id="species_richness_mammals",
        metric_number=21,
        label_key="metrics.tier1.species_richness_mammals",
        english_label="Species Richness — Mammals",
        spanish_label="Riqueza de especies — Mamíferos",
        unit="count",
        format_hint="number",
        source_note=(
            "Count of Mammalia species whose modelled range raster overlaps the "
            "priority area within the current scope. Pool of 256 species from "
            "biomod_spp_ranges_updatedIUCN.csv (class == 'Mammalia')."
        ),
        kind="species_richness",
        species_bucket="mammals",
    ),
    MetricDefinition(
        metric_id="species_richness_birds",
        metric_number=22,
        label_key="metrics.tier1.species_richness_birds",
        english_label="Species Richness — Birds",
        spanish_label="Riqueza de especies — Aves",
        unit="count",
        format_hint="number",
        source_note=(
            "Count of Aves species whose modelled range raster overlaps the priority "
            "area within the current scope. Pool of 1,552 species from "
            "biomod_spp_ranges_updatedIUCN.csv (class == 'Aves')."
        ),
        kind="species_richness",
        species_bucket="birds",
    ),
    MetricDefinition(
        metric_id="species_richness_amphibians",
        metric_number=23,
        label_key="metrics.tier1.species_richness_amphibians",
        english_label="Species Richness — Amphibians",
        spanish_label="Riqueza de especies — Anfibios",
        unit="count",
        format_hint="number",
        source_note=(
            "Count of Amphibia species whose modelled range raster overlaps the "
            "priority area within the current scope. Pool of 184 species from "
            "biomod_spp_ranges_updatedIUCN.csv (class == 'Amphibia')."
        ),
        kind="species_richness",
        species_bucket="amphibians",
    ),
    MetricDefinition(
        metric_id="species_richness_reptiles",
        metric_number=24,
        label_key="metrics.tier1.species_richness_reptiles",
        english_label="Species Richness — Reptiles",
        spanish_label="Riqueza de especies — Reptiles",
        unit="count",
        format_hint="number",
        source_note=(
            "Count of reptile species (class IN ('Squamata', 'Crocodylia')) whose "
            "modelled range overlaps the priority area within the current scope. "
            "Pool of 160 species from biomod_spp_ranges_updatedIUCN.csv (155 "
            "Squamata + 5 Crocodylia)."
        ),
        kind="species_richness",
        species_bucket="reptiles",
    ),
    MetricDefinition(
        metric_id="species_richness_plants",
        metric_number=25,
        label_key="metrics.tier1.species_richness_plants",
        english_label="Species Richness — Plants",
        spanish_label="Riqueza de especies — Plantas",
        unit="count",
        format_hint="number",
        source_note=(
            "Count of Magnoliopsida species whose modelled range overlaps the "
            "priority area within the current scope. Pool of 6,148 species from "
            "biomod_spp_ranges_updatedIUCN.csv (class == 'Magnoliopsida')."
        ),
        kind="species_richness",
        species_bucket="plants",
    ),
    # --- T10: threatened species count (#26) ---
    MetricDefinition(
        metric_id="threatened_species_count",
        metric_number=26,
        label_key="metrics.tier1.threatened_species_count",
        english_label="Threatened Species Count",
        spanish_label="Conteo de especies amenazadas",
        unit="count",
        format_hint="number",
        source_note=(
            "Count of CR/EN/VU non-fish species (Actinopteri excluded) whose "
            "modelled range overlaps the priority area within the current scope. "
            "Pool of 213 threatened species from biomod_spp_ranges_updatedIUCN.csv."
        ),
        kind="species_threatened_count",
    ),
    # --- T10: % of national species total (#28) ---
    MetricDefinition(
        metric_id="species_pct_of_national",
        metric_number=28,
        label_key="metrics.tier1.species_pct_of_national",
        english_label="% of National Species Total",
        spanish_label="% del total nacional de especies",
        unit="%",
        format_hint="percent",
        source_note=(
            "Number of non-fish species whose modelled range overlaps the priority "
            "area within the current scope, divided by the total non-fish species "
            "pool (8,300 in biomod_spp_ranges_updatedIUCN.csv) × 100. Excludes "
            "Actinopteri."
        ),
        kind="species_pct_of_national",
    ),
    # --- T6 ---
    MetricDefinition(
        metric_id="carbon_biomass_total",
        metric_number=39,
        label_key="metrics.tier1.carbon_biomass_total",
        english_label="Total Carbon Biomass",
        spanish_label="Biomasa de carbono total",
        unit="Mg·km²",
        format_hint="number",
        source_note=(
            "Weighted sum of above+below-ground biomass layer × pixel area. "
            "Uses the same layer as #5; soil organic carbon is tracked separately as #41. "
            "Ideally combined with #41 for a total ecosystem carbon figure."
        ),
        kind="weighted_sum",
        layer_id="biomasa",
        off_manifest_url=(
            f"{_PUBLIC_BLOB_HOST}/inputs/features/biomass/"
            "biomasa_areara+subterranea_1km.tif"
        ),
    ),
    MetricDefinition(
        metric_id="soil_organic_carbon",
        metric_number=41,
        label_key="metrics.tier1.soil_organic_carbon",
        english_label="Soil Organic Carbon",
        spanish_label="Carbono orgánico del suelo",
        unit="Mg·km²",
        format_hint="number",
        source_note=(
            "Weighted sum: pixel_value × pixel_area_km² for selected cells. "
            "Layer: carbono_organico.tif. Unit is native raster units × km²."
        ),
        kind="weighted_sum",
        layer_id="carbono_organico",
        off_manifest_url=f"{_PUBLIC_BLOB_HOST}/inputs/features/carbon/carbono_organico.tif",
    ),
    MetricDefinition(
        metric_id="carbon_pct_of_national",
        metric_number=43,
        label_key="metrics.tier1.carbon_pct_of_national",
        english_label="% of National Carbon",
        spanish_label="% del carbono nacional",
        unit="%",
        format_hint="percent",
        source_note=(
            "(selected weighted_sum) / (all valid weighted_sum) × 100 "
            "on the biomasa layer. Denominator is the national total across all finite "
            "biomasa layer cells."
        ),
        kind="weighted_percent_of_national",
        layer_id="biomasa",
        off_manifest_url=(
            f"{_PUBLIC_BLOB_HOST}/inputs/features/biomass/"
            "biomasa_areara+subterranea_1km.tif"
        ),
    ),
    MetricDefinition(
        metric_id="water_regulation_pct",
        metric_number=44,
        label_key="metrics.tier1.water_regulation_pct",
        english_label="Water Regulation Capacity",
        spanish_label="Capacidad de regulación hídrica",
        unit="%",
        format_hint="percent",
        source_note=(
            "% of selected area that overlaps the moderate-to-high groundwater recharge zone. "
            "Binary layer — reflects spatial coverage, not a volumetric capacity estimate."
        ),
        kind="binary_overlap_percent_of_selected",
        layer_id="recarga_agua",
        off_manifest_url=(
            f"{_PUBLIC_BLOB_HOST}/inputs/features/ground_water_recharge/"
            "recarga_agua_subterranea_moderado_alto.tif"
        ),
    ),
    MetricDefinition(
        metric_id="land_use_forest_pct",
        metric_number=51,
        label_key="metrics.tier1.land_use_forest_pct",
        english_label="Land Use - Natural Forest",
        spanish_label="Uso del suelo - Bosque natural",
        unit="%",
        format_hint="percent",
        source_note=(
            "% of selected area classified as Bosques y Áreas Seminaturales (class 1) in coberturas.tif. "
            "CORINE Land Cover Level 1. Note: original CSV classes 1 and 3 were swapped; class 1 in the "
            "TIF is forest/seminatural, confirmed by spatial inspection."
        ),
        kind="binary_overlap_percent_of_selected",
        layer_id="coberturas_forest",
        off_manifest_url=f"{_PUBLIC_BLOB_HOST}/boundaries/coberturas.tif",
        off_manifest_rendering={"valueType": "binary", "selectedValue": 1},
    ),
    MetricDefinition(
        metric_id="land_use_agriculture_pct",
        metric_number=52,
        label_key="metrics.tier1.land_use_agriculture_pct",
        english_label="Land Use - Agriculture (Combined #52/#53)",
        spanish_label="Uso del suelo - Agricultura (combinado #52/#53)",
        unit="%",
        format_hint="percent",
        source_note=(
            "% of selected area classified as Territorios Agrícolas (class 2) in coberturas.tif. "
            "CORINE Level 1 combines pasture (#52) and crop agriculture (#53) into one class. "
            "A finer-resolution raster would be needed to distinguish them."
        ),
        kind="binary_overlap_percent_of_selected",
        layer_id="coberturas_agriculture",
        off_manifest_url=f"{_PUBLIC_BLOB_HOST}/boundaries/coberturas.tif",
        off_manifest_rendering={"valueType": "binary", "selectedValue": 2},
    ),
    MetricDefinition(
        metric_id="land_use_other_pct",
        metric_number=54,
        label_key="metrics.tier1.land_use_other_pct",
        english_label="Land Use - Other",
        spanish_label="Uso del suelo - Otro",
        unit="%",
        format_hint="percent",
        source_note=(
            "% of selected area classified as Artificializados, Áreas Húmedas, or Superficies de Agua "
            "(classes 3+4+5) in coberturas.tif. Represents the remainder after forest and agriculture."
        ),
        kind="binary_overlap_percent_of_selected",
        layer_id="coberturas_other",
        off_manifest_url=f"{_PUBLIC_BLOB_HOST}/boundaries/coberturas.tif",
        off_manifest_rendering={"valueType": "binary", "selectedValues": [3, 4, 5]},
    ),
    # --- T2 (continued) ---
    MetricDefinition(
        metric_id="indigenous_reservations_area",
        metric_number=59,
        label_key="metrics.tier1.indigenous_reservations_area",
        english_label="Indigenous Reservations Area",
        spanish_label="Área de resguardos indígenas",
        unit="km2",
        format_hint="number",
        source_note="Selected area intersected with the manifest 'resguardos' layer.",
        kind="binary_overlap_area",
        layer_id="resguardos",
    ),
    MetricDefinition(
        metric_id="community_councils_area",
        metric_number=60,
        label_key="metrics.tier1.community_councils_area",
        english_label="Community Councils Area",
        spanish_label="Área de consejos comunitarios",
        unit="km2",
        format_hint="number",
        source_note="Selected area intersected with the manifest 'comunidades' layer.",
        kind="binary_overlap_area",
        layer_id="comunidades",
    ),
    # --- T6 ---
    MetricDefinition(
        metric_id="protected_area_runap_km2",
        metric_number=63,
        label_key="metrics.tier1.protected_area_runap_km2",
        english_label="Total Protected Area in AOI (RUNAP)",
        spanish_label="Área protegida total en AOI (RUNAP)",
        unit="km2",
        format_hint="number",
        source_note=(
            "km² of selected area overlapping any RUNAP category. "
            "Uses runap_protected_areas.tif (RUNAP_23_mode); "
            "all non-nodata cells treated as 'protected' regardless of category. "
            "See inputs/includes/runap_categories.csv for the full category legend."
        ),
        kind="binary_overlap_area",
        layer_id="runap_protegidas",
        off_manifest_url=f"{_PUBLIC_BLOB_HOST}/inputs/includes/runap_protected_areas.tif",
    ),
    MetricDefinition(
        metric_id="national_parks_pct",
        metric_number=64,
        label_key="metrics.tier1.national_parks_pct",
        english_label="% Overlap with National Parks",
        spanish_label="% solapamiento con Parques Nacionales",
        unit="%",
        format_hint="percent",
        source_note=(
            "% of selected area overlapping Parque Nacional Natural (RUNAP category id=3). "
            "Uses runap_protected_areas.tif (categorical raster, value 3 = Parque Nacional Natural) "
            "from inputs/includes/. See inputs/includes/runap_categories.csv for full legend."
        ),
        kind="binary_overlap_percent_of_selected",
        layer_id="runap_parques",
        off_manifest_url=f"{_PUBLIC_BLOB_HOST}/inputs/includes/runap_protected_areas.tif",
        off_manifest_rendering={"valueType": "binary", "selectedValue": 3},
    ),
    MetricDefinition(
        metric_id="indigenous_territory_pct",
        metric_number=66,
        label_key="metrics.tier1.indigenous_territory_pct",
        english_label="% Overlap with Indigenous Territories",
        spanish_label="% solapamiento con territorios indígenas",
        unit="%",
        format_hint="percent",
        source_note=(
            "% of selected area overlapping indigenous reservations (resguardos indígenas). "
            "Uses the manifest 'resguardos' binary layer."
        ),
        kind="binary_overlap_percent_of_selected",
        layer_id="resguardos",
    ),
    # --- Deferred pairwise comparison metrics (#70, #71, #72) ---
    # Calculator functions are available in calculators.comparison; values are not cached
    # per-solution since they require two solution rasters.  These entries exist for
    # catalog stability and frontend contract completeness.
    MetricDefinition(
        metric_id="agreement_area",
        metric_number=70,
        label_key="metrics.tier1.agreement_area",
        english_label="Agreement Area",
        spanish_label="Área de acuerdo",
        unit="km2",
        format_hint="number",
        source_note=(
            "Pairwise A∩B: area selected in both solutions. "
            "Calculator: calculators.comparison.agreement_area_km2(raster_a, raster_b). "
            "Deferred — requires two solution rasters; not included in per-solution cache."
        ),
        kind="deferred_pairwise",
    ),
    MetricDefinition(
        metric_id="unique_to_solution_a",
        metric_number=71,
        label_key="metrics.tier1.unique_to_a",
        english_label="Unique to Solution A",
        spanish_label="Único en esolution A",
        unit="km2",
        format_hint="number",
        source_note=(
            "Pairwise A−B: area selected in A but not B. "
            "Calculator: calculators.comparison.unique_to_a_km2(raster_a, raster_b). "
            "Deferred — requires two solution rasters; not included in per-solution cache."
        ),
        kind="deferred_pairwise",
    ),
    MetricDefinition(
        metric_id="unique_to_solution_b",
        metric_number=72,
        label_key="metrics.tier1.unique_to_b",
        english_label="Unique to Solution B",
        spanish_label="Único en esolution B",
        unit="km2",
        format_hint="number",
        source_note=(
            "Pairwise B−A: area selected in B but not A. "
            "Calculator: calculators.comparison.unique_to_b_km2(raster_a, raster_b). "
            "Deferred — requires two solution rasters; not included in per-solution cache."
        ),
        kind="deferred_pairwise",
    ),
)


_SPECIES_KINDS = frozenset({
    "species_group_coverage",
    "species_richness",
    "species_threatened_count",
    "species_threatened_secured",
    "species_pct_of_national",
})


def deferred_metric_ids() -> set[str]:
    return {m.metric_id for m in METRIC_CATALOG if m.kind == "deferred_pairwise"}


def species_metric_ids() -> tuple[str, ...]:
    """metric_ids of every catalog entry computed by the species accumulator."""
    return tuple(m.metric_id for m in METRIC_CATALOG if m.kind in _SPECIES_KINDS)


def is_species_metric_kind(kind: str) -> bool:
    return kind in _SPECIES_KINDS


def computable_metrics() -> tuple[MetricDefinition, ...]:
    """All metrics that should appear in the per-solution cached output."""
    return tuple(m for m in METRIC_CATALOG if m.kind != "deferred_pairwise")


def required_layer_ids() -> tuple[str, ...]:
    """Unique layer_ids for metrics that need raster layers (excludes blocked/deferred)."""
    skip_kinds = frozenset({"deferred_pairwise", "blocked_no_data"})
    seen: list[str] = []
    for m in METRIC_CATALOG:
        if m.layer_id and m.kind not in skip_kinds and m.layer_id not in seen:
            seen.append(m.layer_id)
    return tuple(seen)


def off_manifest_layer_urls() -> dict[str, str]:
    """Return {layer_id: url} for all metrics with an off_manifest_url."""
    result: dict[str, str] = {}
    for m in METRIC_CATALOG:
        if m.off_manifest_url and m.layer_id and m.layer_id not in result:
            result[m.layer_id] = m.off_manifest_url
    return result


def off_manifest_layer_renderings() -> dict[str, dict]:
    """Return {layer_id: rendering_dict} for off-manifest layers that specify rendering."""
    result: dict[str, dict] = {}
    for m in METRIC_CATALOG:
        if m.off_manifest_rendering and m.layer_id and m.layer_id not in result:
            result[m.layer_id] = m.off_manifest_rendering
    return result
