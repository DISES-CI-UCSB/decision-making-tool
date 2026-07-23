import { computed, Injectable, signal } from '@angular/core';
import type Extent from '@arcgis/core/geometry/Extent';
import { DEFAULT_CHART_PALETTE_ID, type ChartPaletteId } from '@core/models/chart-palette.model';
import {
  type AOI,
  type CustomPolygonMetricsGeometry,
  type LayerConfig,
  type RuntimeLayerManifestRenderingConfig,
  type Solution,
  UserTier,
} from '@core/models';
import { environment } from '../../../environments/environment';

export type RightSidebarMode = 'welcome' | 'overview' | 'aoi' | 'comparison';
export type SolutionFinderContext = 'default' | 'comparison-candidate';
export type PlanningDomain = 'land' | 'marine';
export type ComparisonVisualizationMode = 'threeColorOverlay' | 'twoColorOpacity' | 'swipe';
export type MetricNumberFormatMode = 'compact' | 'full';
export type AreaDisplayUnit = 'km2' | 'hectares';
export type MapLegendLayerSwatchType = 'fill' | 'line' | 'gradient';
export type CustomAoiDrawStatus = 'idle' | 'drawing' | 'selected' | 'invalid';

export interface FinderSelectionMemory {
  planningDomain: PlanningDomain;
  selectedScope: 'nacional' | 'sirap';
  selectedSirapRegion: string | null;
  selectedTargetTypeIds: string[];
  targetLevelByType: Record<string, 17 | 30>;
  includeOmecs: boolean;
  includeComunidades: boolean;
  includeResguardos: boolean;
  selectedCostLayerId: string | null;
  marineTargetPercent: 30 | 50;
  marineIncludeOmecs: boolean;
}

export interface SavedSolutionScenario {
  id: string;
  solutionId: string;
  label: string;
  solutionName: string;
  updatedAt: string;
}

export interface MapLegendLayerCategoryEntry {
  id: string;
  label: string;
  color: string;
}

export interface MapLegendDenseCategorySummary {
  count: number;
  messageKey: string;
  sampleColors: string[];
}

export interface MapLegendLayerEntry {
  id: string;
  name: string;
  swatchType: MapLegendLayerSwatchType;
  color: string;
  lineStyle: 'solid' | 'dashed';
  lineWidth: number;
  categories?: MapLegendLayerCategoryEntry[];
  denseCategorySummary?: MapLegendDenseCategorySummary;
  gradientStartColor?: string;
  gradientEndColor?: string;
  gradientMinLabel?: string;
  gradientMaxLabel?: string;
}

interface ContinuousGradientLegendEntryInput {
  id: string;
  name: string;
  color: string;
  rendering: RuntimeLayerManifestRenderingConfig;
}

export function isContinuousGradientRendering(
  rendering: RuntimeLayerManifestRenderingConfig,
): boolean {
  return rendering.valueType === 'continuous' && rendering.renderMode === 'gradient';
}

export function buildContinuousGradientLegendEntry({
  id,
  name,
  color,
  rendering,
}: ContinuousGradientLegendEntryInput): MapLegendLayerEntry {
  return {
    id,
    name,
    swatchType: 'gradient',
    color,
    lineStyle: 'solid',
    lineWidth: 1,
    gradientStartColor: rendering.startColor ?? '#dbeafe',
    gradientEndColor: rendering.endColor ?? color ?? '#7f1d1d',
    gradientMinLabel: formatLegendValue(rendering.minValue),
    gradientMaxLabel: formatLegendValue(rendering.maxValue),
  };
}

function formatLegendValue(value: number | null | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Number.isInteger(value) ? `${value}` : value.toFixed(2);
}

/** Dev-only hover treatment for the Map Layers “Select solution” CTA (persisted in localStorage). */
export type SelectSolutionButtonHoverFxMode =
  | 'professional'
  | 'cursorFollowGreen'
  | 'rainforestReveal';

const SELECT_SOLUTION_HOVER_FX_STORAGE_KEY = 'eco-plan:dev:selectSolutionButtonHoverFx';
const SAVED_SOLUTION_SCENARIOS_STORAGE_KEY = 'eco-plan:savedSolutionScenarios';
const MAX_SAVED_SOLUTION_SCENARIOS = 12;

