import { NgTemplateOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  resolveLayerLabel,
  isMecCompactV2Document,
  type AOI,
  type AnalysisMetricSectionFixture,
  type CachedSolutionMetricsDocument,
  type CustomPolygonMetricId,
  type CustomPolygonMetricsGeometry,
  type CustomPolygonMetricsResponse,
  type GoalFeatureRow,
  type GoalFeatureType,
  type GeographyLevel,
  type LayerLocale,
  type MecCompactDocument,
  type MecViewId,
  type MetricComparisonValue,
  type MetricReadinessStatus,
  type MetricValue,
  type MetricValueFormatHint,
  type Solution,
  type SolutionGoalsDocument,
  type CatalogSolution,
} from '@core/models';
import {
  getSolutionIncludeFlags,
  getSolutionTargetLevel,
  getSolutionTargetTypes,
  normalizeSolutionToken,
  solutionCostMatchesChoice,
} from '@core/models/solution-matching.utils';
import { ApiService } from '@core/services/api.service';
import { AppLocaleService } from '@core/services/app-locale.service';
import { nationalMetrics } from '@core/services/cached-metrics.utils';
import {
  MecMetricsLoaderService,
  type MecMetricsLoadResult,
} from '@core/services/mec-metrics-loader.service';
import {
  AppStateService,
  type AreaDisplayUnit,
  type ComparisonVisualizationMode,
  type MetricNumberFormatMode,
  type RightSidebarMode,
} from '@core/services/app-state.service';
import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import { SolutionGoalsLoaderService } from '@core/services/solution-goals-loader.service';
import { SolutionLayerService } from '@features/map/services/solution-layer.service';
import { FEATURE_FLAGS } from '@feature-flags';
import { ModalShellComponent } from '@core/shared/modal-shell/modal-shell';
import type { EcosystemClassificationView } from '@features/left-sidebar/map-layers-panel/map-layers-panel-ecosystem.config';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, concat, distinctUntilChanged, finalize, map, of, switchMap, tap } from 'rxjs';
import type { Observable } from 'rxjs';
import {
  AOI_ECOSYSTEM_SEGMENTS,
  CHART_PALETTES,
  type ChartPaletteId,
} from '@core/models/chart-palette.model';
import {
  aoiTypeToGeographyLevel,
  resolveCachedAoiMetrics,
} from '../utils/aoi-cached-metrics.utils';
import {
  classifyCustomAoiBiodiversityEstimate,
  getCustomAoiSpeciesLoadingKey as resolveCustomAoiSpeciesLoadingKey,
  type CustomAoiBiodiversityEstimateBand,
  type CustomAoiSpeciesLoadingStage,
} from '../utils/custom-aoi-species.utils';
import {
  buildMetricComparisons as buildMetricComparisonValues,
  buildMetricSections,
} from '../utils/metric-display-builders.utils';
import {
  AOI_ALIGNED_METRIC_BLUEPRINTS,
  COMPARISON_METRIC_BLUEPRINTS,
  COMPARISON_SECTION_META,
  COMPARISON_SECTION_ORDER,
  CUSTOM_AOI_FAST_METRIC_IDS,
  CUSTOM_AOI_METRIC_DEFINITIONS,
  CUSTOM_AOI_SPECIES_METRIC_IDS,
  OVERVIEW_METRIC_BLUEPRINTS,
  OVERVIEW_SECTION_LOOKUP,
  OVERVIEW_SECTION_ORDER,
  type AoiAlignedMetricBlueprint,
  type ComparisonDeltaTone,
  type ComparisonMetricBlueprint,
  type ComparisonSectionId,
  type CustomAoiMetricDefinition,
  type OverviewMetricBlueprint,
  type OverviewMetricSection,
} from './panel-switcher.config';
import {
  appendUnit as appendMetricUnit,
  areaUnitLabel,
  formatAreaValue as formatAreaMetricValue,
  formatMetricDelta,
  formatMetricValue as formatPresentedMetricValue,
  formatNumber as formatPresentedNumber,
  formatPanelMetric,
  getMetricDisplayUnit,
  type MetricFormatOptions,
} from '../utils/metric-presentation.utils';
import {
  buildCustomMecData,
  buildDummyCoverageRows,
  buildMecCoverageRowsByView,
  buildMecPreviewItems,
  calculateOverlapPercent,
  ECOSYSTEM_CLASSIFICATION_SUMMARY_URL,
  isMecViewAvailable,
  isWholeProductionSirapAoi,
  MEC_BREAKDOWNS,
  resolveMecScopeSummary,
  resolveMecScopeIndex,
  type MecBreakdownConfig,
  type MecBreakdownId,
  type MecCoverageRow,
  type CustomMecData,
  type MecPreviewItem,
  type MecSortId,
  STRATEGIC_ECOSYSTEM_BARS,
} from './aoi-ecosystems.utils';
import { formatSpeciesGroupsProtectedValue, resolveOverviewMetric } from './overview-metrics.utils';
import { classifyOverviewTargetDomains } from './overview-target-domains.utils';
import { CustomAoiSpeciesInventoryComponent } from '../custom-aoi-species-inventory/custom-aoi-species-inventory';

type SidebarTab = 'overview' | 'aoi' | 'comparison';
type AoiSectionId =
  | 'general'
  | 'bio'
  | 'ecosystems'
  | 'strategic'
  | 'carbon'
  | 'land'
  | 'cultural'
  | 'marine';
type MetricsCsvRow = string[];
type CsvMetadataRow = [string, string];
type CsvScenarioInputRow = [string, string, string];
type MetricsCsvExportScope = 'overview' | 'aoi' | 'comparison';

interface MetricsCsvPreamble {
  exportDetails: CsvMetadataRow[];
  scenarioInputs: CsvScenarioInputRow[];
}

interface OverviewMetricDisplayEntry {
  id: string;
  labelKey: string;
  descriptionKey: string;
  methodologyKey?: string;
  sourceLabelKey?: string;
  sourceUrlKey?: string;
  iconClass?: string;
  value: string;
  fullValue: string | null;
  unit: string;
  conditional: boolean;
  unavailable: boolean;
}

interface OverviewGoalsDomainEntry {
  id: string;
  featureType: GoalFeatureType;
  labelKey: string;
  /** True when this domain was part of the solution's target set (prioritizr optimized for it). */
  targeted: boolean;
  targetLabel: string;
  metCount: number;
  totalCount: number;
  pctMet: number | null;
  /** Untargeted domains only: how many features incidentally reached the 17%/30% range-coverage checkpoints. */
  reached17Count: number;
  reached30Count: number;
}

interface OverviewGoalsTaxaEntry {
  id: string;
  label: string;
  metCount: number;
  totalCount: number;
  pctMet: number | null;
  reached17Count: number;
  reached30Count: number;
}

type GoalsModalSortId = 'coverage-desc' | 'coverage-asc' | 'name';
type GoalsModalFilterId =
  | 'all'
  | 'met'
  | 'not-met'
  | 'reached17'
  | 'below17'
  | 'reached30'
  | 'below30';

