import { inject, Injectable, signal } from '@angular/core';
import Extent from '@arcgis/core/geometry/Extent';
import MediaLayer from '@arcgis/core/layers/MediaLayer';
import ImageElement from '@arcgis/core/layers/support/ImageElement';
import ExtentAndRotationGeoreference from '@arcgis/core/layers/support/ExtentAndRotationGeoreference';
import LocalMediaElementSource from '@arcgis/core/layers/support/LocalMediaElementSource';

import type ArcGISMap from '@arcgis/core/Map';
import type { Solution } from '@core/models';
import { AppStateService } from '@core/services/app-state.service';
import { MockDataService } from '@core/services/mock-data.service';
import type { LoadedSolution } from '@core/models/solution-scenario.model';
import { GeoTiffLoaderService } from './geotiff-loader.service';

const SOLUTION_LAYER_ID = 'solution-raster-layer';
const BASELINE_LAYER_ID = 'solution-raster-layer-baseline';
const CANDIDATE_LAYER_ID = 'solution-raster-layer-candidate';
const DEFAULT_SOLUTION_COLOR_HEX = '#16a34a';
const DEFAULT_COMPARISON_CANDIDATE_COLOR_HEX = '#2563eb';
const SOLUTION_ALPHA = 180;

@Injectable({ providedIn: 'root' })
export class SolutionLayerService {
  private readonly loader = inject(GeoTiffLoaderService);
  private readonly appState = inject(AppStateService);
  private readonly mockData = inject(MockDataService);
  private map: InstanceType<typeof ArcGISMap> | null = null;
  private currentLayer: InstanceType<typeof MediaLayer> | null = null;
  private baselineComparisonLayer: InstanceType<typeof MediaLayer> | null = null;
  private candidateComparisonLayer: InstanceType<typeof MediaLayer> | null = null;
  private baselineComparisonLoaded: LoadedSolution | null = null;
  private candidateComparisonLoaded: LoadedSolution | null = null;
  private comparisonMode = false;
  private solutionColorHex = DEFAULT_SOLUTION_COLOR_HEX;
  private baselineComparisonColorHex = DEFAULT_SOLUTION_COLOR_HEX;
  private candidateComparisonColorHex = DEFAULT_COMPARISON_CANDIDATE_COLOR_HEX;
  private solutionImageElement: InstanceType<typeof ImageElement> | null = null;

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
      this.solutionImageElement = this.createImageElement(loaded, this.solutionColorHex);
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
      this.removeAllLayers();
      const [baselineLoaded, candidateLoaded] = await Promise.all([
        this.loader.loadSolution(baselineScenarioId),
        this.loader.loadSolution(candidateScenarioId),
      ]);

      this.baselineComparisonLayer = this.createLayerFromLoaded(
        baselineLoaded,
        BASELINE_LAYER_ID,
        `Scenario A: ${baselineLoaded.scenario.name}`,
        this.baselineComparisonColorHex,
      );
      this.candidateComparisonLayer = this.createLayerFromLoaded(
        candidateLoaded,
        CANDIDATE_LAYER_ID,
        `Scenario B: ${candidateLoaded.scenario.name}`,
        this.candidateComparisonColorHex,
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
    this.appState.clearSolution();
  }

  exitComparisonMode(): void {
    this.removeComparisonLayers();
    this.comparisonMode = false;
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
    if (this.currentLayer) {
      this.currentLayer.opacity = clampedOpacity;
    }
    if (this.baselineComparisonLayer) {
      this.baselineComparisonLayer.opacity = clampedOpacity;
    }
  }

  setCandidateOpacity(opacity: number): void {
    const clampedOpacity = Math.max(0, Math.min(1, opacity));
    if (this.candidateComparisonLayer) {
      this.candidateComparisonLayer.opacity = clampedOpacity;
    }
  }

  setColor(color: string): void {
    const normalized = this.normalizeHexColor(color);
    if (!normalized) {
      return;
    }
    this.solutionColorHex = normalized;
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
    if (!normalized) {
      return;
    }
    this.solutionColorHex = normalized;
    this.baselineComparisonColorHex = normalized;

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
    if (!normalized) {
      return;
    }
    this.candidateComparisonColorHex = normalized;
    if (this.candidateComparisonLayer && this.candidateComparisonLoaded) {
      this.replaceLayerSourceColor(
        this.candidateComparisonLayer,
        this.candidateComparisonLoaded,
        normalized,
      );
    }
  }

  private createLayerFromLoaded(
    loaded: LoadedSolution,
    layerId: string,
    title: string,
    colorHex = DEFAULT_SOLUTION_COLOR_HEX,
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
    this.baselineComparisonLoaded = null;
    this.candidateComparisonLoaded = null;
  }

  setVisibility(visible: boolean): void {
    if (this.currentLayer) {
      this.currentLayer.visible = visible;
    }
  }

  setBaselineVisibility(visible: boolean): void {
    if (this.currentLayer) {
      this.currentLayer.visible = visible;
    }
    if (this.baselineComparisonLayer) {
      this.baselineComparisonLayer.visible = visible;
    }
  }

  setCandidateVisibility(visible: boolean): void {
    if (this.candidateComparisonLayer) {
      this.candidateComparisonLayer.visible = visible;
    }
  }

  private toSidebarSolution(loaded: LoadedSolution): Solution {
    const mockSolution = this.getMockSolutionForScenario(loaded.scenario.id);
    const matchPercentage = Math.round(
      Math.max(65, Math.min(98, 100 - loaded.rasterMeta.selectedPct / 4)),
    );

    return {
      id: mockSolution.id,
      name: loaded.scenario.name,
      description: loaded.scenario.description,
      matchPercentage,
      geometryUrl: loaded.scenario.filename,
      metadata: {
        scenarioId: loaded.scenario.id,
      },
      metrics: mockSolution.metrics,
    };
  }

  private getMockSolutionForScenario(scenarioId: string): Solution {
    const mockSolutionIds = ['sol-001', 'sol-002', 'sol-003'] as const;
    const hash = Array.from(scenarioId).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const fallbackId = mockSolutionIds[hash % mockSolutionIds.length];
    return this.mockData.getSolutionById(fallbackId) ?? this.mockData.getSolutionById('sol-001')!;
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
}
