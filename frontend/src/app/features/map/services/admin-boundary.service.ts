import { computed, effect, inject, Injectable, signal } from '@angular/core';
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
import { FEATURE_FLAGS } from '@feature-flags';

interface BoundaryConfig {
  id: string;
  layerKey: AdminBoundaryLayerKey;
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
export type AdminBoundaryLayerKey =
  | 'siraps'
  | 'siraps_territorial'
  | 'siraps_thematic'
  | 'admin_departments'
  | 'admin_municipalities';

interface BoundaryStyle {
  color: [number, number, number, number];
  width: number;
  style: 'solid' | 'long-dash';
}

const PUBLIC_BLOB_HOST = 'https://aagibolq28slyfof.public.blob.vercel-storage.com';
const DEFAULT_ADMIN_BOUNDARY_HEX = '#111827';
const DEFAULT_ADMIN_BOUNDARY_OUTLINE_COLOR: BoundaryStyle['color'] = [17, 24, 39, 235];
const DEFAULT_SIRAP_TERRITORIAL_COLOR: BoundaryStyle['color'] = [37, 99, 235, 235];
const DEFAULT_SIRAP_THEMATIC_COLOR: BoundaryStyle['color'] = [147, 51, 234, 235];
const DEFAULT_BOUNDARY_STYLE_BY_LAYER_KEY: Record<AdminBoundaryLayerKey, BoundaryStyle> = {
  siraps: { color: DEFAULT_ADMIN_BOUNDARY_OUTLINE_COLOR, width: 1.25, style: 'long-dash' },
  siraps_territorial: { color: DEFAULT_SIRAP_TERRITORIAL_COLOR, width: 1.25, style: 'solid' },
  siraps_thematic: { color: DEFAULT_SIRAP_THEMATIC_COLOR, width: 1.25, style: 'long-dash' },
  admin_departments: { color: DEFAULT_ADMIN_BOUNDARY_OUTLINE_COLOR, width: 1, style: 'solid' },
  admin_municipalities: { color: DEFAULT_ADMIN_BOUNDARY_OUTLINE_COLOR, width: 1, style: 'solid' },
};

const COLOMBIA_BOUNDARY_CONFIGS: BoundaryConfig[] = [
  {
    id: 'aoi-departments-colombia',
    layerKey: 'admin_departments',
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
          color: DEFAULT_ADMIN_BOUNDARY_OUTLINE_COLOR,
          width: 1,
        },
      },
    },
  },
  {
    id: 'aoi-municipalities-colombia',
    layerKey: 'admin_municipalities',
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
          color: DEFAULT_ADMIN_BOUNDARY_OUTLINE_COLOR,
          width: 1,
        },
      },
    },
  },
  {
    id: 'aoi-siraps-combined-colombia',
    layerKey: 'siraps',
    title: 'Colombia SIRAPs - Combined Review Layer',
    type: 'sirap',
    sourceType: 'geojson',
    url: `${PUBLIC_BLOB_HOST}/inputs/boundaries/sirap/siraps_merged.geojson`,
    idFields: ['sirap_id', 'sirap_name', 'nombre', 'sirap'],
    nameFields: ['sirap_name', 'nombre', 'sirap'],
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
          color: DEFAULT_ADMIN_BOUNDARY_OUTLINE_COLOR,
          width: 2,
          style: 'long-dash',
        },
      },
    },
  },
  {
    id: 'aoi-siraps-territorial-colombia',
    layerKey: 'siraps_territorial',
    title: 'Colombia SIRAPs - Territorial',
    type: 'sirap',
    sourceType: 'geojson',
    url: `${PUBLIC_BLOB_HOST}/inputs/boundaries/sirap/siraps_territorial.geojson`,
    idFields: ['sirap_id', 'sirap_name', 'nombre', 'sirap'],
    nameFields: ['sirap_name', 'nombre', 'sirap'],
    visible: false,
    opacity: 0.95,
    minScale: 0,
    maxScale: 0,
  },
  {
    id: 'aoi-siraps-thematic-colombia',
    layerKey: 'siraps_thematic',
    title: 'Colombia SIRAPs - Thematic Additions',
    type: 'sirap',
    sourceType: 'geojson',
    url: `${PUBLIC_BLOB_HOST}/inputs/boundaries/sirap/siraps_thematic.geojson`,
    idFields: ['sirap_id', 'sirap_name', 'Tematico', 'sirap'],
    nameFields: ['sirap_name', 'Tematico', 'sirap'],
    visible: false,
    opacity: 0.95,
    minScale: 0,
    maxScale: 0,
  },
];