interface GoalsModalRow {
  id: string;
  name: string;
  secondaryLabel: string | null;
  taxonGroup: string | null;
  iucnStatus: string | null;
  met: boolean | null;
  relativeTarget: number | null;
  relativeHeld: number | null;
  reached17: boolean;
  reached30: boolean;
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

interface EcosystemClassificationSummaryValue {
  label: string;
}

interface EcosystemClassificationSummarySection {
  view: EcosystemClassificationView;
  values: EcosystemClassificationSummaryValue[];
}

interface EcosystemClassificationSummary {
  classifications: EcosystemClassificationSummarySection[];
}

interface ComparisonVisualizationOption {
  id: ComparisonVisualizationMode;
  labelKey: string;
  descriptionKey: string;
}

type CustomAoiMetricRequestMode = 'fast' | 'species';

type MecUnavailableReason =
  | 'no-selection'
  | 'custom-aoi'
  | 'marine-solution'
  | 'partial-sirap'
  | 'no-url';
type MecPanelState =
  | { status: 'unavailable'; reason: MecUnavailableReason }
  | { status: 'loading'; source?: 'custom' }
  | { status: 'error'; error: 'http' | 'invalid-document'; source?: 'custom' }
  | { status: 'scope-missing'; document: MecCompactDocument }
  | { status: 'loaded'; document: MecCompactDocument; scopeIndex: number }
  | { status: 'custom'; data: CustomMecData };
type MecRequest =
  | { key: string; kind: 'unavailable'; reason: MecUnavailableReason }
  | {
      key: string;
      kind: 'load';
      solutionId: string;
      geographyLevel: GeographyLevel;
      aoi: AOI;
    }
  | {
      key: string;
      kind: 'custom-load';
      solutionId?: string;
      geometry: CustomPolygonMetricsGeometry;
    };
const AREA_UNIT_OPTIONS: AreaDisplayUnit[] = ['km2', 'hectares'];

const CUSTOM_AOI_SPECIES_DELAYED_STAGE_MS = 10_000;
const CUSTOM_AOI_SPECIES_EXTENDED_STAGE_MS = 60_000;

@Component({
  selector: 'app-panel-switcher',
  standalone: true,
  imports: [
    TranslatePipe,
    NgTemplateOutlet,
    ModalShellComponent,
    CustomAoiSpeciesInventoryComponent,
  ],
  templateUrl: './panel-switcher.html',
  styleUrl: './panel-switcher.scss',
})
export class PanelSwitcherComponent {
  protected readonly customAoiAreaProfileEnabled = FEATURE_FLAGS.customAoiAreaProfile;
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
  private readonly http = inject(HttpClient, { optional: true });
  private readonly solutionCatalog = inject(SolutionCatalogService);
  private readonly solutionGoals = inject(SolutionGoalsLoaderService);
  private readonly mecMetrics = inject(MecMetricsLoaderService);
  private readonly solutionLayer = inject(SolutionLayerService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private customAoiMetricsRequestSequence = 0;
  private customAoiSpeciesStageTimeouts: ReturnType<typeof setTimeout>[] = [];

  /** Reactive comparison colors sourced from the SolutionLayerService (driven by the left sidebar). */
  protected readonly comparisonBaselineColor = this.solutionLayer.baselineColor$;
  protected readonly comparisonCandidateColor = this.solutionLayer.candidateColor$;
  protected readonly comparisonOverlapColor = this.solutionLayer.overlapColor$;
  protected readonly solutionColor = this.solutionLayer.solutionColor$;
  protected readonly existingProtectedColor = this.solutionLayer.existingProtectedColor$;

  protected readonly rightSidebarMode = this.appState.rightSidebarMode$;
  protected readonly activeSolution = this.appState.activeSolution$;
  protected readonly selectedAoi = this.appState.selectedAOI$;
  protected readonly customAoiGeometry = this.appState.customAOIGeometry$;
  protected readonly comparisonSolution = this.appState.comparisonSolution$;
  protected readonly comparisonVisualizationMode = this.appState.comparisonVisualizationMode$;
  protected readonly fillDummyOverviewMetrics = this.appState.fillDummyOverviewMetrics$;
  protected readonly fillDummyComparisonMetrics = this.appState.fillDummyComparisonMetrics$;
  protected readonly showMetricIcons = this.appState.showMetricIcons$;
  protected readonly metricNumberFormatMode = this.appState.metricNumberFormatMode$;
  protected readonly areaDisplayUnit = this.appState.areaDisplayUnit$;
  protected readonly areaUnitOptions = AREA_UNIT_OPTIONS;
  protected readonly sidebarTabs: SidebarTab[] = ['overview', 'aoi', 'comparison'];
  protected readonly overviewSections = signal<AnalysisMetricSectionFixture[]>([]);
  protected readonly cachedMetricsDocument = signal<CachedSolutionMetricsDocument | null>(null);
  protected readonly solutionGoalsDocument = signal<SolutionGoalsDocument | null>(null);
  protected readonly isGoalsLoading = signal(false);
  protected readonly goalsLoadFailed = signal(false);
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
  protected readonly overviewGoalsDomains = computed<OverviewGoalsDomainEntry[]>(() =>
    this.buildOverviewGoalsDomains(),
  );
  protected readonly overviewGoalsTaxa = computed<OverviewGoalsTaxaEntry[]>(() =>
    this.buildOverviewGoalsTaxa(),
  );
  protected readonly goalsModalOpen = signal(false);
  protected readonly goalsModalDomainId = signal<string | null>(null);
  protected readonly goalsModalSearchQuery = signal('');
  protected readonly goalsModalSortId = signal<GoalsModalSortId>('coverage-desc');
  protected readonly goalsModalFilterId = signal<GoalsModalFilterId>('all');
  protected readonly goalsModalTaxonGroup = signal('all');
  protected readonly goalsModalDomain = computed<OverviewGoalsDomainEntry | null>(
    () =>
      this.overviewGoalsDomains().find((domain) => domain.id === this.goalsModalDomainId()) ?? null,
  );
  protected readonly goalsModalRows = computed<GoalsModalRow[]>(() => {
    const domain = this.goalsModalDomain();
    const document = this.solutionGoalsDocument();
    if (!domain || !document) {
      return [];
    }

    const query = this.goalsModalSearchQuery().trim().toLocaleLowerCase(this.appLocale.locale());
    const filter = this.goalsModalFilterId();
    const taxonGroup = this.goalsModalTaxonGroup();
    const rows = document.features[domain.featureType]
      .map((feature) => this.toGoalsModalRow(feature))
      .filter(
        (row) =>
          !query ||
          [row.name, row.secondaryLabel]
            .filter(Boolean)
            .some((value) => value!.toLocaleLowerCase(this.appLocale.locale()).includes(query)),
      )
      .filter((row) => taxonGroup === 'all' || row.taxonGroup === taxonGroup)
      .filter((row) => {
        switch (filter) {
          case 'met':
            return row.met === true;
          case 'not-met':
            return row.met === false;
          case 'reached17':
            return row.reached17;
          case 'below17':
            return !row.reached17;
          case 'reached30':
            return row.reached30;
          case 'below30':
            return !row.reached30;
          default:
            return true;
        }
      });

    return this.sortGoalsModalRows(rows);
  });
  protected readonly goalsModalTaxonGroups = computed<string[]>(() => {
    const document = this.solutionGoalsDocument();
    if (this.goalsModalDomain()?.featureType !== 'species' || !document) {
      return [];
    }

    return Array.from(
      new Set(
        document.features.species
          .map((feature) => feature.taxonGroup)
          .filter((group): group is string => Boolean(group)),
      ),
    ).sort((a, b) => a.localeCompare(b, this.appLocale.locale()));
  });
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
  protected readonly isMarineSolution = computed(() => {
    const solution = this.activeSolution();
    return (
      this.findActiveCatalogSolution(solution)?.domain === 'marine' ||
      solution?.metadata?.['domain'] === 'marine'
    );
  });
  protected readonly activeSolutionId = computed(() =>
    this.resolveMetricsSolutionId(this.activeSolution()),
  );
  protected readonly showCustomAoiSpeciesInventory = computed(() => {
    const solution = this.activeSolution();
    const domain =
      this.findActiveCatalogSolution(solution)?.domain ?? solution?.metadata?.['domain'];
    return (
      this.customAoiAreaProfileEnabled &&
      this.isCustomAoiSelected() &&
      (!solution || domain === 'land')
    );
  });

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
    ecosystems: true,
    strategic: false,
    carbon: false,
    land: false,
    cultural: false,
    marine: false,
  });
  protected readonly strategicEcosystemBars = STRATEGIC_ECOSYSTEM_BARS;
  protected readonly mecBreakdowns = MEC_BREAKDOWNS;
  protected readonly selectedMecBreakdownId = signal<MecBreakdownId>('broad');
  protected readonly selectedMecBreakdown = computed<MecBreakdownConfig>(
    () =>
      this.mecBreakdowns.find((item) => item.id === this.selectedMecBreakdownId()) ??
      this.mecBreakdowns[0],
  );
  protected readonly mecModalOpen = signal(false);
  protected readonly speciesInventoryModalOpen = signal(false);
  protected readonly customAoiSpeciesInventory = viewChild(CustomAoiSpeciesInventoryComponent);
  protected readonly mecModalBreakdownId = signal<MecBreakdownId>('broad');
  protected readonly mecSearchQuery = signal('');
  protected readonly mecSortId = signal<MecSortId>('coverage');
  protected readonly ecosystemClassificationSummary = signal<EcosystemClassificationSummary | null>(
    null,
  );
  protected readonly ecosystemClassificationSummaryLoading = signal(false);
  protected readonly ecosystemClassificationSummaryError = signal(false);
  protected readonly mecPanelState = signal<MecPanelState>({
    status: 'unavailable',
    reason: 'no-selection',
  });
  private readonly mecCoverageRowsByView = computed<ReadonlyMap<MecViewId, MecCoverageRow[]>>(
    () => {
      const state = this.mecPanelState();
      if (state.status === 'loaded') {
        return buildMecCoverageRowsByView(state.document, state.scopeIndex);
      }
      return state.status === 'custom'
        ? state.data.rowsByView
        : new Map<MecViewId, MecCoverageRow[]>();
    },
  );
  protected readonly mecScopeSummary = computed(() => {
    const state = this.mecPanelState();
    if (state.status === 'loaded') {
      return resolveMecScopeSummary(state.document, state.scopeIndex);
    }
    return state.status === 'custom' ? state.data.scopeSummary : null;
  });
  protected readonly mecPreviewItems = computed<MecPreviewItem[]>(() => {
    const config = this.selectedMecBreakdown();
    if (this.hasMecDataFor(config)) {
      const state = this.mecPanelState();
      if (state.status === 'custom') {
        return (state.data.previewByView.get(config.view as MecViewId) ?? []).map(
          (item, index) => ({
            ...item,
            ...(this.chartPalette().colors[index]
              ? { color: this.chartPalette().colors[index] }
              : {}),
          }),
        );
      }
      if (state.status !== 'loaded') {
        return [];
      }
      return buildMecPreviewItems(
        state.document,
        state.scopeIndex,
        this.getRealMecCoverageRows(config),
        this.resolveMecCandidateAreaKm2(),
        this.chartPalette().colors,
      );
    }
    return this.canUseMecDummyData() ? [...config.dummyItems] : [];
  });
  protected readonly mecDonutGradient = computed(() => {
    const items = this.mecPreviewItems();
    if (items.length === 0 || items.every((item) => item.percent === null)) {
      return '#e2e8f0';
    }

    let start = 0;
    const slices = items.map((item) => {
      const percent = Math.max(0, Math.min(100 - start, item.percent ?? 0));
      const end = start + percent;
      const slice = `${item.color ?? '#94a3b8'} ${start}% ${end}%`;
      start = end;
      return slice;
    });
    if (start < 100) {
      slices.push(`#e2e8f0 ${start}% 100%`);
    }
    return `conic-gradient(${slices.join(', ')})`;
  });
  protected readonly mecModalBreakdown = computed<MecBreakdownConfig>(
    () =>
      this.mecBreakdowns.find((item) => item.id === this.mecModalBreakdownId()) ??
      this.mecBreakdowns[0],
  );
  protected readonly iavhConsideredInRun = computed(() => {
    const scenario = this.findActiveCatalogSolution(this.activeSolution());
    return scenario?.finderInputs && scenario.inputLayerIds
      ? getSolutionTargetTypes(scenario, { inferFromName: true }).has('ecosystems')
      : false;
  });
  protected readonly mecCoverageRows = computed<MecCoverageRow[]>(() => {
    const config = this.mecModalBreakdown();
    const rows = this.hasMecDataFor(config)
      ? this.getRealMecCoverageRows(config)
      : this.canUseMecDummyData()
        ? buildDummyCoverageRows(
            this.getClassificationLabels(config),
            this.resolveMecCandidateAreaKm2() ?? 230,
          )
        : this.getClassificationLabels(config).map((label, index) => ({
            id: `${index}-unavailable`,
            label,
            ecosystemAreaKm2: null,
            preExistingCoverageKm2: null,
            newPrioritizrCoverageKm2: null,
            preExistingPercent: null,
            newPrioritizrPercent: null,
          }));
    const query = this.mecSearchQuery().trim().toLocaleLowerCase(this.appLocale.locale());
    const filtered = query
      ? rows.filter((row) => row.label.toLocaleLowerCase(this.appLocale.locale()).includes(query))
      : rows;
    return [...filtered].sort((a, b) => this.compareMecCoverageRows(a, b));
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

    if (this.isCustomAoiSelected()) {
      return this.aoiBiodiversityBaseCounts.map((item) => ({
        id: item.id,
        label: this.localizedText(item.labelKey),
        count: null,
      }));
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
  protected readonly hasResolvedCustomAoiBiodiversityBars = computed(() =>
    this.aoiBiodiversityBars().some((entry) => entry.count !== null),
  );
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

    toObservable(this.activeSolution)
      .pipe(
        map((solution) => this.resolveMetricsSolutionId(solution)),
        distinctUntilChanged(),
        switchMap((solutionId) => {
          if (!solutionId) {
            this.solutionGoalsDocument.set(null);
            this.isGoalsLoading.set(false);
            this.goalsLoadFailed.set(false);
            return of<SolutionGoalsDocument | null>(null);
          }

          this.isGoalsLoading.set(true);
          this.goalsLoadFailed.set(false);

          return this.solutionGoals.loadGoals(solutionId).pipe(
            catchError(() => {
              this.goalsLoadFailed.set(true);
              return of<SolutionGoalsDocument | null>(null);
            }),
            finalize(() => this.isGoalsLoading.set(false)),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((document) => {
        this.solutionGoalsDocument.set(document);
      });

    const mecRequest = computed<MecRequest>(() =>
      this.buildMecRequest(this.activeSolution(), this.selectedAoi(), this.customAoiGeometry()),
    );
    toObservable(mecRequest)
      .pipe(
        distinctUntilChanged((previous, current) => previous.key === current.key),
        switchMap((request) => {
          if (request.kind === 'unavailable') {
            return of<MecPanelState>({ status: 'unavailable', reason: request.reason });
          }

          if (request.kind === 'custom-load') {
            return concat(
              of<MecPanelState>({ status: 'loading', source: 'custom' }),
              this.api
                .getCustomAoiAreaProfile({
                  geometry: request.geometry,
                  sections: ['ecosystems'],
                  ...(request.solutionId ? { solution_id: request.solutionId } : {}),
                })
                .pipe(
                  map(
                    (response): MecPanelState => ({
                      status: 'custom',
                      data: buildCustomMecData(response),
                    }),
                  ),
                  catchError(() =>
                    of<MecPanelState>({
                      status: 'error',
                      error: 'http',
                      source: 'custom',
                    }),
                  ),
                ),
            );
          }

          return concat(
            of<MecPanelState>({ status: 'loading' }),
            this.mecMetrics.loadMecMetrics(request.solutionId, request.geographyLevel).pipe(
              map((result) => this.toMecPanelState(result, request.aoi)),
              catchError(() =>
                of<MecPanelState>({
                  status: 'error',
                  error: 'http',
                }),
              ),
            ),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => this.mecPanelState.set(state));

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

    this.loadEcosystemClassificationSummary();
  }

  /**
   * Resolve the solution id used to load cached metrics. Prefer the real
   * `metadata.solutionId` (always the manifest id) over `solution.id`, which can
   * be a mock id when the candidate is built via the dev-tools panel.
   */
  private resolveMetricsSolutionId(solution: Solution | null): string | null {
    const solutionId = solution?.metadata?.['solutionId'];
    if (typeof solutionId === 'string' && solutionId.length > 0) {
      return solutionId;
    }
    return solution?.id ?? null;
  }

  protected formatMetricValue(
    metric: MetricValue,
    mode: MetricNumberFormatMode = this.metricNumberFormatMode(),
  ): string {
    return formatPresentedMetricValue(
      metric,
      this.metricFormatOptions(mode),
      this.translate.instant('analysis.common.valueUnavailable'),
    );
  }

  protected formatDelta(
    metric: MetricComparisonValue,
    mode: MetricNumberFormatMode = this.metricNumberFormatMode(),
  ): string {
    return formatMetricDelta(
      metric,
      this.metricFormatOptions(mode),
      this.translate.instant('analysis.common.deltaUnavailable'),
    );
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

  /** Custom AOI profiles are solution-independent; fixed AOIs and comparison are not. */
  protected isSidebarTabDisabled(tab: SidebarTab): boolean {
    if (tab === 'overview') {
      return false;
    }
    if (tab === 'aoi' && this.customAoiAreaProfileEnabled && this.isCustomAoiSelected()) {
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

  protected hasOverviewMetricsCsvRows(): boolean {
    return !this.isOverviewLoading() && this.buildOverviewMetricsCsvRows().length > 0;
  }

  protected downloadOverviewMetricsCsv(): void {
    const rows = this.buildOverviewMetricsCsvRows();
    if (rows.length === 0) {
      return;
    }

    const solution = this.activeSolution();
    this.downloadMetricsCsv(
      rows,
      this.buildCsvFilename('overview-metrics', solution?.name ?? 'scenario'),
      this.buildOverviewCsvMetadata(),
    );
  }

  protected hasAoiMetricsCsvRows(): boolean {
    return this.buildAoiMetricsCsvRows().length > 0;
  }

  protected downloadAoiMetricsCsv(): void {
    const rows = this.buildAoiMetricsCsvRows();
    if (rows.length === 0) {
      return;
    }

    const aoi = this.selectedAoi();
    this.downloadMetricsCsv(
      rows,
      this.buildCsvFilename('aoi-metrics', aoi?.name ?? 'area'),
      this.buildAoiCsvMetadata(),
    );
  }

  protected hasComparisonMetricsCsvRows(): boolean {
    return Boolean(this.comparisonSolution()) && this.buildComparisonMetricsCsvRows().length > 0;
  }

  protected downloadComparisonMetricsCsv(): void {
    const rows = this.buildComparisonMetricsCsvRows();
    if (rows.length === 0) {
      return;
    }

    const baselineName = this.activeSolution()?.name ?? 'baseline';
    const candidateName = this.comparisonSolution()?.name ?? 'candidate';
    this.downloadMetricsCsv(
      rows,
      this.buildCsvFilename('comparison-metrics', `${baselineName}-vs-${candidateName}`),
      this.buildComparisonCsvMetadata(),
    );
  }

  protected getAreaDisplayUnitLabel(unit: AreaDisplayUnit): string {
    return this.areaUnitLabel(unit);
  }

  protected isAreaDisplayUnitSelected(unit: AreaDisplayUnit): boolean {
    return this.areaDisplayUnit() === unit;
  }

  protected selectAreaDisplayUnit(unit: AreaDisplayUnit): void {
    this.appState.setAreaDisplayUnit(unit);
  }

  protected formatAreaFallback(valueKm2: number): string {
    return this.formatAreaValue(valueKm2);
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

  protected formatGoalsCount(metCount: number, totalCount: number): string {
    const met = this.formatNumber(metCount, this.metricNumberFormatMode(), 0, 0);
    const total = this.formatNumber(totalCount, this.metricNumberFormatMode(), 0, 0);
    return `${met} / ${total}`;
  }

  protected formatGoalsFullCount(metCount: number, totalCount: number): string {
    const met = this.formatNumber(metCount, 'full', 0, 0);
    const total = this.formatNumber(totalCount, 'full', 0, 0);
    return `${met} / ${total}`;
  }

  protected getRangeCoverageSharePercent(count: number, totalCount: number): number {
    if (totalCount <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(100, (count / totalCount) * 100));
  }

  protected getGoalsProgressBarWidth(pctMet: number | null): number {
    return Math.max(0, Math.min(100, pctMet ?? 0));
  }

  protected getGoalsPercentLabel(pctMet: number | null): string {
    if (pctMet === null) {
      return '--';
    }
    return this.appendUnit(this.formatNumber(pctMet, this.metricNumberFormatMode(), 0, 1), '%');
  }

  protected getGoalsTargetRuleLabel(): string {
    const document = this.solutionGoalsDocument();
    if (!document) {
      return this.localizedText('analysis.overview.goalsWidget.targetRuleUnavailable');
    }

    const targetLabels = this.overviewGoalsDomains()
      .filter((domain) => domain.targeted)
      .map((domain) => domain.targetLabel)
      .filter((label, index, labels) => label && labels.indexOf(label) === index);

    if (targetLabels.length === 0) {
      return this.localizedText('analysis.overview.goalsWidget.targetRuleNone');
    }

    if (targetLabels.length === 1) {
      return this.translate.instant('analysis.overview.goalsWidget.targetRuleSingle', {
        target: targetLabels[0],
      });
    }

    return this.localizedText('analysis.overview.goalsWidget.targetRuleVariable');
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
      return this.formatOverviewMetricForPanel(metric);
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

    const fullValue = this.formatOverviewMetricForPanel(metric, 'full');
    const compactValue = this.formatOverviewMetricForPanel(metric, 'compact');
    return fullValue !== compactValue ? fullValue : null;
  }

  /** Illustrative range-coverage checkpoints (Aichi 17% / GBF 30%) used to summarize
   * incidental coverage for domains that were *not* part of the solution's target set.
   * These are not real targets - no target was set - so we never call them "met". */
  private static readonly RANGE_COVERAGE_CHECKPOINT_17 = 0.17;
  private static readonly RANGE_COVERAGE_CHECKPOINT_30 = 0.3;

  private buildOverviewGoalsDomains(): OverviewGoalsDomainEntry[] {
    const document = this.solutionGoalsDocument();
    if (!document) {
      return [];
    }

    const targetedDomains = classifyOverviewTargetDomains(document.targetContext);

    const entries: OverviewGoalsDomainEntry[] = [
      {
        id: 'strategic-ecosystems',
        featureType: 'strategicEcosystems',
        labelKey: 'analysis.overview.goalsWidget.strategicEcosystems',
        targeted: targetedDomains.has('strategicEcosystems'),
        targetLabel: this.formatGoalsRelativeTargetLabel(
          document.targetContext.relativeTargetsByType['strategicEcosystems'],
        ),
        metCount: document.summary.byType.strategicEcosystems.metCount,
        totalCount: document.summary.byType.strategicEcosystems.totalCount,
        pctMet: document.summary.byType.strategicEcosystems.pctMet,
        ...this.countRangeCoverageCheckpoints(document.features.strategicEcosystems),
      },
      {
        id: 'ecosystems',
        featureType: 'ecosystems',
        labelKey: 'analysis.overview.goalsWidget.ecosystems',
        targeted: targetedDomains.has('ecosystems'),
        targetLabel: this.formatGoalsRelativeTargetLabel(
          document.targetContext.relativeTargetsByType['ecosystems'],
        ),
        metCount: document.summary.byType.ecosystems.metCount,
        totalCount: document.summary.byType.ecosystems.totalCount,
        pctMet: document.summary.byType.ecosystems.pctMet,
        ...this.countRangeCoverageCheckpoints(document.features.ecosystems),
      },
      {
        id: 'species',
        featureType: 'species',
        labelKey: 'analysis.overview.goalsWidget.species',
        targeted: targetedDomains.has('species'),
        targetLabel: this.formatGoalsRelativeTargetLabel(
          document.targetContext.relativeTargetsByType['species'],
        ),
        metCount: document.summary.byType.species.metSpeciesCount,
        totalCount: document.summary.byType.species.totalSpeciesCount,
        pctMet: document.summary.byType.species.pctMet,
        ...this.countRangeCoverageCheckpoints(document.features.species),
      },
    ];

    return entries.filter((entry) => entry.totalCount > 0);
  }

  /** Counts, from real measured relativeHeld values, how many features reached each
   * illustrative range-coverage checkpoint. Used only for untargeted ("Additional
   * outcomes") domains - targeted domains use the real metCount/pctMet instead. */
  private countRangeCoverageCheckpoints(
    features: GoalFeatureRow[],
  ): Pick<OverviewGoalsDomainEntry, 'reached17Count' | 'reached30Count'> {
    let reached17Count = 0;
    let reached30Count = 0;
    for (const feature of features) {
      if (feature.relativeHeld === null || feature.relativeHeld === undefined) {
        continue;
      }
      if (feature.relativeHeld >= PanelSwitcherComponent.RANGE_COVERAGE_CHECKPOINT_17) {
        reached17Count += 1;
      }
      if (feature.relativeHeld >= PanelSwitcherComponent.RANGE_COVERAGE_CHECKPOINT_30) {
        reached30Count += 1;
      }
    }
    return { reached17Count, reached30Count };
  }

  protected readonly targetProgressGoalsDomains = computed<OverviewGoalsDomainEntry[]>(() =>
    this.overviewGoalsDomains().filter((domain) => domain.targeted),
  );

  protected readonly additionalOutcomeGoalsDomains = computed<OverviewGoalsDomainEntry[]>(() =>
    this.overviewGoalsDomains().filter((domain) => !domain.targeted),
  );

  private formatGoalsRelativeTargetLabel(targets: number[] | undefined): string {
    const validTargets = (targets ?? []).filter((target) => Number.isFinite(target));
    if (validTargets.length === 0) {
      return this.localizedText('analysis.overview.goalsWidget.targetUnknown');
    }

    if (validTargets.length === 1) {
      return this.translate.instant('analysis.overview.goalsWidget.targetPercent', {
        percent: this.formatNumber(validTargets[0] * 100, this.metricNumberFormatMode(), 0, 1),
      });
    }

    return this.localizedText('analysis.overview.goalsWidget.targetVariable');
  }

  private buildOverviewGoalsTaxa(): OverviewGoalsTaxaEntry[] {
    const document = this.solutionGoalsDocument();
    if (!document || !this.overviewGoalsDomains().some((entry) => entry.id === 'species')) {
      return [];
    }

    return Object.entries(document.rollups.species.byTaxa).map(([id, rollup]) => ({
      id,
      label: rollup.label,
      metCount: rollup.metSpeciesCount,
      totalCount: rollup.totalSpeciesCount,
      pctMet: rollup.pctMet,
      ...this.countRangeCoverageCheckpoints(
        document.features.species.filter((feature) => feature.taxonGroup === id),
      ),
    }));
  }

  private toGoalsModalRow(feature: GoalFeatureRow): GoalsModalRow {
    const secondaryLabel =
      feature.featureType === 'species'
        ? [feature.taxonGroup, feature.iucnStatus].filter(Boolean).join(' \u00b7 ') || null
        : null;
    return {
      id: feature.featureId,
      name: feature.label ?? feature.featureName,
      secondaryLabel,
      taxonGroup: feature.taxonGroup ?? null,
      iucnStatus: feature.iucnStatus ?? null,
      met: feature.met,
      relativeTarget: feature.relativeTarget,
      relativeHeld: feature.relativeHeld,
      reached17:
        (feature.relativeHeld ?? -1) >= PanelSwitcherComponent.RANGE_COVERAGE_CHECKPOINT_17,
      reached30:
        (feature.relativeHeld ?? -1) >= PanelSwitcherComponent.RANGE_COVERAGE_CHECKPOINT_30,
    };
  }

  private sortGoalsModalRows(rows: GoalsModalRow[]): GoalsModalRow[] {
    const sorted = [...rows];
    const sortId = this.goalsModalSortId();
    if (sortId === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name, this.appLocale.locale()));
    } else if (sortId === 'coverage-asc') {
      sorted.sort((a, b) => (a.relativeHeld ?? -1) - (b.relativeHeld ?? -1));
    } else {
      sorted.sort((a, b) => (b.relativeHeld ?? -1) - (a.relativeHeld ?? -1));
    }
    return sorted;
  }

  protected openGoalsModal(domainId: string): void {
    this.goalsModalDomainId.set(domainId);
    this.goalsModalSearchQuery.set('');
    this.goalsModalSortId.set('coverage-desc');
    this.goalsModalFilterId.set('all');
    this.goalsModalTaxonGroup.set('all');
    this.goalsModalOpen.set(true);
  }

  protected closeGoalsModal(): void {
    this.goalsModalOpen.set(false);
  }

  protected setGoalsModalSearchQuery(value: string): void {
    this.goalsModalSearchQuery.set(value);
  }

  protected setGoalsModalSortId(value: string): void {
    this.goalsModalSortId.set(value as GoalsModalSortId);
  }

  protected setGoalsModalFilterId(value: string): void {
    this.goalsModalFilterId.set(value as GoalsModalFilterId);
  }

  protected setGoalsModalTaxonGroup(value: string): void {
    this.goalsModalTaxonGroup.set(value);
  }

  protected formatGoalsModalPercent(value: number | null): string {
    if (value === null || value === undefined) {
      return '--';
    }
    return this.getGoalsPercentLabel(Math.round(value * 1000) / 10);
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

  protected selectMecBreakdown(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as MecBreakdownId;
    if (this.mecBreakdowns.some((item) => item.id === value)) {
      this.selectedMecBreakdownId.set(value);
    }
  }

  protected selectMecModalBreakdown(breakdownId: MecBreakdownId): void {
    this.mecModalBreakdownId.set(breakdownId);
    this.mecSearchQuery.set('');
  }

  protected openMecModal(): void {
    this.mecModalBreakdownId.set(this.selectedMecBreakdownId());
    this.mecSortId.set(this.isCustomMecState() ? 'composition' : 'coverage');
    this.mecSearchQuery.set('');
    this.mecModalOpen.set(true);
  }

  protected closeMecModal(): void {
    this.mecModalOpen.set(false);
  }

  protected openCustomAoiSpeciesInventory(): void {
    this.customAoiSpeciesInventory()?.open();
  }

  protected updateMecSearch(event: Event): void {
    this.mecSearchQuery.set((event.target as HTMLInputElement).value);
  }

  protected updateMecSort(event: Event): void {
    this.mecSortId.set((event.target as HTMLSelectElement).value as MecSortId);
  }

  protected isCustomMecState(): boolean {
    return this.mecPanelState().status === 'custom';
  }

  protected hasCustomMecCoverage(): boolean {
    const state = this.mecPanelState();
    return state.status === 'custom' && state.data.hasSolutionCoverage;
  }

  protected supportsMecDrilldown(config = this.selectedMecBreakdown()): boolean {
    return config.id === 'broad' || config.id === 'detailed' || config.id === 'iavh';
  }

  protected shouldShowMecPreview(config: MecBreakdownConfig): boolean {
    return (
      this.canUseMecDummyData() ||
      this.hasMecDataFor(config) ||
      (!this.isCustomAoiSelected() && this.supportsMecDrilldown(config))
    );
  }

  protected getMecPreviewMaximum(): number {
    return Math.max(...this.mecPreviewItems().map((item) => item.percent ?? 0), 1);
  }

  protected formatMecPreviewPercent(value: number | null): string {
    if (value === null) {
      return this.isCustomMecState()
        ? this.translate.instant('analysis.common.valueUnavailable')
        : '--';
    }
    return this.appendUnit(this.formatNumber(value, this.metricNumberFormatMode(), 0, 1), '%');
  }

  protected hasMecDataFor(config: MecBreakdownConfig): boolean {
    const state = this.mecPanelState();
    if (state.status === 'loaded') {
      return isMecViewAvailable(state.document, config.view as MecViewId);
    }
    return (
      state.status === 'custom' &&
      state.data.status === 'complete' &&
      state.data.rowsByView.has(config.view as MecViewId)
    );
  }

  protected shouldShowMecStatus(config: MecBreakdownConfig): boolean {
    return !this.canUseMecDummyData() && !this.hasMecDataFor(config);
  }

  protected getMecStatusTitleKey(config: MecBreakdownConfig): string {
    const state = this.mecPanelState();
    if (state.status === 'loading') {
      return state.source === 'custom'
        ? 'analysis.aoi.mec.states.custom.loadingTitle'
        : 'analysis.aoi.mec.states.loadingTitle';
    }
    if (state.status === 'error') {
      return state.source === 'custom'
        ? 'analysis.aoi.mec.states.custom.failedTitle'
        : 'analysis.aoi.mec.states.errorTitle';
    }
    if (state.status === 'scope-missing') {
      return 'analysis.aoi.mec.states.scopeMissingTitle';
    }
    if (state.status === 'custom') {
      return `analysis.aoi.mec.states.custom.${state.data.status}Title`;
    }
    if (
      state.status === 'loaded' &&
      !isMecViewAvailable(state.document, config.view as MecViewId)
    ) {
      return 'analysis.aoi.mec.states.unsupportedTitle';
    }
    if (state.status === 'unavailable' && state.reason === 'custom-aoi') {
      return 'analysis.aoi.mec.states.customTitle';
    }
    if (state.status === 'unavailable' && state.reason === 'marine-solution') {
      return 'analysis.aoi.mec.states.marineTitle';
    }
    if (state.status === 'unavailable' && state.reason === 'partial-sirap') {
      return 'analysis.aoi.mec.states.partialSirapTitle';
    }
    return 'analysis.aoi.mec.unavailableTitle';
  }

  protected getMecStatusDescriptionKey(config: MecBreakdownConfig): string {
    const state = this.mecPanelState();
    if (state.status === 'loading') {
      return state.source === 'custom'
        ? 'analysis.aoi.mec.states.custom.loadingDescription'
        : 'analysis.aoi.mec.states.loadingDescription';
    }
    if (state.status === 'error') {
      return state.source === 'custom'
        ? 'analysis.aoi.mec.states.custom.failedDescription'
        : 'analysis.aoi.mec.states.errorDescription';
    }
    if (state.status === 'scope-missing') {
      return 'analysis.aoi.mec.states.scopeMissingDescription';
    }
    if (state.status === 'custom') {
      return `analysis.aoi.mec.states.custom.${state.data.status}Description`;
    }
    if (
      state.status === 'loaded' &&
      !isMecViewAvailable(state.document, config.view as MecViewId)
    ) {
      return 'analysis.aoi.mec.states.unsupportedDescription';
    }
    if (state.status === 'unavailable' && state.reason === 'custom-aoi') {
      return 'analysis.aoi.mec.states.customDescription';
    }
    if (state.status === 'unavailable' && state.reason === 'marine-solution') {
      return 'analysis.aoi.mec.states.marineDescription';
    }
    if (state.status === 'unavailable' && state.reason === 'partial-sirap') {
      return 'analysis.aoi.mec.states.partialSirapDescription';
    }
    return 'analysis.aoi.mec.unavailableDescription';
  }

  protected getMecStatusRole(): 'status' | 'alert' {
    const state = this.mecPanelState();
    return state.status === 'error' || (state.status === 'custom' && state.data.status === 'failed')
      ? 'alert'
      : 'status';
  }

  protected getStrategicEcosystemPercent(metricId: string, dummyPercent: number): number {
    const overlap = this.aoiMetricsById().get(metricId);
    const candidateArea = this.aoiMetricsById().get('priority_area_in_region');
    const percent = calculateOverlapPercent(
      overlap?.status === 'ready' ? overlap.value : null,
      candidateArea?.status === 'ready' ? candidateArea.value : null,
    );
    return percent ?? (this.fillDummyAoiMetrics() ? dummyPercent : 0);
  }

  protected getStrategicEcosystemPercentLabel(metricId: string, dummyPercent: number): string {
    const overlap = this.aoiMetricsById().get(metricId);
    const candidateArea = this.aoiMetricsById().get('priority_area_in_region');
    const percent = calculateOverlapPercent(
      overlap?.status === 'ready' ? overlap.value : null,
      candidateArea?.status === 'ready' ? candidateArea.value : null,
    );
    if (percent !== null) {
      return this.appendUnit(this.formatNumber(percent, this.metricNumberFormatMode(), 0, 1), '%');
    }
    return this.fillDummyAoiMetrics() ? `${dummyPercent}%` : '--';
  }

  protected getStrategicEcosystemDescriptionKey(): string {
    return this.isCustomAoiSelected()
      ? 'analysis.aoi.strategic.customDescription'
      : 'analysis.aoi.strategic.description';
  }

  protected getMarineCoverageValue(metricId: string, dummyAreaKm2: number): string {
    if (this.isCustomAoiSelected()) {
      return '--';
    }
    return this.getAoiMetricValue(metricId, this.formatAreaValue(dummyAreaKm2));
  }

  protected getMarineCoverageFullValue(metricId: string): string | null {
    return this.isCustomAoiSelected() ? null : this.getAoiMetricFullValue(metricId);
  }

  protected getMarineCoveragePercentLabel(metricId: string, dummyPercent: number): string {
    const percent = this.getMarineCoveragePercent(metricId);
    if (percent !== null) {
      return this.appendUnit(this.formatNumber(percent, this.metricNumberFormatMode(), 0, 1), '%');
    }
    if (!this.isCustomAoiSelected() && this.fillDummyAoiMetrics()) {
      return `${dummyPercent}%`;
    }
    return '--';
  }

  protected getMarineCoveragePercentFullValue(metricId: string): string | null {
    const percent = this.getMarineCoveragePercent(metricId);
    if (percent === null) {
      return null;
    }

    const compactValue = this.appendUnit(this.formatNumber(percent, 'compact', 0, 1), '%');
    const fullValue = this.appendUnit(this.formatNumber(percent, 'full', 0, 2), '%');
    return compactValue === fullValue ? null : fullValue;
  }

  protected getMecAoiAreaValue(): string {
    const scopeAreaKm2 = this.mecScopeSummary()?.scopeAreaKm2;
    if (scopeAreaKm2 !== undefined) {
      return this.formatAreaValue(scopeAreaKm2);
    }
    const area = this.resolveSelectedAoiAreaKm2();
    if (area !== null) {
      return this.formatAreaValue(area);
    }
    return this.fillDummyAoiMetrics() ? this.formatAreaValue(512) : '--';
  }

  protected getMecCandidateAreaValue(): string {
    const area = this.resolveMecCandidateAreaKm2();
    if (area !== null) {
      return this.formatAreaValue(area);
    }
    return this.fillDummyAoiMetrics() ? this.formatAreaValue(230) : '--';
  }

  protected getMecPreviewAreaValue(): string {
    return this.isLoadedMecV2() || this.isCustomMecState()
      ? this.getMecAoiAreaValue()
      : this.getMecCandidateAreaValue();
  }

  protected getMecPreviewAreaLabelKey(): string {
    return this.isLoadedMecV2() || this.isCustomMecState()
      ? 'analysis.aoi.mec.aoiArea'
      : 'analysis.aoi.mec.legacyCandidateArea';
  }

  protected getMecSourceKey(): string {
    const state = this.mecPanelState();
    if (state.status === 'custom') {
      return 'analysis.aoi.mec.customSource';
    }
    return state.status === 'loaded' && !isMecCompactV2Document(state.document)
      ? 'analysis.aoi.mec.legacySource'
      : 'analysis.aoi.mec.source';
  }

  protected getMecUnclassifiedShareValue(): string {
    return this.formatMecCoveragePercent(this.mecScopeSummary()?.unclassifiedPercent ?? null);
  }

  protected getMecClassifiedAreaValue(): string {
    const value = this.mecScopeSummary()?.classifiedKm2;
    return value === undefined
      ? this.translate.instant('analysis.common.valueUnavailable')
      : this.formatAreaValue(value);
  }

  protected formatMecEcosystemArea(value: number | null): string {
    return value === null
      ? this.isCustomMecState()
        ? this.translate.instant('analysis.common.valueUnavailable')
        : '--'
      : this.formatAreaValue(value);
  }

  protected formatMecCoveragePercent(value: number | null): string {
    if (value === null) {
      return this.isCustomMecState()
        ? this.translate.instant('analysis.common.valueUnavailable')
        : '--';
    }
    return this.appendUnit(this.formatNumber(value, this.metricNumberFormatMode(), 0, 1), '%');
  }

  protected clampMecBarPercent(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  }

  protected formatCustomMecAreaKm2(value: number): string {
    return this.appendUnit(this.formatNumber(value, this.metricNumberFormatMode(), 0, 1), 'km²');
  }

  protected getCustomMecBarAriaLabel(
    metricLabelKey: string,
    ecosystemLabel: string,
    percent: number,
    areaKm2: number,
  ): string {
    return [
      this.translate.instant(metricLabelKey),
      ecosystemLabel,
      this.formatMecCoveragePercent(percent),
      this.formatCustomMecAreaKm2(areaKm2),
    ].join(', ');
  }

  protected getMecCoverageTotal(row: MecCoverageRow): number {
    if (this.isCustomMecState()) {
      return row.solutionCoveragePercent ?? -1;
    }
    return (row.preExistingPercent ?? 0) + (row.newPrioritizrPercent ?? 0);
  }

  protected getMecCategoryCount(config: MecBreakdownConfig): number {
    if (this.hasMecDataFor(config)) {
      return this.getRealMecCoverageRows(config).length;
    }
    return this.canUseMecDummyData() ? config.count : this.getClassificationLabels(config).length;
  }

  protected readonly mecExistingColor = computed(() => this.existingProtectedColor() || '#2563eb');
  protected readonly mecAdditionalColor = computed(() => this.solutionColor() || '#16a34a');

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

  protected hasReadyAoiMetric(metricId: string): boolean {
    const metric = this.aoiMetricsById().get(metricId);
    return metric?.status === 'ready' && metric.value !== null;
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

  private getMarineCoveragePercent(metricId: string): number | null {
    if (this.isCustomAoiSelected()) {
      return null;
    }

    const overlap = this.aoiMetricsById().get(metricId);
    const priorityArea = this.aoiMetricsById().get('priority_area_in_region');
    return calculateOverlapPercent(
      overlap?.status === 'ready' ? overlap.value : null,
      priorityArea?.status === 'ready' ? priorityArea.value : null,
    );
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

  private formatNumber(
    value: number,
    mode: MetricNumberFormatMode,
    minimumFractionDigits: number,
    maximumFractionDigits: number,
  ): string {
    return formatPresentedNumber(
      value,
      this.metricFormatOptions(mode),
      minimumFractionDigits,
      maximumFractionDigits,
    );
  }

  private appendUnit(value: string, unit: string | null): string {
    return appendMetricUnit(value, unit);
  }

  private formatAreaValue(
    valueKm2: number,
    mode: MetricNumberFormatMode = this.metricNumberFormatMode(),
  ): string {
    return formatAreaMetricValue(valueKm2, this.metricFormatOptions(mode));
  }

  private areaUnitLabel(unit: AreaDisplayUnit): string {
    return areaUnitLabel(unit);
  }

  private formatMetricForPanel(
    metric: MetricValue,
    mode: MetricNumberFormatMode = this.metricNumberFormatMode(),
  ): string {
    return formatPanelMetric(metric, this.metricFormatOptions(mode));
  }

  private formatOverviewMetricForPanel(
    metric: MetricValue,
    mode: MetricNumberFormatMode = this.metricNumberFormatMode(),
  ): string {
    return metric.metricId === 'species_groups_protected'
      ? formatSpeciesGroupsProtectedValue(metric, this.metricFormatOptions(mode))
      : this.formatMetricForPanel(metric, mode);
  }

  private metricFormatOptions(mode: MetricNumberFormatMode): MetricFormatOptions {
    return {
      areaUnit: this.areaDisplayUnit(),
      locale: this.appLocale.locale(),
      mode,
    };
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

  private resolveMecCandidateAreaKm2(): number | null {
    if (this.isCustomAoiSelected()) {
      return null;
    }

    const metric = this.aoiMetricsById().get('priority_area_in_region');
    return metric?.status === 'ready' && metric.value !== null && metric.value >= 0
      ? metric.value
      : null;
  }

  private buildMecRequest(
    solution: Solution | null,
    aoi: AOI | null,
    customGeometry: CustomPolygonMetricsGeometry | null,
  ): MecRequest {
    if (!aoi) {
      return { key: 'unavailable:no-selection', kind: 'unavailable', reason: 'no-selection' };
    }

    const catalogSolution = solution ? this.findActiveCatalogSolution(solution) : null;
    const metadataDomain = solution?.metadata?.['domain'];
    if (solution && (catalogSolution?.domain === 'marine' || metadataDomain === 'marine')) {
      return {
        key: `unavailable:marine-solution:${solution.id}`,
        kind: 'unavailable',
        reason: 'marine-solution',
      };
    }

    if (aoi.type === 'custom') {
      if (!customGeometry) {
        return {
          key: `unavailable:custom-aoi:${aoi.id}`,
          kind: 'unavailable',
          reason: 'custom-aoi',
        };
      }
      const solutionId = solution ? this.resolveMetricsSolutionId(solution) : null;
      if (solution && !solutionId) {
        return { key: 'unavailable:no-url', kind: 'unavailable', reason: 'no-url' };
      }
      return {
        key: `${solutionId ?? 'no-solution'}|custom|${JSON.stringify(customGeometry)}`,
        kind: 'custom-load',
        ...(solutionId ? { solutionId } : {}),
        geometry: customGeometry,
      };
    }

    if (!solution) {
      return { key: 'unavailable:no-selection', kind: 'unavailable', reason: 'no-selection' };
    }
    const solutionId = this.resolveMetricsSolutionId(solution);
    const boundaryProvenanceKey = [
      aoi.boundarySourceLayerKey ?? 'missing-layer',
      aoi.boundarySourceId ?? 'missing-source',
      aoi.boundaryGeometrySelection ?? 'missing-selection',
    ].join(':');
    if (aoi.type === 'sirap' && !isWholeProductionSirapAoi(aoi)) {
      return {
        key: `unavailable:partial-sirap:${aoi.id}:${boundaryProvenanceKey}`,
        kind: 'unavailable',
        reason: 'partial-sirap',
      };
    }

    const geographyLevel = aoiTypeToGeographyLevel(aoi.type);
    if (!solutionId || !geographyLevel) {
      return { key: 'unavailable:no-url', kind: 'unavailable', reason: 'no-url' };
    }

    return {
      key: [solutionId, geographyLevel, aoi.id, aoi.name, boundaryProvenanceKey].join('|'),
      kind: 'load',
      solutionId,
      geographyLevel,
      aoi,
    };
  }

  private toMecPanelState(result: MecMetricsLoadResult, aoi: AOI): MecPanelState {
    if (result.status === 'unavailable') {
      return { status: 'unavailable', reason: 'no-url' };
    }
    if (result.status === 'error') {
      return { status: 'error', error: result.error };
    }

    const scopeIndex = resolveMecScopeIndex(result.document, aoi);
    return scopeIndex === null
      ? { status: 'scope-missing', document: result.document }
      : { status: 'loaded', document: result.document, scopeIndex };
  }

  private getRealMecCoverageRows(config: MecBreakdownConfig): MecCoverageRow[] {
    return this.mecCoverageRowsByView().get(config.view as MecViewId) ?? [];
  }

  private getClassificationLabels(config: MecBreakdownConfig): string[] {
    const summarySection = this.ecosystemClassificationSummary()?.classifications.find(
      (section) => section.view === config.view,
    );
    if (summarySection) {
      return summarySection.values.map((value) => value.label);
    }
    return this.fillDummyAoiMetrics() ? config.dummyItems.map((item) => item.label) : [];
  }

  private compareMecCoverageRows(a: MecCoverageRow, b: MecCoverageRow): number {
    switch (this.mecSortId()) {
      case 'name':
        return a.label.localeCompare(b.label, this.appLocale.locale());
      case 'composition':
        return (b.ecosystemAreaKm2 ?? -1) - (a.ecosystemAreaKm2 ?? -1);
      case 'national':
        return (b.nationalClassPercent ?? -1) - (a.nationalClassPercent ?? -1);
      case 'existing':
        return (b.preExistingPercent ?? -1) - (a.preExistingPercent ?? -1);
      case 'additional':
        return (b.newPrioritizrPercent ?? -1) - (a.newPrioritizrPercent ?? -1);
      default:
        return this.getMecCoverageTotal(b) - this.getMecCoverageTotal(a);
    }
  }

  private isLoadedMecV2(): boolean {
    const state = this.mecPanelState();
    return state.status === 'loaded' && isMecCompactV2Document(state.document);
  }

  private canUseMecDummyData(): boolean {
    return this.fillDummyAoiMetrics() && !this.isCustomAoiSelected();
  }

  private loadEcosystemClassificationSummary(): void {
    if (!this.http) {
      this.ecosystemClassificationSummaryError.set(true);
      return;
    }
    this.ecosystemClassificationSummaryLoading.set(true);
    this.http
      .get<EcosystemClassificationSummary>(ECOSYSTEM_CLASSIFICATION_SUMMARY_URL)
      .pipe(
        catchError(() => {
          this.ecosystemClassificationSummaryError.set(true);
          return of(null);
        }),
        finalize(() => this.ecosystemClassificationSummaryLoading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((summary) => this.ecosystemClassificationSummary.set(summary));
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

  private buildOverviewMetricsCsvRows(): MetricsCsvRow[] {
    const solutionName =
      this.activeSolution()?.name ?? this.localizedText('analysis.exports.context.currentScenario');

    const buildRows = (
      sectionKey: string,
      entries: OverviewMetricDisplayEntry[],
    ): MetricsCsvRow[] => {
      const section = this.localizedText(sectionKey);
      return entries.map((entry) =>
        this.buildMetricsCsvRow({
          context: solutionName,
          section,
          metricId: entry.id,
          metric: this.localizedText(entry.labelKey),
          description: this.localizedText(entry.descriptionKey),
          value: entry.fullValue && entry.fullValue !== entry.value ? entry.fullValue : entry.value,
          unit: entry.unit === '--' ? '' : entry.unit,
          status: entry.unavailable
            ? this.localizedText('analysis.common.valueUnavailable')
            : this.localizedText('analysis.status.ready'),
        }),
      );
    };

    return [
      ...buildRows('analysis.overview.sections.conservationGains', this.overviewGainMetrics()),
      ...buildRows('analysis.overview.sections.costsAndTradeoffs', this.overviewCostMetrics()),
    ];
  }

  private buildAoiMetricsCsvRows(): MetricsCsvRow[] {
    const aoi = this.selectedAoi();
    const context = aoi?.name ?? this.localizedText('analysis.exports.context.selectedAoi');
    const section = this.localizedText('analysis.modes.aoi');
    const realRows = this.aoiMetrics().map((metric) =>
      this.buildMetricValueCsvRow(metric, context, section),
    );

    if (realRows.length > 0) {
      return realRows;
    }

    return this.aoiAlignedMetricEntries().map((entry) =>
      this.buildMetricsCsvRow({
        context,
        section: this.localizedText('analysis.aoi.alignedMetrics.title'),
        metricId: entry.metricId,
        metric: this.localizedText(entry.labelKey),
        description: this.localizedText(entry.descriptionKey),
        value: entry.fullValue && entry.fullValue !== entry.value ? entry.fullValue : entry.value,
        unit: entry.unit,
        status: this.localizedText('analysis.status.ready'),
      }),
    );
  }

  private buildComparisonMetricsCsvRows(): MetricsCsvRow[] {
    const baselineName =
      this.activeSolution()?.name ?? this.localizedText('analysis.comparison.baselineLabel');
    const candidateName =
      this.comparisonSolution()?.name ?? this.localizedText('analysis.comparison.candidateLabel');
    const context = `${baselineName} ${this.localizedText('analysis.exports.context.versus')} ${candidateName}`;
    const readyStatus = this.localizedText('analysis.status.ready');
    const unavailableStatus = this.localizedText('analysis.common.valueUnavailable');
    const spatialRows = this.spatialOverlapEntries().map((entry) =>
      this.buildMetricsCsvRow({
        context,
        section: this.localizedText('analysis.comparison.spatialOverlapKicker'),
        metricId: entry.id,
        metric: this.localizedText(entry.labelKey),
        description: this.localizedText(entry.descriptionKey),
        value: entry.fullValue && entry.fullValue !== entry.value ? entry.fullValue : entry.value,
        status: readyStatus,
      }),
    );
    const tableRows = this.comparisonSections().flatMap((section) =>
      section.metrics.map((metric) =>
        this.buildMetricsCsvRow({
          context,
          section: this.localizedText(section.titleKey),
          metricId: metric.id,
          metric: this.localizedText(metric.labelKey),
          description: this.localizedText(metric.descriptionKey),
          baselineValue:
            metric.baselineFull && metric.baselineFull !== metric.baseline
              ? metric.baselineFull
              : metric.baseline,
          candidateValue:
            metric.candidateFull && metric.candidateFull !== metric.candidate
              ? metric.candidateFull
              : metric.candidate,
          difference:
            metric.deltaFull && metric.deltaFull !== metric.delta ? metric.deltaFull : metric.delta,
          status: metric.unavailable ? unavailableStatus : readyStatus,
        }),
      ),
    );

    return [...spatialRows, ...tableRows];
  }

  private buildMetricValueCsvRow(
    metric: MetricValue,
    context: string,
    section: string,
  ): MetricsCsvRow {
    const value =
      metric.status === 'ready' && metric.value !== null
        ? this.formatMetricForPanel(metric, 'full')
        : this.localizedText('analysis.common.valueUnavailable');

    return this.buildMetricsCsvRow({
      context,
      section,
      metricId: metric.metricId,
      metric: this.localizedText(metric.labelKey, metric.metricId),
      value,
      unit: getMetricDisplayUnit(metric, this.areaDisplayUnit()) ?? '',
      status: this.localizedText(this.getStatusKey(metric.status), metric.status),
      source: metric.source,
      notes: metric.notes ?? '',
    });
  }

  private buildMetricsCsvRow(values: {
    context?: string;
    section?: string;
    metricId?: string;
    metric?: string;
    description?: string;
    value?: string;
    unit?: string;
    baselineValue?: string;
    candidateValue?: string;
    difference?: string;
    status?: string;
    source?: string;
    notes?: string;
  }): MetricsCsvRow {
    return [
      values.metric ?? '',
      values.description ?? '',
      values.value ?? '',
      values.unit ?? '',
      values.baselineValue ?? '',
      values.candidateValue ?? '',
      values.difference ?? '',
    ];
  }

  private buildOverviewCsvMetadata(): MetricsCsvPreamble {
    const preamble = this.buildBaseCsvPreamble('overview');

    this.appendSolutionInputsMetadata(preamble, this.activeSolution(), {
      scenario: 'analysis.exports.metadata.scenarioName',
    });

    return preamble;
  }

  private buildAoiCsvMetadata(): MetricsCsvPreamble {
    const aoi = this.selectedAoi();
    const preamble = this.buildBaseCsvPreamble('aoi');

    this.appendSolutionInputsMetadata(preamble, this.activeSolution(), {
      scenario: 'analysis.exports.metadata.scenarioName',
    });

    if (aoi) {
      preamble.exportDetails.push([
        this.localizedText('analysis.exports.metadata.aoiName'),
        aoi.name,
      ]);
      preamble.exportDetails.push([
        this.localizedText('analysis.exports.metadata.aoiType'),
        aoi.subtype || this.localizedText(`analysis.aoi.types.${aoi.type}`, aoi.type),
      ]);

      if (aoi.type === 'sirap') {
        preamble.exportDetails.push([
          this.localizedText('analysis.exports.metadata.sirapScope'),
          this.localizedText('analysis.aoi.scopeFull'),
        ]);
      }
    }

    return preamble;
  }

  private buildComparisonCsvMetadata(): MetricsCsvPreamble {
    const preamble = this.buildBaseCsvPreamble('comparison');

    this.appendSolutionInputsMetadata(preamble, this.activeSolution(), {
      scenario: 'analysis.exports.metadata.baselineScenario',
      stepPrefix: 'analysis.exports.metadata.baselinePrefix',
    });
    this.appendSolutionInputsMetadata(preamble, this.comparisonSolution(), {
      scenario: 'analysis.exports.metadata.candidateScenario',
      stepPrefix: 'analysis.exports.metadata.candidatePrefix',
    });

    return preamble;
  }

  private buildCsvMetadataEntry(labelKey: string, value: string): CsvMetadataRow {
    return [this.localizedText(labelKey), value];
  }

  private buildCsvMetadataExportTypeEntry(exportType: MetricsCsvExportScope): CsvMetadataRow {
    return this.buildCsvMetadataEntry(
      'analysis.exports.metadata.exportType',
      this.localizedText(`analysis.exports.metadata.exportTypes.${exportType}`),
    );
  }

  private buildBaseCsvPreamble(exportType: MetricsCsvExportScope): MetricsCsvPreamble {
    return {
      exportDetails: [
        this.buildCsvMetadataExportTypeEntry(exportType),
        this.buildCsvMetadataEntry(
          'analysis.exports.metadata.exportedAt',
          new Date().toISOString(),
        ),
        this.buildCsvMetadataEntry(
          'analysis.exports.metadata.areaUnit',
          this.getAreaDisplayUnitLabel(this.areaDisplayUnit()),
        ),
      ],
      scenarioInputs: [],
    };
  }

  private appendSolutionInputsMetadata(
    preamble: MetricsCsvPreamble,
    solution: Solution | null,
    labelKeys: {
      scenario: string;
      stepPrefix?: string;
    },
  ): void {
    if (!solution) {
      return;
    }

    preamble.exportDetails.push([this.localizedText(labelKeys.scenario), solution.name]);

    const scenario = this.getScenarioFromSolution(solution);
    if (!scenario) {
      return;
    }

    const stepPrefix = labelKeys.stepPrefix ? `${this.localizedText(labelKeys.stepPrefix)}: ` : '';

    for (const target of this.buildScenarioTargetMetadata(scenario)) {
      preamble.scenarioInputs.push([
        `${stepPrefix}${this.localizedText('analysis.exports.metadata.whatToProtect')}`,
        target.label,
        `${target.coveragePercent}%`,
      ]);
    }

    const includes = this.buildScenarioIncludedAreaSelections(scenario);
    for (const include of includes) {
      preamble.scenarioInputs.push([
        `${stepPrefix}${this.localizedText('analysis.exports.metadata.includedAreas')}`,
        include.label,
        include.selection,
      ]);
    }

    preamble.scenarioInputs.push([
      `${stepPrefix}${this.localizedText('analysis.exports.metadata.costs')}`,
      this.getScenarioCostLabel(scenario),
      this.localizedText('analysis.exports.metadata.selected'),
    ]);
  }

  private buildScenarioTargetMetadata(
    scenario: CatalogSolution,
  ): { label: string; coveragePercent: number }[] {
    const targets = new Map<string, { label: string; coveragePercent: number }>();
    const targetFeatureSet = this.normalizeManifestToken(
      scenario.finderInputs.targetFeatureSet ?? '',
    );
    const targetTypes = getSolutionTargetTypes(scenario, { inferFromName: true });

    if (targetTypes.has('ecosystems')) {
      targets.set('ecosystems', {
        label: this.localizedText('solutionControls.finder.step1.ecosystemsLabel'),
        coveragePercent:
          getSolutionTargetLevel(scenario, 'ecosystems') ?? scenario.ecosystemTargets,
      });
    }

    if (targetTypes.has('strategic-ecosystems')) {
      targets.set('strategic-ecosystems', {
        label: this.localizedText('solutionControls.finder.step1.strategicEcosystemsLabel'),
        coveragePercent:
          getSolutionTargetLevel(scenario, 'strategic-ecosystems') ?? scenario.ecosystemTargets,
      });
    }

    if (targetTypes.has('species-richness')) {
      targets.set('species-richness', {
        label: this.localizedText('solutionControls.finder.step1.speciesRichnessLabel'),
        coveragePercent:
          getSolutionTargetLevel(scenario, 'species-richness') ?? scenario.ecosystemTargets,
      });
    }

    for (const rawTargetId of scenario.finderInputs.targetFeatureIds) {
      const normalizedTargetId = this.normalizeManifestToken(rawTargetId);
      if (
        normalizedTargetId === 'ecosistemas' ||
        normalizedTargetId === 'strategic-ecosystems' ||
        normalizedTargetId === 'species-richness' ||
        ['paramos', 'bosque-seco', 'wetlands', 'mangroves'].includes(normalizedTargetId)
      ) {
        continue;
      }

      targets.set(normalizedTargetId, {
        label: this.getLayerLabel(rawTargetId) ?? this.humanizeManifestToken(rawTargetId),
        coveragePercent: scenario.ecosystemTargets,
      });
    }

    if (targets.size === 0 && targetFeatureSet) {
      targets.set(targetFeatureSet, {
        label: this.humanizeManifestToken(targetFeatureSet),
        coveragePercent: scenario.ecosystemTargets,
      });
    }

    return [...targets.values()];
  }

  private buildScenarioIncludedAreaSelections(
    scenario: CatalogSolution,
  ): { label: string; selection: string }[] {
    const includes = getSolutionIncludeFlags(scenario, scenario.constraints);
    const selections = [
      {
        key: 'runap',
        label: this.localizedText('solutionControls.finder.step2a.alwaysRunapLabel'),
        selected: true,
        selection: this.localizedText('analysis.exports.metadata.alwaysApplied'),
      },
      {
        key: 'omec',
        label: this.localizedText('analysis.exports.metadata.omecs'),
        selected: includes.omecs,
        selection: this.localizedText('analysis.exports.metadata.selected'),
      },
      {
        key: 'comunidades',
        label: this.localizedText('analysis.exports.metadata.afroColombianTerritories'),
        selected: includes.comunidades,
        selection: this.localizedText('analysis.exports.metadata.selected'),
      },
      {
        key: 'resguardos',
        label: this.localizedText('analysis.exports.metadata.indigenousReserves'),
        selected: includes.resguardos,
        selection: this.localizedText('analysis.exports.metadata.selected'),
      },
    ];

    return selections
      .filter((selection) => selection.selected)
      .map(({ label, selection }) => ({ label, selection }));
  }

  private getScenarioSelectionLabel(id: string): string {
    const layerLabel = this.getLayerLabel(id);
    if (layerLabel) {
      return layerLabel;
    }

    const normalizedId = this.normalizeManifestToken(id);
    if (normalizedId.includes('runap')) {
      return this.localizedText('solutionControls.finder.step2a.alwaysRunapLabel');
    }
    if (normalizedId.includes('omec')) {
      return this.localizedText('solutionControls.finder.step2a.includeOmecsLabel');
    }
    if (normalizedId.includes('comunidades') || normalizedId === 'com') {
      return this.localizedText('solutionControls.finder.step2a.includeComunidadesLabel');
    }
    if (normalizedId.includes('resguardos') || normalizedId === 'res') {
      return this.localizedText('solutionControls.finder.step2a.includeResguardosLabel');
    }

    return this.humanizeManifestToken(id);
  }

  private getScenarioCostLabel(scenario: CatalogSolution): string {
    const costLayerId = scenario.finderInputs.costLayerId ?? scenario.inputLayerIds.cost;
    const layerLabel = costLayerId ? this.getLayerLabel(costLayerId) : null;
    if (layerLabel) {
      return layerLabel;
    }

    if (solutionCostMatchesChoice(scenario, 'carbon-opportunity')) {
      return this.localizedText('solutionControls.finder.step2b.carbonOpportunityLabel');
    }

    return this.localizedText('solutionControls.finder.step2b.humanFootprintLabel');
  }

  private getLayerLabel(layerId: string): string | null {
    const layer = this.solutionCatalog.getLayerById(layerId);
    if (!layer) {
      return null;
    }

    return resolveLayerLabel(layer.englishLabel, layer.spanishLabel, this.getLayerLocale());
  }

  private getLayerLocale(): LayerLocale {
    return this.appLocale.locale() === 'es' ? 'es' : 'en';
  }

  private normalizeManifestToken(value: string): string {
    return normalizeSolutionToken(value, { stripDiacritics: true });
  }

  private humanizeManifestToken(value: string): string {
    return value
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  private downloadMetricsCsv(
    rows: MetricsCsvRow[],
    filename: string,
    preamble: MetricsCsvPreamble | null = null,
  ): void {
    const csvRows: string[][] = [];

    if (preamble) {
      csvRows.push([this.localizedText('analysis.exports.metadata.exportDetailsTitle')]);
      csvRows.push([
        this.localizedText('analysis.exports.metadata.field'),
        this.localizedText('analysis.exports.metadata.value'),
      ]);
      csvRows.push(...preamble.exportDetails);
      csvRows.push([]);

      if (preamble.scenarioInputs.length > 0) {
        csvRows.push([this.localizedText('analysis.exports.metadata.scenarioInputsTitle')]);
        csvRows.push([
          this.localizedText('analysis.exports.metadata.stepColumn'),
          this.localizedText('analysis.exports.metadata.selectionTypeColumn'),
          this.localizedText('analysis.exports.metadata.selectionColumn'),
        ]);
        csvRows.push(...preamble.scenarioInputs);
        csvRows.push([]);
      }
    }

    csvRows.push([this.localizedText('analysis.exports.metadata.metricsTitle')]);
    csvRows.push(this.getMetricsCsvColumns(), ...rows);
    const csvContent =
      '\uFEFF' +
      csvRows.map((row) => row.map((value) => this.escapeCsvValue(value)).join(',')).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }

  private getMetricsCsvColumns(): MetricsCsvRow {
    return [
      'analysis.exports.csvColumns.metric',
      'analysis.exports.csvColumns.description',
      'analysis.exports.csvColumns.value',
      'analysis.exports.csvColumns.unit',
      'analysis.exports.csvColumns.baselineValue',
      'analysis.exports.csvColumns.candidateValue',
      'analysis.exports.csvColumns.difference',
    ].map((key) => this.localizedText(key));
  }

  private escapeCsvValue(value: string): string {
    const escapedValue = value.replace(/"/g, '""');
    return /[",\r\n]/.test(escapedValue) ? `"${escapedValue}"` : escapedValue;
  }

  private buildCsvFilename(prefix: string, descriptor: string): string {
    const date = new Date().toISOString().slice(0, 10);
    const slug = this.slugifyFilename(descriptor);
    return `${prefix}-${slug}-${date}.csv`;
  }

  private slugifyFilename(value: string): string {
    const slug = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();

    return slug || 'metrics';
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

  private findActiveCatalogSolution(solution: Solution | null): CatalogSolution | null {
    const metadataSolutionId = solution?.metadata?.['solutionId'];
    const solutionId = typeof metadataSolutionId === 'string' ? metadataSolutionId : solution?.id;
    return solutionId ? this.solutionCatalog.getById(solutionId) : null;
  }

  private getScenarioFromSolution(solution: Solution | null): CatalogSolution | null {
    return this.findActiveCatalogSolution(solution);
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
    return resolveCustomAoiSpeciesLoadingKey(
      this.customAoiSpeciesLoadingStage(),
      this.customAoiBiodiversityEstimateBand(),
    );
  }

  protected retryCustomAoiSpeciesMetrics(): void {
    const geometry = this.customAoiGeometry();
    if (!geometry || this.isCustomAoiSpeciesMetricsLoading()) {
      return;
    }

    const requestId = this.customAoiMetricsRequestSequence;
    this.customAoiSpeciesMetricsLoadFailed.set(false);
    this.customAoiSpeciesMetricsMessage.set(null);
    this.isCustomAoiSpeciesMetricsLoading.set(true);
    this.startCustomAoiSpeciesLoadingStages();

    this.loadCustomAoiMetricBatch(geometry, CUSTOM_AOI_SPECIES_METRIC_IDS, 'species', requestId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (speciesMetrics) => {
          if (requestId === this.customAoiMetricsRequestSequence) {
            this.customAoiMetrics.set(
              this.mergeCustomAoiMetricValues(this.customAoiMetrics(), speciesMetrics),
            );
          }
        },
        error: (error: unknown) => {
          if (requestId === this.customAoiMetricsRequestSequence) {
            this.customAoiSpeciesMetricsLoadFailed.set(true);
            this.customAoiSpeciesMetricsMessage.set(this.getCustomAoiErrorMessage(error));
            this.finishCustomAoiSpeciesRetry();
          }
        },
        complete: () => {
          if (requestId === this.customAoiMetricsRequestSequence) {
            this.finishCustomAoiSpeciesRetry();
          }
        },
      });
  }

  private classifyCustomAoiBiodiversityEstimate(): CustomAoiBiodiversityEstimateBand {
    return classifyCustomAoiBiodiversityEstimate(this.resolveSelectedAoiAreaKm2());
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

  private finishCustomAoiSpeciesRetry(): void {
    this.isCustomAoiSpeciesMetricsLoading.set(false);
    this.stopCustomAoiSpeciesLoadingStages();
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
    return buildMetricSections(metrics, OVERVIEW_SECTION_LOOKUP, OVERVIEW_SECTION_ORDER);
  }

  private resolveAoiMetrics(
    document: CachedSolutionMetricsDocument | null,
    aoi: AOI,
  ): MetricValue[] {
    return resolveCachedAoiMetrics(document, aoi);
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
    const planningDomain = this.isMarineSolution() ? 'marine' : 'land';

    return OVERVIEW_METRIC_BLUEPRINTS.filter((metric) => metric.section === section).map(
      (metric) => {
        if (metric.conditional) {
          return {
            id: metric.id,
            labelKey: metric.labelKey,
            descriptionKey: metric.descriptionKey,
            methodologyKey: metric.methodologyKey,
            sourceLabelKey: metric.sourceLabelKey,
            sourceUrlKey: metric.sourceUrlKey,
            iconClass: metric.iconClass,
            value: '--',
            fullValue: null,
            unit: '--',
            conditional: true,
            unavailable: true,
          };
        }

        const realMetric = metric.realMetricId
          ? resolveOverviewMetric(metricsById, metric.realMetricId, planningDomain)
          : undefined;
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
            methodologyKey: metric.methodologyKey,
            sourceLabelKey: metric.sourceLabelKey,
            sourceUrlKey: metric.sourceUrlKey,
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
            methodologyKey: metric.methodologyKey,
            sourceLabelKey: metric.sourceLabelKey,
            sourceUrlKey: metric.sourceUrlKey,
            iconClass: metric.iconClass,
            value: this.formatOverviewMetricForPanel(realMetric),
            fullValue: this.formatOverviewMetricForPanel(realMetric, 'full'),
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
            methodologyKey: metric.methodologyKey,
            sourceLabelKey: metric.sourceLabelKey,
            sourceUrlKey: metric.sourceUrlKey,
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
          methodologyKey: metric.methodologyKey,
          sourceLabelKey: metric.sourceLabelKey,
          sourceUrlKey: metric.sourceUrlKey,
          iconClass: metric.iconClass,
          value: '--',
          fullValue: null,
          unit: '--',
          conditional: Boolean(metric.conditional),
          unavailable: true,
        };
      },
    );
  }

  private findOverviewMetric(metricId: string): MetricValue | null {
    const metricsById = new Map(
      this.overviewSections()
        .flatMap((metricSection) => metricSection.metrics)
        .map((metric) => [metric.metricId, metric] as const),
    );
    const planningDomain = this.isMarineSolution() ? 'marine' : 'land';
    return resolveOverviewMetric(metricsById, metricId, planningDomain) ?? null;
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

    return COMPARISON_SECTION_ORDER.map((sectionId) => {
      const sectionMeta = COMPARISON_SECTION_META[sectionId];
      const metrics = COMPARISON_METRIC_BLUEPRINTS.filter(
        (metric) => metric.section === sectionId,
      ).map((metric) =>
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

    return AOI_ALIGNED_METRIC_BLUEPRINTS.flatMap<AoiAlignedMetricDisplayEntry>((blueprint) => {
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
    return buildMetricComparisonValues(baselineMetrics, candidateMetrics);
  }

  private buildComparisonMetricDisplayEntry(
    blueprint: ComparisonMetricBlueprint,
    metricsById: Map<string, MetricComparisonValue>,
    shouldFillDummy: boolean,
  ): ComparisonMetricDisplayEntry {
    const realMetric = blueprint.metricId ? metricsById.get(blueprint.metricId) : undefined;
    const liveMetricEntry = this.buildLiveRasterComparisonEntry(blueprint);
    if (liveMetricEntry) {
      return liveMetricEntry;
    }

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
    if (metric.dummyAreaKm2 !== undefined && metric.realMetricId) {
      return this.formatAreaValue(metric.dummyAreaKm2);
    }

    if (metric.id === 'metric-05-carbon-storage-capacity') {
      return this.formatNumber(2_300_000, this.metricNumberFormatMode(), 0, 1);
    }

    return metric.dummyValue;
  }

  private formatComparisonDummyValue(
    blueprint: ComparisonMetricBlueprint,
    field: 'baseline' | 'candidate' | 'delta',
  ): string {
    const areaValueByField = {
      baseline: blueprint.dummyBaselineAreaKm2,
      candidate: blueprint.dummyCandidateAreaKm2,
      delta: blueprint.dummyDeltaAreaKm2,
    } satisfies Record<typeof field, number | undefined>;
    const areaValue = areaValueByField[field];
    if (areaValue !== undefined) {
      const sign = field === 'delta' && areaValue > 0 ? '+' : '';
      return `${sign}${this.formatAreaValue(areaValue)}`;
    }

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
        liveMetrics.newAgreementAreaKm2,
        'overlap',
      ),
      this.buildSpatialOverlapEntry(
        'unique-solution-a',
        'analysis.comparison.metrics.uniqueSolutionA',
        'analysis.comparison.metrics.uniqueSolutionADesc',
        liveMetrics.newUniqueToBaselineKm2,
        'baseline',
      ),
      this.buildSpatialOverlapEntry(
        'unique-solution-b',
        'analysis.comparison.metrics.uniqueSolutionB',
        'analysis.comparison.metrics.uniqueSolutionBDesc',
        liveMetrics.newUniqueToCandidateKm2,
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
        liveMetrics.baselineTotalSelectedAreaKm2,
        liveMetrics.candidateTotalSelectedAreaKm2,
        (value) => this.formatLiveAreaMetric(value),
        (value) => this.formatLiveAreaMetric(value, 'full'),
      );
    }

    if (blueprint.metricId === 'pre_existing_selected_area') {
      return this.buildLiveRasterDisplayEntry(
        blueprint,
        liveMetrics.baselinePreExistingAreaKm2,
        liveMetrics.candidatePreExistingAreaKm2,
        (value) => this.formatLiveAreaMetric(value),
        (value) => this.formatLiveAreaMetric(value, 'full'),
      );
    }

    if (blueprint.metricId === 'new_selected_area') {
      return this.buildLiveRasterDisplayEntry(
        blueprint,
        liveMetrics.baselineNewAreaKm2,
        liveMetrics.candidateNewAreaKm2,
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
    return this.formatAreaValue(value, mode);
  }
}
