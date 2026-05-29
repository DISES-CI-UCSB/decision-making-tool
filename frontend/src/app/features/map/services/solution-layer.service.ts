import { inject, Injectable, signal } from '@angular/core';
import Extent from '@arcgis/core/geometry/Extent';
import ImageryTileLayer from '@arcgis/core/layers/ImageryTileLayer';
import MediaLayer from '@arcgis/core/layers/MediaLayer';
import ImageElement from '@arcgis/core/layers/support/ImageElement';
import ExtentAndRotationGeoreference from '@arcgis/core/layers/support/ExtentAndRotationGeoreference';
import LocalMediaElementSource from '@arcgis/core/layers/support/LocalMediaElementSource';
import ClassBreaksRenderer from '@arcgis/core/renderers/ClassBreaksRenderer';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol';

import type ArcGISMap from '@arcgis/core/Map';
import type { Solution } from '@core/models';
import { getSolutionIncludedAreasLegendLabel } from '@core/models/solution-included-areas.utils';
import type { RuntimeLayerManifestClassColor } from '@core/models/layer-manifest.model';
import {
  AppStateService,
  type ComparisonVisualizationMode,
} from '@core/services/app-state.service';
import { MockDataService } from '@core/services/mock-data.service';
import type { LoadedSolution } from '@core/models/solution-scenario.model';
import { GeoTiffLoaderService } from './geotiff-loader.service';

const SOLUTION_LAYER_ID = 'solution-raster-layer';
const BASELINE_LAYER_ID = 'solution-raster-layer-baseline';
const CANDIDATE_LAYER_ID = 'solution-raster-layer-candidate';
const OVERLAP_LAYER_ID = 'solution-raster-layer-overlap';

/** Canonical default colors. Any module that needs a default must import from here. */
export const DEFAULT_SINGLE_SOLUTION_HEX = '#16a34a';
export const DEFAULT_EXISTING_PROTECTED_HEX = '#2563eb';
export const DEFAULT_COMPARISON_BASELINE_HEX = DEFAULT_SINGLE_SOLUTION_HEX;
export const DEFAULT_COMPARISON_CANDIDATE_HEX = '#7c3aed';
export const DEFAULT_COMPARISON_OVERLAP_HEX = '#ec4899';
export const DEFAULT_SOLUTION_LAYER_OPACITY = 0.8;

const SOLUTION_ALPHA = 255;
const NEW_COVERAGE_VALUE = 1;
const EXISTING_PROTECTED_VALUE = 2;
const EARTH_RADIUS_KM = 6371.0088;
const GRID_ABSOLUTE_TOLERANCE = 1e-7;
const TEMPORARY_METRICS_FIXTURE_SOLUTION_ID = 'sol-001';
type SidebarSolutionLayerType = 'solution-baseline' | 'solution-candidate' | 'solution-overlap';
type SolutionDisplayLayer = InstanceType<typeof MediaLayer> | InstanceType<typeof ImageryTileLayer>;
interface SolutionRenderOptions {
  collapseExistingProtectedCoverage?: boolean;
}

export interface LiveComparisonMetrics {
  agreementAreaKm2: number | null;
  uniqueToBaselineKm2: number | null;
  uniqueToCandidateKm2: number | null;
  baselineSelectedAreaKm2: number | null;
  candidateSelectedAreaKm2: number | null;
  baselineNationalContributionPct: number | null;
  candidateNationalContributionPct: number | null;
  status: 'ready' | 'unavailable';
  notes: string | null;
}

@Injectable({ providedIn: 'root' })
export class SolutionLayerService {
  private readonly loader = inject(GeoTiffLoaderService);
  private readonly appState = inject(AppStateService);
  private readonly mockData = inject(MockDataService);
  private map: InstanceType<typeof ArcGISMap> | null = null;
  private currentLayer: SolutionDisplayLayer | null = null;
  private baselineComparisonLayer: SolutionDisplayLayer | null = null;
  private candidateComparisonLayer: SolutionDisplayLayer | null = null;
  private overlapComparisonLayer: InstanceType<typeof MediaLayer> | null = null;
  private baselineComparisonLoaded: LoadedSolution | null = null;
  private candidateComparisonLoaded: LoadedSolution | null = null;
  private comparisonMode = false;
  private lastSingleSolutionId: string | null = null;
  private lastComparisonBaselineId: string | null = null;
  private lastComparisonCandidateId: string | null = null;
  private baselineComparisonOpacity = DEFAULT_SOLUTION_LAYER_OPACITY;
  private candidateComparisonOpacity = DEFAULT_SOLUTION_LAYER_OPACITY;
  private overlapComparisonOpacity = 1;
  private baselineComparisonVisible = true;
  private candidateComparisonVisible = true;
  private overlapComparisonVisible = true;
  private comparisonVisualizationMode: ComparisonVisualizationMode = 'threeColorOverlay';

  /**
   * Per-scenario color memory so that returning to a previously-viewed scenario during the
   * same browsing session restores the user's chosen color rather than snapping back to the
   * canonical default (Option B). Colors are reset to defaults only when the user explicitly
   * removes the solution layer (removeSolutionLayer), which clears lastSingle/Comparison IDs.
   */
  private readonly userSingleColorByScenarioId = new Map<string, string>();
  private readonly userBaselineColorByScenarioId = new Map<string, string>();
  private readonly userCandidateColorByScenarioId = new Map<string, string>();

