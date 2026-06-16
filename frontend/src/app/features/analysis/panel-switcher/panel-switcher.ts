import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  type AOI,
  type AnalysisMetricSectionFixture,
  type CachedSolutionMetricsDocument,
  type CustomPolygonMetricId,
  type CustomPolygonMetricsGeometry,
  type CustomPolygonMetricsResponse,
  type GeographyLevel,
  type MetricComparisonValue,
  type MetricReadinessStatus,
  type MetricValue,
  type MetricValueFormatHint,
  type Solution,
} from '@core/models';
import { ApiService } from '@core/services/api.service';
import { AppLocaleService } from '@core/services/app-locale.service';
import { metricsForScope, nationalMetrics } from '@core/services/cached-metrics.utils';
import {
  AppStateService,
  type ComparisonVisualizationMode,
  type MetricNumberFormatMode,
  type RightSidebarMode,
} from '@core/services/app-state.service';
import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import {
  AdminBoundaryService,
  type SirapSelectionScope,
} from '@features/map/services/admin-boundary.service';
import { SolutionLayerService } from '@features/map/services/solution-layer.service';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, concat, distinctUntilChanged, finalize, map, of, switchMap, tap } from 'rxjs';
import type { Observable } from 'rxjs';
import {
  AOI_ECOSYSTEM_SEGMENTS,
  CHART_PALETTES,
  type ChartPaletteId,
} from '@core/models/chart-palette.model';

type SidebarTab = 'overview' | 'aoi' | 'comparison';
type OverviewMetricSection = 'gains' | 'costs';
type ComparisonSectionId = 'general' | 'biodiversity' | 'ecosystems' | 'protection';
type ComparisonDeltaTone = 'positive' | 'negative' | 'neutral';
type AoiSectionId = 'general' | 'bio' | 'eco' | 'land' | 'cultural' | 'marine';

interface OverviewMetricBlueprint {
  id: string;
  section: OverviewMetricSection;
  labelKey: string;
  descriptionKey: string;
  iconClass?: string;
  realMetricId?: string;
  dummyValue: string;
  dummyUnitKey?: string;
  conditional?: boolean;
}

interface OverviewMetricDisplayEntry {
  id: string;
  labelKey: string;
  descriptionKey: string;
  iconClass?: string;
  value: string;
  fullValue: string | null;
  unit: string;
  conditional: boolean;
  unavailable: boolean;
}

interface AoiAlignedMetricBlueprint {
  id: string;
  metricIds: string[];
  labelKey: string;
  customAoiLabelKey?: string;
  descriptionKey: string;
  iconClass?: string;
  dummyValue: string;
  dummyUnitKey?: string;
}

interface AoiAlignedMetricDisplayEntry {
  id: string;
  metricId: string;
  labelKey: string;
  descriptionKey: string;
  iconClass?: string;
  value: string;
  fullValue: string | null;
  unit: string;
}

interface ComparisonMetricBlueprint {
  id: string;
  section: ComparisonSectionId;
  labelKey: string;
  descriptionKey: string;
  metricId?: string;
  dummyBaseline: string;
  dummyCandidate: string;
  dummyDelta: string;
  conditional?: boolean;
  deltaTone?: ComparisonDeltaTone;
}

interface ComparisonMetricDisplayEntry {
  id: string;
  labelKey: string;
  descriptionKey: string;
  baseline: string;
  baselineFull: string | null;
  candidate: string;
  candidateFull: string | null;
  delta: string;
  deltaFull: string | null;
  conditional: boolean;
  unavailable: boolean;
  deltaTone: ComparisonDeltaTone;
}

interface ComparisonMetricSection {
  id: ComparisonSectionId;
  titleKey: string;
  toneClass: 'general' | 'bio' | 'eco' | 'socio' | 'protect';
  metrics: ComparisonMetricDisplayEntry[];
}

interface SpatialOverlapDisplayEntry {
  id: string;
  labelKey: string;
  descriptionKey: string;
  value: string;
  fullValue: string | null;
  colorClass: 'overlap' | 'baseline' | 'candidate';
}

interface AoiBiodiversityBar {
  id: string;
  label: string;
  count: number | null;
}

interface AoiLandUseBar {
  id: string;
  label: string;
  percent: number;
  color: string;
}

interface ComparisonVisualizationOption {
  id: ComparisonVisualizationMode;
  labelKey: string;
  descriptionKey: string;
}

