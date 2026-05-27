import { inject, Injectable, signal } from '@angular/core';
import Extent from '@arcgis/core/geometry/Extent';
import MediaLayer from '@arcgis/core/layers/MediaLayer';
import ImageElement from '@arcgis/core/layers/support/ImageElement';
import ExtentAndRotationGeoreference from '@arcgis/core/layers/support/ExtentAndRotationGeoreference';
import LocalMediaElementSource from '@arcgis/core/layers/support/LocalMediaElementSource';

import type ArcGISMap from '@arcgis/core/Map';
import type { Solution } from '@core/models';
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
export const DEFAULT_COMPARISON_BASELINE_HEX = DEFAULT_SINGLE_SOLUTION_HEX;
export const DEFAULT_COMPARISON_CANDIDATE_HEX = '#7c3aed';
export const DEFAULT_COMPARISON_OVERLAP_HEX = '#ec4899';

const SOLUTION_ALPHA = 180;
const TEMPORARY_METRICS_FIXTURE_SOLUTION_ID = 'sol-001';
type SidebarSolutionLayerType = 'solution-baseline' | 'solution-candidate' | 'solution-overlap';

@Injectable({ providedIn: 'root' })
export class SolutionLayerService {
  private readonly loader = inject(GeoTiffLoaderService);
  private readonly appState = inject(AppStateService);
  private readonly mockData = inject(MockDataService);
  private map: InstanceType<typeof ArcGISMap> | null = null;
  private currentLayer: InstanceType<typeof MediaLayer> | null = null;
  private baselineComparisonLayer: InstanceType<typeof MediaLayer> | null = null;
  private candidateComparisonLayer: InstanceType<typeof MediaLayer> | null = null;
  private overlapComparisonLayer: InstanceType<typeof MediaLayer> | null = null;
  private baselineComparisonLoaded: LoadedSolution | null = null;
  private candidateComparisonLoaded: LoadedSolution | null = null;
  private comparisonMode = false;
  private lastSingleSolutionId: string | null = null;
  private lastComparisonBaselineId: string | null = null;
  private lastComparisonCandidateId: string | null = null;
  private baselineComparisonOpacity = 0.7;
  private candidateComparisonOpacity = 0.7;
  private overlapComparisonOpacity = 1;
  private baselineComparisonVisible = true;
  private candidateComparisonVisible = true;
  private overlapComparisonVisible = true;
  private comparisonVisualizationMode: ComparisonVisualizationMode = 'threeColorOverlay';
  private solutionImageElement: InstanceType<typeof ImageElement> | null = null;

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
  readonly baselineColor$ = signal(DEFAULT_COMPARISON_BASELINE_HEX);
  readonly candidateColor$ = signal(DEFAULT_COMPARISON_CANDIDATE_HEX);
  readonly overlapColor$ = signal(DEFAULT_COMPARISON_OVERLAP_HEX);

  readonly loadedSolution$ = signal<LoadedSolution | null>(null);
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
      this.lastSingleSolutionId = loaded.scenario.id;
      this.solutionImageElement = this.createImageElement(loaded, this.solutionColor$());
      this.currentLayer = new MediaLayer({
        id: SOLUTION_LAYER_ID,
        source: new LocalMediaElementSource({ elements: [this.solutionImageElement] }),
        opacity: 0.7,
        title: loaded.scenario.name,
      });
      this.comparisonMode = false;
      this.baselineComparisonLoaded = null;
      this.candidateComparisonLoaded = null;

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
      );
      this.candidateComparisonLayer = this.createLayerFromLoaded(
        candidateLoaded,
        CANDIDATE_LAYER_ID,
        `Scenario B: ${candidateLoaded.scenario.name}`,
        this.candidateColor$(),
      );
      this.baselineComparisonLoaded = baselineLoaded;
      this.candidateComparisonLoaded = candidateLoaded;
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
  }

  isComparisonModeActive(): boolean {
    return this.comparisonMode;
  }

  getComparisonLayers(): {
    baselineLayer: InstanceType<typeof MediaLayer>;
    candidateLayer: InstanceType<typeof MediaLayer>;
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
      .filter((layer): layer is InstanceType<typeof MediaLayer> => !!layer);

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

    const nextImageElement = this.createImageElement(loaded, normalized);
    this.solutionImageElement = nextImageElement;
    const source = this.currentLayer.source;
    if (source instanceof LocalMediaElementSource) {
      source.elements.removeAll();
      source.elements.add(nextImageElement);
      return;
    }
    this.currentLayer.source = new LocalMediaElementSource({ elements: [nextImageElement] });
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
      this.replaceLayerSourceColor(this.currentLayer, loaded, normalized);
    }
    if (this.baselineComparisonLayer && this.baselineComparisonLoaded) {
      this.replaceLayerSourceColor(
        this.baselineComparisonLayer,
        this.baselineComparisonLoaded,
        normalized,
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
      this.replaceLayerSourceColor(
        this.candidateComparisonLayer,
        this.candidateComparisonLoaded,
        normalized,
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
      this.baselineComparisonLoaded.rasterData,
      this.candidateComparisonLoaded.rasterData,
    );
    this.replaceLayerSourceWithRaster(
      this.overlapComparisonLayer,
      this.baselineComparisonLoaded,
      overlapRasterData,
      normalized,
    );
  }

  private createLayerFromLoaded(
    loaded: LoadedSolution,
    layerId: string,
    title: string,
    colorHex = DEFAULT_SINGLE_SOLUTION_HEX,
  ): InstanceType<typeof MediaLayer> {
    return new MediaLayer({
      id: layerId,
      source: new LocalMediaElementSource({
        elements: [this.createImageElement(loaded, colorHex)],
      }),
      opacity: 0.7,
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
    this.solutionImageElement = null;
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
        metadataUrl: loaded.scenario.metadataUrl,
      },
      metrics: metricsFixture?.metrics ?? [],
    };
  }

  private createImageElement(loaded: LoadedSolution, colorHex: string): ImageElement {
    const canvas = this.rasterToCanvasWithColor(loaded.rasterData, loaded.rasterMeta, colorHex);
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

  private replaceLayerSourceColor(
    layer: InstanceType<typeof MediaLayer>,
    loaded: LoadedSolution,
    colorHex: string,
  ): void {
    const nextImageElement = this.createImageElement(loaded, colorHex);
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
      this.baselineComparisonLoaded.rasterData,
      this.candidateComparisonLoaded.rasterData,
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
    baselineRasterData: LoadedSolution['rasterData'],
    candidateRasterData: LoadedSolution['rasterData'],
  ): Float64Array {
    const length = Math.min(baselineRasterData.length, candidateRasterData.length);
    const overlapRaster = new Float64Array(length);
    for (let index = 0; index < length; index++) {
      overlapRaster[index] =
        baselineRasterData[index] === 1 && candidateRasterData[index] === 1 ? 1 : 0;
    }
    return overlapRaster;
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
  ): HTMLCanvasElement {
    const [r, g, b] = this.hexToRgb(colorHex) ?? [22, 163, 74];
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
      const pixelOffset = index * 4;
      if (rasterData[index] === 1) {
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

  resolveLayerForSidebarType(
    layerType: SidebarSolutionLayerType,
  ): InstanceType<typeof MediaLayer> | null {
    if (layerType === 'solution-baseline') {
      return this.comparisonMode ? this.baselineComparisonLayer : this.currentLayer;
    }
    if (layerType === 'solution-candidate') {
      return this.candidateComparisonLayer;
    }
    return this.overlapComparisonLayer;
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
