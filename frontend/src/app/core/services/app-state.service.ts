import { computed, Injectable, signal } from '@angular/core';
import type Extent from '@arcgis/core/geometry/Extent';
import { DEFAULT_CHART_PALETTE_ID, type ChartPaletteId } from '@core/models/chart-palette.model';
import {
  type AOI,
  type LayerConfig,
  type RuntimeLayerManifestRenderingConfig,
  type Solution,
  UserTier,
} from '@core/models';
import { environment } from '../../../environments/environment';

export type RightSidebarMode = 'welcome' | 'overview' | 'aoi' | 'comparison';
export type SolutionFinderContext = 'default' | 'comparison-candidate';
export type ComparisonVisualizationMode = 'threeColorOverlay' | 'twoColorOpacity' | 'swipe';
export type MetricNumberFormatMode = 'compact' | 'full';
export type MapLegendLayerSwatchType = 'fill' | 'line' | 'gradient';

export interface MapLegendLayerCategoryEntry {
  id: string;
  label: string;
  color: string;
}

export interface MapLegendLayerEntry {
  id: string;
  name: string;
  swatchType: MapLegendLayerSwatchType;
  color: string;
  lineStyle: 'solid' | 'dashed';
  lineWidth: number;
  categories?: MapLegendLayerCategoryEntry[];
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

@Injectable({
  providedIn: 'root',
})
export class AppStateService {
  readonly activeSolution$ = signal<Solution | null>(null);
  readonly selectedAOI$ = signal<AOI | null>(null);
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
  readonly showFinderScenarioFilenames$ = signal(false);
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
  readonly chartPaletteId$ = signal<ChartPaletteId>(DEFAULT_CHART_PALETTE_ID);
  readonly solutionFinderModalOpen$ = signal(false);
  readonly solutionFinderContext$ = signal<SolutionFinderContext>('default');
  readonly userTier$ = signal<UserTier>(UserTier.Public);
  readonly userIsAdmin$ = signal(false);
  readonly mapExtent$ = signal<Extent | null>(null);
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
    if (this.rightSidebarMode$() !== 'comparison') {
      this.rightSidebarMode$.set('overview');
    }
  }

  clearSolution(): void {
    this.activeSolution$.set(null);
    this.selectedAOI$.set(null);
    this.comparisonSolution$.set(null);
    this.comparisonVisualizationMode$.set('threeColorOverlay');
    this.rightSidebarMode$.set('welcome');
  }

  selectAOI(aoi: AOI): void {
    this.selectedAOI$.set(aoi);
  }

  clearAOI(): void {
    this.selectedAOI$.set(null);
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

  setShowFinderScenarioFilenames(enabled: boolean): void {
    this.showFinderScenarioFilenames$.set(enabled);
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

  setChartPaletteId(paletteId: ChartPaletteId): void {
    this.chartPaletteId$.set(paletteId);
  }

  setSelectSolutionButtonHoverFx(mode: SelectSolutionButtonHoverFxMode): void {
    this.selectSolutionButtonHoverFx$.set(mode);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SELECT_SOLUTION_HOVER_FX_STORAGE_KEY, mode);
    }
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

  closeSolutionFinder(): void {
    this.solutionFinderModalOpen$.set(false);
    this.solutionFinderContext$.set('default');
  }
}
