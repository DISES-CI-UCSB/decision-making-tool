"""Calculator lookup tables for raster-backed metric definitions."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from calculators import carbon as calc_carbon
from calculators import ecosystem_coverage as calc_ecosystem
from calculators import land_cover as calc_land_cover
from calculators import marine_ecosystems as calc_marine
from calculators import protected_areas as calc_protected
from calculators import social_governance as calc_social
from calculators import water as calc_water
from metric_definitions import MetricDefinition

Calculator = Callable[..., Any]

_OVERLAP_AREA_BY_LAYER: dict[str, Calculator] = {
    "paramos": calc_ecosystem.paramo_km2,
    "bosque_seco": calc_ecosystem.dry_forest_km2,
    "wetlands": calc_ecosystem.wetlands_km2,
    "mangroves": calc_ecosystem.mangroves_km2,
    "resguardos": calc_social.indigenous_reservations_km2,
    "comunidades": calc_social.community_councils_km2,
    "runap": calc_protected.runap_overlap_km2,
    "runap_protegidas": calc_protected.runap_overlap_km2,
    "recarga_agua": calc_water.water_recharge_overlap_km2,
    "coberturas_agriculture": calc_land_cover.agricultural_area_km2,
}

_OVERLAP_PERCENT_BY_LAYER: dict[str, Calculator] = {
    "runap_parques": calc_protected.national_parks_percent_of_selected,
    "resguardos": calc_protected.indigenous_territory_percent_of_selected,
    "recarga_agua": calc_water.water_recharge_percent_of_selected,
    "coberturas_forest": calc_land_cover.forest_pct,
    "coberturas_agriculture": calc_land_cover.agriculture_pct,
    "coberturas_other": calc_land_cover.other_land_use_pct,
}

_CATEGORICAL_AREA_BY_METRIC_ID: dict[str, Calculator] = {
    "ecosystem_coverage": calc_ecosystem.ecosystem_total_km2,
    "coral_reef_coverage": calc_marine.coral_reef_coverage_km2,
    "marine_mangrove_coverage": calc_marine.marine_mangrove_coverage_km2,
    "seagrass_coverage": calc_marine.seagrass_coverage_km2,
}

_WEIGHTED_SUM_BY_LAYER: dict[str, Calculator] = {
    "biomasa": calc_carbon.carbon_storage_biomass,
    "carbono_organico": calc_carbon.soil_organic_carbon,
}

_WEIGHTED_SUM_BY_METRIC_ID: dict[str, Calculator] = {
    "carbon_storage_biomass": calc_carbon.carbon_storage_biomass,
    "carbon_biomass_total": calc_carbon.carbon_biomass_total,
    "soil_organic_carbon": calc_carbon.soil_organic_carbon,
}

_WEIGHTED_PERCENT_BY_LAYER: dict[str, Calculator] = {
    "biomasa": calc_carbon.national_carbon_percent,
}


def overlap_area_calculator(layer_id: str) -> Calculator | None:
    return _OVERLAP_AREA_BY_LAYER.get(layer_id)


def overlap_percent_calculator(layer_id: str) -> Calculator | None:
    return _OVERLAP_PERCENT_BY_LAYER.get(layer_id)


def categorical_area_calculator(metric_id: str) -> Calculator | None:
    return _CATEGORICAL_AREA_BY_METRIC_ID.get(metric_id)


def weighted_sum_calculator(definition: MetricDefinition) -> Calculator | None:
    return (
        _WEIGHTED_SUM_BY_METRIC_ID.get(definition.metric_id)
        or _WEIGHTED_SUM_BY_LAYER.get(definition.layer_id or "")
    )


def weighted_percent_calculator(layer_id: str) -> Calculator | None:
    return _WEIGHTED_PERCENT_BY_LAYER.get(layer_id)