// Single enforcement point for SIRAP layer feature flags. Disabled layers are
// excluded here and never registered on the map or reachable via hit-test.
const SIRAP_LAYER_ENABLED_BY_KEY: Partial<Record<AdminBoundaryLayerKey, boolean>> = {
  siraps: FEATURE_FLAGS.sirapLayers.combined,
  siraps_territorial: FEATURE_FLAGS.sirapLayers.territorial,
  siraps_thematic: FEATURE_FLAGS.sirapLayers.thematic,
};
const ENABLED_BOUNDARY_CONFIGS = COLOMBIA_BOUNDARY_CONFIGS.filter(
  (config) => config.type !== 'sirap' || (SIRAP_LAYER_ENABLED_BY_KEY[config.layerKey] ?? true),
);

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
  private readonly defaultVisibilityByLayerKey: Record<AdminBoundaryLayerKey, boolean> = {
    siraps: false,
    siraps_territorial: false,
    siraps_thematic: false,
    admin_departments: true,
    admin_municipalities: false,
  };
  readonly layerVisibilityByLayerKey$ = signal<Record<AdminBoundaryLayerKey, boolean>>(
    this.defaultVisibilityByLayerKey,
  );
  readonly layerVisibilityByType$ = computed<Record<AoiType, boolean>>(() => {
    const state = this.layerVisibilityByLayerKey$();
    return {
      sirap: state.siraps || state.siraps_territorial || state.siraps_thematic,
      department: state.admin_departments,
      municipality: state.admin_municipalities,
      omec: false,
    };
  });
  readonly popupEnabled$ = signal(false);
  readonly sirapSelectionScope$ = signal<SirapSelectionScope>('part');
  private readonly boundaryStyleByLayerKey = signal<Record<AdminBoundaryLayerKey, BoundaryStyle>>(
    DEFAULT_BOUNDARY_STYLE_BY_LAYER_KEY,
  );
  private readonly unavailableBoundaryLayerKeys = new Set<AdminBoundaryLayerKey>();

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
    this.boundaryLayers = ENABLED_BOUNDARY_CONFIGS.filter(
      (config) => this.layerVisibilityByLayerKey$()[config.layerKey] ?? config.visible ?? true,
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

  /** Returns ArcGIS layer IDs currently loaded for the given boundary layer key. */
  getLayerIdsByBoundaryKey(key: AdminBoundaryLayerKey): string[] {
    const configIds = new Set(
      COLOMBIA_BOUNDARY_CONFIGS.filter((c) => c.layerKey === key).map((c) => c.id),
    );
    return this.boundaryLayers.filter((layer) => configIds.has(layer.id)).map((layer) => layer.id);
  }

  setLayerVisibility(target: AoiType | AdminBoundaryLayerKey, visible: boolean): void {
    const configs = this.getConfigsForTarget(target);

    if (visible) {
      for (const config of configs) {
        this.ensureLayerForConfig(config);
      }
      if (configs.some((config) => this.unavailableBoundaryLayerKeys.has(config.layerKey))) {
        this.setVisibilityForConfigs(configs, false);
        return;
      }
    }
    this.setVisibilityForConfigs(configs, visible);
    this.applyVisibilityToMapLayers(configs, visible);
    if (visible) {
      this.bringLayersToFront(configs);
      if (
        !configs.some((config) => config.type === 'sirap') &&
        this.layerVisibilityByType$().sirap
      ) {
        this.bringLayersToFront(this.getConfigsForTarget('sirap'));
      }
    }
  }

  toggleLayerVisibility(type: AoiType): void {
    const current = this.layerVisibilityByType$()[type];
    this.setLayerVisibility(type, !current);
  }

  setLayerStyle(target: AoiType | AdminBoundaryLayerKey, options: { color?: string | null }): void {
    const configs = this.getConfigsForTarget(target);
    const color = this.hexToRgba(options.color ?? DEFAULT_ADMIN_BOUNDARY_HEX);
    this.boundaryStyleByLayerKey.update((state) =>
      configs.reduce(
        (nextState, config) => ({
          ...nextState,
          [config.layerKey]: {
            ...nextState[config.layerKey],
            color,
          },
        }),
        state,
      ),
    );
    this.applyStyleToMapLayers(configs);
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
    const preferredVisibility = this.layerVisibilityByLayerKey$()[config.layerKey];
    const commonLayerProps = {
      id: config.id,
      title: config.title,
      visible: preferredVisibility ?? config.visible ?? true,
      opacity: config.opacity ?? 1,
      minScale: config.minScale ?? 0,
      maxScale: config.maxScale ?? 0,
      renderer: this.getBoundaryRenderer(config.layerKey) as never,
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
    });
  }

  private ensureLayerForConfig(config: BoundaryConfig): void {
    if (!this.map || !this.view) {
      return;
    }
    if (this.unavailableBoundaryLayerKeys.has(config.layerKey)) {
      return;
    }

    const existing = this.boundaryLayers.some((layer) => {
      return layer.id === config.id;
    });
    if (existing) {
      return;
    }

    const newLayer = this.buildLayer(config);
    this.boundaryLayers = [...this.boundaryLayers, newLayer];
    this.map.add(newLayer);

    void this.view.whenLayerView(newLayer).catch((error: unknown) => {
      console.warn(
        `[AdminBoundaryService] "${newLayer.id}" unavailable (likely CORS/remote service issue); disabling ${config.layerKey} boundary.`,
        error,
      );
      this.unavailableBoundaryLayerKeys.add(config.layerKey);
      this.removeLayerById(newLayer.id);
      this.setVisibilityForConfigs([config], false);
    });
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

      const config = ENABLED_BOUNDARY_CONFIGS.find((item) => item.id === layerId);
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

  private getConfigsForTarget(target: AoiType | AdminBoundaryLayerKey): BoundaryConfig[] {
    const layerKeyConfigs = ENABLED_BOUNDARY_CONFIGS.filter((config) => config.layerKey === target);
    if (layerKeyConfigs.length > 0) {
      return layerKeyConfigs;
    }
    return ENABLED_BOUNDARY_CONFIGS.filter((config) => config.type === target);
  }

  private setVisibilityForConfigs(configs: BoundaryConfig[], visible: boolean): void {
    this.layerVisibilityByLayerKey$.update((state) =>
      configs.reduce(
        (nextState, config) => ({
          ...nextState,
          [config.layerKey]: visible,
        }),
        state,
      ),
    );
  }

  private applyVisibilityToMapLayers(configs: BoundaryConfig[], visible: boolean): void {
    const layerIds = new Set(configs.map((config) => config.id));
    for (const layer of this.boundaryLayers) {
      if (layerIds.has(layer.id)) {
        layer.visible = visible;
      }
    }
  }

  private applyStyleToMapLayers(configs: BoundaryConfig[]): void {
    const configsByLayerId = new Map(configs.map((config) => [config.id, config]));
    for (const layer of this.boundaryLayers) {
      const config = configsByLayerId.get(layer.id);
      if (config) {
        layer.renderer = this.getBoundaryRenderer(config.layerKey) as never;
      }
    }
  }

  private bringLayersToFront(configs: BoundaryConfig[]): void {
    if (!this.map) {
      return;
    }

    const layerIds = new Set(configs.map((config) => config.id));
    const layersForTarget = this.boundaryLayers.filter((layer) => layerIds.has(layer.id));

    for (const layer of layersForTarget) {
      this.map.reorder(layer, this.map.layers.length - 1);
    }
  }

  private getBoundaryRenderer(
    target: AoiType | AdminBoundaryLayerKey,
  ): Record<string, unknown> | null {
    const config = this.getConfigsForTarget(target)[0];
    const fallbackStyle: BoundaryStyle = {
      color: DEFAULT_ADMIN_BOUNDARY_OUTLINE_COLOR,
      width: 1,
      style: 'solid',
    };
    const boundaryStyle = config ? this.boundaryStyleByLayerKey()[config.layerKey] : fallbackStyle;
    return {
      type: 'simple',
      symbol: {
        type: 'simple-fill',
        color: [0, 0, 0, 0],
        outline: {
          color: [...boundaryStyle.color],
          width: boundaryStyle.width,
          style: boundaryStyle.style,
        },
      },
    };
  }

  private hexToRgba(hexColor: string): BoundaryStyle['color'] {
    const normalized = hexColor.trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(normalized)) {
      return DEFAULT_ADMIN_BOUNDARY_OUTLINE_COLOR;
    }
    const value = Number.parseInt(normalized.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 235];
  }

  /**
   * Public hook for non-boundary AOI selections (e.g. OMEC polygons selected via
   * MapView's identify flow) to reuse the existing AOI highlight graphics layer.
   */
  highlightAoiGeometry(geometry: Geometry | null): void {
    this.setSelectionHighlight(geometry);
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
