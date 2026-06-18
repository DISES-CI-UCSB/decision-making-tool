import { inject, Injectable } from '@angular/core';

import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import type {
  LoadedSolution,
  RasterMetadata,
  CatalogSolution,
} from '@core/models/solution-catalog.model';

const NEW_COVERAGE_VALUE = 1;
const EXISTING_PROTECTED_VALUE = 2;
const EXISTING_PROTECTED_COLOR: [number, number, number, number] = [37, 99, 235, 180];
const NEW_COVERAGE_COLOR: [number, number, number, number] = [22, 163, 74, 180];
const NO_DATA_COLOR: [number, number, number, number] = [0, 0, 0, 0];

@Injectable({ providedIn: 'root' })
export class GeoTiffLoaderService {
  private readonly catalog = inject(SolutionCatalogService);
  private readonly fallbackWidth = 1200;
  private readonly fallbackHeight = 800;
  private readonly fallbackBbox: [number, number, number, number] = [-79.0, -4.5, -66.0, 13.5];
  private readonly countryValidCellCountByUrl = new Map<string, Promise<number | null>>();

  async loadSolution(solutionId: string): Promise<LoadedSolution> {
    const solution = this.catalog.getById(solutionId);
    if (!solution) {
      throw new Error(`Unknown solution: ${solutionId}`);
    }

    const t0 = performance.now();
    const url = this.catalog.getTifUrl(solution);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status}`);
      }
      const buffer = await response.arrayBuffer();

      const { fromArrayBuffer } = await import('geotiff');
      const tiff = await fromArrayBuffer(buffer);
      const image = await tiff.getImage();
      const rasterData = (await image.readRasters({ samples: [0] }))[0] as Float64Array;

      const countryValidCells =
        (await this.loadCountryValidCellCount(solution)) ??
        this.countValidCells(rasterData, image.getGDALNoData());
      const rasterMeta = this.extractMetadata(image, rasterData, solution, countryValidCells);
      const canvas = this.rasterToCanvas(rasterData, rasterMeta, solution);

      const loadTimeMs = Math.round(performance.now() - t0);
      return { solution, rasterMeta, rasterData, canvas, loadTimeMs };
    } catch (error) {
      if (!this.shouldUseSyntheticFallback(url)) {
        throw error;
      }
      // Keep map workflows unblocked only for explicit local dev asset paths.
      return this.buildFallbackSolution(solution, error, t0);
    }
  }

  private shouldUseSyntheticFallback(url: string): boolean {
    return url.startsWith('/');
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
    solution: CatalogSolution,
    countryValidCells: number,
  ): RasterMetadata {
    const width = image.getWidth();
    const height = image.getHeight();
    const bbox = image.getBoundingBox() as [number, number, number, number];
    const resolution: [number, number] = image.getResolution() as [number, number];

    const fileDir = image.fileDirectory as Record<string, unknown>;
    const geoKeys = (fileDir['geoKeys'] as Record<string, number> | undefined) ?? {};
    const epsg = geoKeys['GeographicTypeGeoKey'] ?? geoKeys['ProjectedCSTypeGeoKey'] ?? null;
    const crs = epsg ? `EPSG:${epsg}` : 'Unknown';
    const bandDesc = (fileDir['ImageDescription'] as string | undefined) ?? solution.costLayer;

    const noData = image.getGDALNoData();
    let selectedCount = 0;
    let totalValid = 0;

    for (const cellValue of data) {
      const isNoData = this.isNoDataValue(cellValue, noData);
      if (isNoData) continue;
      totalValid++;
      if (cellValue === NEW_COVERAGE_VALUE) selectedCount++;
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
      countryValidCells,
      newCoveragePctOfCountry:
        countryValidCells > 0 ? (selectedCount / countryValidCells) * 100 : 0,
    };
  }

  private loadCountryValidCellCount(solution: CatalogSolution): Promise<number | null> {
    const costLayer = this.catalog.getLayerById(
      solution.inputLayerIds.cost ?? solution.finderInputs.costLayerId,
    );
    const url = costLayer?.displayUrl?.trim();
    if (!url) {
      return Promise.resolve(null);
    }

    const cached = this.countryValidCellCountByUrl.get(url);
    if (cached) {
      return cached;
    }

    const loadPromise = this.countValidCellsFromRasterUrl(url).catch((error: unknown) => {
      console.warn(
        `[GeoTiffLoaderService] Failed to load country denominator raster "${url}".`,
        error,
      );
      this.countryValidCellCountByUrl.delete(url);
      return null;
    });
    this.countryValidCellCountByUrl.set(url, loadPromise);
    return loadPromise;
  }

  private async countValidCellsFromRasterUrl(url: string): Promise<number> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }

    const { fromArrayBuffer } = await import('geotiff');
    const tiff = await fromArrayBuffer(await response.arrayBuffer());
    const image = await tiff.getImage();
    const data = (await image.readRasters({ samples: [0] }))[0] as Float64Array;
    return this.countValidCells(data, image.getGDALNoData());
  }

  private countValidCells(data: Iterable<number>, noData: number | null): number {
    let totalValid = 0;
    for (const cellValue of data) {
      if (!this.isNoDataValue(cellValue, noData)) {
        totalValid++;
      }
    }
    return totalValid;
  }

  private isNoDataValue(cellValue: number, noData: number | null): boolean {
    return (
      !Number.isFinite(cellValue) ||
      (typeof noData === 'number' &&
        (Number.isNaN(noData) ? Number.isNaN(cellValue) : cellValue === noData))
    );
  }

  private rasterToCanvas(
    data: Float64Array,
    rasterMeta: RasterMetadata,
    solution: CatalogSolution,
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = rasterMeta.width;
    canvas.height = rasterMeta.height;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(rasterMeta.width, rasterMeta.height);
    const pixels = imageData.data;
    const classColorByValue = this.solutionClassColors(solution);

    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      const px = i * 4;
      const isNoData =
        !Number.isFinite(value) ||
        (typeof rasterMeta.noDataValue === 'number' && value === rasterMeta.noDataValue);
      const color = isNoData ? NO_DATA_COLOR : (classColorByValue.get(value) ?? NO_DATA_COLOR);
      pixels[px] = color[0];
      pixels[px + 1] = color[1];
      pixels[px + 2] = color[2];
      pixels[px + 3] = color[3];
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  private solutionClassColors(
    solution: CatalogSolution,
  ): Map<number, [number, number, number, number]> {
    const manifestClassColors =
      solution.rendering.renderMode === 'categorical' ? (solution.rendering.classColors ?? []) : [];
    const colorByValue = new Map<number, [number, number, number, number]>([
      [EXISTING_PROTECTED_VALUE, EXISTING_PROTECTED_COLOR],
      [NEW_COVERAGE_VALUE, NEW_COVERAGE_COLOR],
    ]);

    for (const entry of manifestClassColors) {
      const rgb = this.hexToRgb(entry.color);
      if (rgb) {
        colorByValue.set(entry.value, [...rgb, 180]);
      }
    }

    return colorByValue;
  }

  private hexToRgb(hexColor: string): [number, number, number] | null {
    const normalized = hexColor.trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(normalized)) {
      return null;
    }
    return [
      Number.parseInt(normalized.slice(1, 3), 16),
      Number.parseInt(normalized.slice(3, 5), 16),
      Number.parseInt(normalized.slice(5, 7), 16),
    ];
  }

  private buildFallbackSolution(
    solution: CatalogSolution,
    cause: unknown,
    loadStart: number,
  ): LoadedSolution {
    const width = this.fallbackWidth;
    const height = this.fallbackHeight;
    const totalCells = width * height;
    const selectedCount = Math.min(Math.max(0, solution.nSelected), totalCells);
    const rasterData = this.createDeterministicRaster(solution.id, totalCells, selectedCount);
    const [xmin, ymin, xmax, ymax] = this.fallbackBbox;
    const rasterMeta: RasterMetadata = {
      width,
      height,
      bbox: this.fallbackBbox,
      resolution: [(xmax - xmin) / width, (ymax - ymin) / height],
      crs: 'EPSG:4326',
      bandCount: 1,
      bandDescription: `${solution.costLayer} (fallback mock)`,
      noDataValue: 255,
      selectedCount,
      totalValidCells: totalCells,
      selectedPct: totalCells > 0 ? (selectedCount / totalCells) * 100 : 0,
      countryValidCells: totalCells,
      newCoveragePctOfCountry: totalCells > 0 ? (selectedCount / totalCells) * 100 : 0,
    };
    const canvas = this.rasterToCanvas(rasterData, rasterMeta, solution);

    console.warn(
      `[GeoTiffLoaderService] Falling back to synthetic raster for "${solution.id}" because GeoTIFF load failed.`,
      cause,
    );

    return {
      solution,
      rasterMeta,
      rasterData,
      canvas,
      loadTimeMs: Math.round(performance.now() - loadStart),
    };
  }

  private createDeterministicRaster(
    solutionId: string,
    totalCells: number,
    selectedCount: number,
  ): Float64Array {
    const data = new Float64Array(totalCells);
    data.fill(255);
    if (selectedCount <= 0 || totalCells <= 0) {
      return data;
    }

    const hash = Array.from(solutionId).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    // Use a coprime stride so this cycles across the full array before repeating.
    const stride = 104729;
    const offset = hash % totalCells;

    for (let i = 0; i < selectedCount; i++) {
      const index = (offset + i * stride) % totalCells;
      data[index] = NEW_COVERAGE_VALUE;
    }

    return data;
  }
}
