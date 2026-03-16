import { inject, Injectable } from '@angular/core';

import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import type {
  LoadedSolution,
  RasterMetadata,
  SolutionScenario,
} from '@core/models/solution-scenario.model';

const SELECTED_COLOR: [number, number, number, number] = [22, 163, 74, 180];
const NO_DATA_COLOR: [number, number, number, number] = [0, 0, 0, 0];

@Injectable({ providedIn: 'root' })
export class GeoTiffLoaderService {
  private readonly catalog = inject(SolutionCatalogService);

  async loadSolution(scenarioId: string): Promise<LoadedSolution> {
    const scenario = this.catalog.getById(scenarioId);
    if (!scenario) {
      throw new Error(`Unknown scenario: ${scenarioId}`);
    }

    const t0 = performance.now();
    const url = this.catalog.getTifUrl(scenario);

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
    const buffer = await response.arrayBuffer();

    const { fromArrayBuffer } = await import('geotiff');
    const tiff = await fromArrayBuffer(buffer);
    const image = await tiff.getImage();
    const rasterData = (await image.readRasters({ samples: [0] }))[0] as Float64Array;

    const rasterMeta = this.extractMetadata(image, rasterData, scenario);
    const canvas = this.rasterToCanvas(rasterData, rasterMeta.width, rasterMeta.height);

    const loadTimeMs = Math.round(performance.now() - t0);

    return { scenario, rasterMeta, rasterData, canvas, loadTimeMs };
  }

  private extractMetadata(
    image: {
      fileDirectory: unknown;
      getWidth(): number;
      getHeight(): number;
      getBoundingBox(): number[];
      getResolution(): number[];
      getSamplesPerPixel(): number;
      getGDALNoData(): number | null;
    },
    data: Float64Array,
    scenario: SolutionScenario,
  ): RasterMetadata {
    const width = image.getWidth();
    const height = image.getHeight();
    const bbox = image.getBoundingBox() as [number, number, number, number];
    const resolution: [number, number] = image.getResolution() as [number, number];

    const fileDir = image.fileDirectory as Record<string, unknown>;
    const geoKeys = (fileDir['geoKeys'] as Record<string, number> | undefined) ?? {};
    const epsg = geoKeys['GeographicTypeGeoKey'] ?? geoKeys['ProjectedCSTypeGeoKey'] ?? null;
    const crs = epsg ? `EPSG:${epsg}` : 'Unknown';
    const bandDesc = (fileDir['ImageDescription'] as string | undefined) ?? scenario.costLayer;

    let selectedCount = 0;
    let totalValid = 0;
    const noData = image.getGDALNoData();

    for (const cellValue of data) {
      if (noData !== null && cellValue === noData) continue;
      totalValid++;
      if (cellValue === 1) selectedCount++;
    }

    return {
      width,
      height,
      bbox,
      resolution,
      crs,
      bandCount: image.getSamplesPerPixel(),
      bandDescription: bandDesc,
      noDataValue: noData,
      selectedCount,
      totalValidCells: totalValid,
      selectedPct: totalValid > 0 ? (selectedCount / totalValid) * 100 : 0,
    };
  }

  private rasterToCanvas(data: Float64Array, width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(width, height);
    const pixels = imageData.data;

    for (let i = 0; i < data.length; i++) {
      const px = i * 4;
      const color = data[i] === 1 ? SELECTED_COLOR : NO_DATA_COLOR;
      pixels[px] = color[0];
      pixels[px + 1] = color[1];
      pixels[px + 2] = color[2];
      pixels[px + 3] = color[3];
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }
}
