import type { CustomPolygonMetricId, MetricValue } from '@core/models';

export type OverviewMetricSection = 'gains' | 'ecosystemServices' | 'costs';
export type ComparisonSectionId = 'general' | 'biodiversity' | 'ecosystems' | 'protection';
export type ComparisonDeltaTone = 'positive' | 'negative' | 'neutral';

export interface OverviewMetricBlueprint {
  id: string;
  section: OverviewMetricSection;
  labelKey: string;
  descriptionKey: string;
  methodologyKey?: string;
  sourceLabelKey?: string;
  sourceUrlKey?: string;
  iconClass?: string;
  realMetricId?: string;
  dummyValue: string;
  dummyAreaKm2?: number;
  dummyUnitKey?: string;
  conditional?: boolean;
}

export interface ComparisonMetricBlueprint {
  id: string;
  section: ComparisonSectionId;
  labelKey: string;
  descriptionKey: string;
  metricId?: string;
  dummyBaseline: string;
  dummyCandidate: string;
  dummyDelta: string;
  dummyBaselineAreaKm2?: number;
  dummyCandidateAreaKm2?: number;
  dummyDeltaAreaKm2?: number;
  conditional?: boolean;
  deltaTone?: ComparisonDeltaTone;
}

interface ComparisonSectionMeta {
  titleKey: string;
  toneClass: 'general' | 'bio' | 'eco' | 'socio' | 'protect';
}

export type CustomAoiMetricDefinition = Pick<
  MetricValue,
  'metricId' | 'unit' | 'labelKey' | 'formatHint'
>;

export const CUSTOM_AOI_FAST_METRIC_IDS: CustomPolygonMetricId[] = [
  'priority_area_in_region',
  'ecosystem_coverage',
  'carbon_storage_biomass',
  'water_regulation_area',
  'agricultural_area',
  'priority_area_pct_of_region',
  'ecosystem_coverage_paramo',
  'ecosystem_coverage_dry_forest',
  'ecosystem_coverage_wetlands',
  'mangrove_coverage',
  'carbon_biomass_total',
  'soil_organic_carbon',
  'carbon_pct_of_national',
  'water_regulation_pct',
  'land_use_forest_pct',
  'land_use_agriculture_pct',
  'land_use_other_pct',
  'indigenous_reservations_area',
  'community_councils_area',
  'protected_area_runap_km2',
  'national_parks_pct',
  'indigenous_territory_pct',
];

export const CUSTOM_AOI_SPECIES_METRIC_IDS: CustomPolygonMetricId[] = [
  'species_richness_mammals',
  'species_richness_birds',
  'species_richness_amphibians',
  'species_richness_reptiles',
  'species_richness_plants',
  'threatened_species_count',
  'threatened_species_secured',
  'species_pct_of_national',
];

export const CUSTOM_AOI_METRIC_DEFINITIONS: Partial<
  Record<CustomPolygonMetricId, CustomAoiMetricDefinition>