  /**
   * Canonical source of truth for all four solution-layer colors.
   * Downstream consumers (legend, right-sidebar comparison panel) subscribe directly.
   * The left-sidebar layer-control rows write here via set*Color().
   */
  readonly solutionColor$ = signal(DEFAULT_SINGLE_SOLUTION_HEX);
  readonly existingProtectedColor$ = signal(DEFAULT_EXISTING_PROTECTED_HEX);
  readonly baselineColor$ = signal(DEFAULT_COMPARISON_BASELINE_HEX);
  readonly candidateColor$ = signal(DEFAULT_COMPARISON_CANDIDATE_HEX);
  readonly overlapColor$ = signal(DEFAULT_COMPARISON_OVERLAP_HEX);

  readonly loadedSolution$ = signal<LoadedSolution | null>(null);
  readonly liveComparisonMetrics$ = signal<LiveComparisonMetrics | null>(null);
  readonly isLoading$ = signal(false);
  readonly loadError$ = signal<string | null>(null);

  initialize(map: InstanceType<typeof ArcGISMap>): void {
    this.map = map;
  }

  async showSolution(
    scenarioId: string,
    options: {
      syncAppState?: boolean;
    } = {},
  ): Promise<void> {
    if (!this.map) {
      console.error('[SolutionLayerService] map not initialized');
      return;
    }

    const { syncAppState = true } = options;
    this.isLoading$.set(true);
    this.loadError$.set(null);

    try {
      this.removeAllLayers();

      const loaded = await this.loader.loadSolution(scenarioId);
      // Restore the user-picked color for this scenario (if any), otherwise use the default.
      // This lets returning to a previously-viewed scenario preserve the chosen color.
      const restoredColor =
        this.userSingleColorByScenarioId.get(loaded.scenario.id) ?? DEFAULT_SINGLE_SOLUTION_HEX;
      this.solutionColor$.set(restoredColor);
      this.syncExistingProtectedColor(loaded, restoredColor);
      this.lastSingleSolutionId = loaded.scenario.id;
      this.currentLayer = this.createLayerFromLoaded(
        loaded,
        SOLUTION_LAYER_ID,
        loaded.scenario.name,
        this.solutionColor$(),
      );
      this.comparisonMode = false;
      this.baselineComparisonLoaded = null;
      this.candidateComparisonLoaded = null;
      this.liveComparisonMetrics$.set(null);

      this.map.add(this.currentLayer);
      this.loadedSolution$.set(loaded);
      if (syncAppState) {
        this.appState.loadSolution(this.toSidebarSolution(loaded));
      }

      console.info(
        `[SolutionLayerService] rendered "${loaded.scenario.id}" in ${loaded.loadTimeMs}ms ` +
          `(${loaded.rasterMeta.selectedCount.toLocaleString()} cells selected, ` +
          `${loaded.rasterMeta.selectedPct.toFixed(1)}%)`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.loadError$.set(msg);
      console.error('[SolutionLayerService] load failed:', err);
    } finally {
      this.isLoading$.set(false);
    }
  }

  async showComparison(baselineScenarioId: string, candidateScenarioId: string): Promise<void> {
    if (!this.map) {
      console.error('[SolutionLayerService] map not initialized');
      return;
    }

    this.isLoading$.set(true);
    this.loadError$.set(null);

    try {
      const currentlyLoaded = this.loadedSolution$();
      const reuseIfLoaded = (scenarioId: string): LoadedSolution | null => {
        return currentlyLoaded?.scenario.id === scenarioId ? currentlyLoaded : null;
      };

      let baselineLoaded: LoadedSolution;
      let candidateLoaded: LoadedSolution;

      if (baselineScenarioId === candidateScenarioId) {
        const sharedLoaded =
          reuseIfLoaded(baselineScenarioId) ?? (await this.loader.loadSolution(baselineScenarioId));
        baselineLoaded = sharedLoaded;
        candidateLoaded = sharedLoaded;
      } else {
        [baselineLoaded, candidateLoaded] = await Promise.all([
          reuseIfLoaded(baselineScenarioId) ?? this.loader.loadSolution(baselineScenarioId),
          reuseIfLoaded(candidateScenarioId) ?? this.loader.loadSolution(candidateScenarioId),
        ]);
      }

      // Only clear existing map layers once both scenarios have loaded successfully.
      this.removeAllLayers();
      // Restore user-picked colors for each scenario side (if any), otherwise use the default.
      // Overlap resets whenever either side changes since it depends on both scenarios.
      const baselineChanged = this.lastComparisonBaselineId !== baselineLoaded.scenario.id;
      const candidateChanged = this.lastComparisonCandidateId !== candidateLoaded.scenario.id;
      this.baselineColor$.set(
        this.userBaselineColorByScenarioId.get(baselineLoaded.scenario.id) ??
          DEFAULT_COMPARISON_BASELINE_HEX,
      );
      this.candidateColor$.set(
        this.userCandidateColorByScenarioId.get(candidateLoaded.scenario.id) ??
          DEFAULT_COMPARISON_CANDIDATE_HEX,
      );
      if (baselineChanged || candidateChanged) {
        this.overlapColor$.set(DEFAULT_COMPARISON_OVERLAP_HEX);
      }
      this.lastComparisonBaselineId = baselineLoaded.scenario.id;
      this.lastComparisonCandidateId = candidateLoaded.scenario.id;
      this.baselineComparisonLayer = this.createLayerFromLoaded(
        baselineLoaded,
        BASELINE_LAYER_ID,
        `Scenario A: ${baselineLoaded.scenario.name}`,
        this.baselineColor$(),
        { collapseExistingProtectedCoverage: true },
      );
      this.candidateComparisonLayer = this.createLayerFromLoaded(
        candidateLoaded,
        CANDIDATE_LAYER_ID,
        `Scenario B: ${candidateLoaded.scenario.name}`,
        this.candidateColor$(),
        { collapseExistingProtectedCoverage: true },
      );
      this.baselineComparisonLoaded = baselineLoaded;
      this.candidateComparisonLoaded = candidateLoaded;
      this.liveComparisonMetrics$.set(
        this.calculateLiveComparisonMetrics(baselineLoaded, candidateLoaded),
      );
      this.comparisonMode = true;
      this.map.addMany([this.baselineComparisonLayer, this.candidateComparisonLayer]);
      this.loadedSolution$.set(baselineLoaded);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.loadError$.set(msg);
      console.error('[SolutionLayerService] comparison load failed:', err);
    } finally {
      this.isLoading$.set(false);
    }
  }

  removeSolutionLayer(): void {
    this.removeAllLayers();
    this.loadedSolution$.set(null);
    this.comparisonMode = false;
    // Clear scenario tracking so a subsequent load of the same id is treated as a fresh start
    // (and therefore snaps colors back to defaults per Option B).
    this.lastSingleSolutionId = null;
    this.lastComparisonBaselineId = null;
    this.lastComparisonCandidateId = null;
    this.appState.clearSolution();
  }

  exitComparisonMode(): void {
    this.removeComparisonLayers();
    this.comparisonMode = false;
    this.lastComparisonBaselineId = null;
    this.lastComparisonCandidateId = null;
    this.liveComparisonMetrics$.set(null);
  }

  isComparisonModeActive(): boolean {
    return this.comparisonMode;
  }

  getComparisonLayers(): {
    baselineLayer: SolutionDisplayLayer;
    candidateLayer: SolutionDisplayLayer;
  } | null {
    if (!this.baselineComparisonLayer || !this.candidateComparisonLayer) {
      return null;
    }

    return {
      baselineLayer: this.baselineComparisonLayer,
      candidateLayer: this.candidateComparisonLayer,
    };
  }

  /** @deprecated Prefer subscribing to `baselineColor$` for reactivity. */
  getBaselineColorHex(): string {
    return this.baselineColor$();
  }

  /** @deprecated Prefer subscribing to `candidateColor$` for reactivity. */
  getCandidateColorHex(): string {
    return this.candidateColor$();
  }

  /** @deprecated Prefer subscribing to `overlapColor$` for reactivity. */
  getOverlapColorHex(): string {
    return this.overlapColor$();
  }

  getBaselineOpacity(): number {
    return this.baselineComparisonOpacity;
  }

  getCandidateOpacity(): number {
    return this.candidateComparisonOpacity;
  }

  getOverlapOpacity(): number {
    return this.overlapComparisonOpacity;
  }

  hasComparisonScenarios(baselineScenarioId: string, candidateScenarioId: string): boolean {
    if (!this.baselineComparisonLoaded || !this.candidateComparisonLoaded) {
      return false;
    }
    return (
      this.baselineComparisonLoaded.scenario.id === baselineScenarioId &&
      this.candidateComparisonLoaded.scenario.id === candidateScenarioId
    );
  }

  applyComparisonVisualizationMode(mode: ComparisonVisualizationMode): void {
    this.comparisonVisualizationMode = mode;
    if (!this.comparisonMode) {
      return;
    }

    if (mode === 'threeColorOverlay') {
      this.ensureOverlapLayer();
      this.setBaselineVisibility(this.baselineComparisonVisible);
      this.setCandidateVisibility(this.candidateComparisonVisible);
      this.setOverlapVisibility(this.overlapComparisonVisible);
      return;
    }

    this.hideOverlapLayerForComparisonMode();
    this.setBaselineVisibility(this.baselineComparisonVisible);
    this.setCandidateVisibility(this.candidateComparisonVisible);
  }

  reorderSolutionLayersBySidebarOrder(orderTopToBottom: SidebarSolutionLayerType[]): void {
    if (!this.map || orderTopToBottom.length === 0) {
      return;
    }

    const resolvedLayers = orderTopToBottom
      .map((layerType) => this.resolveLayerForSidebarType(layerType))
      .filter((layer): layer is SolutionDisplayLayer => !!layer);

    // ArcGIS draws higher indices on top; move bottom->top so final stack matches sidebar.
    for (const layer of [...resolvedLayers].reverse()) {
      this.map.reorder(layer, this.map.layers.length - 1);
    }
  }

  setOpacity(opacity: number): void {
    const clampedOpacity = Math.max(0, Math.min(1, opacity));
    if (this.currentLayer) {
      this.currentLayer.opacity = clampedOpacity;
    }
    if (this.baselineComparisonLayer) {
      this.baselineComparisonLayer.opacity = clampedOpacity;
    }
    if (this.candidateComparisonLayer) {
      this.candidateComparisonLayer.opacity = clampedOpacity;
    }
  }

  setBaselineOpacity(opacity: number): void {
    const clampedOpacity = Math.max(0, Math.min(1, opacity));
    this.baselineComparisonOpacity = clampedOpacity;
    if (this.currentLayer) {
      this.currentLayer.opacity = clampedOpacity;
    }
    if (this.baselineComparisonLayer) {
      this.baselineComparisonLayer.opacity = clampedOpacity;
    }
  }

  setCandidateOpacity(opacity: number): void {
    const clampedOpacity = Math.max(0, Math.min(1, opacity));
    this.candidateComparisonOpacity = clampedOpacity;
    if (this.candidateComparisonLayer) {
      this.candidateComparisonLayer.opacity = clampedOpacity;
    }
  }

  setOverlapOpacity(opacity: number): void {
    const clampedOpacity = Math.max(0, Math.min(1, opacity));
    this.overlapComparisonOpacity = clampedOpacity;
    if (this.overlapComparisonLayer) {
      this.overlapComparisonLayer.opacity = clampedOpacity;
    }
  }

  setColor(color: string): void {
    const normalized = this.normalizeHexColor(color);
    if (!normalized || normalized === this.solutionColor$()) {
      return;
    }
    this.solutionColor$.set(normalized);
    if (this.lastSingleSolutionId) {
      this.userSingleColorByScenarioId.set(this.lastSingleSolutionId, normalized);
    }
    const loaded = this.loadedSolution$();
    if (!loaded || !this.currentLayer) {
      return;
    }

    this.applyLayerColor(this.currentLayer, loaded, normalized);
  }

  setBaselineColor(color: string): void {
    const normalized = this.normalizeHexColor(color);
    if (!normalized || normalized === this.baselineColor$()) {
      return;
    }
    // Baseline color also drives the single-solution (non-comparison) green channel so the
    // left sidebar's sole "Selected Solution" row and the comparison baseline stay coherent.
    this.solutionColor$.set(normalized);
    this.baselineColor$.set(normalized);
    if (this.lastSingleSolutionId) {
      this.userSingleColorByScenarioId.set(this.lastSingleSolutionId, normalized);
    }
    if (this.lastComparisonBaselineId) {
      this.userBaselineColorByScenarioId.set(this.lastComparisonBaselineId, normalized);
    }

    const loaded = this.loadedSolution$();
    if (loaded && this.currentLayer) {
      this.applyLayerColor(this.currentLayer, loaded, normalized);
    }
    if (this.baselineComparisonLayer && this.baselineComparisonLoaded) {
      this.applyLayerColor(
        this.baselineComparisonLayer,
        this.baselineComparisonLoaded,
        normalized,
        {
          collapseExistingProtectedCoverage: true,
        },
      );
    }
  }

  setCandidateColor(color: string): void {
    const normalized = this.normalizeHexColor(color);
    if (!normalized || normalized === this.candidateColor$()) {
      return;
    }
    this.candidateColor$.set(normalized);
    if (this.lastComparisonCandidateId) {
      this.userCandidateColorByScenarioId.set(this.lastComparisonCandidateId, normalized);
    }
    if (this.candidateComparisonLayer && this.candidateComparisonLoaded) {
      this.applyLayerColor(
        this.candidateComparisonLayer,
        this.candidateComparisonLoaded,
        normalized,
        { collapseExistingProtectedCoverage: true },
      );
    }
  }

  setOverlapColor(color: string): void {
    const normalized = this.normalizeHexColor(color);
    if (!normalized || normalized === this.overlapColor$()) {
      return;
    }
    this.overlapColor$.set(normalized);
    if (
      !this.overlapComparisonLayer ||
      !this.baselineComparisonLoaded ||
      !this.candidateComparisonLoaded
    ) {
      return;
    }

    const overlapRasterData = this.buildOverlapRasterData(
      this.baselineComparisonLoaded,
      this.candidateComparisonLoaded,
    );
    this.replaceLayerSourceWithRaster(
      this.overlapComparisonLayer,
      this.baselineComparisonLoaded,
      overlapRasterData,
      normalized,
    );
  }

  refreshSolutionClassRendering(): void {
    const loaded = this.loadedSolution$();
    if (loaded) {
      this.syncExistingProtectedColor(loaded, this.solutionColor$());
    }
    if (loaded && this.currentLayer) {
      this.applyLayerColor(this.currentLayer, loaded, this.solutionColor$());
    }
    if (this.baselineComparisonLayer && this.baselineComparisonLoaded) {
      this.applyLayerColor(
        this.baselineComparisonLayer,
        this.baselineComparisonLoaded,
        this.baselineColor$(),
        { collapseExistingProtectedCoverage: true },
      );
    }
    if (this.candidateComparisonLayer && this.candidateComparisonLoaded) {
      this.applyLayerColor(
        this.candidateComparisonLayer,
        this.candidateComparisonLoaded,
        this.candidateColor$(),
        { collapseExistingProtectedCoverage: true },
      );
    }
  }

  private createLayerFromLoaded(
    loaded: LoadedSolution,
    layerId: string,
    title: string,
    colorHex = DEFAULT_SINGLE_SOLUTION_HEX,
    renderOptions: SolutionRenderOptions = {},
  ): SolutionDisplayLayer {
    if (loaded.scenario.displayCogUrl) {
      return this.createImageryTileLayer(loaded, layerId, title, colorHex, renderOptions);
    }

    return new MediaLayer({
      id: layerId,
      source: new LocalMediaElementSource({
        elements: [this.createImageElement(loaded, colorHex, renderOptions)],
      }),
      opacity: DEFAULT_SOLUTION_LAYER_OPACITY,
      title,
    });
  }

  private removeAllLayers(): void {
    this.removeSingleLayer();
    this.removeComparisonLayers();
  }

  private removeSingleLayer(): void {
    if (this.currentLayer && this.map) {
      this.map.remove(this.currentLayer);
      this.currentLayer.destroy();
      this.currentLayer = null;
    }
  }

  private removeComparisonLayers(): void {
    if (this.baselineComparisonLayer && this.map) {
      this.map.remove(this.baselineComparisonLayer);
      this.baselineComparisonLayer.destroy();
      this.baselineComparisonLayer = null;
    }
    if (this.candidateComparisonLayer && this.map) {
      this.map.remove(this.candidateComparisonLayer);
      this.candidateComparisonLayer.destroy();
      this.candidateComparisonLayer = null;
    }
    if (this.overlapComparisonLayer && this.map) {
      this.map.remove(this.overlapComparisonLayer);
      this.overlapComparisonLayer.destroy();
      this.overlapComparisonLayer = null;
    }
    this.baselineComparisonLoaded = null;
    this.candidateComparisonLoaded = null;
    this.liveComparisonMetrics$.set(null);
  }

  setVisibility(visible: boolean): void {
    if (this.currentLayer) {
      this.currentLayer.visible = visible;
    }
  }

  setBaselineVisibility(visible: boolean): void {
    this.baselineComparisonVisible = visible;
    if (this.currentLayer) {
      this.currentLayer.visible = visible;
    }
    if (this.baselineComparisonLayer) {
      this.baselineComparisonLayer.visible = visible;
    }
  }

  setCandidateVisibility(visible: boolean): void {
    this.candidateComparisonVisible = visible;
    if (this.candidateComparisonLayer) {
      this.candidateComparisonLayer.visible = visible;
    }
  }

  setOverlapVisibility(visible: boolean): void {
    this.overlapComparisonVisible = visible;
    if (this.overlapComparisonLayer) {
      this.overlapComparisonLayer.visible =
        visible && this.comparisonVisualizationMode === 'threeColorOverlay';
    }
  }

  private hideOverlapLayerForComparisonMode(): void {
    if (this.overlapComparisonLayer) {
      this.overlapComparisonLayer.visible = false;
    }
  }

  private toSidebarSolution(loaded: LoadedSolution): Solution {
    const metricsFixture = this.mockData.getSolutionById(TEMPORARY_METRICS_FIXTURE_SOLUTION_ID);

    return {
      id: loaded.scenario.id,
      name: loaded.scenario.name,
      description: loaded.scenario.description,
      matchPercentage: loaded.scenario.pctTargetsMet,
      geometryUrl: loaded.scenario.displayUrl,
      metadata: {
        scenarioId: loaded.scenario.id,
        scope: loaded.scenario.scope,
        rasterFile: loaded.scenario.filename,
        displayCogUrl: loaded.scenario.displayCogUrl ?? null,
        metadataUrl: loaded.scenario.metadataUrl,
      },
      metrics: metricsFixture?.metrics ?? [],
    };
  }

  private createImageElement(
    loaded: LoadedSolution,
    colorHex: string,
    renderOptions: SolutionRenderOptions = {},
  ): ImageElement {
    const canvas = this.rasterToCanvasWithColor(
      loaded.rasterData,
      loaded.rasterMeta,
      colorHex,
      loaded,
      renderOptions,
    );
    const [xmin, ymin, xmax, ymax] = loaded.rasterMeta.bbox;
    return new ImageElement({
      image: canvas,
      georeference: new ExtentAndRotationGeoreference({
        extent: new Extent({
          xmin,
          ymin,
          xmax,
          ymax,
          spatialReference: { wkid: 4326 },
        }),
      }),
    });
  }

  private createImageryTileLayer(
    loaded: LoadedSolution,
    layerId: string,
    title: string,
    colorHex: string,
    renderOptions: SolutionRenderOptions = {},
  ): InstanceType<typeof ImageryTileLayer> {
    return new ImageryTileLayer({
      id: layerId,
      url: loaded.scenario.displayCogUrl ?? loaded.scenario.displayUrl,
      interpolation: 'nearest',
      renderer: this.createSolutionRenderer(loaded, colorHex, renderOptions),
      opacity: DEFAULT_SOLUTION_LAYER_OPACITY,
      title,
    });
  }

  private createSolutionRenderer(
    loaded: LoadedSolution,
    newCoverageColorHex: string,
    renderOptions: SolutionRenderOptions = {},
  ): InstanceType<typeof ClassBreaksRenderer> {
    return new ClassBreaksRenderer({
      field: 'Value',
      defaultSymbol: new SimpleFillSymbol({
        color: [0, 0, 0, 0],
        outline: null,
      }),
      classBreakInfos: this.solutionClassColors(loaded, newCoverageColorHex, renderOptions).map(
        (entry) => {
          const [r, g, b] = this.hexToRgb(entry.color) ?? [22, 163, 74];
          return {
            minValue: entry.value - 0.5,
            maxValue: entry.value + 0.5,
            label: entry.label ?? undefined,
            symbol: new SimpleFillSymbol({
              color: [r, g, b, 1],
              outline: null,
            }),
          };
        },
      ),
    });
  }

  private applyLayerColor(
    layer: SolutionDisplayLayer,
    loaded: LoadedSolution,
    colorHex: string,
    renderOptions: SolutionRenderOptions = {},
  ): void {
    if (this.isImageryTileLayer(layer)) {
      layer.renderer = this.createSolutionRenderer(loaded, colorHex, renderOptions);
      return;
    }
    this.replaceLayerSourceColor(layer, loaded, colorHex, renderOptions);
  }

  private replaceLayerSourceColor(
    layer: InstanceType<typeof MediaLayer>,
    loaded: LoadedSolution,
    colorHex: string,
    renderOptions: SolutionRenderOptions = {},
  ): void {
    const nextImageElement = this.createImageElement(loaded, colorHex, renderOptions);
    const source = layer.source;
    if (source instanceof LocalMediaElementSource) {
      source.elements.removeAll();
      source.elements.add(nextImageElement);
      return;
    }
    layer.source = new LocalMediaElementSource({ elements: [nextImageElement] });
  }

  private replaceLayerSourceWithRaster(
    layer: InstanceType<typeof MediaLayer>,
    loaded: LoadedSolution,
    rasterData: LoadedSolution['rasterData'],
    colorHex: string,
  ): void {
    const canvas = this.rasterToCanvasWithColor(rasterData, loaded.rasterMeta, colorHex);
    const [xmin, ymin, xmax, ymax] = loaded.rasterMeta.bbox;
    const nextImageElement = new ImageElement({
      image: canvas,
      georeference: new ExtentAndRotationGeoreference({
        extent: new Extent({
          xmin,
          ymin,
          xmax,
          ymax,
          spatialReference: { wkid: 4326 },
        }),
      }),
    });
    const source = layer.source;
    if (source instanceof LocalMediaElementSource) {
      source.elements.removeAll();
      source.elements.add(nextImageElement);
      return;
    }
    layer.source = new LocalMediaElementSource({ elements: [nextImageElement] });
  }

  private ensureOverlapLayer(): void {
    if (!this.map || !this.baselineComparisonLoaded || !this.candidateComparisonLoaded) {
      return;
    }

    const overlapRasterData = this.buildOverlapRasterData(
      this.baselineComparisonLoaded,
      this.candidateComparisonLoaded,
    );

    if (!this.overlapComparisonLayer) {
      this.overlapComparisonLayer = new MediaLayer({
        id: OVERLAP_LAYER_ID,
        source: new LocalMediaElementSource({
          elements: [
            this.createImageElementWithRaster(this.baselineComparisonLoaded, overlapRasterData),
          ],
        }),
        opacity: this.overlapComparisonOpacity,
        title: 'Overlap',
      });
      this.map.add(this.overlapComparisonLayer);
    } else {
      this.replaceLayerSourceWithRaster(
        this.overlapComparisonLayer,
        this.baselineComparisonLoaded,
        overlapRasterData,
        this.overlapColor$(),
      );
    }

    this.overlapComparisonLayer.opacity = this.overlapComparisonOpacity;
    this.overlapComparisonLayer.visible = this.overlapComparisonVisible;
    if ('reorder' in this.map && typeof this.map.reorder === 'function') {
      const topIndex =
        'layers' in this.map && this.map.layers && 'length' in this.map.layers
          ? this.map.layers.length - 1
          : undefined;
      if (typeof topIndex === 'number' && Number.isFinite(topIndex)) {
        this.map.reorder(this.overlapComparisonLayer, topIndex);
      }
    }

    if (this.baselineComparisonLayer) {
      this.baselineComparisonLayer.opacity = this.baselineComparisonOpacity;
      this.baselineComparisonLayer.visible = this.baselineComparisonVisible;
    }
    if (this.candidateComparisonLayer) {
      this.candidateComparisonLayer.opacity = this.candidateComparisonOpacity;
      this.candidateComparisonLayer.visible = this.candidateComparisonVisible;
    }
  }

  private buildOverlapRasterData(
    baseline: LoadedSolution,
    candidate: LoadedSolution,
  ): Float64Array {
    const length = Math.min(baseline.rasterData.length, candidate.rasterData.length);
    const overlapRaster = new Float64Array(length);
    for (let index = 0; index < length; index++) {
      overlapRaster[index] =
        this.isSelectedSolutionCell(baseline.rasterData[index], baseline.rasterMeta.noDataValue) &&
        this.isSelectedSolutionCell(candidate.rasterData[index], candidate.rasterMeta.noDataValue)
          ? NEW_COVERAGE_VALUE
          : 0;
    }
    return overlapRaster;
  }

  private isSelectedSolutionCell(value: number, noDataValue: number | null): boolean {
    if (!Number.isFinite(value)) {
      return false;
    }
    if (typeof noDataValue === 'number' && value === noDataValue) {
      return false;
    }
    return value > 0;
  }

  private createImageElementWithRaster(
    loaded: LoadedSolution,
    rasterData: LoadedSolution['rasterData'],
  ): ImageElement {
    const canvas = this.rasterToCanvasWithColor(
      rasterData,
      loaded.rasterMeta,
      this.overlapColor$(),
    );
    const [xmin, ymin, xmax, ymax] = loaded.rasterMeta.bbox;
    return new ImageElement({
      image: canvas,
      georeference: new ExtentAndRotationGeoreference({
        extent: new Extent({
          xmin,
          ymin,
          xmax,
          ymax,
          spatialReference: { wkid: 4326 },
        }),
      }),
    });
  }

  private rasterToCanvasWithColor(
    rasterData: LoadedSolution['rasterData'],
    rasterMeta: LoadedSolution['rasterMeta'],
    colorHex: string,
    loaded?: LoadedSolution,
    renderOptions: SolutionRenderOptions = {},
  ): HTMLCanvasElement {
    const classColorByValue = new Map(
      (loaded
        ? this.solutionClassColors(loaded, colorHex, renderOptions)
        : this.defaultSolutionClassColors(colorHex)
      ).map((entry) => [entry.value, entry.color]),
    );
    const canvas = document.createElement('canvas');
    canvas.width = rasterMeta.width;
    canvas.height = rasterMeta.height;
    const context = canvas.getContext('2d');
    if (!context) {
      return canvas;
    }

    const imageData = context.createImageData(rasterMeta.width, rasterMeta.height);
    const pixels = imageData.data;
    for (let index = 0; index < rasterData.length; index++) {
      const value = rasterData[index];
      const pixelOffset = index * 4;
      const isNoData =
        !Number.isFinite(value) ||
        (typeof rasterMeta.noDataValue === 'number' && value === rasterMeta.noDataValue);
      const color = isNoData ? undefined : classColorByValue.get(value);
      if (color) {
        const [r, g, b] = this.hexToRgb(color) ?? [22, 163, 74];
        pixels[pixelOffset] = r;
        pixels[pixelOffset + 1] = g;
        pixels[pixelOffset + 2] = b;
        pixels[pixelOffset + 3] = SOLUTION_ALPHA;
      } else {
        pixels[pixelOffset] = 0;
        pixels[pixelOffset + 1] = 0;
        pixels[pixelOffset + 2] = 0;
        pixels[pixelOffset + 3] = 0;
      }
    }
    context.putImageData(imageData, 0, 0);
    return canvas;
  }

  private solutionClassColors(
    loaded: LoadedSolution,
    newCoverageColorHex: string,
    renderOptions: SolutionRenderOptions = {},
  ): RuntimeLayerManifestClassColor[] {
    const classColors =
      loaded.scenario.rendering.renderMode === 'categorical'
        ? (loaded.scenario.rendering.classColors ?? [])
        : [];
    const existingProtectedClass = classColors.find(
      (entry) => entry.value === EXISTING_PROTECTED_VALUE,
    );
    const newCoverageClass = classColors.find((entry) => entry.value === NEW_COVERAGE_VALUE);
    const selectedSolutionColor =
      newCoverageColorHex || newCoverageClass?.color || DEFAULT_SINGLE_SOLUTION_HEX;

    if (
      renderOptions.collapseExistingProtectedCoverage ||
      !this.appState.showExistingProtectedCoverage$()
    ) {
      return [
        {
          value: EXISTING_PROTECTED_VALUE,
          color: selectedSolutionColor,
          label: 'Selected solution',
        },
        {
          value: NEW_COVERAGE_VALUE,
          color: selectedSolutionColor,
          label: 'Selected solution',
        },
      ];
    }

    return [
      {
        value: EXISTING_PROTECTED_VALUE,
        color: existingProtectedClass?.color ?? DEFAULT_EXISTING_PROTECTED_HEX,
        label: getSolutionIncludedAreasLegendLabel(loaded.scenario),
      },
      {
        value: NEW_COVERAGE_VALUE,
        color: selectedSolutionColor,
        label: newCoverageClass?.label ?? 'New coverage',
      },
    ];
  }

  private syncExistingProtectedColor(loaded: LoadedSolution, newCoverageColorHex: string): void {
    this.existingProtectedColor$.set(
      this.solutionClassColors(loaded, newCoverageColorHex)[0].color,
    );
  }

  private defaultSolutionClassColors(
    newCoverageColorHex: string,
  ): RuntimeLayerManifestClassColor[] {
    return [
      {
        value: NEW_COVERAGE_VALUE,
        color: newCoverageColorHex || DEFAULT_SINGLE_SOLUTION_HEX,
        label: 'New coverage',
      },
    ];
  }

  private normalizeHexColor(color: string): string | null {
    const trimmed = color.trim();
    if (!/^#([0-9a-fA-F]{6})$/.test(trimmed)) {
      return null;
    }
    return trimmed.toLowerCase();
  }

  private hexToRgb(hexColor: string): [number, number, number] | null {
    const normalized = this.normalizeHexColor(hexColor);
    if (!normalized) {
      return null;
    }
    return [
      Number.parseInt(normalized.slice(1, 3), 16),
      Number.parseInt(normalized.slice(3, 5), 16),
      Number.parseInt(normalized.slice(5, 7), 16),
    ];
  }

  resolveLayerForSidebarType(layerType: SidebarSolutionLayerType): SolutionDisplayLayer | null {
    if (layerType === 'solution-baseline') {
      return this.comparisonMode ? this.baselineComparisonLayer : this.currentLayer;
    }
    if (layerType === 'solution-candidate') {
      return this.candidateComparisonLayer;
    }
    return this.overlapComparisonLayer;
  }

  private isImageryTileLayer(
    layer: SolutionDisplayLayer,
  ): layer is InstanceType<typeof ImageryTileLayer> {
    return layer instanceof ImageryTileLayer;
  }

  /** Reorder an arbitrary set of ArcGIS layers by their IDs. `idsTopToBottom[0]` ends up on top. */
  reorderLayersByIds(idsTopToBottom: string[]): void {
    if (!this.map || idsTopToBottom.length === 0) {
      return;
    }
    // ArcGIS draws higher indices on top; iterate bottom→top so the first entry ends on top.
    for (const id of [...idsTopToBottom].reverse()) {
      const layer = this.map.findLayerById(id);
      if (layer) {
        this.map.reorder(layer, this.map.layers.length - 1);
      }
    }
  }

  private calculateLiveComparisonMetrics(
    baseline: LoadedSolution,
    candidate: LoadedSolution,
  ): LiveComparisonMetrics {
    if (!this.hasSameRasterGrid(baseline, candidate)) {
      return {
        agreementAreaKm2: null,
        uniqueToBaselineKm2: null,
        uniqueToCandidateKm2: null,
        baselineSelectedAreaKm2: null,
        candidateSelectedAreaKm2: null,
        baselineNationalContributionPct: null,
        candidateNationalContributionPct: null,
        status: 'unavailable',
        notes: 'Comparison rasters must share the same grid, CRS, and transform.',
      };
    }

    const expectedLength = baseline.rasterMeta.width * baseline.rasterMeta.height;
    if (
      baseline.rasterData.length < expectedLength ||
      candidate.rasterData.length < expectedLength
    ) {
      return {
        agreementAreaKm2: null,
        uniqueToBaselineKm2: null,
        uniqueToCandidateKm2: null,
        baselineSelectedAreaKm2: null,
        candidateSelectedAreaKm2: null,
        baselineNationalContributionPct: null,
        candidateNationalContributionPct: null,
        status: 'unavailable',
        notes: 'Comparison rasters do not contain the expected number of cells.',
      };
    }

    const pixelAreaByRow = this.getPixelAreaKm2PerRow(baseline.rasterMeta);
    if (!pixelAreaByRow) {
      return {
        agreementAreaKm2: null,
        uniqueToBaselineKm2: null,
        uniqueToCandidateKm2: null,
        baselineSelectedAreaKm2: null,
        candidateSelectedAreaKm2: null,
        baselineNationalContributionPct: null,
        candidateNationalContributionPct: null,
        status: 'unavailable',
        notes: 'Unable to derive pixel area from solution raster metadata.',
      };
    }

    let agreementAreaKm2 = 0;
    let uniqueToBaselineKm2 = 0;
    let uniqueToCandidateKm2 = 0;
    let baselineValidAreaKm2 = 0;
    let candidateValidAreaKm2 = 0;
    const width = baseline.rasterMeta.width;

    for (let index = 0; index < expectedLength; index++) {
      const row = Math.floor(index / width);
      const cellAreaKm2 = pixelAreaByRow[row] ?? 0;
      if (this.isValidSolutionCell(baseline.rasterData[index], baseline.rasterMeta.noDataValue)) {
        baselineValidAreaKm2 += cellAreaKm2;
      }
      if (this.isValidSolutionCell(candidate.rasterData[index], candidate.rasterMeta.noDataValue)) {
        candidateValidAreaKm2 += cellAreaKm2;
      }
      const selectedBaseline = this.isSelectedSolutionCell(
        baseline.rasterData[index],
        baseline.rasterMeta.noDataValue,
      );
      const selectedCandidate = this.isSelectedSolutionCell(
        candidate.rasterData[index],
        candidate.rasterMeta.noDataValue,
      );

      if (selectedBaseline && selectedCandidate) {
        agreementAreaKm2 += cellAreaKm2;
      } else if (selectedBaseline) {
        uniqueToBaselineKm2 += cellAreaKm2;
      } else if (selectedCandidate) {
        uniqueToCandidateKm2 += cellAreaKm2;
      }
    }

    const baselineSelectedAreaKm2 = agreementAreaKm2 + uniqueToBaselineKm2;
    const candidateSelectedAreaKm2 = agreementAreaKm2 + uniqueToCandidateKm2;

    return {
      agreementAreaKm2,
      uniqueToBaselineKm2,
      uniqueToCandidateKm2,
      baselineSelectedAreaKm2,
      candidateSelectedAreaKm2,
      baselineNationalContributionPct:
        baselineValidAreaKm2 > 0 ? (baselineSelectedAreaKm2 / baselineValidAreaKm2) * 100 : null,
      candidateNationalContributionPct:
        candidateValidAreaKm2 > 0 ? (candidateSelectedAreaKm2 / candidateValidAreaKm2) * 100 : null,
      status: 'ready',
      notes: null,
    };
  }

  private isValidSolutionCell(value: number, noDataValue: number | null): boolean {
    if (!Number.isFinite(value)) {
      return false;
    }
    return !(typeof noDataValue === 'number' && value === noDataValue);
  }

  private hasSameRasterGrid(baseline: LoadedSolution, candidate: LoadedSolution): boolean {
    const a = baseline.rasterMeta;
    const b = candidate.rasterMeta;
    return (
      a.width === b.width &&
      a.height === b.height &&
      a.crs === b.crs &&
      this.numberArraysClose(a.bbox, b.bbox) &&
      this.numberArraysClose(a.resolution, b.resolution)
    );
  }

  private numberArraysClose(a: readonly number[], b: readonly number[]): boolean {
    return (
      a.length === b.length &&
      a.every(
        (value, index) =>
          Math.abs(value - (b[index] ?? Number.POSITIVE_INFINITY)) <= GRID_ABSOLUTE_TOLERANCE,
      )
    );
  }

  private getPixelAreaKm2PerRow(rasterMeta: LoadedSolution['rasterMeta']): Float64Array | null {
    const [pixelWidth, pixelHeight] = rasterMeta.resolution.map((value) => Math.abs(value));
    if (!Number.isFinite(pixelWidth) || !Number.isFinite(pixelHeight)) {
      return null;
    }

    if (this.isGeographicRaster(rasterMeta)) {
      const kmPerDegreeLatitude = (Math.PI / 180) * EARTH_RADIUS_KM;
      const areaByRow = new Float64Array(rasterMeta.height);
      const [, , , ymax] = rasterMeta.bbox;
      const yResolution = rasterMeta.resolution[1];

      for (let row = 0; row < rasterMeta.height; row++) {
        const latitudeCenterDegrees = ymax + yResolution * (row + 0.5);
        const latitudeRadians = (latitudeCenterDegrees * Math.PI) / 180;
        const kmPerDegreeLongitude = kmPerDegreeLatitude * Math.cos(latitudeRadians);
        areaByRow[row] = pixelWidth * kmPerDegreeLongitude * pixelHeight * kmPerDegreeLatitude;
      }

      return areaByRow;
    }

    const projectedAreaKm2 = (pixelWidth * pixelHeight) / 1_000_000;
    return new Float64Array(rasterMeta.height).fill(projectedAreaKm2);
  }

  private isGeographicRaster(rasterMeta: LoadedSolution['rasterMeta']): boolean {
    const normalizedCrs = rasterMeta.crs.toUpperCase();
    if (normalizedCrs.includes('EPSG:4326')) {
      return true;
    }

    const [xmin, ymin, xmax, ymax] = rasterMeta.bbox;
    const [xResolution, yResolution] = rasterMeta.resolution.map((value) => Math.abs(value));
    return (
      xmin >= -180 &&
      xmax <= 180 &&
      ymin >= -90 &&
      ymax <= 90 &&
      xResolution <= 1 &&
      yResolution <= 1
    );
  }
}