function readStoredSelectSolutionHoverFx(): SelectSolutionButtonHoverFxMode {
  if (typeof localStorage === 'undefined') {
    return 'professional';
  }
  const raw = localStorage.getItem(SELECT_SOLUTION_HOVER_FX_STORAGE_KEY);
  if (raw === 'cursorFollowGreen') {
    return 'cursorFollowGreen';
  }
  if (raw === 'rainforestReveal') {
    return 'rainforestReveal';
  }
  return 'professional';
}

function readStoredSavedSolutionScenarios(): SavedSolutionScenario[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  const raw = localStorage.getItem(SAVED_SOLUTION_SCENARIOS_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isSavedSolutionScenario).slice(0, MAX_SAVED_SOLUTION_SCENARIOS);
  } catch {
    return [];
  }
}

function isSavedSolutionScenario(value: unknown): value is SavedSolutionScenario {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<SavedSolutionScenario>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.solutionId === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.solutionName === 'string' &&
    typeof candidate.updatedAt === 'string'
  );
}

@Injectable({
  providedIn: 'root',
})
export class AppStateService {
  readonly activeSolution$ = signal<Solution | null>(null);
  readonly activeSolutionLabel$ = signal<string | null>(null);
  readonly savedSolutionScenarios$ = signal<SavedSolutionScenario[]>(
    readStoredSavedSolutionScenarios(),
  );
  readonly selectedAOI$ = signal<AOI | null>(null);
  readonly customAOIGeometry$ = signal<CustomPolygonMetricsGeometry | null>(null);
  readonly visibleLayers$ = signal<LayerConfig[]>([]);
  readonly comparisonSolution$ = signal<Solution | null>(null);
  readonly comparisonVisualizationMode$ = signal<ComparisonVisualizationMode>('threeColorOverlay');
  readonly rightSidebarMode$ = signal<RightSidebarMode>('welcome');
  // Default to OFF: rows without a real Tier 1 (or AOI/comparison) metric
  // value render as `--` instead of fabricated demo numbers. Dev tools can
  // flip these back on for design reviews that want fully populated mocks.
  readonly fillDummyOverviewMetrics$ = signal(false);
  readonly fillDummyComparisonMetrics$ = signal(false);
  readonly fillDummyAoiMetrics$ = signal(false);
  /** Dev-only: toggle metric-row icons in Overview/AOI panels for iconography review. */
  readonly showMetricIcons$ = signal(true);
  readonly showFinderSolutionFilenames$ = signal(false);
  readonly showFinderScopeBar$ = signal(false);
  /** Dev-only: gate the overview panel's "View Full Report" CTA while the report experience is in flight. */
  readonly showViewFullReportButton$ = signal(true);
  /** Dev-only: gate the AOI dashboard's "Generate Regional Report" CTA until that functionality exists (UCS-144). */
  readonly showGenerateRegionalReportButton$ = signal(false);
  /** Dev-only: show the info-icon reminder of Solution Finder inputs next to the overview title. Off until data is ready. */
  readonly showOverviewInputsReminder$ = signal(false);
  /** Dev-only: split solution rasters into existing include coverage versus newly recommended coverage. */
  readonly showExistingProtectedCoverage$ = signal(true);
  /** Dev-only: compare readable compact metric numbers against full precision values. */
  readonly metricNumberFormatMode$ = signal<MetricNumberFormatMode>('compact');
  readonly areaDisplayUnit$ = signal<AreaDisplayUnit>('km2');
  readonly chartPaletteId$ = signal<ChartPaletteId>(DEFAULT_CHART_PALETTE_ID);
  readonly solutionFinderModalOpen$ = signal(false);
  readonly solutionFinderContext$ = signal<SolutionFinderContext>('default');
  readonly finderSelectionMemory$ = signal<FinderSelectionMemory | null>(null);
  readonly userTier$ = signal<UserTier>(UserTier.Public);
  readonly userIsAdmin$ = signal(false);
  readonly mapExtent$ = signal<Extent | null>(null);
  readonly customAoiDrawRequest$ = signal(0);
  readonly customAoiDrawCancelRequest$ = signal(0);
  readonly customAoiDrawClearRequest$ = signal(0);
  readonly customAoiDrawStatus$ = signal<CustomAoiDrawStatus>('idle');
  readonly selectedLegendLayers$ = signal<MapLegendLayerEntry[]>([]);
  readonly selectSolutionButtonHoverFx$ = signal<SelectSolutionButtonHoverFxMode>(
    readStoredSelectSolutionHoverFx(),
  );

