import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  type AOI,
  type AnalysisMetricSectionFixture,
  type CachedSolutionMetricsDocument,
  type GeographyLevel,
  type MetricComparisonValue,
  type MetricReadinessStatus,
  type MetricValue,
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
import { catchError, distinctUntilChanged, finalize, map, of, switchMap } from 'rxjs';
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
      id: 'metric-04-ecosystem-coverage',
      section: 'gains',
      labelKey: 'analysis.overview.metrics.ecosystemCoverage',
      descriptionKey: 'analysis.overview.metrics.ecosystemCoverageDesc',
      iconClass: 'fas fa-seedling',
      realMetricId: 'ecosystem_coverage',
      dummyValue: '125k km²',
      dummyUnitKey: 'analysis.overview.metricUnits.eightyFivePercentOfTarget',
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
      dummyValue: '2.3B',
      dummyUnitKey: 'analysis.overview.metricUnits.tco2e',
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
    {
      id: 'metric-13-conflict-zone-overlap',
      section: 'costs',
      labelKey: 'analysis.overview.metrics.conflictZoneOverlap',
      descriptionKey: 'analysis.overview.metrics.conflictZoneOverlapDesc',
      iconClass: 'fas fa-triangle-exclamation',
      dummyValue: '95,000 km²',
      dummyUnitKey: 'analysis.overview.metricUnits.areaAffected',
      conditional: true,
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
      id: 'comp-biodiversity',
      section: 'biodiversity',
      labelKey: 'analysis.comparison.metrics.ecosystemCoverage',
      descriptionKey: 'analysis.comparison.metrics.ecosystemCoverageDesc',
      metricId: 'ecosystem_coverage',
      dummyBaseline: '83%',
      dummyCandidate: '92%',
      dummyDelta: '+9%',
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
      dummyBaseline: '69 t/ha',
      dummyCandidate: '74 t/ha',
      dummyDelta: '+5 t/ha',
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
    return this.resolveAoiMetrics(this.cachedMetricsDocument(), aoi);
  });
  protected readonly aoiMetricsById = computed<Map<string, MetricValue>>(
    () => new Map(this.aoiMetrics().map((metric) => [metric.metricId, metric] as const)),
  );
  protected readonly isSirapAoiSelected = computed(() => this.selectedAoi()?.type === 'sirap');

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
    const metric = this.findOverviewMetric(metricId);
    if (metric && this.isMetricReady(metric)) {
      return this.formatMetricForPanel(metric);
    }

    return fallbackWhenMissing;
  }

  protected getOverviewMetricFullValue(metricId: string): string | null {
    const metric = this.findOverviewMetric(metricId);
    if (!metric || !this.isMetricReady(metric)) {
      return null;
    }

    const fullValue = this.formatMetricForPanel(metric, 'full');
    const compactValue = this.formatMetricForPanel(metric, 'compact');
    return fullValue !== compactValue ? fullValue : null;
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
      'cloud-forest': 'ecosystem_coverage',
      paramo: 'ecosystem_coverage_paramo',
      'dry-forest': 'ecosystem_coverage_dry_forest',
      wetlands: 'ecosystem_coverage_wetlands',
      other: 'mangrove_coverage',
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
    const locale = this.resolveLocale();
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
      return this.translate.currentLang === 'es' ? `${formattedValue} mil` : `${formattedValue}K`;
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

    return unit.replace(/Mg\s*[·x*]\s*km\^?2\b/g, 'Mg·km²').replace(/km\^?2\b/g, 'km²');
  }

  private formatMetricForPanel(
    metric: MetricValue,
    mode: MetricNumberFormatMode = this.metricNumberFormatMode(),
  ): string {
    const formattedUnit = this.formatMetricUnit(metric.unit);
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

  private resolveLocale(): string {
    return this.translate.currentLang === 'es' ? 'es-CO' : 'en-US';
  }

  private getAoiBiodiversityScale(aoiId: string): number {
    const mod = aoiId.length % 4;
    return [0.9, 1, 1.1, 1.2][mod] ?? 1;
  }

  private calculateAoiPriorityAreaPercent(): number | null {
    const selectedAoi = this.selectedAoi();
    const priorityArea = this.aoiMetricsById().get('priority_area_in_region');
    if (
      !selectedAoi?.areaKm2 ||
      !Number.isFinite(selectedAoi.areaKm2) ||
      selectedAoi.areaKm2 <= 0 ||
      priorityArea?.status !== 'ready' ||
      priorityArea.value === null
    ) {
      return null;
    }

    const percent = (priorityArea.value / selectedAoi.areaKm2) * 100;
    return Math.max(0, Math.min(100, percent));
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
      'cloud-forest': 'analysis.aoi.ecosystemLegend.cloudForest',
      paramo: 'analysis.aoi.ecosystemLegend.paramo',
      'dry-forest': 'analysis.aoi.ecosystemLegend.dryForest',
      wetlands: 'analysis.aoi.ecosystemLegend.wetlands',
      other: 'analysis.aoi.ecosystemLegend.other',
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
            value: metric.dummyValue,
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
        baseline: blueprint.dummyBaseline,
        baselineFull: null,
        candidate: blueprint.dummyCandidate,
        candidateFull: null,
        delta: blueprint.dummyDelta,
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
