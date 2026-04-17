import { effect, inject, Injectable, signal } from '@angular/core';
import Graphic from '@arcgis/core/Graphic';
import type Geometry from '@arcgis/core/geometry/Geometry';
import type Multipoint from '@arcgis/core/geometry/Multipoint';
import Polygon from '@arcgis/core/geometry/Polygon';
import type Point from '@arcgis/core/geometry/Point';
import type Polyline from '@arcgis/core/geometry/Polyline';
import * as geometryEngine from '@arcgis/core/geometry/geometryEngine';
import FeatureLayer from '@arcgis/core/layers/FeatureLayer';
import GeoJSONLayer from '@arcgis/core/layers/GeoJSONLayer';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import type ArcGISMap from '@arcgis/core/Map';
import type ArcGISMapView from '@arcgis/core/views/MapView';
import type { ViewHit } from '@arcgis/core/views/types';

import { type AoiType } from '@core/models';
import { AppStateService } from '@core/services/app-state.service';

interface BoundaryConfig {
  id: string;
  title: string;
  type: AoiType;
  sourceType: 'feature' | 'geojson';
  url: string;
  idFields: string[];
  nameFields: string[];
  definitionExpression?: string;
  visible?: boolean;
  opacity?: number;
  minScale?: number;
  maxScale?: number;
  renderer?: Record<string, unknown>;
}

interface HitTestCandidate {
  config: BoundaryConfig;
  attributes: Record<string, unknown>;
  geometry: Geometry | null;
}

export type SirapSelectionScope = 'part' | 'whole';

const COLOMBIA_BOUNDARY_CONFIGS: BoundaryConfig[] = [
  {
    id: 'aoi-departments-colombia',
    title: 'Colombia Departments (IGAC)',
    type: 'department',
    sourceType: 'feature',
    url: 'https://mapas2.igac.gov.co/server/rest/services/limites/limites/MapServer/2',
    idFields: ['DeCodigo', 'OBJECTID'],
    nameFields: ['DeNombre'],
    visible: false,
    opacity: 0.7,
    renderer: {
      type: 'simple',
      symbol: {
        type: 'simple-fill',
        color: [0, 0, 0, 0],
        outline: {
          color: [17, 24, 39, 235],
          width: 1,
        },
      },
    },
  },
  {
    id: 'aoi-municipalities-colombia',
    title: 'Colombia Municipalities (IGAC)',
    type: 'municipality',
    sourceType: 'feature',
    url: 'https://mapas2.igac.gov.co/server/rest/services/limites/limites/MapServer/1',
    idFields: ['MpCodigo', 'OBJECTID'],
    nameFields: ['MpNombre'],
    visible: false,
    opacity: 0.45,
    renderer: {
      type: 'simple',
      symbol: {
        type: 'simple-fill',
        color: [0, 0, 0, 0],
        outline: {
          color: [17, 24, 39, 235],
          width: 1,
        },
      },
    },
  },
  {
    id: 'aoi-sirap-colombia',
    title: 'Colombia SIRAP Regions',
    type: 'sirap',
    sourceType: 'geojson',
    url: '/data/sirap-regions.geojson',
    idFields: ['sirap'],
    nameFields: ['sirap'],
    visible: false,
    opacity: 0.95,
    minScale: 0,
    maxScale: 0,
    // Use a bold style so SIRAP-related polygons are visible at national view.
    renderer: {
      type: 'simple',
      symbol: {
        type: 'simple-fill',
        color: [0, 0, 0, 0],
        outline: {
          color: [17, 24, 39, 235],
          width: 1,
          style: 'long-dash',
        },
      },
    },
  },
];

