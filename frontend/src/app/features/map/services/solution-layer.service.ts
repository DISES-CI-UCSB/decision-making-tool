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
import {
  AppStateService,
  type ComparisonVisualizationMode,
} from '@core/services/app-state.service';
import type { LoadedSolution } from '@core/models/solution-catalog.model';
import {
  buildOverlapRasterData,
  calculateLiveComparisonMetrics,
  calculateLiveSolutionMetrics,
  type LiveComparisonMetrics,
  type LiveSolutionMetrics,
} from '../utils/solution-raster.utils';
import {
  defaultExistingProtectedColor,
  defaultSolutionClassColors,
  DEFAULT_COMPARISON_BASELINE_HEX,
  DEFAULT_COMPARISON_CANDIDATE_HEX,
  DEFAULT_COMPARISON_OVERLAP_HEX,
  DEFAULT_EXISTING_PROTECTED_HEX,
  DEFAULT_SINGLE_SOLUTION_HEX,
  DEFAULT_SOLUTION_LAYER_OPACITY,
  hexToRgb,
  normalizeHexColor,
  solutionClassColors,
  type SolutionRenderOptions,
  spatialReferenceForRaster,
} from '../utils/solution-rendering.utils';
import { GeoTiffLoaderService } from './geotiff-loader.service';

const SOLUTION_LAYER_ID = 'solution-raster-layer';
const BASELINE_LAYER_ID = 'solution-raster-layer-baseline';
const CANDIDATE_LAYER_ID = 'solution-raster-layer-candidate';
const OVERLAP_LAYER_ID = 'solution-raster-layer-overlap';

const SOLUTION_ALPHA = 255;
type SidebarSolutionLayerType = 'solution-baseline' | 'solution-candidate' | 'solution-overlap';
type SolutionDisplayLayer = InstanceType<typeof MediaLayer> | InstanceType<typeof ImageryTileLayer>;

@Injectable({ providedIn: 'root' })
export class SolutionLayerService {
  private readonly loader = inject(GeoTiffLoaderService);
  private readonly appState = inject(AppStateService);
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
   * Per-solution color memory so that returning to a previously-viewed solution during the
   * same browsing session restores the user's chosen color rather than snapping back to the
   * canonical default (Option B). Colors are reset to defaults only when the user explicitly
   * removes the solution layer (removeSolutionLayer), which clears lastSingle/Comparison IDs.
   */
  private readonly userSingleColorBySolutionId = new Map<string, string>();
  private readonly userExistingProtectedColorBySolutionId = new Map<string, string>();
  private readonly userBaselineColorBySolutionId = new Map<string, string>();
  private readonly userCandidateColorBySolutionId = new Map<string, string>();

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
  readonly liveSolutionMetrics$ = signal<LiveSolutionMetrics | null>(null);
  readonly liveComparisonMetrics$ = signal<LiveComparisonMetrics | null>(null);
  readonly isLoading$ = signal(false);
  readonly loadError$ = signal<string | null>(null);

  initialize(map: InstanceType<typeof ArcGISMap>): void {
    this.map = map;
  }

