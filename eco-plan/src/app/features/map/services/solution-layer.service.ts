import { inject, Injectable, signal } from '@angular/core';
import Extent from '@arcgis/core/geometry/Extent';
import MediaLayer from '@arcgis/core/layers/MediaLayer';
import ImageElement from '@arcgis/core/layers/support/ImageElement';
import ExtentAndRotationGeoreference from '@arcgis/core/layers/support/ExtentAndRotationGeoreference';

import type ArcGISMap from '@arcgis/core/Map';
import type { Solution } from '@core/models';
import { AppStateService } from '@core/services/app-state.service';
import { MockDataService } from '@core/services/mock-data.service';
import type { LoadedSolution } from '@core/models/solution-scenario.model';
import { GeoTiffLoaderService } from './geotiff-loader.service';

const SOLUTION_LAYER_ID = 'solution-raster-layer';
const BASELINE_LAYER_ID = 'solution-raster-layer-baseline';
const CANDIDATE_LAYER_ID = 'solution-raster-layer-candidate';

@Injectable({ providedIn: 'root' })
export class SolutionLayerService {
  private readonly loader = inject(GeoTiffLoaderService);
  private readonly appState = inject(AppStateService);
  private readonly mockData = inject(MockDataService);
  private map: InstanceType<typeof ArcGISMap> | null = null;
  private currentLayer: InstanceType<typeof MediaLayer> | null = null;
  private baselineComparisonLayer: InstanceType<typeof MediaLayer> | null = null;
  private candidateComparisonLayer: InstanceType<typeof MediaLayer> | null = null;
  private comparisonMode = false;

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
      this.currentLayer = this.createLayerFromLoaded(
        loaded,
        SOLUTION_LAYER_ID,
        loaded.scenario.name,
      );
      this.comparisonMode = false;

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
      );
      this.candidateComparisonLayer = this.createLayerFromLoaded(
        candidateLoaded,
        CANDIDATE_LAYER_ID,
        `Scenario B: ${candidateLoaded.scenario.name}`,
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

  private createLayerFromLoaded(
    loaded: LoadedSolution,
    layerId: string,
    title: string,
  ): InstanceType<typeof MediaLayer> {
    const [xmin, ymin, xmax, ymax] = loaded.rasterMeta.bbox;
    const imageElement = new ImageElement({
      image: loaded.canvas.toDataURL('image/png'),
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

    return new MediaLayer({
      id: layerId,
      source: [imageElement],
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
}