@Injectable({ providedIn: 'root' })
export class AdminBoundaryService {
  private readonly appState = inject(AppStateService);
  private map: InstanceType<typeof ArcGISMap> | null = null;
  private view: InstanceType<typeof ArcGISMapView> | null = null;
  private boundaryLayers: (FeatureLayer | GeoJSONLayer)[] = [];
  private aoiHighlightLayer: GraphicsLayer | null = null;
  private viewClickHandle: { remove: () => void } | null = null;
  private lastSelectionCandidate: HitTestCandidate | null = null;
  private lastClickPoint: InstanceType<typeof Point> | null = null;
  private readonly defaultVisibilityByType: Record<AoiType, boolean> = {
    sirap: false,
    department: true,
    municipality: false,
  };
  readonly layerVisibilityByType$ = signal<Record<AoiType, boolean>>(this.defaultVisibilityByType);
  readonly popupEnabled$ = signal(false);
  readonly sirapSelectionScope$ = signal<SirapSelectionScope>('part');
  private readonly unavailableBoundaryTypes = new Set<AoiType>();

  constructor() {
    effect(() => {
      if (this.appState.selectedAOI$() === null) {
        this.lastSelectionCandidate = null;
        this.lastClickPoint = null;
        this.clearSelectionHighlight();
      }
    });
  }

  initialize(map: InstanceType<typeof ArcGISMap>, view: InstanceType<typeof ArcGISMapView>): void {
    if (this.boundaryLayers.length > 0) {
      return;
    }

    this.map = map;
    this.view = view;
    // Always false — we open popups manually via openPopup() so the
    // built-in click handler doesn't race with ours.
    this.view.popupEnabled = false;
    // Create only default-visible layers on startup. Remote IGAC FeatureLayers are loaded lazily
    // when users explicitly toggle them on, which avoids noisy startup CORS errors.
    this.boundaryLayers = COLOMBIA_BOUNDARY_CONFIGS.filter(
      (config) => this.layerVisibilityByType$()[config.type] ?? config.visible ?? true,
    ).map((config) => this.buildLayer(config));
    if (this.boundaryLayers.length > 0) {
      map.addMany(this.boundaryLayers);
    }
    this.aoiHighlightLayer = new GraphicsLayer({
      id: 'aoi-selection-highlight-layer',
      title: 'AOI Selection Highlight',
      listMode: 'hide',
    });
    map.add(this.aoiHighlightLayer);
    for (const layer of this.boundaryLayers) {
      void view.whenLayerView(layer).catch((error: unknown) => {
        console.error(`[AdminBoundaryService] failed to create layerview for "${layer.id}"`, error);
      });
    }
    this.viewClickHandle = view.on('click', (event) => {
      void this.handleMapClick(view, event.mapPoint, event.x, event.y);
    });
  }

  destroy(map: InstanceType<typeof ArcGISMap> | null): void {
    this.viewClickHandle?.remove();
    this.viewClickHandle = null;

    if (map && this.boundaryLayers.length > 0) {
      map.removeMany(this.boundaryLayers);
    }
    if (map && this.aoiHighlightLayer) {
      map.remove(this.aoiHighlightLayer);
    }

    this.map = null;
    this.view = null;
    this.boundaryLayers = [];
    this.aoiHighlightLayer = null;
  }

  setLayerVisibility(type: AoiType, visible: boolean): void {
    if (type === 'sirap' && visible && !this.appState.canAccessSirapBoundaries()) {
      this.layerVisibilityByType$.update((state) => ({ ...state, [type]: false }));
      return;
    }

    if (visible) {
      this.ensureLayersForType(type);
      if (this.unavailableBoundaryTypes.has(type)) {
        this.layerVisibilityByType$.update((state) => ({ ...state, [type]: false }));
        return;
      }
    }
    this.layerVisibilityByType$.update((state) => ({ ...state, [type]: visible }));
    this.applyVisibilityToMapLayers(type, visible);
    if (visible) {
      this.bringTypeLayersToFront(type);
    }
  }

  toggleLayerVisibility(type: AoiType): void {
    const current = this.layerVisibilityByType$()[type];
    this.setLayerVisibility(type, !current);
  }

  setPopupEnabled(enabled: boolean): void {
    this.popupEnabled$.set(enabled);
    if (!enabled) {
      this.view?.closePopup();
    }
  }

  togglePopupEnabled(): void {
    this.setPopupEnabled(!this.popupEnabled$());
  }

