import { Injectable } from '@angular/core';
import Extent from '@arcgis/core/geometry/Extent';
import MediaLayer from '@arcgis/core/layers/MediaLayer';
import ImageElement from '@arcgis/core/layers/support/ImageElement';
import ExtentAndRotationGeoreference from '@arcgis/core/layers/support/ExtentAndRotationGeoreference';
import LocalMediaElementSource from '@arcgis/core/layers/support/LocalMediaElementSource';
import type ArcGISMap from '@arcgis/core/Map';

interface LoadedManifestRaster {
  width: number;
  height: number;
  bbox: [number, number, number, number];
  values: Float64Array;
  noDataValue: number | null;
}

interface ManifestRasterLayerState {
  displayUrl: string;
  visible: boolean;
  opacity: number;
  color: string;
}

const DEFAULT_BBOX: [number, number, number, number] = [-79.0, -4.5, -66.0, 13.5];
const RASTER_ALPHA = 170;

@Injectable({ providedIn: 'root' })
export class ManifestRasterLayerService {
  private map: InstanceType<typeof ArcGISMap> | null = null;
  private readonly layersById = new Map<string, InstanceType<typeof MediaLayer>>();
  private readonly rasterByUrl = new Map<string, Promise<LoadedManifestRaster>>();
  private readonly latestStateByLayerId = new Map<string, ManifestRasterLayerState>();

  initialize(map: InstanceType<typeof ArcGISMap>): void {
    this.map = map;
  }

  syncLayer(
    layerId: string,
    state: ManifestRasterLayerState,
    options: { selected: boolean } = { selected: false },
  ): void {
    this.latestStateByLayerId.set(layerId, state);

    if (!options.selected) {
      this.setLayerVisibility(layerId, false);
      return;
    }

    void this.ensureRenderedLayer(layerId, state).catch((error) => {
      console.error(`[ManifestRasterLayerService] failed to render "${layerId}"`, error);
    });
  }

  private async ensureRenderedLayer(
    layerId: string,
    state: ManifestRasterLayerState,
  ): Promise<void> {
    if (!this.map) {
      return;
    }

    const raster = await this.loadRaster(state.displayUrl);
    const latestState = this.latestStateByLayerId.get(layerId);
    if (!latestState || latestState.displayUrl !== state.displayUrl) {
      return;
    }

    const imageElement = this.createImageElement(raster, latestState.color);
    const existingLayer = this.layersById.get(layerId);

    if (existingLayer) {
      const source = existingLayer.source;
      if (source instanceof LocalMediaElementSource) {
        source.elements.removeAll();
        source.elements.add(imageElement);
      } else {
        existingLayer.source = new LocalMediaElementSource({ elements: [imageElement] });
      }
      existingLayer.visible = latestState.visible;
      existingLayer.opacity = latestState.opacity;
      return;
    }

    const layer = new MediaLayer({
      id: layerId,
      source: new LocalMediaElementSource({ elements: [imageElement] }),
      visible: latestState.visible,
      opacity: latestState.opacity,
      title: layerId,
    });
    this.map.add(layer);
    this.layersById.set(layerId, layer);
  }

  private setLayerVisibility(layerId: string, visible: boolean): void {
    const layer = this.layersById.get(layerId);
    if (!layer) {
      return;
    }
    layer.visible = visible;
  }

  private async loadRaster(displayUrl: string): Promise<LoadedManifestRaster> {
    const cached = this.rasterByUrl.get(displayUrl);
    if (cached) {
      return cached;
    }

    const loadingPromise = (async () => {
      const response = await fetch(displayUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${displayUrl}: ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      const { fromArrayBuffer } = await import('geotiff');
      const tiff = await fromArrayBuffer(buffer);
      const image = await tiff.getImage();
      const values = (await image.readRasters({ samples: [0] }))[0] as Float64Array;
      const bboxArray = image.getBoundingBox();
      const bbox: [number, number, number, number] =
        bboxArray.length === 4
          ? [bboxArray[0], bboxArray[1], bboxArray[2], bboxArray[3]]
          : DEFAULT_BBOX;

      return {
        width: image.getWidth(),
        height: image.getHeight(),
        bbox,
        values,
        noDataValue: image.getGDALNoData(),
      };
    })();

    this.rasterByUrl.set(displayUrl, loadingPromise);
    return loadingPromise;
  }

  private createImageElement(raster: LoadedManifestRaster, colorHex: string): ImageElement {
    const canvas = this.rasterToCanvas(raster, colorHex);
    const [xmin, ymin, xmax, ymax] = raster.bbox;
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

  private rasterToCanvas(raster: LoadedManifestRaster, colorHex: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = raster.width;
    canvas.height = raster.height;

    const context = canvas.getContext('2d');
    if (!context) {
      return canvas;
    }

    const [r, g, b] = this.hexToRgb(colorHex) ?? [22, 163, 74];
    const imageData = context.createImageData(raster.width, raster.height);
    const pixels = imageData.data;

    const renderAsBinaryMask = raster.noDataValue === 255;

    for (let index = 0; index < raster.values.length; index++) {
      const value = raster.values[index];
      const pixelOffset = index * 4;
      const isNoData =
        !Number.isFinite(value) || (raster.noDataValue !== null && value === raster.noDataValue);
      if (isNoData) {
        pixels[pixelOffset + 3] = 0;
        continue;
      }

      // Most strategic-ecosystem masks use nodata=255 and selected=1.
      // Render these as strict binary masks to avoid flooding the map.
      const shouldRenderPixel = renderAsBinaryMask ? value === 1 : value > 0;
      if (!shouldRenderPixel) {
        pixels[pixelOffset + 3] = 0;
        continue;
      }

      pixels[pixelOffset] = r;
      pixels[pixelOffset + 1] = g;
      pixels[pixelOffset + 2] = b;
      pixels[pixelOffset + 3] = RASTER_ALPHA;
    }

    context.putImageData(imageData, 0, 0);
    return canvas;
  }

  private hexToRgb(hexColor: string): [number, number, number] | null {
    const normalized = hexColor.trim().toLowerCase();
    if (!/^#([0-9a-f]{6})$/.test(normalized)) {
      return null;
    }
    const intValue = Number.parseInt(normalized.slice(1), 16);
    return [(intValue >> 16) & 255, (intValue >> 8) & 255, intValue & 255];
  }
}