  readonly hasActiveSolution = computed(() => this.activeSolution$() !== null);
  readonly isComparing = computed(() => this.comparisonSolution$() !== null);
  readonly canAccessTier2 = computed(
    () => environment.bypassLoginForDevelopment || this.userTier$() >= UserTier.DecisionMaker,
  );

  loadSolution(solution: Solution): void {
    this.activeSolution$.set(solution);
    this.activeSolutionLabel$.set(null);
    if (this.rightSidebarMode$() !== 'comparison') {
      this.rightSidebarMode$.set('overview');
    }
  }

  labelActiveSolution(label: string | null): void {
    const activeSolution = this.activeSolution$();
    if (!activeSolution) {
      return;
    }

    this.activeSolutionLabel$.set(label);
    if (label) {
      this.saveSolutionScenario({
        solutionId: this.resolveSolutionId(activeSolution),
        label,
        solutionName: activeSolution.name,
      });
    } else {
      this.removeSavedSolutionScenario(this.resolveSolutionId(activeSolution));
    }
  }

  clearSolution(): void {
    this.activeSolution$.set(null);
    this.activeSolutionLabel$.set(null);
    this.selectedAOI$.set(null);
    this.customAOIGeometry$.set(null);
    this.customAoiDrawStatus$.set('idle');
    this.comparisonSolution$.set(null);
    this.comparisonVisualizationMode$.set('threeColorOverlay');
    this.rightSidebarMode$.set('welcome');
  }

  selectAOI(aoi: AOI): void {
    this.customAOIGeometry$.set(null);
    this.customAoiDrawStatus$.set('idle');
    this.selectedAOI$.set(aoi);
  }

  selectCustomAOI(
    geometry: CustomPolygonMetricsGeometry,
    options: { id?: string; name?: string; areaKm2?: number } = {},
  ): void {
    this.customAOIGeometry$.set(geometry);
    this.customAoiDrawStatus$.set('selected');
    this.selectedAOI$.set({
      id: options.id ?? 'custom:drawn-polygon',
      name: options.name ?? 'Custom drawn AOI',
      type: 'custom',
      subtype: 'Custom polygon',
      geometryUrl: 'custom-polygon://drawn-aoi',
      areaKm2: options.areaKm2,
    });
  }

  clearAOI(): void {
    this.selectedAOI$.set(null);
    this.customAOIGeometry$.set(null);
    this.customAoiDrawStatus$.set('idle');
  }

  requestCustomAoiDraw(): void {
    this.customAoiDrawRequest$.update((requestCount) => requestCount + 1);
  }

  requestCustomAoiDrawCancel(): void {
    this.customAoiDrawCancelRequest$.update((requestCount) => requestCount + 1);
  }

  requestCustomAoiDrawClear(): void {
    this.customAoiDrawClearRequest$.update((requestCount) => requestCount + 1);
  }

  setCustomAoiDrawStatus(status: CustomAoiDrawStatus): void {
    this.customAoiDrawStatus$.set(status);
  }

  toggleLayer(layerId: string): void {
    this.visibleLayers$.update((layers) =>
      layers.map((layer) => (layer.id === layerId ? { ...layer, visible: !layer.visible } : layer)),
    );
  }

  setRightSidebarMode(mode: RightSidebarMode): void {
    this.rightSidebarMode$.set(mode);
  }

  setComparisonSolution(solution: Solution | null): void {
    this.comparisonSolution$.set(solution);
  }

  setComparisonVisualizationMode(mode: ComparisonVisualizationMode): void {
    this.comparisonVisualizationMode$.set(mode);
  }

  setSelectedLegendLayers(entries: MapLegendLayerEntry[]): void {
    this.selectedLegendLayers$.set(entries);
  }

  setFillDummyOverviewMetrics(enabled: boolean): void {
    this.fillDummyOverviewMetrics$.set(enabled);
  }

  setFillDummyComparisonMetrics(enabled: boolean): void {
    this.fillDummyComparisonMetrics$.set(enabled);
  }

  setFillDummyAoiMetrics(enabled: boolean): void {
    this.fillDummyAoiMetrics$.set(enabled);
  }

  setShowMetricIcons(enabled: boolean): void {
    this.showMetricIcons$.set(enabled);
  }

  setShowFinderSolutionFilenames(enabled: boolean): void {
    this.showFinderSolutionFilenames$.set(enabled);
  }