  setSirapSelectionScope(scope: SirapSelectionScope): void {
    if (this.sirapSelectionScope$() === scope) {
      return;
    }

    this.sirapSelectionScope$.set(scope);
    this.refreshSelectionForScope();
  }

  private buildLayer(config: BoundaryConfig): FeatureLayer | GeoJSONLayer {
    const preferredVisibility = this.layerVisibilityByType$()[config.type];
    const commonLayerProps = {
      id: config.id,
      title: config.title,
      visible: preferredVisibility ?? config.visible ?? true,
      opacity: config.opacity ?? 1,
      minScale: config.minScale ?? 0,
      maxScale: config.maxScale ?? 0,
      renderer: config.renderer as never,
    };

    if (config.sourceType === 'geojson') {
      return new GeoJSONLayer({
        ...commonLayerProps,
        url: config.url,
        outFields: ['*'],
      });
    }

    return new FeatureLayer({
      ...commonLayerProps,
      url: config.url,
      outFields: ['*'],
      definitionExpression: config.definitionExpression,
      renderer: this.getBoundaryRenderer(config.type) as never,
    });
  }

  private ensureLayersForType(type: AoiType): void {
    if (!this.map || !this.view) {
      return;
    }
    if (this.unavailableBoundaryTypes.has(type)) {
      return;
    }

    const existing = this.boundaryLayers.some((layer) => {
      const config = COLOMBIA_BOUNDARY_CONFIGS.find((item) => item.id === layer.id);
      return config?.type === type;
    });
    if (existing) {
      return;
    }

    const configsForType = COLOMBIA_BOUNDARY_CONFIGS.filter((config) => config.type === type);
    if (configsForType.length === 0) {
      return;
    }

    const newLayers = configsForType.map((config) => this.buildLayer(config));
    this.boundaryLayers = [...this.boundaryLayers, ...newLayers];
    this.map.addMany(newLayers);

    for (const layer of newLayers) {
      void this.view.whenLayerView(layer).catch((error: unknown) => {
        console.warn(
          `[AdminBoundaryService] "${layer.id}" unavailable (likely CORS/remote service issue); disabling ${type} boundary.`,
          error,
        );
        this.unavailableBoundaryTypes.add(type);
        this.removeLayerById(layer.id);
        this.layerVisibilityByType$.update((state) => ({ ...state, [type]: false }));
      });
    }
  }

  private removeLayerById(layerId: string): void {
    const index = this.boundaryLayers.findIndex((layer) => layer.id === layerId);
    if (index < 0) {
      return;
    }

    const [layer] = this.boundaryLayers.splice(index, 1);
    if (this.map) {
      this.map.remove(layer);
    }
    layer.destroy();
  }

  private async handleMapClick(
    view: InstanceType<typeof ArcGISMapView>,
    mapPoint: InstanceType<typeof Point>,
    screenX: number,
    screenY: number,
  ): Promise<void> {
    const interactiveLayers = this.boundaryLayers.filter((layer) => layer.visible);
    if (interactiveLayers.length === 0) {
      this.clearSelectionState();
      return;
    }

    const hit = await view.hitTest({ x: screenX, y: screenY }, { include: interactiveLayers });
    if (!hit.results.length) {
      this.clearSelectionState();
      return;
    }

    const candidate = this.resolveCandidate(hit.results);
    if (!candidate) {
      this.clearSelectionState();
      return;
    }
    if (candidate.config.type === 'sirap' && !this.appState.canAccessSirapBoundaries()) {
      this.clearSelectionState();
      return;
    }

    const aoiName = this.readFirstText(candidate.attributes, candidate.config.nameFields);
    const rawId = this.readFirstText(candidate.attributes, candidate.config.idFields);
    const displayName = aoiName ?? 'Unnamed feature';

    if (this.popupEnabled$()) {
      try {
        await view.openPopup({
          title: `${candidate.config.type.toUpperCase()}: ${displayName}`,
          content: this.buildPopupMetadataHtml(candidate.attributes),
          location: mapPoint,
        });
      } catch (error: unknown) {
        console.error('[AdminBoundaryService] openPopup failed:', error);
      }
    }

    if (!aoiName || !rawId) {
      return;
    }

    this.lastSelectionCandidate = candidate;
    this.lastClickPoint = mapPoint;
    const selectionGeometry = this.resolveSelectionGeometry(
      candidate.geometry,
      mapPoint,
      candidate.config.type,
    );

    this.setSelectionHighlight(selectionGeometry);
    await this.zoomToSelection(view, selectionGeometry);
    this.appState.selectAOI({
      id: `${candidate.config.type}:${rawId}`,
      name: aoiName,
      type: candidate.config.type,
      geometryUrl: candidate.config.url,
    });
    this.appState.setRightSidebarMode('aoi');
  }

