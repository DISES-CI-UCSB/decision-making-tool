import { inject, Injectable, signal } from '@angular/core';
import Extent from '@arcgis/core/geometry/Extent';
import MediaLayer from '@arcgis/core/layers/MediaLayer';
import ImageElement from '@arcgis/core/layers/support/ImageElement';
import ExtentAndRotationGeoreference from '@arcgis/core/layers/support/ExtentAndRotationGeoreference';

import type ArcGISMap from '@arcgis/core/Map';
import type { LoadedSolution } from '@core/models/solution-scenario.model';
import { GeoTiffLoaderService } from './geotiff-loader.service';

const SOLUTION_LAYER_ID = 'solution-raster-layer';

@Injectable({ providedIn: 'root' })
export class SolutionLayerService {
  private readonly loader = inject(GeoTiffLoaderService);
  private map: InstanceType<typeof ArcGISMap> | null = null;
  private currentLayer: InstanceType<typeof MediaLayer> | null = null;

  readonly loadedSolution$ = signal<LoadedSolution | null>(null);
  readonly isLoading$ = signal(false);
  readonly loadError$ = signal<string | null>(null);

  initialize(map: InstanceType<typeof ArcGISMap>): void {
    this.map = map;
  }

  async showSolution(scenarioId: string): Promise<void> {
    if (!this.map) {
      console.error('[SolutionLayerService] map not initialized');
      return;
    }

    this.isLoading$.set(true);
    this.loadError$.set(null);

    try {
      this.removeSolutionLayer();

      const loaded = await this.loader.loadSolution(scenarioId);
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

      this.currentLayer = new MediaLayer({
        id: SOLUTION_LAYER_ID,
        source: [imageElement],
        opacity: 0.7,
        title: loaded.scenario.name,
      });

      this.map.add(this.currentLayer);
      this.loadedSolution$.set(loaded);

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

  removeSolutionLayer(): void {
    if (this.currentLayer && this.map) {
      this.map.remove(this.currentLayer);
      this.currentLayer.destroy();
      this.currentLayer = null;
    }
    this.loadedSolution$.set(null);
  }

  setOpacity(opacity: number): void {
    if (this.currentLayer) {
      this.currentLayer.opacity = Math.max(0, Math.min(1, opacity));
    }
  }
}