> = {
  area: {
    metricId: 'area',
    unit: 'km²',
    labelKey: 'metrics.custom_polygon_area',
    formatHint: 'number',
  },
  priority_area_in_region: {
    metricId: 'priority_area_in_region',
    unit: 'km²',
    labelKey: 'metrics.priority_area_total',
    formatHint: 'number',
  },
  national_contribution: {
    metricId: 'national_contribution',
    unit: '%',
    labelKey: 'metrics.national_contribution',
    formatHint: 'percent',
  },
  ecosystem_coverage: {
    metricId: 'ecosystem_coverage',
    unit: 'km²',
    labelKey: 'metrics.tier1.ecosystem_coverage',
    formatHint: 'number',
  },
  threatened_species_secured: {
    metricId: 'threatened_species_secured',
    unit: 'count',
    labelKey: 'metrics.tier1.threatened_species_secured',
    formatHint: 'number',
  },
  carbon_storage_biomass: {
    metricId: 'carbon_storage_biomass',
    unit: 'Mg·km²',
    labelKey: 'metrics.tier1.carbon_storage_biomass',
    formatHint: 'number',
  },
  water_regulation_area: {
    metricId: 'water_regulation_area',
    unit: 'km²',
    labelKey: 'metrics.tier1.water_regulation_area',
    formatHint: 'number',
  },
  agricultural_area: {
    metricId: 'agricultural_area',
    unit: 'km²',
    labelKey: 'metrics.tier1.agricultural_area',
    formatHint: 'number',
  },
  priority_area_pct_of_region: {
    metricId: 'priority_area_pct_of_region',
    unit: '%',
    labelKey: 'metrics.tier1.priority_area_pct_of_region',
    formatHint: 'percent',
  },
  ecosystem_coverage_paramo: {
    metricId: 'ecosystem_coverage_paramo',
    unit: 'km²',
    labelKey: 'metrics.tier1.ecosystem_paramo',
    formatHint: 'number',
  },
  ecosystem_coverage_dry_forest: {
    metricId: 'ecosystem_coverage_dry_forest',
    unit: 'km²',
    labelKey: 'metrics.tier1.ecosystem_dry_forest',
    formatHint: 'number',
  },
  ecosystem_coverage_wetlands: {
    metricId: 'ecosystem_coverage_wetlands',
    unit: 'km²',
    labelKey: 'metrics.tier1.ecosystem_wetlands',
    formatHint: 'number',
  },
  mangrove_coverage: {
    metricId: 'mangrove_coverage',
    unit: 'km²',
    labelKey: 'metrics.tier1.ecosystem_mangroves',
    formatHint: 'number',
  },
  species_richness_mammals: {
    metricId: 'species_richness_mammals',
    unit: 'count',
    labelKey: 'metrics.tier1.species_richness_mammals',
    formatHint: 'number',
  },
  species_richness_birds: {
    metricId: 'species_richness_birds',
    unit: 'count',
    labelKey: 'metrics.tier1.species_richness_birds',
    formatHint: 'number',
  },
  species_richness_amphibians: {
    metricId: 'species_richness_amphibians',
    unit: 'count',
    labelKey: 'metrics.tier1.species_richness_amphibians',
    formatHint: 'number',
  },
  species_richness_reptiles: {
    metricId: 'species_richness_reptiles',
    unit: 'count',
    labelKey: 'metrics.tier1.species_richness_reptiles',
    formatHint: 'number',
  },
  species_richness_plants: {
    metricId: 'species_richness_plants',
    unit: 'count',
    labelKey: 'metrics.tier1.species_richness_plants',
    formatHint: 'number',
  },
  threatened_species_count: {
    metricId: 'threatened_species_count',
    unit: 'count',
    labelKey: 'metrics.tier1.threatened_species_count',
    formatHint: 'number',
  },
  species_pct_of_national: {
    metricId: 'species_pct_of_national',
    unit: '%',
    labelKey: 'metrics.tier1.species_pct_of_national',
    formatHint: 'percent',
  },
  carbon_biomass_total: {
    metricId: 'carbon_biomass_total',
    unit: 'Mg·km²',
    labelKey: 'metrics.tier1.carbon_biomass_total',
    formatHint: 'number',
  },
  soil_organic_carbon: {
    metricId: 'soil_organic_carbon',
    unit: 'Mg·km²',
    labelKey: 'metrics.tier1.soil_organic_carbon',
    formatHint: 'number',
  },
  carbon_pct_of_national: {
    metricId: 'carbon_pct_of_national',
    unit: '%',
    labelKey: 'metrics.tier1.carbon_pct_of_national',
    formatHint: 'percent',
  },
  water_regulation_pct: {
    metricId: 'water_regulation_pct',
    unit: '%',
    labelKey: 'metrics.tier1.water_regulation_pct',
    formatHint: 'percent',
  },
  land_use_forest_pct: {
    metricId: 'land_use_forest_pct',
    unit: '%',
    labelKey: 'metrics.tier1.land_use_forest_pct',
    formatHint: 'percent',
  },
  land_use_agriculture_pct: {
    metricId: 'land_use_agriculture_pct',
    unit: '%',
    labelKey: 'metrics.tier1.land_use_agriculture_pct',
    formatHint: 'percent',
  },
  land_use_other_pct: {
    metricId: 'land_use_other_pct',
    unit: '%',
    labelKey: 'metrics.tier1.land_use_other_pct',
    formatHint: 'percent',
  },
  indigenous_reservations_area: {
    metricId: 'indigenous_reservations_area',
    unit: 'km²',
    labelKey: 'metrics.tier1.indigenous_reservations_area',
    formatHint: 'number',
  },
  community_councils_area: {
    metricId: 'community_councils_area',
    unit: 'km²',
    labelKey: 'metrics.tier1.community_councils_area',
    formatHint: 'number',
  },
  protected_area_runap_km2: {
    metricId: 'protected_area_runap_km2',
    unit: 'km²',
    labelKey: 'metrics.tier1.protected_area_runap_km2',
    formatHint: 'number',
  },
  national_parks_pct: {
    metricId: 'national_parks_pct',
    unit: '%',
    labelKey: 'metrics.tier1.national_parks_pct',
    formatHint: 'percent',
  },
  indigenous_territory_pct: {
    metricId: 'indigenous_territory_pct',
    unit: '%',
    labelKey: 'metrics.tier1.indigenous_territory_pct',
    formatHint: 'percent',
  },
};