  private resolveCandidate(results: ViewHit[]): HitTestCandidate | null {
    let bestCandidate: HitTestCandidate | null = null;
    let bestLayerIndex = -1;

    for (const result of results) {
      if (result.type !== 'graphic') {
        continue;
      }

      const layerId = result.graphic.layer?.id;
      if (typeof layerId !== 'string') {
        continue;
      }

      const config = COLOMBIA_BOUNDARY_CONFIGS.find((item) => item.id === layerId);
      if (!config) {
        continue;
      }

      const attributes = (result.graphic.attributes ?? {}) as Record<string, unknown>;
      const layerIndex = this.getLayerIndex(layerId);
      if (layerIndex >= bestLayerIndex) {
        bestLayerIndex = layerIndex;
        bestCandidate = { config, attributes, geometry: result.graphic.geometry ?? null };
      }
    }

    return bestCandidate;
  }

  private readFirstText(
    attributes: Record<string, unknown>,
    fieldCandidates: string[],
  ): string | null {
    for (const fieldName of fieldCandidates) {
      const value = attributes[fieldName];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
    }

    return null;
  }

  private buildPopupMetadataHtml(attributes: Record<string, unknown>): string {
    const rows = Object.entries(attributes)
      .filter(([key, value]) => {
        if (value === null || value === undefined) return false;
        const lowered = key.toLowerCase();
        return lowered !== 'shape' && lowered !== 'geometry' && lowered !== 'st_area(shape)';
      })
      .slice(0, 10)
      .map(
        ([key, value]) =>
          `<tr><td style="padding:2px 8px 2px 0;font-weight:600;">${this.escapeHtml(key)}</td><td style="padding:2px 0;">${this.escapeHtml(String(value))}</td></tr>`,
      )
      .join('');

    if (!rows) {
      return 'No metadata available for this feature.';
    }

    return `<table style="font-size:12px;border-collapse:collapse;">${rows}</table>`;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  private applyVisibilityToMapLayers(type: AoiType, visible: boolean): void {
    for (const layer of this.boundaryLayers) {
      const config = COLOMBIA_BOUNDARY_CONFIGS.find((item) => item.id === layer.id);
      if (config?.type === type) {
        layer.visible = visible;
      }
    }
  }

  private bringTypeLayersToFront(type: AoiType): void {
    if (!this.map) {
      return;
    }

    const layersForType = this.boundaryLayers.filter((layer) => {
      const config = COLOMBIA_BOUNDARY_CONFIGS.find((item) => item.id === layer.id);
      return config?.type === type;
    });

    for (const layer of layersForType) {
      this.map.reorder(layer, this.map.layers.length - 1);
    }
  }

  private getBoundaryRenderer(type: AoiType): Record<string, unknown> | null {
    if (type === 'department') {
      return {
        type: 'simple',
        symbol: {
          type: 'simple-fill',
          color: [0, 0, 0, 0],
          outline: {
            color: [76, 0, 115, 255],
            width: 1,
            style: 'solid',
          },
        },
      };
    }

    if (type === 'municipality') {
      return {
        type: 'simple',
        symbol: {
          type: 'simple-fill',
          color: [0, 0, 0, 0],
          outline: {
            color: [71, 85, 105, 220],
            width: 1,
            style: 'solid',
          },
        },
      };
    }

    return null;
  }

  private setSelectionHighlight(selectionGeometry: Geometry | null): void {
    if (!this.aoiHighlightLayer || !selectionGeometry) {
      return;
    }

    // Keep the selection highlight on top of all map layers so it remains visible
    // even when AOI base layers use strong outlines.
    if (this.map) {
      this.map.reorder(this.aoiHighlightLayer, this.map.layers.length - 1);
    }

    this.aoiHighlightLayer.removeAll();
    this.aoiHighlightLayer.add(
      new Graphic({
        geometry: selectionGeometry,
        symbol: this.getHighlightSymbol(selectionGeometry) as never,
      }),
    );
  }

  private clearSelectionHighlight(): void {
    this.aoiHighlightLayer?.removeAll();
  }

  private clearSelectionState(): void {
    this.clearSelectionHighlight();
    this.appState.clearAOI();
    this.appState.setRightSidebarMode(this.appState.hasActiveSolution() ? 'overview' : 'welcome');
  }

  private getLayerIndex(layerId: string): number {
    return this.map?.layers.findIndex((layer) => layer.id === layerId) ?? -1;
  }

  private getHighlightSymbol(geometry: Geometry): Record<string, unknown> {
    if (geometry.type === 'polyline') {
      return {
        type: 'simple-line',
        color: [37, 99, 235, 255],
        width: 3,
        style: 'solid',
      };
    }

    if (geometry.type === 'point' || geometry.type === 'multipoint') {
      return {
        type: 'simple-marker',
        color: [37, 99, 235, 255],
        size: 12,
        outline: {
          color: [255, 255, 255, 255],
          width: 1.5,
        },
      };
    }

    return {
      type: 'simple-fill',
      color: [59, 130, 246, 0],
      outline: {
        color: [37, 99, 235, 255],
        width: 2,
        style: 'solid',
      },
    };
  }

  private resolveSelectionGeometry(
    geometry: Geometry | null,
    clickedPoint: InstanceType<typeof Point>,
    aoiType: AoiType,
  ): Geometry | null {
    if (!geometry) {
      return null;
    }

    const isWholeSirapSelection = aoiType === 'sirap' && this.sirapSelectionScope$() === 'whole';
    if (geometry.type !== 'polygon' || isWholeSirapSelection) {
      return geometry;
    }

    const polygon = geometry as Polygon;
    if (polygon.rings.length <= 1) {
      return geometry;
    }

    for (const ring of polygon.rings) {
      const ringPolygon = new Polygon({
        rings: [ring],
        spatialReference: polygon.spatialReference,
        hasM: polygon.hasM,
        hasZ: polygon.hasZ,
      });

      if (geometryEngine.contains(ringPolygon, clickedPoint)) {
        return ringPolygon;
      }
    }

    return geometry;
  }

  private async zoomToSelection(
    view: InstanceType<typeof ArcGISMapView>,
    selectionGeometry: Geometry | null,
  ): Promise<void> {
    if (!selectionGeometry) {
      return;
    }

    const target =
      selectionGeometry.extent?.clone().expand(1.25) ?? this.toGoToGeometry(selectionGeometry);
    if (!target) {
      return;
    }

    try {
      await view.goTo(target, {
        animate: true,
        duration: 450,
        easing: 'ease-in-out',
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      console.error('[AdminBoundaryService] zoomToSelection failed:', error);
    }
  }

  private toGoToGeometry(geometry: Geometry): Point | Polygon | Polyline | Multipoint | null {
    if (
      geometry.type === 'point' ||
      geometry.type === 'polygon' ||
      geometry.type === 'polyline' ||
      geometry.type === 'multipoint'
    ) {
      return geometry as Point | Polygon | Polyline | Multipoint;
    }

    return null;
  }

  private refreshSelectionForScope(): void {
    const candidate = this.lastSelectionCandidate;
    const clickedPoint = this.lastClickPoint;
    const view = this.view;
    if (!candidate || !candidate.geometry || !clickedPoint || !view) {
      return;
    }

    const selectionGeometry = this.resolveSelectionGeometry(
      candidate.geometry,
      clickedPoint,
      candidate.config.type,
    );
    this.setSelectionHighlight(selectionGeometry);
    void this.zoomToSelection(view, selectionGeometry);
  }
}