  setShowFinderScopeBar(enabled: boolean): void {
    this.showFinderScopeBar$.set(enabled);
  }

  setShowViewFullReportButton(enabled: boolean): void {
    this.showViewFullReportButton$.set(enabled);
  }

  setShowGenerateRegionalReportButton(enabled: boolean): void {
    this.showGenerateRegionalReportButton$.set(enabled);
  }

  setShowOverviewInputsReminder(enabled: boolean): void {
    this.showOverviewInputsReminder$.set(enabled);
  }

  setShowExistingProtectedCoverage(enabled: boolean): void {
    this.showExistingProtectedCoverage$.set(enabled);
  }

  setMetricNumberFormatMode(mode: MetricNumberFormatMode): void {
    this.metricNumberFormatMode$.set(mode);
  }

  setAreaDisplayUnit(unit: AreaDisplayUnit): void {
    this.areaDisplayUnit$.set(unit);
  }

  setChartPaletteId(paletteId: ChartPaletteId): void {
    this.chartPaletteId$.set(paletteId);
  }

  setSelectSolutionButtonHoverFx(mode: SelectSolutionButtonHoverFxMode): void {
    this.selectSolutionButtonHoverFx$.set(mode);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SELECT_SOLUTION_HOVER_FX_STORAGE_KEY, mode);
    }
  }

  applySavedSolutionScenarioLabel(scenario: SavedSolutionScenario): void {
    this.activeSolutionLabel$.set(scenario.label);
    this.saveSolutionScenario({
      solutionId: scenario.solutionId,
      label: scenario.label,
      solutionName: scenario.solutionName,
    });
  }

  private saveSolutionScenario(input: {
    solutionId: string;
    label: string;
    solutionName: string;
  }): void {
    const trimmedLabel = input.label.trim();
    if (!trimmedLabel) {
      return;
    }

    const scenario: SavedSolutionScenario = {
      id: `saved-scenario-${input.solutionId}`,
      solutionId: input.solutionId,
      label: trimmedLabel,
      solutionName: input.solutionName,
      updatedAt: new Date().toISOString(),
    };

    const nextScenarios = [
      scenario,
      ...this.savedSolutionScenarios$().filter((item) => item.solutionId !== input.solutionId),
    ].slice(0, MAX_SAVED_SOLUTION_SCENARIOS);

    this.savedSolutionScenarios$.set(nextScenarios);
    this.persistSavedSolutionScenarios(nextScenarios);
  }

  private removeSavedSolutionScenario(solutionId: string): void {
    const nextScenarios = this.savedSolutionScenarios$().filter(
      (item) => item.solutionId !== solutionId,
    );
    this.savedSolutionScenarios$.set(nextScenarios);
    this.persistSavedSolutionScenarios(nextScenarios);
  }

  private persistSavedSolutionScenarios(scenarios: SavedSolutionScenario[]): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    localStorage.setItem(SAVED_SOLUTION_SCENARIOS_STORAGE_KEY, JSON.stringify(scenarios));
  }

  private resolveSolutionId(solution: Solution): string {
    const metadataSolutionId = solution.metadata?.['solutionId'];
    return typeof metadataSolutionId === 'string' ? metadataSolutionId : solution.id;
  }

  toggleSelectSolutionButtonHoverFx(): void {
    const order: SelectSolutionButtonHoverFxMode[] = [
      'professional',
      'cursorFollowGreen',
      'rainforestReveal',
    ];
    const cur = this.selectSolutionButtonHoverFx$();
    const i = order.indexOf(cur);
    const next = order[(i === -1 ? 0 : i + 1) % order.length];
    this.setSelectSolutionButtonHoverFx(next);
  }

  openSolutionFinder(context: SolutionFinderContext = 'default'): void {
    this.solutionFinderContext$.set(context);
    this.solutionFinderModalOpen$.set(true);
  }

  setFinderSelectionMemory(selection: FinderSelectionMemory): void {
    this.finderSelectionMemory$.set({
      ...selection,
      selectedTargetTypeIds: [...selection.selectedTargetTypeIds],
      targetLevelByType: { ...selection.targetLevelByType },
    });
  }

  clearFinderSelectionMemory(): void {
    this.finderSelectionMemory$.set(null);
  }

  closeSolutionFinder(): void {
    this.solutionFinderModalOpen$.set(false);
    this.solutionFinderContext$.set('default');
  }
}
