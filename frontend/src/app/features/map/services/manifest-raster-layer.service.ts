import { Injectable, signal } from '@angular/core';
import Extent from '@arcgis/core/geometry/Extent';
import MediaLayer from '@arcgis/core/layers/MediaLayer';
import ImageElement from '@arcgis/core/layers/support/ImageElement';
import ExtentAndRotationGeoreference from '@arcgis/core/layers/support/ExtentAndRotationGeoreference';
import LocalMediaElementSource from '@arcgis/core/layers/support/LocalMediaElementSource';
import type ArcGISMap from '@arcgis/core/Map';
import type { RuntimeLayerManifestRenderingConfig } from '@core/models/layer-manifest.model';

/**
 * The OMEC and RUNAP overlays are special-cased: instead of rendering their
 * 1 km rasters (which produce chunky stair-stepped polygon edges), MapView
 * draws the original vector polygons via per-layer GeoJSONLayers and mirrors
 * the sidebar state below. The rasters are kept for live metrics only.
 */
export const OMEC_OVERLAY_LAYER_ID = 'overlay-omecs';
export const RUNAP_OVERLAY_LAYER_ID = 'overlay-runap';
export const RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID = 'overlay-runap-national-parks';
export const OMEC_VECTOR_OVERLAY_ARCGIS_LAYER_ID = 'map-view-omec-vector-layer';
export const RUNAP_VECTOR_OVERLAY_ARCGIS_LAYER_ID = 'map-view-runap-vector-layer';
export const RUNAP_NATIONAL_PARKS_VECTOR_OVERLAY_ARCGIS_LAYER_ID =
  'map-view-runap-national-parks-vector-layer';
export const VECTOR_OVERLAY_ARCGIS_LAYER_ID_BY_OVERLAY_ID: Readonly<Record<string, string>> = {
  [OMEC_OVERLAY_LAYER_ID]: OMEC_VECTOR_OVERLAY_ARCGIS_LAYER_ID,
  [RUNAP_OVERLAY_LAYER_ID]: RUNAP_VECTOR_OVERLAY_ARCGIS_LAYER_ID,
  [RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID]: RUNAP_NATIONAL_PARKS_VECTOR_OVERLAY_ARCGIS_LAYER_ID,
};
export const VECTOR_OVERLAY_LAYER_IDS: ReadonlySet<string> = new Set([
  OMEC_OVERLAY_LAYER_ID,
  RUNAP_OVERLAY_LAYER_ID,
  RUNAP_NATIONAL_PARKS_OVERLAY_LAYER_ID,
]);

export type VectorOverlayFillStyle = 'solid' | 'hatch' | 'mesh' | 'dots';
export type VectorOverlayBorderStyle = 'none' | 'solid' | 'dashed' | 'dotted';

export interface VectorOverlayState {
  visible: boolean;
  opacity: number;
  color: string;
  fillStyle: VectorOverlayFillStyle;
  fillDensity: number;
  borderColor: string;
  borderStyle: VectorOverlayBorderStyle;
  borderWidth: number;
}

/** Back-compat alias: existing consumers used `OmecOverlayState`. */
export type OmecOverlayState = VectorOverlayState;

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
  fillStyle?: VectorOverlayFillStyle;
  fillDensity?: number;
  borderColor?: string;
  borderStyle?: VectorOverlayBorderStyle;
  borderWidth?: number;
  rendering: RuntimeLayerManifestRenderingConfig;
}

const DEFAULT_BBOX: [number, number, number, number] = [-79.0, -4.5, -66.0, 13.5];
const RASTER_ALPHA = 255;

@Injectable({ providedIn: 'root' })
export class ManifestRasterLayerService {
  private map: InstanceType<typeof ArcGISMap> | null = null;
  private readonly layersById = new Map<string, InstanceType<typeof MediaLayer>>();
  private readonly rasterByUrl = new Map<string, Promise<LoadedManifestRaster>>();
  private readonly latestStateByLayerId = new Map<string, ManifestRasterLayerState>();
  private readonly loadingLayerIds = new Set<string>();

  /**
   * Latest sidebar state for every vector-rendered overlay (OMEC, RUNAP),
   * keyed by the overlay row id. Consumed by MapView to drive the per-overlay
   * GeoJSONLayer. Missing keys mean the row has not been synced yet.
   */
  readonly vectorOverlayStates$ = signal<Record<string, VectorOverlayState>>({});