export const OVERVIEW_SECTION_LOOKUP: Record<string, { id: string; labelKey: string }> = {
  'm-biodiversity': { id: 'ecology', labelKey: 'analysis.sections.ecology' },
  'm-carbon': { id: 'climate', labelKey: 'analysis.sections.climate' },
  'm-cost': { id: 'finance', labelKey: 'analysis.sections.finance' },
  // Cached metric ids for the solution overview. Section assignment is
  // provisional — the blueprints control where each metric actually renders.
  conservation_goals_met: { id: 'ecology', labelKey: 'analysis.sections.ecology' },
  species_groups_protected: { id: 'ecology', labelKey: 'analysis.sections.ecology' },
  ecosystem_coverage: { id: 'ecology', labelKey: 'analysis.sections.ecology' },
  national_contribution: { id: 'ecology', labelKey: 'analysis.sections.ecology' },
  priority_area_in_region: { id: 'ecology', labelKey: 'analysis.sections.ecology' },
  ecosystem_coverage_paramo: { id: 'ecology', labelKey: 'analysis.sections.ecology' },
  ecosystem_coverage_dry_forest: { id: 'ecology', labelKey: 'analysis.sections.ecology' },
  ecosystem_coverage_wetlands: { id: 'ecology', labelKey: 'analysis.sections.ecology' },
  mangrove_coverage: { id: 'ecology', labelKey: 'analysis.sections.ecology' },
  marine_mangrove_coverage: { id: 'ecology', labelKey: 'analysis.sections.ecology' },
  indigenous_reservations_area: { id: 'ecology', labelKey: 'analysis.sections.ecology' },
  community_councils_area: { id: 'ecology', labelKey: 'analysis.sections.ecology' },
  // T10 additions
  threatened_species_secured: { id: 'ecology', labelKey: 'analysis.sections.ecology' },
  // T6 additions
  carbon_storage_biomass: { id: 'climate', labelKey: 'analysis.sections.climate' },
  water_regulation_area: { id: 'climate', labelKey: 'analysis.sections.climate' },
  agricultural_area: { id: 'finance', labelKey: 'analysis.sections.finance' },
};
export const OVERVIEW_SECTION_ORDER = ['ecology', 'climate', 'finance'];
export const OVERVIEW_METRIC_BLUEPRINTS: OverviewMetricBlueprint[] = [
  {
    id: 'metric-01-conservation-goals-met',
    section: 'gains',
    labelKey: 'analysis.overview.metrics.conservationGoalsMet',
    descriptionKey: 'analysis.overview.metrics.conservationGoalsMetDesc',
    iconClass: 'fas fa-bullseye',
    realMetricId: 'conservation_goals_met',
    dummyValue: '92%',
    dummyUnitKey: 'analysis.overview.metricUnits.ofFeatures',
  },
  {
    id: 'metric-02-species-groups-protected',
    section: 'gains',
    labelKey: 'analysis.overview.metrics.speciesGroupsProtected',
    descriptionKey: 'analysis.overview.metrics.speciesGroupsProtectedDesc',
    iconClass: 'fas fa-paw',
    realMetricId: 'species_groups_protected',
    dummyValue: '45 / 50',
    dummyUnitKey: 'analysis.overview.metricUnits.ninetyPercentOfTotal',
  },
  {
    id: 'metric-03-threatened-species-secured',
    section: 'gains',
    labelKey: 'analysis.overview.metrics.threatenedSpeciesSecured',
    descriptionKey: 'analysis.overview.metrics.threatenedSpeciesSecuredDesc',
    iconClass: 'fas fa-triangle-exclamation',
    realMetricId: 'threatened_species_secured',
    dummyValue: '28 / 32',
    dummyUnitKey: 'analysis.overview.metricUnits.eightyEightPercentSecured',
  },
  {
    id: 'metric-18-priority-area-total',
    section: 'gains',
    labelKey: 'analysis.overview.metrics.priorityAreaTotal',
    descriptionKey: 'analysis.overview.metrics.priorityAreaTotalDesc',
    iconClass: 'fas fa-square-check',
    realMetricId: 'priority_area_in_region',
    dummyValue: '199k km²',
    dummyAreaKm2: 199_000,
    dummyUnitKey: 'analysis.overview.metricUnits.selected',
  },
  {
    id: 'metric-59-indigenous-reservations',
    section: 'gains',
    labelKey: 'analysis.overview.metrics.indigenousReservationsArea',
    descriptionKey: 'analysis.overview.metrics.indigenousReservationsAreaDesc',
    iconClass: 'fas fa-people-group',
    realMetricId: 'indigenous_reservations_area',
    dummyValue: '47k km²',
    dummyAreaKm2: 47_000,
    dummyUnitKey: 'analysis.overview.metricUnits.resguardos',
  },
  {
    id: 'metric-60-community-councils',
    section: 'gains',
    labelKey: 'analysis.overview.metrics.communityCouncilsArea',
    descriptionKey: 'analysis.overview.metrics.communityCouncilsAreaDesc',
    iconClass: 'fas fa-handshake',
    realMetricId: 'community_councils_area',
    dummyValue: '2.8k km²',
    dummyAreaKm2: 2_800,
    dummyUnitKey: 'analysis.overview.metricUnits.communities',
  },
  {
    id: 'metric-05-carbon-storage-capacity',
    section: 'ecosystemServices',
    labelKey: 'analysis.overview.metrics.carbonStorageCapacity',
    descriptionKey: 'analysis.overview.metrics.carbonStorageCapacityDesc',
    methodologyKey: 'analysis.overview.metrics.carbonStorageCapacityMethodology',
    sourceLabelKey: 'analysis.overview.metrics.carbonStorageCapacitySourceLabel',
    sourceUrlKey: 'analysis.overview.metrics.carbonStorageCapacitySourceUrl',
    iconClass: 'fas fa-leaf',
    realMetricId: 'carbon_storage_biomass',
    dummyValue: '2,300,000',
    dummyUnitKey: 'analysis.overview.metricUnits.megagrams',
  },
  {
    id: 'metric-06-water-regulation-services',
    section: 'ecosystemServices',
    labelKey: 'analysis.overview.metrics.waterRegulationServices',
    descriptionKey: 'analysis.overview.metrics.waterRegulationServicesDesc',
    methodologyKey: 'analysis.overview.metrics.waterRegulationServicesMethodology',
    sourceLabelKey: 'analysis.overview.metrics.waterRegulationServicesSourceLabel',
    sourceUrlKey: 'analysis.overview.metrics.waterRegulationServicesSourceUrl',
    iconClass: 'fas fa-droplet',
    realMetricId: 'water_regulation_area',
    dummyValue: '45k km²',
    dummyAreaKm2: 45_000,
    dummyUnitKey: 'analysis.overview.metricUnits.selected',
  },
  {
    id: 'metric-09-affected-agricultural-area',
    section: 'costs',
    labelKey: 'analysis.overview.metrics.affectedAgriculturalArea',
    descriptionKey: 'analysis.overview.metrics.affectedAgriculturalAreaDesc',
    iconClass: 'fas fa-wheat-awn',
    realMetricId: 'agricultural_area',
    dummyValue: '8,500 km²',
    dummyAreaKm2: 8_500,
    dummyUnitKey: 'analysis.overview.metricUnits.fifteenPercentOverlap',
  },
];
export const COMPARISON_SECTION_META: Record<ComparisonSectionId, ComparisonSectionMeta> = {
  general: {
    titleKey: 'analysis.comparison.sections.general',
    toneClass: 'general',
  },
  biodiversity: {
    titleKey: 'analysis.comparison.sections.biodiversity',
    toneClass: 'bio',
  },
  ecosystems: {
    titleKey: 'analysis.comparison.sections.ecosystems',
    toneClass: 'eco',
  },
  protection: {
    titleKey: 'analysis.comparison.sections.protection',
    toneClass: 'protect',
  },
};
export const COMPARISON_SECTION_ORDER: ComparisonSectionId[] = [
  'general',
  'biodiversity',
  'ecosystems',
  'protection',
];
export const COMPARISON_METRIC_BLUEPRINTS: ComparisonMetricBlueprint[] = [
  {
    id: 'comp-priority-area',
    section: 'general',
    labelKey: 'analysis.comparison.metrics.priorityArea',
    descriptionKey: 'analysis.comparison.metrics.priorityAreaDesc',
    metricId: 'priority_area_in_region',
    dummyBaseline: '210 km²',
    dummyCandidate: '230 km²',
    dummyDelta: '+20 km²',
    dummyBaselineAreaKm2: 210,
    dummyCandidateAreaKm2: 230,
    dummyDeltaAreaKm2: 20,
    deltaTone: 'positive',
  },
  {
    id: 'comp-pre-existing-area',
    section: 'general',
    labelKey: 'analysis.comparison.metrics.preExistingArea',
    descriptionKey: 'analysis.comparison.metrics.preExistingAreaDesc',
    metricId: 'pre_existing_selected_area',
    dummyBaseline: '150 km²',
    dummyCandidate: '155 km²',
    dummyDelta: '+5 km²',
    dummyBaselineAreaKm2: 150,
    dummyCandidateAreaKm2: 155,
    dummyDeltaAreaKm2: 5,
    deltaTone: 'neutral',
  },
  {
    id: 'comp-new-selected-area',
    section: 'general',
    labelKey: 'analysis.comparison.metrics.newSelectedArea',
    descriptionKey: 'analysis.comparison.metrics.newSelectedAreaDesc',
    metricId: 'new_selected_area',
    dummyBaseline: '60 km²',
    dummyCandidate: '75 km²',
    dummyDelta: '+15 km²',
    dummyBaselineAreaKm2: 60,
    dummyCandidateAreaKm2: 75,
    dummyDeltaAreaKm2: 15,
    deltaTone: 'positive',
  },
  {
    id: 'comp-national-target',
    section: 'general',
    labelKey: 'analysis.comparison.metrics.nationalTarget',
    descriptionKey: 'analysis.comparison.metrics.nationalTargetDesc',
    metricId: 'national_contribution',
    dummyBaseline: '1.3%',
    dummyCandidate: '1.9%',
    dummyDelta: '+0.6%',
    deltaTone: 'positive',
  },
  {
    id: 'comp-threatened-species',
    section: 'biodiversity',
    labelKey: 'analysis.comparison.metrics.threatenedSpecies',
    descriptionKey: 'analysis.comparison.metrics.threatenedSpeciesDesc',
    metricId: 'threatened_species_secured',
    dummyBaseline: '4 species',
    dummyCandidate: '5 species',
    dummyDelta: '+1',
    deltaTone: 'positive',
  },
  {
    id: 'comp-endemic-species',
    section: 'biodiversity',
    labelKey: 'analysis.comparison.metrics.endemicSpecies',
    descriptionKey: 'analysis.comparison.metrics.endemicSpeciesDesc',
    dummyBaseline: '10 species',
    dummyCandidate: '12 species',
    dummyDelta: '+2',
    deltaTone: 'positive',
  },
  {
    id: 'comp-carbon',
    section: 'ecosystems',
    labelKey: 'analysis.comparison.metrics.carbonStorage',
    descriptionKey: 'analysis.comparison.metrics.carbonStorageDesc',
    metricId: 'carbon_storage_biomass',
    dummyBaseline: '69,000 Mg',
    dummyCandidate: '74,000 Mg',
    dummyDelta: '+5,000 Mg',
  },
  {
    id: 'comp-water-regulation',
    section: 'ecosystems',
    labelKey: 'analysis.comparison.metrics.waterRegulation',
    descriptionKey: 'analysis.comparison.metrics.waterRegulationDesc',
    metricId: 'water_regulation_area',
    dummyBaseline: '72 / 100',
    dummyCandidate: '78 / 100',
    dummyDelta: '+6',
    deltaTone: 'positive',
  },
  {
    id: 'comp-protected-overlap',
    section: 'protection',
    labelKey: 'analysis.comparison.metrics.protectedOverlap',
    descriptionKey: 'analysis.comparison.metrics.protectedOverlapDesc',
    metricId: 'national_parks_pct',
    dummyBaseline: '14%',
    dummyCandidate: '18%',
    dummyDelta: '+4%',
    deltaTone: 'positive',
  },
  {
    id: 'comp-indigenous-overlap',
    section: 'protection',
    labelKey: 'analysis.comparison.metrics.indigenousOverlap',
    descriptionKey: 'analysis.comparison.metrics.indigenousOverlapDesc',
    metricId: 'indigenous_territory_pct',
    dummyBaseline: '10%',
    dummyCandidate: '12%',
    dummyDelta: '+2%',
    conditional: true,
    deltaTone: 'neutral',
  },
];