const CUSTOM_AOI_FAST_METRIC_IDS: CustomPolygonMetricId[] = [
  'priority_area_in_region',
  'national_contribution',
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

const CUSTOM_AOI_SPECIES_METRIC_IDS: CustomPolygonMetricId[] = [
  'species_richness_mammals',
  'species_richness_birds',
  'species_richness_amphibians',
  'species_richness_reptiles',
  'species_richness_plants',
  'threatened_species_count',
  'species_pct_of_national',
];

type CustomAoiMetricRequestMode = 'fast' | 'species';
type CustomAoiSpeciesLoadingStage = 'initial' | 'delayed' | 'extended';
type CustomAoiBiodiversityEstimateBand = 'small' | 'medium' | 'large' | 'veryLarge' | 'unknown';

type CustomAoiMetricDefinition = Pick<MetricValue, 'metricId' | 'unit' | 'labelKey' | 'formatHint'>;

const CUSTOM_AOI_SPECIES_DELAYED_STAGE_MS = 10_000;
const CUSTOM_AOI_SPECIES_EXTENDED_STAGE_MS = 60_000;
// Heuristic proxy for species benchmark matched-cell bands. The API does not
// currently expose matched cells before the species request, so browser area
// keeps the estimate honest without implying exact progress.
const CUSTOM_AOI_BIODIVERSITY_AREA_BANDS_KM2 = {
  smallMax: 1_000,
  mediumMax: 15_000,
  largeMax: 75_000,
} as const;

const CUSTOM_AOI_METRIC_DEFINITIONS: Partial<
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

/**
 * Human-readable reminder of the Solution Finder inputs that produced the
 * currently active solution. Rendered as a tooltip next to the solution name
 * in the Overview panel header.
 */
interface ActiveSolutionInputs {
  targetText: string;
  constraintsText: string;
  tradeoffText: string;
}

@Component({
  selector: 'app-panel-switcher',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './panel-switcher.html',
  styleUrl: './panel-switcher.scss',
})
export class PanelSwitcherComponent {
  private readonly aoiSpeciesColorSlotByPalette: Record<ChartPaletteId, Record<string, number>> = {
    okabeIto: {
      plants: 2,
      mammals: 1,
      birds: 0,
      amphibians: 3,
      reptiles: 4,
    },
    tolBright: {
      plants: 2,
      mammals: 1,
      birds: 0,
      amphibians: 3,
      reptiles: 4,
    },
    tolMuted: {
      plants: 2,
      mammals: 0,
      birds: 1,
      amphibians: 3,
      reptiles: 4,
    },
    viridisBalanced: {
      plants: 3,
      mammals: 0,
      birds: 1,
      amphibians: 3,
      reptiles: 4,
    },
    cividisBalanced: {
      plants: 3,
      mammals: 1,
      birds: 2,
      amphibians: 0,
      reptiles: 4,
    },
  };
  private readonly aoiBiodiversityBaseCounts: readonly {
    id: string;
    labelKey: string;
    count: number;
  }[] = [
    { id: 'mammals', labelKey: 'analysis.aoi.biodiversityTaxa.mammals', count: 42 },
    { id: 'birds', labelKey: 'analysis.aoi.biodiversityTaxa.birds', count: 131 },
    { id: 'amphibians', labelKey: 'analysis.aoi.biodiversityTaxa.amphibians', count: 44 },
    { id: 'reptiles', labelKey: 'analysis.aoi.biodiversityTaxa.reptiles', count: 38 },
    { id: 'plants', labelKey: 'analysis.aoi.biodiversityTaxa.plants', count: 27 },
  ];
  private readonly aoiLandUseBaseBars: readonly {
    id: string;
    labelKey: string;
    percent: number;
  }[] = [
    { id: 'forest', labelKey: 'analysis.aoi.landUseLabels.forest', percent: 60 },
    { id: 'agriculture', labelKey: 'analysis.aoi.landUseLabels.agriculture', percent: 25 },
    { id: 'other-land', labelKey: 'analysis.aoi.landUseLabels.other', percent: 15 },
  ];
  private readonly appState = inject(AppStateService);
  private readonly appLocale = inject(AppLocaleService);
  private readonly api = inject(ApiService);
  private readonly solutionCatalog = inject(SolutionCatalogService);
  private readonly adminBoundaries = inject(AdminBoundaryService);
  private readonly solutionLayer = inject(SolutionLayerService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private customAoiMetricsRequestSequence = 0;
  private customAoiSpeciesStageTimeouts: ReturnType<typeof setTimeout>[] = [];

  /** Reactive comparison colors sourced from the SolutionLayerService (driven by the left sidebar). */
  protected readonly comparisonBaselineColor = this.solutionLayer.baselineColor$;
  protected readonly comparisonCandidateColor = this.solutionLayer.candidateColor$;
  protected readonly comparisonOverlapColor = this.solutionLayer.overlapColor$;

  private readonly overviewSectionLookup: Record<string, { id: string; labelKey: string }> = {
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
    indigenous_reservations_area: { id: 'ecology', labelKey: 'analysis.sections.ecology' },
    community_councils_area: { id: 'ecology', labelKey: 'analysis.sections.ecology' },
    // T10 additions
    threatened_species_secured: { id: 'ecology', labelKey: 'analysis.sections.ecology' },
    // T6 additions
    carbon_storage_biomass: { id: 'climate', labelKey: 'analysis.sections.climate' },
    water_regulation_area: { id: 'climate', labelKey: 'analysis.sections.climate' },
    agricultural_area: { id: 'finance', labelKey: 'analysis.sections.finance' },
  };
  private readonly overviewSectionOrder = ['ecology', 'climate', 'finance'];
  private readonly overviewMetricBlueprints: OverviewMetricBlueprint[] = [
    {
      id: 'metric-01-conservation-goals-met',
      section: 'gains',
      labelKey: 'analysis.overview.metrics.conservationGoalsMet',
      descriptionKey: 'analysis.overview.metrics.conservationGoalsMetDesc',
      iconClass: 'fas fa-bullseye',
      realMetricId: 'conservation_goals_met',
      dummyValue: '92%',
      dummyUnitKey: 'analysis.overview.metricUnits.ofTargets',
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
      id: 'metric-17-national-contribution',
      section: 'gains',
      labelKey: 'analysis.overview.metrics.nationalContribution',
      descriptionKey: 'analysis.overview.metrics.nationalContributionDesc',
      iconClass: 'fas fa-flag',
      realMetricId: 'national_contribution',
      dummyValue: '17%',
      dummyUnitKey: 'analysis.overview.metricUnits.ofColombia',
    },
    {
      id: 'metric-18-priority-area-total',
      section: 'gains',
      labelKey: 'analysis.overview.metrics.priorityAreaTotal',
      descriptionKey: 'analysis.overview.metrics.priorityAreaTotalDesc',
      iconClass: 'fas fa-square-check',
      realMetricId: 'priority_area_in_region',
      dummyValue: '199k km²',
      dummyUnitKey: 'analysis.overview.metricUnits.selected',
    },
    {
      id: 'metric-30-paramo-coverage',
      section: 'gains',
      labelKey: 'analysis.overview.metrics.paramoCoverage',
      descriptionKey: 'analysis.overview.metrics.paramoCoverageDesc',
      iconClass: 'fas fa-mountain',
      realMetricId: 'ecosystem_coverage_paramo',
      dummyValue: '14k km²',
      dummyUnitKey: 'analysis.overview.metricUnits.paramo',
    },
    {
      id: 'metric-31-dry-forest-coverage',
      section: 'gains',
      labelKey: 'analysis.overview.metrics.dryForestCoverage',
      descriptionKey: 'analysis.overview.metrics.dryForestCoverageDesc',
      iconClass: 'fas fa-tree',
      realMetricId: 'ecosystem_coverage_dry_forest',
      dummyValue: '1.7k km²',
      dummyUnitKey: 'analysis.overview.metricUnits.dryForest',
    },
    {
      id: 'metric-32-wetlands-coverage',
      section: 'gains',
      labelKey: 'analysis.overview.metrics.wetlandsCoverage',
      descriptionKey: 'analysis.overview.metrics.wetlandsCoverageDesc',
      iconClass: 'fas fa-water',
      realMetricId: 'ecosystem_coverage_wetlands',
      dummyValue: '30k km²',
      dummyUnitKey: 'analysis.overview.metricUnits.wetlands',
    },
    {
      id: 'metric-36-mangrove-coverage',
      section: 'gains',
      labelKey: 'analysis.overview.metrics.mangroveCoverage',
      descriptionKey: 'analysis.overview.metrics.mangroveCoverageDesc',
      iconClass: 'fas fa-spa',
      realMetricId: 'mangrove_coverage',
      dummyValue: '866 km²',
      dummyUnitKey: 'analysis.overview.metricUnits.mangrove',
    },
    {
      id: 'metric-59-indigenous-reservations',
      section: 'gains',
      labelKey: 'analysis.overview.metrics.indigenousReservationsArea',
      descriptionKey: 'analysis.overview.metrics.indigenousReservationsAreaDesc',
      iconClass: 'fas fa-people-group',
      realMetricId: 'indigenous_reservations_area',
      dummyValue: '47k km²',
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
      dummyUnitKey: 'analysis.overview.metricUnits.communities',
    },
    {
      id: 'metric-05-carbon-storage-capacity',
      section: 'gains',
      labelKey: 'analysis.overview.metrics.carbonStorageCapacity',
      descriptionKey: 'analysis.overview.metrics.carbonStorageCapacityDesc',
      iconClass: 'fas fa-leaf',
      realMetricId: 'carbon_storage_biomass',
      dummyValue: '2,300,000',
      dummyUnitKey: 'analysis.overview.metricUnits.megagrams',
    },
    {
      id: 'metric-06-water-regulation-services',
      section: 'gains',
      labelKey: 'analysis.overview.metrics.waterRegulationServices',
      descriptionKey: 'analysis.overview.metrics.waterRegulationServicesDesc',
      iconClass: 'fas fa-droplet',
      realMetricId: 'water_regulation_area',
      dummyValue: '450M',
      dummyUnitKey: 'analysis.overview.metricUnits.cubicMeterIndex',
    },
    {
      id: 'metric-09-affected-agricultural-area',
      section: 'costs',
      labelKey: 'analysis.overview.metrics.affectedAgriculturalArea',
      descriptionKey: 'analysis.overview.metrics.affectedAgriculturalAreaDesc',
      iconClass: 'fas fa-wheat-awn',
      realMetricId: 'agricultural_area',
      dummyValue: '8,500 km²',
      dummyUnitKey: 'analysis.overview.metricUnits.fifteenPercentOverlap',
    },
    {
      id: 'metric-08-agricultural-opportunity-cost',
      section: 'costs',
      labelKey: 'analysis.overview.metrics.agriculturalOpportunityCost',
      descriptionKey: 'analysis.overview.metrics.agriculturalOpportunityCostDesc',
      iconClass: 'fas fa-coins',
      realMetricId: 'm-cost',
      dummyValue: '$350M',
      dummyUnitKey: 'analysis.overview.metricUnits.usd',
      conditional: true,
    },
  ];
  private readonly aoiAlignedMetricBlueprints: AoiAlignedMetricBlueprint[] = [
    {
      id: 'aoi-summary-priority-area',
      metricIds: ['priority_area_in_region'],
      labelKey: 'analysis.overview.metrics.priorityAreaTotal',
      customAoiLabelKey: 'analysis.aoi.alignedMetrics.priorityAreaDrawn',
      descriptionKey: 'analysis.overview.metrics.priorityAreaTotalDesc',
      iconClass: 'fas fa-square-check',
      dummyValue: '230 km²',
      dummyUnitKey: 'analysis.overview.metricUnits.selected',
    },
    {
      id: 'aoi-summary-national-contribution',
      metricIds: ['national_contribution'],
      labelKey: 'analysis.overview.metrics.nationalContribution',
      descriptionKey: 'analysis.overview.metrics.nationalContributionDesc',
      iconClass: 'fas fa-flag',
      dummyValue: '1.9%',
      dummyUnitKey: 'analysis.overview.metricUnits.ofColombia',
    },
    {
      id: 'aoi-summary-threatened-species',
      metricIds: ['threatened_species_secured', 'threatened_species_count'],
      labelKey: 'analysis.overview.metrics.threatenedSpeciesSecured',
      descriptionKey: 'analysis.overview.metrics.threatenedSpeciesSecuredDesc',
      iconClass: 'fas fa-triangle-exclamation',
      dummyValue: '5',
      dummyUnitKey: 'analysis.aoi.stats.iucnLabel',
    },
    {
      id: 'aoi-summary-paramo',
      metricIds: ['ecosystem_coverage_paramo'],
      labelKey: 'analysis.overview.metrics.paramoCoverage',
      descriptionKey: 'analysis.overview.metrics.paramoCoverageDesc',
      iconClass: 'fas fa-mountain',
      dummyValue: '34 km²',
      dummyUnitKey: 'analysis.overview.metricUnits.paramo',
    },
    {
      id: 'aoi-summary-dry-forest',
      metricIds: ['ecosystem_coverage_dry_forest'],
      labelKey: 'analysis.overview.metrics.dryForestCoverage',
      descriptionKey: 'analysis.overview.metrics.dryForestCoverageDesc',
      iconClass: 'fas fa-tree',
      dummyValue: '18 km²',
      dummyUnitKey: 'analysis.overview.metricUnits.dryForest',
    },
    {
      id: 'aoi-summary-wetlands',
      metricIds: ['ecosystem_coverage_wetlands'],
      labelKey: 'analysis.overview.metrics.wetlandsCoverage',
      descriptionKey: 'analysis.overview.metrics.wetlandsCoverageDesc',
      iconClass: 'fas fa-water',
      dummyValue: '42 km²',
      dummyUnitKey: 'analysis.overview.metricUnits.wetlands',
    },
    {
      id: 'aoi-summary-carbon',
      metricIds: ['carbon_storage_biomass'],
      labelKey: 'analysis.overview.metrics.carbonStorageCapacity',
      descriptionKey: 'analysis.overview.metrics.carbonStorageCapacityDesc',
      iconClass: 'fas fa-leaf',
      dummyValue: '52M',
      dummyUnitKey: 'analysis.overview.metricUnits.megagrams',
    },
    {
      id: 'aoi-summary-water',
      metricIds: ['water_regulation_area'],
      labelKey: 'analysis.overview.metrics.waterRegulationServices',
      descriptionKey: 'analysis.overview.metrics.waterRegulationServicesDesc',
      iconClass: 'fas fa-droplet',
      dummyValue: '78',
      dummyUnitKey: 'analysis.aoi.stats.waterRegulationDesc',
    },
    {
      id: 'aoi-summary-agriculture',
      metricIds: ['agricultural_area'],
      labelKey: 'analysis.overview.metrics.affectedAgriculturalArea',
      descriptionKey: 'analysis.overview.metrics.affectedAgriculturalAreaDesc',
      iconClass: 'fas fa-wheat-awn',
      dummyValue: '125 km²',
      dummyUnitKey: 'analysis.overview.metricUnits.areaAffected',
    },
    {
      id: 'aoi-summary-indigenous-reservations',
      metricIds: ['indigenous_reservations_area'],
      labelKey: 'analysis.overview.metrics.indigenousReservationsArea',
      descriptionKey: 'analysis.overview.metrics.indigenousReservationsAreaDesc',
      iconClass: 'fas fa-people-group',
      dummyValue: '41 km²',
      dummyUnitKey: 'analysis.overview.metricUnits.resguardos',
    },
    {
      id: 'aoi-summary-community-councils',
      metricIds: ['community_councils_area'],
      labelKey: 'analysis.overview.metrics.communityCouncilsArea',
      descriptionKey: 'analysis.overview.metrics.communityCouncilsAreaDesc',
      iconClass: 'fas fa-handshake',
      dummyValue: '27 km²',
      dummyUnitKey: 'analysis.overview.metricUnits.communities',
    },
  ];
  private readonly comparisonSectionMeta: Record<
    ComparisonSectionId,
    Pick<ComparisonMetricSection, 'titleKey' | 'toneClass'>
  > = {
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
  private readonly comparisonSectionOrder: ComparisonSectionId[] = [
    'general',
    'biodiversity',
    'ecosystems',
    'protection',
  ];
  private readonly comparisonMetricBlueprints: ComparisonMetricBlueprint[] = [
    {
      id: 'comp-priority-area',
      section: 'general',
      labelKey: 'analysis.comparison.metrics.priorityArea',
      descriptionKey: 'analysis.comparison.metrics.priorityAreaDesc',
      metricId: 'priority_area_in_region',
      dummyBaseline: '210 km²',
      dummyCandidate: '230 km²',
      dummyDelta: '+20 km²',
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

  protected readonly rightSidebarMode = this.appState.rightSidebarMode$;
  protected readonly activeSolution = this.appState.activeSolution$;
  protected readonly activeSolutionInputs = computed<ActiveSolutionInputs | null>(() =>
    this.buildActiveSolutionInputs(),
  );
  protected readonly selectedAoi = this.appState.selectedAOI$;
  protected readonly customAoiGeometry = this.appState.customAOIGeometry$;
  protected readonly sirapSelectionScope = this.adminBoundaries.sirapSelectionScope$;
  protected readonly comparisonSolution = this.appState.comparisonSolution$;
  protected readonly comparisonVisualizationMode = this.appState.comparisonVisualizationMode$;
  protected readonly fillDummyOverviewMetrics = this.appState.fillDummyOverviewMetrics$;
  protected readonly fillDummyComparisonMetrics = this.appState.fillDummyComparisonMetrics$;
  protected readonly showViewFullReportButton = this.appState.showViewFullReportButton$;
  protected readonly showGenerateRegionalReportButton =
    this.appState.showGenerateRegionalReportButton$;
  protected readonly showMetricIcons = this.appState.showMetricIcons$;
  protected readonly metricNumberFormatMode = this.appState.metricNumberFormatMode$;
  protected readonly isNotImplementedDialogOpen = signal(false);
  protected readonly sidebarTabs: SidebarTab[] = ['overview', 'aoi', 'comparison'];
  protected readonly overviewSections = signal<AnalysisMetricSectionFixture[]>([]);
  protected readonly cachedMetricsDocument = signal<CachedSolutionMetricsDocument | null>(null);
  protected readonly customAoiMetrics = signal<MetricValue[]>([]);
  protected readonly isCustomAoiMetricsLoading = signal(false);
  protected readonly customAoiMetricsLoadFailed = signal(false);
  protected readonly customAoiMetricsMessage = signal<string | null>(null);
  protected readonly isCustomAoiSpeciesMetricsLoading = signal(false);
  protected readonly customAoiSpeciesMetricsLoadFailed = signal(false);
  protected readonly customAoiSpeciesMetricsMessage = signal<string | null>(null);
  protected readonly customAoiSpeciesLoadingStage = signal<CustomAoiSpeciesLoadingStage>('initial');
  protected readonly customAoiBiodiversityEstimateBand =
    computed<CustomAoiBiodiversityEstimateBand>(() => this.classifyCustomAoiBiodiversityEstimate());
  protected readonly comparisonCandidateMetricsDocument =
    signal<CachedSolutionMetricsDocument | null>(null);
  protected readonly isOverviewLoading = signal(false);
  protected readonly overviewLoadFailed = signal(false);
  protected readonly overviewGainMetrics = computed<OverviewMetricDisplayEntry[]>(() =>
    this.buildOverviewMetricDisplayEntries('gains'),
  );
  protected readonly overviewCostMetrics = computed<OverviewMetricDisplayEntry[]>(() =>
    this.buildOverviewMetricDisplayEntries('costs'),
  );
  protected readonly overviewSectionExpanded = signal<Record<OverviewMetricSection, boolean>>({
    gains: true,
    costs: true,
  });

  protected readonly aoiMetrics = computed(() => {
    const aoi = this.selectedAoi();
    if (!aoi) {
      return [];
    }
    if (aoi.type === 'custom' && this.customAoiGeometry()) {
      return this.customAoiMetrics();
    }

    return this.resolveAoiMetrics(this.cachedMetricsDocument(), aoi);
  });
  protected readonly aoiMetricsById = computed<Map<string, MetricValue>>(
    () => new Map(this.aoiMetrics().map((metric) => [metric.metricId, metric] as const)),
  );
  protected readonly aoiAlignedMetricEntries = computed<AoiAlignedMetricDisplayEntry[]>(() =>
    this.buildAoiAlignedMetricDisplayEntries(),
  );
  protected readonly isSirapAoiSelected = computed(() => this.selectedAoi()?.type === 'sirap');
  protected readonly isCustomAoiSelected = computed(
    () => this.selectedAoi()?.type === 'custom' && this.customAoiGeometry() !== null,
  );

  protected readonly comparisonMetrics = computed(() => {
    const baselineMetrics = nationalMetrics(this.cachedMetricsDocument());
    const candidateMetrics = nationalMetrics(this.comparisonCandidateMetricsDocument());
    if (baselineMetrics.length === 0 || candidateMetrics.length === 0) {
      return [];
    }

    return this.buildMetricComparisons(baselineMetrics, candidateMetrics);
  });
  protected readonly fillDummyAoiMetrics = this.appState.fillDummyAoiMetrics$;
  protected readonly chartPaletteId = this.appState.chartPaletteId$;
  protected readonly chartPalette = computed(() => CHART_PALETTES[this.chartPaletteId()]);
  protected readonly aoiEcosystemLegend = computed(() =>
    AOI_ECOSYSTEM_SEGMENTS.map((segment, index) => ({
      ...segment,
      label: this.getAoiEcosystemLabel(segment.id, segment.label),
      color: this.chartPalette().colors[index],
    })),
  );
  protected readonly aoiSectionExpanded = signal<Record<AoiSectionId, boolean>>({
    general: true,
    bio: true,
    eco: true,
    land: false,
    cultural: false,
    marine: false,
  });
  protected readonly aoiDonutGradient = computed(() => {
    if (!this.fillDummyAoiMetrics()) return '#e2e8f0';
    return this.buildDonutGradient();
  });
  private readonly aoiBiodiversityMetricIds: Record<string, string> = {
    mammals: 'species_richness_mammals',
    birds: 'species_richness_birds',
    amphibians: 'species_richness_amphibians',
    reptiles: 'species_richness_reptiles',
    plants: 'species_richness_plants',
  };

  protected readonly aoiBiodiversityBars = computed<AoiBiodiversityBar[]>(() => {
    const metricsById = this.aoiMetricsById();
    const hasCachedSpecies = this.aoiBiodiversityBaseCounts.some((item) => {
      const metric = metricsById.get(this.aoiBiodiversityMetricIds[item.id]);
      return metric?.status === 'ready' && metric.value !== null;
    });

    if (hasCachedSpecies) {
      return this.aoiBiodiversityBaseCounts.map((item) => {
        const metric = metricsById.get(this.aoiBiodiversityMetricIds[item.id]);
        const value = metric?.status === 'ready' && metric.value !== null ? metric.value : null;
        return { id: item.id, label: this.localizedText(item.labelKey), count: value };
      });
    }

    if (this.fillDummyAoiMetrics()) {
      const selectedAoi = this.selectedAoi();
      const scale = selectedAoi ? this.getAoiBiodiversityScale(selectedAoi.id) : 1;
      return this.aoiBiodiversityBaseCounts.map((item) => ({
        id: item.id,
        label: this.localizedText(item.labelKey),
        count: Math.max(0, Math.round(item.count * scale)),
      }));
    }

    return this.aoiBiodiversityBaseCounts.map((item) => ({
      id: item.id,
      label: this.localizedText(item.labelKey),
      count: null,
    }));
  });
  protected readonly aoiBiodiversityMaxCount = computed<number>(() =>
    this.aoiBiodiversityBars().reduce((maxValue, item) => {
      if (item.count === null) {
        return maxValue;
      }
      return Math.max(maxValue, item.count);
    }, 0),
  );
  protected readonly aoiLandUseBars = computed<AoiLandUseBar[]>(() => {
    const palette = this.chartPalette().colors;
    const greenSlot = this.getGreenPaletteSlot();
    const fallbackColor = palette[0] ?? '#64748b';
    const alternateSlots = [0, 1, 2, 3, 4].filter((slot) => slot !== greenSlot);

    return this.aoiLandUseBaseBars.map((bar, index) => {
      const slot = index === 0 ? greenSlot : (alternateSlots[index - 1] ?? 0);
      return {
        id: bar.id,
        label: this.localizedText(bar.labelKey),
        percent: bar.percent,
        color: palette[slot] ?? fallbackColor,
      };
    });
  });
  protected readonly aoiHeroPriorityBarColor = computed(() =>
    this.getPaletteColorBySlot(this.getGreenPaletteSlot()),
  );
  protected readonly aoiHeroAddedContributionColor = computed(() => this.getPaletteColorBySlot(0));
  protected readonly aoiHeroExistingContributionColor = computed(() =>
    this.withAlpha(this.aoiHeroAddedContributionColor(), 0.35),
  );

  protected readonly comparisonSectionExpanded = signal<Record<ComparisonSectionId, boolean>>({
    general: true,
    biodiversity: true,
    ecosystems: true,
    protection: false,
  });
  protected readonly spatialOverlapEntries = computed<SpatialOverlapDisplayEntry[]>(() =>
    this.buildSpatialOverlapEntries(),
  );
  protected readonly comparisonSections = computed<ComparisonMetricSection[]>(() =>
    this.buildComparisonSections(),
  );
  protected readonly comparisonVisualizationOptions: ComparisonVisualizationOption[] = [
    {
      id: 'threeColorOverlay',
      labelKey: 'analysis.comparison.visualizationModes.threeColorOverlay.label',
      descriptionKey: 'analysis.comparison.visualizationModes.threeColorOverlay.description',
    },
    {
      id: 'swipe',
      labelKey: 'analysis.comparison.visualizationModes.swipe.label',
      descriptionKey: 'analysis.comparison.visualizationModes.swipe.description',
    },
  ];

  constructor() {
    this.destroyRef.onDestroy(() => this.stopCustomAoiSpeciesLoadingStages());

    toObservable(this.activeSolution)
      .pipe(
        map((solution) => this.resolveMetricsSolutionId(solution)),
        distinctUntilChanged(),
        switchMap((solutionId) => {
          if (!solutionId) {
            this.overviewSections.set([]);
            this.cachedMetricsDocument.set(null);
            this.isOverviewLoading.set(false);
            this.overviewLoadFailed.set(false);
            return of<CachedSolutionMetricsDocument | null>(null);
          }

          this.isOverviewLoading.set(true);
          this.overviewLoadFailed.set(false);

          return this.api.getSolutionMetrics(solutionId).pipe(
            catchError(() => {
              this.overviewLoadFailed.set(true);
              return of<CachedSolutionMetricsDocument | null>(null);
            }),
            finalize(() => this.isOverviewLoading.set(false)),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((document) => {
        this.cachedMetricsDocument.set(document);
        this.overviewSections.set(this.buildOverviewSections(nationalMetrics(document)));
      });

    toObservable(this.customAoiGeometry)
      .pipe(
        distinctUntilChanged((previous, current) =>
          this.areCustomAoiGeometriesEqual(previous, current),
        ),
        switchMap((geometry) => {
          if (!geometry) {
            this.customAoiMetrics.set([]);
            this.isCustomAoiMetricsLoading.set(false);
            this.customAoiMetricsLoadFailed.set(false);
            this.customAoiMetricsMessage.set(null);
            this.isCustomAoiSpeciesMetricsLoading.set(false);
            this.customAoiSpeciesMetricsLoadFailed.set(false);
            this.customAoiSpeciesMetricsMessage.set(null);
            this.stopCustomAoiSpeciesLoadingStages();
            return of<MetricValue[]>([]);
          }

          const requestId = ++this.customAoiMetricsRequestSequence;
          this.customAoiMetrics.set([]);
          this.isCustomAoiMetricsLoading.set(true);
          this.customAoiMetricsLoadFailed.set(false);
          this.customAoiMetricsMessage.set(null);
          this.isCustomAoiSpeciesMetricsLoading.set(false);
          this.customAoiSpeciesMetricsLoadFailed.set(false);
          this.customAoiSpeciesMetricsMessage.set(null);
          this.stopCustomAoiSpeciesLoadingStages();

          return this.loadCustomAoiMetricBatch(
            geometry,
            CUSTOM_AOI_FAST_METRIC_IDS,
            'fast',
            requestId,
          ).pipe(
            catchError((error: unknown) => {
              this.customAoiMetricsLoadFailed.set(true);
              this.customAoiMetricsMessage.set(this.getCustomAoiErrorMessage(error));
              return of<MetricValue[]>([]);
            }),
            finalize(() => this.isCustomAoiMetricsLoading.set(false)),
            switchMap((fastMetrics) => {
              if (this.customAoiMetricsLoadFailed()) {
                return of(fastMetrics);
              }

              this.isCustomAoiSpeciesMetricsLoading.set(true);
              this.startCustomAoiSpeciesLoadingStages();
              return concat(
                of(fastMetrics),
                this.loadCustomAoiMetricBatch(
                  geometry,
                  CUSTOM_AOI_SPECIES_METRIC_IDS,
                  'species',
                  requestId,
                ).pipe(
                  map((speciesMetrics) => {
                    return this.mergeCustomAoiMetricValues(fastMetrics, speciesMetrics);
                  }),
                  catchError((error: unknown) => {
                    this.customAoiSpeciesMetricsLoadFailed.set(true);
                    this.customAoiSpeciesMetricsMessage.set(this.getCustomAoiErrorMessage(error));
                    return of(fastMetrics);
                  }),
                  finalize(() => {
                    this.isCustomAoiSpeciesMetricsLoading.set(false);
                    this.stopCustomAoiSpeciesLoadingStages();
                  }),
                ),
              );
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((metrics) => {
        this.customAoiMetrics.set(metrics);
      });

    toObservable(this.comparisonSolution)
      .pipe(
        map((solution) => this.resolveMetricsSolutionId(solution)),
        distinctUntilChanged(),
        switchMap((solutionId) => {
          if (!solutionId) {
            return of<CachedSolutionMetricsDocument | null>(null);
          }

          return this.api
            .getSolutionMetrics(solutionId)
            .pipe(catchError(() => of<CachedSolutionMetricsDocument | null>(null)));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((document) => {
        this.comparisonCandidateMetricsDocument.set(document);
      });
  }

  /**
   * Resolve the scenario id used to load cached metrics. Prefer the real
   * `metadata.scenarioId` (always the manifest id) over `solution.id`, which can
   * be a mock id when the candidate is built via the dev-tools panel.
   */
  private resolveMetricsSolutionId(solution: Solution | null): string | null {
    const scenarioId = solution?.metadata?.['scenarioId'];
    if (typeof scenarioId === 'string' && scenarioId.length > 0) {
      return scenarioId;
    }
    return solution?.id ?? null;
  }

  protected formatMetricValue(
    metric: MetricValue,
    mode: MetricNumberFormatMode = this.metricNumberFormatMode(),
  ): string {
    if (metric.value === null) {
      return this.translate.instant('analysis.common.valueUnavailable');
    }

    switch (metric.formatHint) {
      case 'percent':
        return `${this.formatNumber(metric.value, mode, 0, 1)}%`;
      case 'currency':
        return this.appendUnit(this.formatNumber(metric.value, mode, 1, 1), metric.unit);
      default:
        return this.appendUnit(this.formatNumber(metric.value, mode, 0, 2), metric.unit);
    }
  }

  protected formatDelta(
    metric: MetricComparisonValue,
    mode: MetricNumberFormatMode = this.metricNumberFormatMode(),
  ): string {
    if (metric.delta === null) {
      return this.translate.instant('analysis.common.deltaUnavailable');
    }

    const sign = metric.delta > 0 ? '+' : '';

    switch (metric.formatHint) {
      case 'percent':
        return `${sign}${this.formatNumber(metric.delta, mode, 0, 1)}%`;
      case 'currency':
        return this.appendUnit(
          `${sign}${this.formatNumber(metric.delta, mode, 1, 1)}`,
          metric.candidate.unit,
        );
      default:
        return this.appendUnit(
          `${sign}${this.formatNumber(metric.delta, mode, 0, 2)}`,
          metric.candidate.unit,
        );
    }
  }

  protected getModeLabelKey(mode: RightSidebarMode): string {
    return `analysis.modes.${mode}`;
  }

  protected getStatusKey(status: MetricReadinessStatus): string {
    return `analysis.status.${status}`;
  }

  protected getTabLabelKey(tab: SidebarTab): string {
    return `analysis.modes.${tab}`;
  }

  protected isTabActive(tab: SidebarTab): boolean {
    const mode = this.rightSidebarMode();
    if (tab === 'overview') {
      return mode === 'welcome' || mode === 'overview';
    }

    return mode === tab;
  }

  /** AOI and comparison require an active solution; overview is always available. */
  protected isSidebarTabDisabled(tab: SidebarTab): boolean {
    if (tab === 'overview') {
      return false;
    }
    return this.activeSolution() === null;
  }

  protected selectTab(tab: SidebarTab): void {
    if (this.isSidebarTabDisabled(tab)) {
      return;
    }

    if (tab === 'overview') {
      const hasSolution = this.activeSolution() !== null;
      this.appState.setRightSidebarMode(hasSolution ? 'overview' : 'welcome');
      return;
    }

    this.appState.setRightSidebarMode(tab);
  }

  protected isSirapScopeSelected(scope: SirapSelectionScope): boolean {
    return this.sirapSelectionScope() === scope;
  }

  protected setSirapSelectionScope(scope: SirapSelectionScope): void {
    this.adminBoundaries.setSirapSelectionScope(scope);
  }

  protected isMetricReady(metric: MetricValue): boolean {
    return metric.status === 'ready' && metric.value !== null;
  }

  protected isPositiveDelta(delta: number | null): boolean {
    return delta !== null && delta > 0;
  }

  protected isNegativeDelta(delta: number | null): boolean {
    return delta !== null && delta < 0;
  }

  protected getGoalsAchievedPercent(fallbackPercent: number): string {
    const goalsMetric = this.findOverviewMetric('conservation_goals_met');
    if (goalsMetric && this.isMetricReady(goalsMetric)) {
      return this.formatNumber(goalsMetric.value ?? 0, this.metricNumberFormatMode(), 0, 1);
    }

    return this.formatNumber(fallbackPercent, this.metricNumberFormatMode(), 0, 1);
  }

  protected getGoalsAchievedBarWidth(fallbackPercent: number): number {
    const goalsMetric = this.findOverviewMetric('conservation_goals_met');
    const value =
      goalsMetric && this.isMetricReady(goalsMetric) ? goalsMetric.value : fallbackPercent;
    return Math.max(0, Math.min(100, value ?? 0));
  }

  protected getOverviewMetricValue(metricId: string, fallbackWhenMissing = '--'): string {
    if (metricId === 'national_contribution') {
      const liveValue = this.formatLiveNationalContribution();
      if (liveValue) {
        return liveValue;
      }
    }

    const metric = this.findOverviewMetric(metricId);
    if (metric && this.isMetricReady(metric)) {
      return this.formatMetricForPanel(metric);
    }

    return fallbackWhenMissing;
  }

  protected getOverviewMetricFullValue(metricId: string): string | null {
    if (metricId === 'national_contribution') {
      const compactValue = this.formatLiveNationalContribution('compact');
      const fullValue = this.formatLiveNationalContribution('full');
      return compactValue && fullValue && fullValue !== compactValue ? fullValue : null;
    }

    const metric = this.findOverviewMetric(metricId);
    if (!metric || !this.isMetricReady(metric)) {
      return null;
    }

    const fullValue = this.formatMetricForPanel(metric, 'full');
    const compactValue = this.formatMetricForPanel(metric, 'compact');
    return fullValue !== compactValue ? fullValue : null;
  }

  protected getOverviewPriorityZoneCountValue(): string {
    const zoneCount = this.solutionLayer.liveSolutionMetrics$()?.priorityZoneCount;
    if (zoneCount === null || zoneCount === undefined) {
      return '--';
    }
    return this.formatNumber(zoneCount, this.metricNumberFormatMode(), 0, 0);
  }

  protected getOverviewPriorityZoneCountFullValue(): string | null {
    const zoneCount = this.solutionLayer.liveSolutionMetrics$()?.priorityZoneCount;
    if (zoneCount === null || zoneCount === undefined) {
      return null;
    }

    const compactValue = this.getOverviewPriorityZoneCountValue();
    const fullValue = this.formatNumber(zoneCount, 'full', 0, 0);
    return compactValue === fullValue ? null : fullValue;
  }

  protected toggleOverviewSection(sectionId: OverviewMetricSection): void {
    this.overviewSectionExpanded.update((state) => ({
      ...state,
      [sectionId]: !state[sectionId],
    }));
  }

  protected isOverviewSectionExpanded(sectionId: OverviewMetricSection): boolean {
    return this.overviewSectionExpanded()[sectionId];
  }

  protected toggleAoiSection(sectionId: AoiSectionId): void {
    this.aoiSectionExpanded.update((state) => ({
      ...state,
      [sectionId]: !state[sectionId],
    }));
  }

  protected isAoiSectionExpanded(sectionId: AoiSectionId): boolean {
    return this.aoiSectionExpanded()[sectionId];
  }

  protected aoiVal(dummyValue: string): string {
    return this.fillDummyAoiMetrics() ? dummyValue : '--';
  }

  protected getAoiMetricValue(metricId: string, fallbackWhenMissing = '--'): string {
    const metric = this.aoiMetricsById().get(metricId);
    if (metric && metric.status === 'ready' && metric.value !== null) {
      return this.formatMetricForPanel(metric);
    }
    if (this.fillDummyAoiMetrics()) {
      return fallbackWhenMissing;
    }
    return '--';
  }

  protected getAoiUnitFallback(value: number, unit: string): string {
    return this.appendUnit(this.formatNumber(value, this.metricNumberFormatMode(), 0, 1), unit);
  }

  protected getAoiMetricFullValue(metricId: string): string | null {
    const metric = this.aoiMetricsById().get(metricId);
    if (metric && metric.status === 'ready' && metric.value !== null) {
      const compactValue = this.formatMetricForPanel(metric);
      const fullValue = this.formatMetricForPanel(metric, 'full');
      return compactValue === fullValue ? null : fullValue;
    }
    return null;
  }

  protected getAoiMetricStatus(metricId: string): string {
    const metric = this.aoiMetricsById().get(metricId);
    return metric && metric.status === 'ready' && metric.value !== null ? '' : '--';
  }

  protected getAoiMetricPercent(metricId: string, fallbackWhenMissing = 0): number {
    const metric = this.aoiMetricsById().get(metricId);
    if (metric?.status === 'ready' && metric.value !== null) {
      return Math.max(0, Math.min(100, metric.value));
    }
    return this.fillDummyAoiMetrics() ? fallbackWhenMissing : 0;
  }

  protected getAoiPriorityAreaPercentBarWidth(): number {
    const percent = this.calculateAoiPriorityAreaPercent();
    if (percent !== null) {
      return percent;
    }
    return this.fillDummyAoiMetrics() ? 45 : 0;
  }

  protected getAoiPriorityAreaPercentValue(): string {
    const percent = this.calculateAoiPriorityAreaPercent();
    if (percent !== null) {
      return this.appendUnit(this.formatNumber(percent, this.metricNumberFormatMode(), 0, 1), '%');
    }
    return this.fillDummyAoiMetrics() ? '45%' : '--';
  }

  protected getAoiPriorityAreaPercentFullValue(): string | null {
    const percent = this.calculateAoiPriorityAreaPercent();
    if (percent === null) {
      return null;
    }

    const compactValue = this.getAoiPriorityAreaPercentValue();
    const fullValue = this.appendUnit(this.formatNumber(percent, 'full', 0, 1), '%');
    return compactValue === fullValue ? null : fullValue;
  }

  protected getAoiEcosystemLegendValue(segmentId: string, fallbackWhenMissing = '--'): string {
    const metricIdBySegmentId: Record<string, string> = {
      ecosystems: 'ecosystem_coverage',
      paramo: 'ecosystem_coverage_paramo',
      'dry-forest': 'ecosystem_coverage_dry_forest',
      wetlands: 'ecosystem_coverage_wetlands',
      mangroves: 'mangrove_coverage',
    };
    const metricId = metricIdBySegmentId[segmentId];
    if (!metricId) {
      return this.fillDummyAoiMetrics() ? fallbackWhenMissing : '--';
    }
    return this.getAoiMetricValue(metricId, fallbackWhenMissing);
  }

  protected aoiBarWidth(dummyPercent: number): number {
    return this.fillDummyAoiMetrics() ? dummyPercent : 0;
  }

  protected aoiSpeciesBarWidth(count: number | null): number {
    if (count === null) {
      return 0;
    }

    const maxCount = this.aoiBiodiversityMaxCount();
    if (maxCount <= 0) {
      return 0;
    }

    // Keep headroom so the largest bar reads as "relative max", not "100% complete".
    const maxVisualFillPercent = 85;
    return (count / maxCount) * maxVisualFillPercent;
  }

  protected aoiSpeciesBarColor(speciesId: string): string {
    const paletteId = this.chartPaletteId();
    const palette = this.chartPalette().colors;
    const fallbackColor = palette[0] ?? '#64748b';
    const slot = this.aoiSpeciesColorSlotByPalette[paletteId]?.[speciesId];
    if (slot === undefined) {
      return fallbackColor;
    }
    return palette[slot] ?? fallbackColor;
  }

  protected isComparisonSectionExpanded(sectionId: ComparisonSectionId): boolean {
    return this.comparisonSectionExpanded()[sectionId];
  }

  protected toggleComparisonSection(sectionId: ComparisonSectionId): void {
    this.comparisonSectionExpanded.update((state) => ({
      ...state,
      [sectionId]: !state[sectionId],
    }));
  }

  protected openComparisonSolutionFinder(): void {
    this.appState.openSolutionFinder('comparison-candidate');
    this.appState.setRightSidebarMode('comparison');
  }

  protected getComparisonActionLabelKey(): string {
    return this.comparisonSolution()
      ? 'analysis.comparison.actions.change'
      : 'analysis.comparison.actions.select';
  }

  protected isComparisonVisualizationModeSelected(mode: ComparisonVisualizationMode): boolean {
    return this.comparisonVisualizationMode() === mode;
  }

  protected selectComparisonVisualizationMode(mode: ComparisonVisualizationMode): void {
    this.appState.setComparisonVisualizationMode(mode);
  }

  protected openNotImplementedDialog(): void {
    this.isNotImplementedDialogOpen.set(true);
  }

  protected closeNotImplementedDialog(): void {
    this.isNotImplementedDialogOpen.set(false);
  }

  protected onNotImplementedDialogBackdropClick(event: Event): void {
    if (event.target === event.currentTarget) {
      this.closeNotImplementedDialog();
    }
  }

  protected onNotImplementedDialogBackdropKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') {
      event.preventDefault();
      this.closeNotImplementedDialog();
    }
  }

  private formatNumber(
    value: number,
    mode: MetricNumberFormatMode,
    minimumFractionDigits: number,
    maximumFractionDigits: number,
  ): string {
    if (mode === 'compact') {
      return this.formatCompactNumber(value, minimumFractionDigits, maximumFractionDigits);
    }

    return new Intl.NumberFormat(this.resolveLocale(), {
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(value);
  }

  private formatCompactNumber(
    value: number,
    minimumFractionDigits: number,
    maximumFractionDigits: number,
  ): string {
    const absoluteValue = Math.abs(value);
    const appLocale = this.appLocale.locale();
    const locale = this.resolveNumberLocale(appLocale);
    const compactScale =
      absoluteValue >= 1_000_000 ? 1_000_000 : absoluteValue >= 1_000 ? 1_000 : 1;
    const scaledValue = value / compactScale;
    const formattedValue = new Intl.NumberFormat(locale, {
      minimumFractionDigits,
      maximumFractionDigits: compactScale === 1 ? maximumFractionDigits : 1,
    }).format(scaledValue);

    if (compactScale === 1_000_000) {
      return `${formattedValue}M`;
    }

    if (compactScale === 1_000) {
      return appLocale === 'es' ? `${formattedValue} mil` : `${formattedValue}K`;
    }

    return formattedValue;
  }

  private appendUnit(value: string, unit: string | null): string {
    if (unit === '%') {
      return `${value}%`;
    }
    return unit ? `${value} ${unit}` : value;
  }

  private formatMetricUnit(unit: string | null): string | null {
    if (!unit) {
      return null;
    }

    return unit.replace(/Mg\s*[-·x*/]\s*km\^?2\b/g, 'Mg/km²').replace(/km\^?2\b/g, 'km²');
  }

  private formatMetricForPanel(
    metric: MetricValue,
    mode: MetricNumberFormatMode = this.metricNumberFormatMode(),
  ): string {
    const formattedUnit = this.getMetricDisplayUnit(metric);
    const number = this.formatNumber(
      metric.value ?? 0,
      mode,
      0,
      metric.formatHint === 'percent' ? 1 : 2,
    );
    if (metric.formatHint === 'percent' || formattedUnit === '%') {
      return `${number}%`;
    }
    return formattedUnit ? `${number} ${formattedUnit}` : number;
  }

  private getMetricDisplayUnit(metric: MetricValue): string | null {
    if (metric.metricId === 'carbon_biomass_total' || metric.metricId === 'soil_organic_carbon') {
      return 'Mg';
    }

    if (metric.metricId === 'carbon_storage_biomass') {
      return 'Mg';
    }

    return this.formatMetricUnit(metric.unit);
  }

  private resolveLocale(): string {
    return this.resolveNumberLocale(this.appLocale.locale());
  }

  private resolveNumberLocale(locale: string): string {
    return locale === 'es' ? 'es-CO' : 'en-US';
  }

  private getAoiBiodiversityScale(aoiId: string): number {
    const mod = aoiId.length % 4;
    return [0.9, 1, 1.1, 1.2][mod] ?? 1;
  }

  private calculateAoiPriorityAreaPercent(): number | null {
    const selectedAoiAreaKm2 = this.resolveSelectedAoiAreaKm2();
    const priorityArea = this.aoiMetricsById().get('priority_area_in_region');
    if (
      selectedAoiAreaKm2 === null ||
      priorityArea?.status !== 'ready' ||
      priorityArea.value === null
    ) {
      return null;
    }

    const percent = (priorityArea.value / selectedAoiAreaKm2) * 100;
    return Math.max(0, Math.min(100, percent));
  }

  private resolveSelectedAoiAreaKm2(): number | null {
    const selectedAoiAreaKm2 = this.selectedAoi()?.areaKm2;
    if (
      selectedAoiAreaKm2 !== undefined &&
      Number.isFinite(selectedAoiAreaKm2) &&
      selectedAoiAreaKm2 > 0
    ) {
      return selectedAoiAreaKm2;
    }

    const customArea = this.aoiMetricsById().get('area');
    if (customArea?.status === 'ready' && customArea.value !== null && customArea.value > 0) {
      return customArea.value;
    }

    return null;
  }

  private buildDonutGradient(): string {
    const legend = this.aoiEcosystemLegend();
    const slices: string[] = [];
    let start = 0;

    for (const segment of legend) {
      const end = start + segment.percent;
      slices.push(`${segment.color} ${start}% ${end}%`);
      start = end;
    }

    return `conic-gradient(${slices.join(', ')})`;
  }

  private getGreenPaletteSlot(): number {
    return this.aoiSpeciesColorSlotByPalette[this.chartPaletteId()]?.['plants'] ?? 0;
  }

  private getAoiEcosystemLabel(segmentId: string, fallback: string): string {
    const keyById: Record<string, string> = {
      ecosystems: 'analysis.aoi.ecosystemLegend.ecosystems',
      paramo: 'analysis.aoi.ecosystemLegend.paramo',
      'dry-forest': 'analysis.aoi.ecosystemLegend.dryForest',
      wetlands: 'analysis.aoi.ecosystemLegend.wetlands',
      mangroves: 'analysis.aoi.ecosystemLegend.mangroves',
    };
    const key = keyById[segmentId];
    return key ? this.localizedText(key, fallback) : fallback;
  }

  private localizedText(key: string, fallback = key): string {
    this.appLocale.locale();
    return this.translate.instant(key) || fallback;
  }

  private getPaletteColorBySlot(slot: number): string {
    const palette = this.chartPalette().colors;
    return palette[slot] ?? palette[0] ?? '#64748b';
  }

  private withAlpha(hexColor: string, alpha: number): string {
    const normalized = hexColor.trim();
    if (!normalized.startsWith('#')) {
      return hexColor;
    }

    let hex = normalized.slice(1);
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((char) => `${char}${char}`)
        .join('');
    }

    if (hex.length !== 6) {
      return hexColor;
    }

    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  private buildActiveSolutionInputs(): ActiveSolutionInputs | null {
    if (!this.appState.showOverviewInputsReminder$()) {
      return null;
    }

    const solution = this.activeSolution();
    const scenarioId = solution?.metadata?.['scenarioId'];
    if (typeof scenarioId !== 'string') {
      return null;
    }

    const scenario = this.solutionCatalog.getById(scenarioId);
    if (!scenario) {
      return null;
    }

    const isStrategic = scenario.id.toLowerCase().startsWith('estr');
    const targetFamilyKey = isStrategic
      ? 'analysis.overview.inputsTooltip.targetFamilyStrategic'
      : 'analysis.overview.inputsTooltip.targetFamilyEcosystems';

    const targetText = this.translate.instant('analysis.overview.inputsTooltip.targetValue', {
      pct: scenario.ecosystemTargets,
      family: this.translate.instant(targetFamilyKey),
    });

    const constraintsText =
      scenario.constraints.length > 0
        ? scenario.constraints.join(', ')
        : this.translate.instant('analysis.overview.inputsTooltip.constraintsNone');

    return {
      targetText,
      constraintsText,
      tradeoffText: scenario.costLayer,
    };
  }

  private loadCustomAoiMetricBatch(
    geometry: CustomPolygonMetricsGeometry,
    metrics: CustomPolygonMetricId[],
    mode: CustomAoiMetricRequestMode,
    requestId: number,
  ): Observable<MetricValue[]> {
    const startedAt = Date.now();
    this.logCustomAoiRequestStart(requestId, mode, metrics);

    return this.api.getCustomPolygonMetrics({ geometry, metrics }).pipe(
      map((response) => {
        const responseMetricKeys = Object.keys(response.metrics ?? {});
        this.logCustomAoiRequestSuccess(requestId, mode, startedAt, response, responseMetricKeys);

        if (response.status !== 'ok') {
          throw new Error(
            response.message ||
              this.translate.instant('analysis.aoi.customMetrics.statusReturned', {
                status: response.status,
              }),
          );
        }

        return this.mapCustomPolygonMetrics(response, mode);
      }),
      tap({
        error: (error: unknown) => this.logCustomAoiRequestError(requestId, mode, startedAt, error),
      }),
      finalize(() => this.logCustomAoiRequestFinalize(requestId, mode, startedAt)),
    );
  }

  private mapCustomPolygonMetrics(
    response: CustomPolygonMetricsResponse,
    mode: CustomAoiMetricRequestMode,
  ): MetricValue[] {
    if (response.status !== 'ok') {
      this.customAoiMetricsLoadFailed.set(true);
      this.customAoiMetricsMessage.set(
        response.message || this.translate.instant('analysis.aoi.customMetrics.unavailable'),
      );
      return [];
    }

    this.customAoiMetricsLoadFailed.set(false);
    this.customAoiMetricsMessage.set(response.message || null);
    const metrics = Object.entries(response.metrics ?? {}).map(([metricId, value]) =>
      this.buildCustomAoiMetricValue(metricId, value, `custom-polygon-api:${mode}`),
    );

    const selectedAoiAreaKm2 = this.selectedAoi()?.areaKm2;
    if (
      mode === 'fast' &&
      selectedAoiAreaKm2 !== undefined &&
      Number.isFinite(selectedAoiAreaKm2)
    ) {
      metrics.unshift(
        this.buildCustomAoiMetricValue('area', selectedAoiAreaKm2, 'custom-aoi-geometry'),
      );
    }

    return metrics;
  }

  private mergeCustomAoiMetricValues(
    baseMetrics: MetricValue[],
    nextMetrics: MetricValue[],
  ): MetricValue[] {
    const metricsById = new Map(baseMetrics.map((metric) => [metric.metricId, metric]));
    for (const metric of nextMetrics) {
      metricsById.set(metric.metricId, metric);
    }
    return Array.from(metricsById.values());
  }

  protected getCustomAoiSpeciesLoadingKey(): string {
    const stage = this.customAoiSpeciesLoadingStage();
    const estimateBand = this.customAoiBiodiversityEstimateBand();

    if (stage === 'initial') {
      return `analysis.aoi.customMetrics.speciesLoading.initial.${estimateBand}`;
    }

    if (stage === 'delayed') {
      const delayedBand =
        estimateBand === 'large' || estimateBand === 'veryLarge'
          ? 'largeAoi'
          : 'longerThanExpected';
      return `analysis.aoi.customMetrics.speciesLoading.delayed.${delayedBand}`;
    }

    return 'analysis.aoi.customMetrics.speciesLoading.extended';
  }

  private classifyCustomAoiBiodiversityEstimate(): CustomAoiBiodiversityEstimateBand {
    const areaKm2 = this.resolveSelectedAoiAreaKm2();
    if (areaKm2 === null) {
      return 'unknown';
    }

    if (areaKm2 <= CUSTOM_AOI_BIODIVERSITY_AREA_BANDS_KM2.smallMax) {
      return 'small';
    }

    if (areaKm2 <= CUSTOM_AOI_BIODIVERSITY_AREA_BANDS_KM2.mediumMax) {
      return 'medium';
    }

    if (areaKm2 <= CUSTOM_AOI_BIODIVERSITY_AREA_BANDS_KM2.largeMax) {
      return 'large';
    }

    return 'veryLarge';
  }

  private startCustomAoiSpeciesLoadingStages(): void {
    this.stopCustomAoiSpeciesLoadingStages();
    this.customAoiSpeciesLoadingStage.set('initial');
    this.customAoiSpeciesStageTimeouts = [
      setTimeout(
        () => this.customAoiSpeciesLoadingStage.set('delayed'),
        CUSTOM_AOI_SPECIES_DELAYED_STAGE_MS,
      ),
      setTimeout(
        () => this.customAoiSpeciesLoadingStage.set('extended'),
        CUSTOM_AOI_SPECIES_EXTENDED_STAGE_MS,
      ),
    ];
  }

  private stopCustomAoiSpeciesLoadingStages(): void {
    for (const timeoutId of this.customAoiSpeciesStageTimeouts) {
      clearTimeout(timeoutId);
    }
    this.customAoiSpeciesStageTimeouts = [];
    this.customAoiSpeciesLoadingStage.set('initial');
  }

  private areCustomAoiGeometriesEqual(
    previous: CustomPolygonMetricsGeometry | null,
    current: CustomPolygonMetricsGeometry | null,
  ): boolean {
    if (previous === current) {
      return true;
    }
    if (!previous || !current || previous.type !== current.type) {
      return false;
    }
    return JSON.stringify(previous.coordinates) === JSON.stringify(current.coordinates);
  }

  private buildCustomAoiMetricValue(
    metricId: CustomPolygonMetricId,
    rawValue: number | null | undefined,
    source: string,
  ): MetricValue {
    const definition = this.getCustomAoiMetricDefinition(metricId);
    const value = typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : null;

    return {
      ...definition,
      value,
      status: value === null ? 'pending' : 'ready',
      source,
      notes: value === null ? 'Backend did not return a value for this metric.' : null,
    };
  }

  private getCustomAoiMetricDefinition(metricId: CustomPolygonMetricId): CustomAoiMetricDefinition {
    const definition = CUSTOM_AOI_METRIC_DEFINITIONS[metricId];
    if (definition) {
      return definition;
    }

    const formatHint: MetricValueFormatHint =
      metricId.includes('_pct') ||
      metricId.endsWith('_percent') ||
      metricId.endsWith('_contribution')
        ? 'percent'
        : 'number';
    return {
      metricId,
      unit: formatHint === 'percent' ? '%' : null,
      labelKey: `metrics.tier1.${metricId}`,
      formatHint,
    };
  }

  private getCustomAoiErrorMessage(error: unknown): string {
    const detail = this.getHttpErrorDetail(error);
    if (detail) {
      return detail;
    }
    return error instanceof Error
      ? error.message
      : this.translate.instant('analysis.aoi.customMetrics.loadError');
  }

  private getHttpErrorDetail(error: unknown): string | null {
    if (!error || typeof error !== 'object' || !('error' in error)) {
      return null;
    }

    const responseBody = (error as { error?: unknown }).error;
    if (!responseBody || typeof responseBody !== 'object' || !('detail' in responseBody)) {
      return null;
    }

    const detail = (responseBody as { detail?: unknown }).detail;
    if (typeof detail === 'string') {
      return detail;
    }
    if (detail && typeof detail === 'object' && 'message' in detail) {
      const message = (detail as { message?: unknown }).message;
      return typeof message === 'string' ? message : null;
    }

    return null;
  }

  private logCustomAoiRequestStart(
    requestId: number,
    mode: CustomAoiMetricRequestMode,
    metrics: CustomPolygonMetricId[],
  ): void {
    console.info('[PanelSwitcher][CustomAOI] request start', {
      requestId,
      mode,
      requestedMetricCount: metrics.length,
      requestedMetrics: metrics,
    });
  }

  private logCustomAoiRequestSuccess(
    requestId: number,
    mode: CustomAoiMetricRequestMode,
    startedAt: number,
    response: CustomPolygonMetricsResponse,
    responseMetricKeys: string[],
  ): void {
    console.info('[PanelSwitcher][CustomAOI] request success', {
      requestId,
      mode,
      elapsedMs: Date.now() - startedAt,
      responseStatus: response.status,
      returnedMetricCount: responseMetricKeys.length,
      responseMetricKeys,
    });
  }

  private logCustomAoiRequestError(
    requestId: number,
    mode: CustomAoiMetricRequestMode,
    startedAt: number,
    error: unknown,
  ): void {
    console.error('[PanelSwitcher][CustomAOI] request error', {
      requestId,
      mode,
      elapsedMs: Date.now() - startedAt,
      responseStatus: this.getHttpErrorStatus(error),
      detail: this.getCustomAoiErrorMessage(error),
      error,
    });
  }

  private logCustomAoiRequestFinalize(
    requestId: number,
    mode: CustomAoiMetricRequestMode,
    startedAt: number,
  ): void {
    console.info('[PanelSwitcher][CustomAOI] request finalize', {
      requestId,
      mode,
      elapsedMs: Date.now() - startedAt,
    });
  }

  private getHttpErrorStatus(error: unknown): number | string | null {
    if (!error || typeof error !== 'object' || !('status' in error)) {
      return null;
    }

    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' || typeof status === 'string' ? status : null;
  }

  private buildOverviewSections(metrics: MetricValue[]): AnalysisMetricSectionFixture[] {
    const grouped = new Map<string, AnalysisMetricSectionFixture>();

    for (const metric of metrics) {
      const sectionDefinition = this.overviewSectionLookup[metric.metricId];
      if (!sectionDefinition) {
        continue;
      }

      const section =
        grouped.get(sectionDefinition.id) ??
        ({
          sectionId: sectionDefinition.id,
          sectionLabelKey: sectionDefinition.labelKey,
          metrics: [],
        } satisfies AnalysisMetricSectionFixture);

      section.metrics.push(metric);
      grouped.set(sectionDefinition.id, section);
    }

    return this.overviewSectionOrder
      .map((sectionId) => grouped.get(sectionId))
      .filter((section): section is AnalysisMetricSectionFixture => section !== undefined);
  }

  private resolveAoiMetrics(
    document: CachedSolutionMetricsDocument | null,
    aoi: AOI,
  ): MetricValue[] {
    if (!document) {
      return [];
    }

    const level = this.aoiTypeToGeographyLevel(aoi.type);
    if (!level) {
      return [];
    }

    const geographies = document.geographies[level] ?? {};
    const rawId = this.extractRawAoiScopeId(aoi.id);
    const directCandidates = [rawId, aoi.name].filter((candidate): candidate is string =>
      Boolean(candidate?.trim()),
    );

    for (const scopeId of directCandidates) {
      const metrics = metricsForScope(document, level, scopeId);
      if (metrics.length > 0) {
        return metrics;
      }
    }

    const normalizedAoiName = this.normalizeScopeLabel(aoi.name);
    for (const [scopeId, scope] of Object.entries(geographies)) {
      if (this.normalizeScopeLabel(scopeId) === normalizedAoiName) {
        return scope.metrics ?? [];
      }
      if (this.normalizeScopeLabel(scope.name ?? '') === normalizedAoiName) {
        return scope.metrics ?? [];
      }
    }

    return [];
  }

  private aoiTypeToGeographyLevel(type: AOI['type']): GeographyLevel | null {
    switch (type) {
      case 'department':
        return 'departments';
      case 'municipality':
        return 'municipalities';
      case 'sirap':
        return 'siraps';
      case 'runap':
        return 'runaps';
      case 'omec':
        return 'omecs';
      default:
        return null;
    }
  }

  private extractRawAoiScopeId(prefixedAoiId: string): string {
    const separatorIndex = prefixedAoiId.indexOf(':');
    if (separatorIndex === -1) {
      return prefixedAoiId.trim();
    }
    return prefixedAoiId.slice(separatorIndex + 1).trim();
  }

  private normalizeScopeLabel(label: string): string {
    return label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase();
  }

  private buildOverviewMetricDisplayEntries(
    section: OverviewMetricSection,
  ): OverviewMetricDisplayEntry[] {
    const metricsById = new Map(
      this.overviewSections()
        .flatMap((metricSection) => metricSection.metrics)
        .map((metric) => [metric.metricId, metric] as const),
    );
    const shouldFillDummy = this.fillDummyOverviewMetrics();

    return this.overviewMetricBlueprints
      .filter((metric) => metric.section === section)
      .map((metric) => {
        if (metric.conditional) {
          return {
            id: metric.id,
            labelKey: metric.labelKey,
            descriptionKey: metric.descriptionKey,
            iconClass: metric.iconClass,
            value: '--',
            fullValue: null,
            unit: '--',
            conditional: true,
            unavailable: true,
          };
        }

        const realMetric = metric.realMetricId ? metricsById.get(metric.realMetricId) : undefined;
        const realValueAvailable = realMetric?.status === 'ready' && realMetric.value !== null;
        const liveNationalContribution =
          metric.realMetricId === 'national_contribution'
            ? this.formatLiveNationalContribution()
            : null;

        if (liveNationalContribution) {
          const fullValue = this.formatLiveNationalContribution('full');
          return {
            id: metric.id,
            labelKey: metric.labelKey,
            descriptionKey: metric.descriptionKey,
            iconClass: metric.iconClass,
            value: liveNationalContribution,
            fullValue,
            unit: '',
            conditional: Boolean(metric.conditional),
            unavailable: false,
          };
        }

        if (realMetric && realValueAvailable) {
          return {
            id: metric.id,
            labelKey: metric.labelKey,
            descriptionKey: metric.descriptionKey,
            iconClass: metric.iconClass,
            value: this.formatMetricForPanel(realMetric),
            fullValue: this.formatMetricForPanel(realMetric, 'full'),
            unit: '',
            conditional: Boolean(metric.conditional),
            unavailable: false,
          };
        }

        if (shouldFillDummy) {
          return {
            id: metric.id,
            labelKey: metric.labelKey,
            descriptionKey: metric.descriptionKey,
            iconClass: metric.iconClass,
            value: this.formatOverviewDummyValue(metric),
            fullValue: null,
            unit: this.localizedText(metric.dummyUnitKey ?? ''),
            conditional: Boolean(metric.conditional),
            unavailable: false,
          };
        }

        return {
          id: metric.id,
          labelKey: metric.labelKey,
          descriptionKey: metric.descriptionKey,
          iconClass: metric.iconClass,
          value: '--',
          fullValue: null,
          unit: '--',
          conditional: Boolean(metric.conditional),
          unavailable: true,
        };
      });
  }

  private findOverviewMetric(metricId: string): MetricValue | null {
    return (
      this.overviewSections()
        .flatMap((metricSection) => metricSection.metrics)
        .find((metric) => metric.metricId === metricId) ?? null
    );
  }

  private formatLiveNationalContribution(
    mode: MetricNumberFormatMode = this.metricNumberFormatMode(),
  ): string | null {
    const liveMetrics = this.solutionLayer.liveSolutionMetrics$();
    const percent = liveMetrics?.nationalContributionPct;
    if (liveMetrics?.status !== 'ready' || percent === null || percent === undefined) {
      return null;
    }

    return `${this.formatNumber(percent, mode, 0, mode === 'full' ? 2 : 1)}%`;
  }

  private buildComparisonSections(): ComparisonMetricSection[] {
    const metricsById = new Map(
      this.comparisonMetrics().map((metric) => [metric.metricId, metric] as const),
    );
    const shouldFillDummy = this.fillDummyComparisonMetrics();

    return this.comparisonSectionOrder.map((sectionId) => {
      const sectionMeta = this.comparisonSectionMeta[sectionId];
      const metrics = this.comparisonMetricBlueprints
        .filter((metric) => metric.section === sectionId)
        .map((metric) =>
          this.buildComparisonMetricDisplayEntry(metric, metricsById, shouldFillDummy),
        );

      return {
        id: sectionId,
        titleKey: sectionMeta.titleKey,
        toneClass: sectionMeta.toneClass,
        metrics,
      };
    });
  }

  private buildAoiAlignedMetricDisplayEntries(): AoiAlignedMetricDisplayEntry[] {
    const metricsById = this.aoiMetricsById();
    const shouldFillDummy = this.fillDummyAoiMetrics();

    return this.aoiAlignedMetricBlueprints.flatMap<AoiAlignedMetricDisplayEntry>((blueprint) => {
      const realMetric = blueprint.metricIds
        .map((metricId) => metricsById.get(metricId))
        .find((metric): metric is MetricValue => Boolean(metric && this.isMetricReady(metric)));

      if (realMetric) {
        const fullValue = this.formatMetricForPanel(realMetric, 'full');
        const compactValue = this.formatMetricForPanel(realMetric);

        return [
          {
            id: blueprint.id,
            metricId: realMetric.metricId,
            labelKey: this.getAoiAlignedMetricLabelKey(blueprint),
            descriptionKey: blueprint.descriptionKey,
            iconClass: blueprint.iconClass,
            value: compactValue,
            fullValue,
            unit: '',
          },
        ];
      }

      if (shouldFillDummy) {
        return [
          {
            id: blueprint.id,
            metricId: blueprint.metricIds[0] ?? blueprint.id,
            labelKey: this.getAoiAlignedMetricLabelKey(blueprint),
            descriptionKey: blueprint.descriptionKey,
            iconClass: blueprint.iconClass,
            value: blueprint.dummyValue,
            fullValue: null,
            unit: this.localizedText(blueprint.dummyUnitKey ?? ''),
          },
        ];
      }

      return [];
    });
  }

  private getAoiAlignedMetricLabelKey(blueprint: AoiAlignedMetricBlueprint): string {
    if (this.isCustomAoiSelected() && blueprint.customAoiLabelKey) {
      return blueprint.customAoiLabelKey;
    }

    return blueprint.labelKey;
  }

  private buildMetricComparisons(
    baselineMetrics: MetricValue[],
    candidateMetrics: MetricValue[],
  ): MetricComparisonValue[] {
    const candidateById = new Map(candidateMetrics.map((metric) => [metric.metricId, metric]));
    return baselineMetrics
      .map((baseline): MetricComparisonValue | null => {
        const candidate = candidateById.get(baseline.metricId);
        if (!candidate) {
          return null;
        }

        const delta =
          baseline.status === 'ready' &&
          candidate.status === 'ready' &&
          baseline.value !== null &&
          candidate.value !== null
            ? Number((candidate.value - baseline.value).toFixed(2))
            : null;

        return {
          metricId: baseline.metricId,
          labelKey: baseline.labelKey,
          formatHint: baseline.formatHint,
          baseline,
          candidate,
          delta,
        };
      })
      .filter((metric): metric is MetricComparisonValue => metric !== null);
  }

  private buildComparisonMetricDisplayEntry(
    blueprint: ComparisonMetricBlueprint,
    metricsById: Map<string, MetricComparisonValue>,
    shouldFillDummy: boolean,
  ): ComparisonMetricDisplayEntry {
    const realMetric = blueprint.metricId ? metricsById.get(blueprint.metricId) : undefined;

    if (realMetric && this.isComparisonMetricReady(realMetric)) {
      return {
        id: blueprint.id,
        labelKey: blueprint.labelKey,
        descriptionKey: blueprint.descriptionKey,
        baseline: this.formatMetricValue(realMetric.baseline),
        baselineFull: this.formatMetricValue(realMetric.baseline, 'full'),
        candidate: this.formatMetricValue(realMetric.candidate),
        candidateFull: this.formatMetricValue(realMetric.candidate, 'full'),
        delta: this.formatDelta(realMetric),
        deltaFull: this.formatDelta(realMetric, 'full'),
        conditional: Boolean(blueprint.conditional),
        unavailable: false,
        deltaTone:
          realMetric.delta === null || realMetric.delta === 0
            ? 'neutral'
            : realMetric.delta > 0
              ? 'positive'
              : 'negative',
      };
    }

    const liveMetricEntry = this.buildLiveRasterComparisonEntry(blueprint);
    if (liveMetricEntry) {
      return liveMetricEntry;
    }

    if (shouldFillDummy) {
      return {
        id: blueprint.id,
        labelKey: blueprint.labelKey,
        descriptionKey: blueprint.descriptionKey,
        baseline: this.formatComparisonDummyValue(blueprint, 'baseline'),
        baselineFull: null,
        candidate: this.formatComparisonDummyValue(blueprint, 'candidate'),
        candidateFull: null,
        delta: this.formatComparisonDummyValue(blueprint, 'delta'),
        deltaFull: null,
        conditional: Boolean(blueprint.conditional),
        unavailable: false,
        deltaTone: blueprint.deltaTone ?? 'positive',
      };
    }

    if (realMetric) {
      return {
        id: blueprint.id,
        labelKey: blueprint.labelKey,
        descriptionKey: blueprint.descriptionKey,
        baseline: this.formatMetricValue(realMetric.baseline),
        baselineFull: this.formatMetricValue(realMetric.baseline, 'full'),
        candidate: this.formatMetricValue(realMetric.candidate),
        candidateFull: this.formatMetricValue(realMetric.candidate, 'full'),
        delta: this.formatDelta(realMetric),
        deltaFull: this.formatDelta(realMetric, 'full'),
        conditional: Boolean(blueprint.conditional),
        unavailable: true,
        deltaTone: 'neutral',
      };
    }

    return {
      id: blueprint.id,
      labelKey: blueprint.labelKey,
      descriptionKey: blueprint.descriptionKey,
      baseline: '--',
      baselineFull: null,
      candidate: '--',
      candidateFull: null,
      delta: '--',
      deltaFull: null,
      conditional: Boolean(blueprint.conditional),
      unavailable: true,
      deltaTone: 'neutral',
    };
  }

  private formatOverviewDummyValue(metric: OverviewMetricBlueprint): string {
    if (metric.id === 'metric-05-carbon-storage-capacity') {
      return this.formatNumber(2_300_000, this.metricNumberFormatMode(), 0, 1);
    }

    return metric.dummyValue;
  }

  private formatComparisonDummyValue(
    blueprint: ComparisonMetricBlueprint,
    field: 'baseline' | 'candidate' | 'delta',
  ): string {
    if (blueprint.id !== 'comp-carbon') {
      switch (field) {
        case 'baseline':
          return blueprint.dummyBaseline;
        case 'candidate':
          return blueprint.dummyCandidate;
        case 'delta':
          return blueprint.dummyDelta;
      }
    }

    const valueByField = {
      baseline: 69_000,
      candidate: 74_000,
      delta: 5_000,
    } satisfies Record<typeof field, number>;
    const sign = field === 'delta' ? '+' : '';
    return this.appendUnit(
      `${sign}${this.formatNumber(valueByField[field], this.metricNumberFormatMode(), 0, 0)}`,
      'Mg',
    );
  }

  private isComparisonMetricReady(metric: MetricComparisonValue): boolean {
    return (
      metric.baseline.status === 'ready' &&
      metric.candidate.status === 'ready' &&
      metric.baseline.value !== null &&
      metric.candidate.value !== null &&
      metric.delta !== null
    );
  }

  private buildSpatialOverlapEntries(): SpatialOverlapDisplayEntry[] {
    const liveMetrics = this.solutionLayer.liveComparisonMetrics$();
    if (liveMetrics?.status !== 'ready') {
      return [];
    }

    return [
      this.buildSpatialOverlapEntry(
        'agreement-area',
        'analysis.comparison.metrics.agreementArea',
        'analysis.comparison.metrics.agreementAreaDesc',
        liveMetrics.agreementAreaKm2,
        'overlap',
      ),
      this.buildSpatialOverlapEntry(
        'unique-scenario-a',
        'analysis.comparison.metrics.uniqueScenarioA',
        'analysis.comparison.metrics.uniqueScenarioADesc',
        liveMetrics.uniqueToBaselineKm2,
        'baseline',
      ),
      this.buildSpatialOverlapEntry(
        'unique-scenario-b',
        'analysis.comparison.metrics.uniqueScenarioB',
        'analysis.comparison.metrics.uniqueScenarioBDesc',
        liveMetrics.uniqueToCandidateKm2,
        'candidate',
      ),
    ];
  }

  private buildSpatialOverlapEntry(
    id: string,
    labelKey: string,
    descriptionKey: string,
    value: number | null,
    colorClass: SpatialOverlapDisplayEntry['colorClass'],
  ): SpatialOverlapDisplayEntry {
    const compactValue = value === null ? '--' : this.formatLiveAreaMetric(value);
    const fullValue = value === null ? null : this.formatLiveAreaMetric(value, 'full');
    return {
      id,
      labelKey,
      descriptionKey,
      value: compactValue,
      fullValue: compactValue === fullValue ? null : fullValue,
      colorClass,
    };
  }

  private buildLiveRasterComparisonEntry(
    blueprint: ComparisonMetricBlueprint,
  ): ComparisonMetricDisplayEntry | null {
    const liveMetrics = this.solutionLayer.liveComparisonMetrics$();
    if (!blueprint.metricId || liveMetrics?.status !== 'ready') {
      return null;
    }

    if (blueprint.metricId === 'priority_area_in_region') {
      return this.buildLiveRasterDisplayEntry(
        blueprint,
        liveMetrics.baselineSelectedAreaKm2,
        liveMetrics.candidateSelectedAreaKm2,
        (value) => this.formatLiveAreaMetric(value),
        (value) => this.formatLiveAreaMetric(value, 'full'),
      );
    }

    if (blueprint.metricId === 'national_contribution') {
      return this.buildLiveRasterDisplayEntry(
        blueprint,
        liveMetrics.baselineNationalContributionPct,
        liveMetrics.candidateNationalContributionPct,
        (value) => `${this.formatNumber(value, this.metricNumberFormatMode(), 0, 1)}%`,
        (value) => `${this.formatNumber(value, 'full', 0, 2)}%`,
      );
    }

    return null;
  }

  private buildLiveRasterDisplayEntry(
    blueprint: ComparisonMetricBlueprint,
    baselineValue: number | null,
    candidateValue: number | null,
    formatCompact: (value: number) => string,
    formatFull: (value: number) => string,
  ): ComparisonMetricDisplayEntry | null {
    if (baselineValue === null || candidateValue === null) {
      return null;
    }

    const baseline = formatCompact(baselineValue);
    const baselineFull = formatFull(baselineValue);
    const candidate = formatCompact(candidateValue);
    const candidateFull = formatFull(candidateValue);
    const deltaValue = Number((candidateValue - baselineValue).toFixed(2));
    const deltaPrefix = deltaValue > 0 ? '+' : '';
    const delta = `${deltaPrefix}${formatCompact(deltaValue)}`;
    const deltaFull = `${deltaPrefix}${formatFull(deltaValue)}`;

    return {
      id: blueprint.id,
      labelKey: blueprint.labelKey,
      descriptionKey: blueprint.descriptionKey,
      baseline,
      baselineFull: baseline === baselineFull ? null : baselineFull,
      candidate,
      candidateFull: candidate === candidateFull ? null : candidateFull,
      delta,
      deltaFull: delta === deltaFull ? null : deltaFull,
      conditional: Boolean(blueprint.conditional),
      unavailable: false,
      deltaTone: deltaValue === 0 ? 'neutral' : deltaValue > 0 ? 'positive' : 'negative',
    };
  }

  private formatLiveAreaMetric(
    value: number,
    mode: MetricNumberFormatMode = this.metricNumberFormatMode(),
  ): string {
    return this.appendUnit(this.formatNumber(value, mode, 0, 2), 'km²');
  }
}