  /** Back-compat: existing OMEC consumers read a single signal-style getter. */
  readonly omecOverlayState$ = signal<OmecOverlayState | null>(null);
  readonly renderedLayerRevision$ = signal(0);
  readonly isLayerRendering$ = signal(false);

  /** Convenience accessor for one overlay's current sidebar state. */
  getVectorOverlayState(layerId: string): VectorOverlayState | null {
    return this.vectorOverlayStates$()[layerId] ?? null;
  }

  initialize(map: InstanceType<typeof ArcGISMap>): void {
    this.map = map;
  }

  syncLayer(
    layerId: string,
    state: ManifestRasterLayerState,
    options: { selected: boolean } = { selected: false },
  ): void {
    if (VECTOR_OVERLAY_LAYER_IDS.has(layerId)) {
      // MapView renders these overlays from vector GeoJSON instead of the
      // raster, so we only forward sidebar state and ensure no MediaLayer
      // lingers from a previous render path.
      this.removeRenderedLayer(layerId);
      const nextState: VectorOverlayState = {
        visible: options.selected && state.visible,
        opacity: state.opacity,
        color: state.color,
        fillStyle: state.fillStyle ?? 'solid',
        fillDensity: state.fillDensity ?? 3,
        borderColor: state.borderColor ?? state.color,
        borderStyle: state.borderStyle ?? 'solid',
        borderWidth: state.borderWidth ?? 1,
      };
      this.vectorOverlayStates$.update((prev) => ({ ...prev, [layerId]: nextState }));
      if (layerId === OMEC_OVERLAY_LAYER_ID) {
        this.omecOverlayState$.set(nextState);
      }
      this.bumpRenderedLayerRevision();
      return;
    }

    this.latestStateByLayerId.set(layerId, state);

    if (!options.selected) {
      this.setLayerVisibility(layerId, false);
      return;
    }

    void this.ensureRenderedLayer(layerId, state).catch((error) => {
      console.error(`[ManifestRasterLayerService] failed to render "${layerId}"`, error);
    });
  }

  private removeRenderedLayer(layerId: string): void {
    const layer = this.layersById.get(layerId);
    if (!layer) {
      return;
    }
    if (this.map) {
      this.map.remove(layer);
    }
    this.layersById.delete(layerId);
    this.latestStateByLayerId.delete(layerId);
  }

  private async ensureRenderedLayer(
    layerId: string,
    state: ManifestRasterLayerState,
  ): Promise<void> {
    if (!this.map) {
      return;
    }

    this.setLayerLoading(layerId, true);
    try {
      const raster = await this.loadRaster(state.displayUrl);
      const latestState = this.latestStateByLayerId.get(layerId);
      if (!latestState || latestState.displayUrl !== state.displayUrl) {
        return;
      }

      const imageElement = this.createImageElement(raster, latestState);
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
        this.bumpRenderedLayerRevision();
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
      this.bumpRenderedLayerRevision();
    } finally {
      this.setLayerLoading(layerId, false);
    }
  }

  private bumpRenderedLayerRevision(): void {
    this.renderedLayerRevision$.update((revision) => revision + 1);
  }

  private setLayerLoading(layerId: string, isLoading: boolean): void {
    if (isLoading) {
      this.loadingLayerIds.add(layerId);
    } else {
      this.loadingLayerIds.delete(layerId);
    }
    this.isLayerRendering$.set(this.loadingLayerIds.size > 0);
  }

  private setLayerVisibility(layerId: string, visible: boolean): void {
    const layer = this.layersById.get(layerId);
    if (!layer) {
      return;
    }
    layer.visible = visible;
  }