  async showSolution(
    solutionId: string,
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

      const loaded = await this.loader.loadSolution(solutionId);
      // Restore the user-picked color for this solution (if any), otherwise use the default.
      // This lets returning to a previously-viewed solution preserve the chosen color.
      const restoredColor =
        this.userSingleColorBySolutionId.get(loaded.solution.id) ?? DEFAULT_SINGLE_SOLUTION_HEX;
      const restoredExistingProtectedColor =
        this.userExistingProtectedColorBySolutionId.get(loaded.solution.id) ??
        defaultExistingProtectedColor(loaded);
      this.solutionColor$.set(restoredColor);
      this.existingProtectedColor$.set(restoredExistingProtectedColor);
      this.lastSingleSolutionId = loaded.solution.id;
      this.currentLayer = this.createLayerFromLoaded(
        loaded,
        SOLUTION_LAYER_ID,
        loaded.solution.name,
        this.solutionColor$(),
      );
      this.comparisonMode = false;
      this.baselineComparisonLoaded = null;
      this.candidateComparisonLoaded = null;
      this.liveSolutionMetrics$.set(calculateLiveSolutionMetrics(loaded));
      this.liveComparisonMetrics$.set(null);

      this.map.add(this.currentLayer);
      this.loadedSolution$.set(loaded);
      if (syncAppState) {
        this.appState.loadSolution(this.toSidebarSolution(loaded));
      }

      console.info(
        `[SolutionLayerService] rendered "${loaded.solution.id}" in ${loaded.loadTimeMs}ms ` +
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

  async showComparison(baselineSolutionId: string, candidateSolutionId: string): Promise<void> {
    if (!this.map) {
      console.error('[SolutionLayerService] map not initialized');
      return;
    }

    this.isLoading$.set(true);
    this.loadError$.set(null);

    try {
      const currentlyLoaded = this.loadedSolution$();
      const reuseIfLoaded = (solutionId: string): LoadedSolution | null => {
        return currentlyLoaded?.solution.id === solutionId ? currentlyLoaded : null;
      };

      let baselineLoaded: LoadedSolution;
      let candidateLoaded: LoadedSolution;

      if (baselineSolutionId === candidateSolutionId) {
        const sharedLoaded =
          reuseIfLoaded(baselineSolutionId) ?? (await this.loader.loadSolution(baselineSolutionId));
        baselineLoaded = sharedLoaded;
        candidateLoaded = sharedLoaded;
      } else {
        [baselineLoaded, candidateLoaded] = await Promise.all([
          reuseIfLoaded(baselineSolutionId) ?? this.loader.loadSolution(baselineSolutionId),
          reuseIfLoaded(candidateSolutionId) ?? this.loader.loadSolution(candidateSolutionId),
        ]);
      }

      // Only clear existing map layers once both solutions have loaded successfully.
      this.removeAllLayers();
      // Restore user-picked colors for each solution side (if any), otherwise use the default.
      // Overlap resets whenever either side changes since it depends on both solutions.
      const baselineChanged = this.lastComparisonBaselineId !== baselineLoaded.solution.id;
      const candidateChanged = this.lastComparisonCandidateId !== candidateLoaded.solution.id;
      this.baselineColor$.set(
        this.userBaselineColorBySolutionId.get(baselineLoaded.solution.id) ??
          DEFAULT_COMPARISON_BASELINE_HEX,
      );
      this.candidateColor$.set(
        this.userCandidateColorBySolutionId.get(candidateLoaded.solution.id) ??
          DEFAULT_COMPARISON_CANDIDATE_HEX,
      );
      if (baselineChanged || candidateChanged) {
        this.overlapColor$.set(DEFAULT_COMPARISON_OVERLAP_HEX);
      }
      this.lastComparisonBaselineId = baselineLoaded.solution.id;
      this.lastComparisonCandidateId = candidateLoaded.solution.id;
      this.baselineComparisonLayer = this.createLayerFromLoaded(
        baselineLoaded,
        BASELINE_LAYER_ID,
        `Scenario A: ${baselineLoaded.solution.name}`,
        this.baselineColor$(),
        { collapseExistingProtectedCoverage: true },
      );
      this.candidateComparisonLayer = this.createLayerFromLoaded(
        candidateLoaded,
        CANDIDATE_LAYER_ID,
        `Scenario B: ${candidateLoaded.solution.name}`,
        this.candidateColor$(),
        { collapseExistingProtectedCoverage: true },
      );
      this.baselineComparisonLoaded = baselineLoaded;
      this.candidateComparisonLoaded = candidateLoaded;
      this.liveComparisonMetrics$.set(
        calculateLiveComparisonMetrics(baselineLoaded, candidateLoaded),
      );
      this.liveSolutionMetrics$.set(calculateLiveSolutionMetrics(baselineLoaded));
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
    this.liveSolutionMetrics$.set(null);
    this.comparisonMode = false;
    // Clear solution tracking so a subsequent load of the same id is treated as a fresh start
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

  hasComparisonSolutions(baselineSolutionId: string, candidateSolutionId: string): boolean {
    if (!this.baselineComparisonLoaded || !this.candidateComparisonLoaded) {
      return false;
    }
    return (
      this.baselineComparisonLoaded.solution.id === baselineSolutionId &&
      this.candidateComparisonLoaded.solution.id === candidateSolutionId
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
    const normalized = normalizeHexColor(color);
    if (!normalized || normalized === this.solutionColor$()) {
      return;
    }
    this.solutionColor$.set(normalized);
    if (this.lastSingleSolutionId) {
      this.userSingleColorBySolutionId.set(this.lastSingleSolutionId, normalized);
    }
    const loaded = this.loadedSolution$();
    if (!loaded || !this.currentLayer) {
      return;
    }

    this.applyLayerColor(this.currentLayer, loaded, normalized);
  }

  setExistingProtectedColor(color: string): void {
    const normalized = normalizeHexColor(color);
    if (!normalized || normalized === this.existingProtectedColor$()) {
      return;
    }
    this.existingProtectedColor$.set(normalized);
    if (this.lastSingleSolutionId) {
      this.userExistingProtectedColorBySolutionId.set(this.lastSingleSolutionId, normalized);
    }
    const loaded = this.loadedSolution$();
    if (!loaded || !this.currentLayer) {
      return;
    }

    this.applyLayerColor(this.currentLayer, loaded, this.solutionColor$());
  }

  setBaselineColor(color: string): void {
    const normalized = normalizeHexColor(color);
    if (!normalized || normalized === this.baselineColor$()) {
      return;
    }
    // Baseline color also drives the single-solution (non-comparison) green channel so the
    // left sidebar's sole "Selected Solution" row and the comparison baseline stay coherent.
    this.solutionColor$.set(normalized);
    this.baselineColor$.set(normalized);
    if (this.lastSingleSolutionId) {
      this.userSingleColorBySolutionId.set(this.lastSingleSolutionId, normalized);
    }
    if (this.lastComparisonBaselineId) {
      this.userBaselineColorBySolutionId.set(this.lastComparisonBaselineId, normalized);
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
    const normalized = normalizeHexColor(color);
    if (!normalized || normalized === this.candidateColor$()) {
      return;
    }
    this.candidateColor$.set(normalized);
    if (this.lastComparisonCandidateId) {
      this.userCandidateColorBySolutionId.set(this.lastComparisonCandidateId, normalized);
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
    const normalized = normalizeHexColor(color);
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

    const overlapRasterData = buildOverlapRasterData(
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
    if (loaded.solution.displayCogUrl) {
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
    this.liveSolutionMetrics$.set(null);
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
    return {
      id: loaded.solution.id,
      name: loaded.solution.name,
      description: loaded.solution.description,
      matchPercentage: loaded.solution.pctTargetsMet,
      geometryUrl: loaded.solution.displayUrl,
      metadata: {
        solutionId: loaded.solution.id,
        scope: loaded.solution.scope,
        rasterFile: loaded.solution.filename,
        displayCogUrl: loaded.solution.displayCogUrl ?? null,
        metadataUrl: loaded.solution.metadataUrl,
      },
      metrics: [],
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
          spatialReference: spatialReferenceForRaster(loaded.rasterMeta),
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
      url: loaded.solution.displayCogUrl ?? loaded.solution.displayUrl,
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
      classBreakInfos: this.getSolutionClassColors(loaded, newCoverageColorHex, renderOptions).map(
        (entry) => {
          const [r, g, b] = hexToRgb(entry.color) ?? [22, 163, 74];
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
          spatialReference: spatialReferenceForRaster(loaded.rasterMeta),
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

    const overlapRasterData = buildOverlapRasterData(
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
          spatialReference: spatialReferenceForRaster(loaded.rasterMeta),
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
        ? this.getSolutionClassColors(loaded, colorHex, renderOptions)
        : defaultSolutionClassColors(colorHex)
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
        const [r, g, b] = hexToRgb(color) ?? [22, 163, 74];
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

  private getSolutionClassColors(
    loaded: LoadedSolution,
    newCoverageColorHex: string,
    renderOptions: SolutionRenderOptions = {},
  ) {
    return solutionClassColors(loaded, newCoverageColorHex, {
      ...renderOptions,
      existingProtectedColorHex:
        renderOptions.existingProtectedColorHex ?? this.existingProtectedColor$(),
      showExistingProtectedCoverage: this.appState.showExistingProtectedCoverage$(),
    });
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
}