  isLayerVisible(layerId: string): boolean {
    if (VECTOR_OVERLAY_LAYER_IDS.has(layerId)) {
      return !!this.vectorOverlayStates$()[layerId]?.visible;
    }
    const layer = this.layersById.get(layerId);
    return !!layer?.visible;
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

  private createImageElement(
    raster: LoadedManifestRaster,
    state: ManifestRasterLayerState,
  ): ImageElement {
    const canvas = this.rasterToCanvas(raster, state);
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

  private rasterToCanvas(
    raster: LoadedManifestRaster,
    state: ManifestRasterLayerState,
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = raster.width;
    canvas.height = raster.height;

    const context = canvas.getContext('2d');
    if (!context) {
      return canvas;
    }

    const imageData = context.createImageData(raster.width, raster.height);
    const pixels = imageData.data;
    const rendering = state.rendering;
    const noDataValue =
      typeof rendering.noDataValue === 'number' ? rendering.noDataValue : raster.noDataValue;
    const categoricalColorByValue = new Map(
      (rendering.classColors ?? []).map((entry) => [entry.value, entry.color]),
    );
    const gradientMinMax = this.resolveGradientMinMax(raster, noDataValue, rendering);
    const startColorRgb = this.hexToRgb(rendering.startColor ?? '') ?? [220, 252, 231];
    const endColorRgb = this.hexToRgb(rendering.endColor ?? '') ?? [22, 101, 52];
    const maskColorRgb = this.hexToRgb(rendering.selectedColor ?? '') ??
      this.hexToRgb(state.color) ?? [22, 163, 74];

    for (let index = 0; index < raster.values.length; index++) {
      const value = raster.values[index];
      const pixelOffset = index * 4;
      const isNoData =
        !Number.isFinite(value) || (typeof noDataValue === 'number' && value === noDataValue);
      if (isNoData) {
        pixels[pixelOffset + 3] = 0;
        continue;
      }
      if (rendering.renderMode === 'mask') {
        // Mask semantics:
        //   • numeric `selectedValue`  → render only pixels equal to that value (default 1).
        //   • explicit `null`          → "presence mask": render any non-zero, non-noData pixel.
        //                                Used for include_layers (e.g. conservation areas) whose
        //                                rasters are categorical mode codes rather than 0/1 binary.
        const selectedValue =
          rendering.selectedValue === null
            ? null
            : typeof rendering.selectedValue === 'number'
              ? rendering.selectedValue
              : 1;
        const isSelectedPixel = selectedValue === null ? value !== 0 : value === selectedValue;
        if (!isSelectedPixel) {
          pixels[pixelOffset + 3] = 0;
          continue;
        }
        pixels[pixelOffset] = maskColorRgb[0];
        pixels[pixelOffset + 1] = maskColorRgb[1];
        pixels[pixelOffset + 2] = maskColorRgb[2];
        pixels[pixelOffset + 3] = RASTER_ALPHA;
        continue;
      }

      if (rendering.renderMode === 'categorical') {
        const classColor = categoricalColorByValue.get(value);
        if (!classColor) {
          pixels[pixelOffset + 3] = 0;
          continue;
        }
        const [r, g, b] = this.hexToRgb(classColor) ?? maskColorRgb;
        pixels[pixelOffset] = r;
        pixels[pixelOffset + 1] = g;
        pixels[pixelOffset + 2] = b;
        pixels[pixelOffset + 3] = RASTER_ALPHA;
        continue;
      }

      const [gradientMin, gradientMax] = gradientMinMax;
      if (
        !Number.isFinite(gradientMin) ||
        !Number.isFinite(gradientMax) ||
        gradientMax <= gradientMin
      ) {
        pixels[pixelOffset + 3] = 0;
        continue;
      }
      const t = Math.max(0, Math.min(1, (value - gradientMin) / (gradientMax - gradientMin)));
      pixels[pixelOffset] = Math.round(startColorRgb[0] + (endColorRgb[0] - startColorRgb[0]) * t);
      pixels[pixelOffset + 1] = Math.round(
        startColorRgb[1] + (endColorRgb[1] - startColorRgb[1]) * t,
      );
      pixels[pixelOffset + 2] = Math.round(
        startColorRgb[2] + (endColorRgb[2] - startColorRgb[2]) * t,
      );
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

  private resolveGradientMinMax(
    raster: LoadedManifestRaster,
    noDataValue: number | null,
    rendering: RuntimeLayerManifestRenderingConfig,
  ): [number, number] {
    if (typeof rendering.minValue === 'number' && typeof rendering.maxValue === 'number') {
      return [rendering.minValue, rendering.maxValue];
    }

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (const value of raster.values) {
      const isNoData =
        !Number.isFinite(value) || (typeof noDataValue === 'number' && value === noDataValue);
      if (isNoData) {
        continue;
      }
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    }

    return [min, max];
  }
}
