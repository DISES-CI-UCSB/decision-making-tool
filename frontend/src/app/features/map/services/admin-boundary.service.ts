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
import type Layer from '@arcgis/core/layers/Layer';
import type ArcGISMap from '@arcgis/core/Map';
import type ArcGISMapView from '@arcgis/core/views/MapView';
import type { ViewHit } from '@arcgis/core/views/types';

import { PUBLIC_BLOB_HOST } from '@core/config/runtime-manifest.constants';
import {
  PRODUCTION_SIRAP_BOUNDARY_SOURCE,
  UPDATED_TERRITORIAL_SIRAP_BOUNDARY_SOURCE,
  type AoiType,
  type BoundaryGeometrySelection,
} from '@core/models';
import { AppStateService } from '@core/services/app-state.service';
import { FEATURE_FLAGS } from '@feature-flags';

interface BoundaryConfig {
  id: string;
  layerKey: AdminBoundaryLayerKey;
  title: string;
  type: AoiType;
  selectable?: boolean;
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

interface ResolvedSelectionGeometry {
  geometry: Geometry | null;
  geometrySelection?: BoundaryGeometrySelection;
}

interface HoverHit {
  graphic: Graphic;
  screenX: number;
  screenY: number;
}

interface HoverHitTestRequest {
  view: InstanceType<typeof ArcGISMapView>;
  screenX: number;
  screenY: number;
  requestId: number;
}

export type AdminBoundaryLayerKey =
  | 'siraps'
  | 'siraps_territorial'
  | 'siraps_territorial_updated'
  | 'siraps_thematic'
  | 'admin_country_outline'
  | 'admin_departments'
  | 'admin_municipalities';
export type AdminBoundaryLineStyle = 'none' | 'solid' | 'long-dash' | 'dot';

interface BoundaryStyle {
  color: [number, number, number, number];
  width: number;
  style: AdminBoundaryLineStyle;
}

const DEFAULT_ADMIN_BOUNDARY_HEX = '#6b7280';
const DEFAULT_ADMIN_BOUNDARY_OUTLINE_COLOR: BoundaryStyle['color'] = [107, 114, 128, 235];
const AOI_HOVER_COLOR: BoundaryStyle['color'] = [250, 204, 21, 255];
const AOI_SELECTION_COLOR: BoundaryStyle['color'] = [249, 115, 22, 255];
export const COLOMBIA_OUTLINE_VISUAL_URL =
  `${PUBLIC_BLOB_HOST}/inputs/reference/colombia_outline_visual/` +
  'v0.1.0/colombia_outline_visual.geojson';
// Named view highlight used for hover. The layer view renders it from geometry it
// has already tessellated, which avoids cloning large boundary polygons per move.
const AOI_HOVER_HIGHLIGHT_NAME = 'aoi-hover';
const DEFAULT_BOUNDARY_STYLE_BY_LAYER_KEY: Record<AdminBoundaryLayerKey, BoundaryStyle> = {
  siraps: { color: DEFAULT_ADMIN_BOUNDARY_OUTLINE_COLOR, width: 1.25, style: 'long-dash' },
  siraps_territorial: { color: DEFAULT_ADMIN_BOUNDARY_OUTLINE_COLOR, width: 1.25, style: 'solid' },
  siraps_territorial_updated: {
    color: DEFAULT_ADMIN_BOUNDARY_OUTLINE_COLOR,
    width: 1.25,
    style: 'solid',
  },
  siraps_thematic: { color: DEFAULT_ADMIN_BOUNDARY_OUTLINE_COLOR, width: 1.25, style: 'long-dash' },
  admin_country_outline: {
    color: DEFAULT_ADMIN_BOUNDARY_OUTLINE_COLOR,
    width: 1.6,
    style: 'solid',
  },
  admin_departments: { color: DEFAULT_ADMIN_BOUNDARY_OUTLINE_COLOR, width: 1, style: 'solid' },
  admin_municipalities: {
    color: DEFAULT_ADMIN_BOUNDARY_OUTLINE_COLOR,
    width: 0.9,
    style: 'long-dash',
  },
};

const COLOMBIA_BOUNDARY_CONFIGS: BoundaryConfig[] = [
  {
    id: 'aoi-departments-colombia',
    layerKey: 'admin_departments',
    title: 'Colombia Departments',
    type: 'department',
    sourceType: 'geojson',
    url: `${PUBLIC_BLOB_HOST}/boundaries/igac_departments_detailed.geojson`,
    idFields: ['boundary_id', 'DeCodigo', 'OBJECTID'],
    nameFields: ['boundary_name', 'DeNombre'],
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
    title: 'Colombia Municipalities',
    type: 'municipality',
    sourceType: 'geojson',
    url: `${PUBLIC_BLOB_HOST}/boundaries/igac_municipalities_detailed.geojson`,
    idFields: ['boundary_id', 'MpCodigo', 'OBJECTID'],
    nameFields: ['boundary_name', 'MpNombre'],
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
    id: 'aoi-country-outline-colombia',
    layerKey: 'admin_country_outline',
    title: 'Colombia Country Outline',
    // Keep country outline non-interactive so clicks only target AOI layers.
    selectable: false,
    type: 'department',
    sourceType: 'geojson',
    url: COLOMBIA_OUTLINE_VISUAL_URL,
    idFields: ['shapeISO', 'shapeID', 'OBJECTID'],
    nameFields: ['shapeName'],
    visible: true,
    opacity: 1,
  },
  {
    id: PRODUCTION_SIRAP_BOUNDARY_SOURCE.sourceId,
    layerKey: PRODUCTION_SIRAP_BOUNDARY_SOURCE.layerKey,
    title: 'Colombia SIRAPs - Combined Review Layer',
    type: 'sirap',
    sourceType: 'geojson',
    url: `${PUBLIC_BLOB_HOST}/${PRODUCTION_SIRAP_BOUNDARY_SOURCE.pathname}`,
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
    title: 'Territorial SIRAPs (outdated)',
    type: 'sirap',
    selectable: false,
    sourceType: 'geojson',
    url: `${PUBLIC_BLOB_HOST}/${PRODUCTION_SIRAP_BOUNDARY_SOURCE.pathname}`,
    idFields: ['sirap_id'],
    nameFields: ['sirap_name'],
    definitionExpression: "sirap_kind = 'territorial'",
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
    url: `${PUBLIC_BLOB_HOST}/${PRODUCTION_SIRAP_BOUNDARY_SOURCE.pathname}`,
    idFields: ['sirap_id'],
    nameFields: ['sirap_name'],
    definitionExpression: "sirap_kind = 'thematic'",
    visible: false,
    opacity: 0.95,
    minScale: 0,
    maxScale: 0,
  },
  {
    id: UPDATED_TERRITORIAL_SIRAP_BOUNDARY_SOURCE.sourceId,
    layerKey: UPDATED_TERRITORIAL_SIRAP_BOUNDARY_SOURCE.layerKey,
    title: 'Territorial SIRAPs',
    type: 'sirap',
    sourceType: 'geojson',
    url: `${PUBLIC_BLOB_HOST}/${UPDATED_TERRITORIAL_SIRAP_BOUNDARY_SOURCE.pathname}`,
    idFields: ['sirap_id'],
    nameFields: ['sirap_name'],
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
  siraps_territorial_updated: FEATURE_FLAGS.sirapLayers.territorialUpdated,
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
  private supplementalHoverLayers: Layer[] = [];
  private aoiHoverLayer: GraphicsLayer | null = null;
  private aoiHighlightLayer: GraphicsLayer | null = null;
  private viewClickHandle: { remove: () => void } | null = null;
  private viewPointerMoveHandle: { remove: () => void } | null = null;
  private viewPointerLeaveHandle: { remove: () => void } | null = null;
  private hoverRequestId = 0;
  private lastAppliedHoverRequestId = 0;
  private hoverHitTestsInFlight = 0;
  private pendingHoverHitTest: HoverHitTestRequest | null = null;
  private hoveredGeometry: Geometry | null = null;
  private selectedHighlightGeometry: Geometry | null = null;
  private hoverHighlightGraphic: Graphic | null = null;
  private selectionHighlightGraphic: Graphic | null = null;
  private lastHoverHit: HoverHit | null = null;
  private hoverHighlightHandle: { remove: () => void } | null = null;
  private hoveredFeatureKey: string | null = null;
  private unkeyedHoverCount = 0;
  private readonly defaultVisibilityByLayerKey: Record<AdminBoundaryLayerKey, boolean> = {
    siraps: false,
    siraps_territorial: false,
    siraps_territorial_updated: false,
    siraps_thematic: false,
    admin_country_outline: true,
    admin_departments: false,
    admin_municipalities: false,
  };
  readonly layerVisibilityByLayerKey$ = signal<Record<AdminBoundaryLayerKey, boolean>>(
    this.defaultVisibilityByLayerKey,
  );
  readonly layerVisibilityByType$ = computed<Record<AoiType, boolean>>(() => {
    const state = this.layerVisibilityByLayerKey$();
    return {
      sirap:
        state.siraps ||
        state.siraps_territorial ||
        state.siraps_territorial_updated ||
        state.siraps_thematic,
      department: state.admin_departments,
      municipality: state.admin_municipalities,
      omec: false,
      runap: false,
      custom: false,
    };
  });
  readonly popupEnabled$ = signal(false);
  private readonly boundaryStyleByLayerKey = signal<Record<AdminBoundaryLayerKey, BoundaryStyle>>(
    DEFAULT_BOUNDARY_STYLE_BY_LAYER_KEY,
  );
  private readonly unavailableBoundaryLayerKeys = new Set<AdminBoundaryLayerKey>();

  constructor() {
    effect(() => {
      if (this.appState.selectedAOI$() === null) {
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
    // Create only default-visible layers on startup. Remote boundary layers are loaded lazily
    // when users explicitly toggle them on, which avoids noisy startup network errors.
    this.boundaryLayers = ENABLED_BOUNDARY_CONFIGS.filter(
      (config) => this.layerVisibilityByLayerKey$()[config.layerKey] ?? config.visible ?? true,
    ).map((config) => this.buildLayer(config));
    if (this.boundaryLayers.length > 0) {
      map.addMany(this.boundaryLayers);
    }
    this.aoiHoverLayer = new GraphicsLayer({
      id: 'aoi-hover-highlight-layer',
      title: 'AOI Hover Highlight',
      listMode: 'hide',
    });
    this.aoiHighlightLayer = new GraphicsLayer({
      id: 'aoi-selection-highlight-layer',
      title: 'AOI Selection Highlight',
      listMode: 'hide',
    });
    map.addMany([this.aoiHoverLayer, this.aoiHighlightLayer]);
    this.registerHoverHighlightOptions(view);
    for (const layer of this.boundaryLayers) {
      void view.whenLayerView(layer).catch((error: unknown) => {
        console.error(`[AdminBoundaryService] failed to create layerview for "${layer.id}"`, error);
      });
    }
    this.viewClickHandle = view.on('click', (event) => {
      void this.handleMapClick(view, event.mapPoint, event.x, event.y);
    });
    this.viewPointerMoveHandle = view.on('pointer-move', (event) => {
      this.enqueuePointerMove(view, event.x, event.y);
    });
    this.viewPointerLeaveHandle = view.on('pointer-leave', () => {
      this.clearHoverState();
    });
  }

  destroy(map: InstanceType<typeof ArcGISMap> | null): void {
    this.viewClickHandle?.remove();
    this.viewClickHandle = null;
    this.viewPointerMoveHandle?.remove();
    this.viewPointerMoveHandle = null;
    this.viewPointerLeaveHandle?.remove();
    this.viewPointerLeaveHandle = null;
    this.hoverRequestId += 1;
    this.lastAppliedHoverRequestId = this.hoverRequestId;
    this.pendingHoverHitTest = null;
    this.hoverHighlightHandle?.remove();
    this.hoverHighlightHandle = null;
    this.hoveredFeatureKey = null;

    if (map && this.boundaryLayers.length > 0) {
      map.removeMany(this.boundaryLayers);
    }
    if (map && this.aoiHoverLayer) {
      map.remove(this.aoiHoverLayer);
    }
    if (map && this.aoiHighlightLayer) {
      map.remove(this.aoiHighlightLayer);
    }

    this.map = null;
    this.view = null;
    this.boundaryLayers = [];
    this.supplementalHoverLayers = [];
    this.aoiHoverLayer = null;
    this.aoiHighlightLayer = null;
    this.hoveredGeometry = null;
    this.selectedHighlightGeometry = null;
    this.hoverHighlightGraphic = null;
    this.selectionHighlightGraphic = null;
    this.lastHoverHit = null;
  }

  /**
   * Adds selectable layers managed elsewhere (such as RUNAP and OMEC) to the
   * shared AOI hover affordance without transferring layer ownership.
   */
  setSupplementalHoverLayers(layers: Layer[]): void {
    this.supplementalHoverLayers = [...layers];
  }

  /** Reuses the latest pointer hit so clicks do not repeat an expensive hit test. */
  getRecentHoverGraphic(layer: Layer, screenX: number, screenY: number): Graphic | null {
    const hit = this.lastHoverHit;
    if (
      !hit ||
      hit.graphic.layer !== layer ||
      Math.hypot(hit.screenX - screenX, hit.screenY - screenY) > 4
    ) {
      return null;
    }
    return hit.graphic;
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
    if (!visible) {
      this.clearSelectionForHiddenBoundary(configs);
    }
    if (visible) {
      this.bringLayersToFront(configs);
      if (
        !configs.some((config) => config.type === 'sirap') &&
        this.layerVisibilityByType$().sirap
      ) {
        this.bringLayersToFront(this.getConfigsForTarget('sirap'));
      }
      this.keepInteractionHighlightsOnTop();
    }
  }

  toggleLayerVisibility(type: AoiType): void {
    const current = this.layerVisibilityByType$()[type];
    this.setLayerVisibility(type, !current);
  }

  setLayerStyle(
    target: AoiType | AdminBoundaryLayerKey,
    options: {
      color?: string | null;
      width?: number | null;
      style?: AdminBoundaryLineStyle | null;
    },
  ): void {
    const configs = this.getConfigsForTarget(target);
    const color = this.hexToRgba(options.color ?? DEFAULT_ADMIN_BOUNDARY_HEX);
    this.boundaryStyleByLayerKey.update((state) =>
      configs.reduce(
        (nextState, config) => ({
          ...nextState,
          [config.layerKey]: {
            ...nextState[config.layerKey],
            color,
            width: options.width ?? nextState[config.layerKey].width,
            style: options.style ?? nextState[config.layerKey].style,
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

  private buildLayer(config: BoundaryConfig): FeatureLayer | GeoJSONLayer {
    const preferredVisibility = this.layerVisibilityByLayerKey$()[config.layerKey];
    const commonLayerProps = {
      id: config.id,
      title: config.title,
      visible: preferredVisibility ?? config.visible ?? true,
      opacity: config.opacity ?? 1,
      minScale: config.minScale ?? 0,
      maxScale: config.maxScale ?? 0,
    };

    if (config.sourceType === 'geojson') {
      return new GeoJSONLayer({
        ...commonLayerProps,
        url: config.url,
        outFields: ['*'],
        definitionExpression: config.definitionExpression,
        renderer: this.getBoundaryRenderer(config.layerKey) as never,
      });
    }

    return new FeatureLayer({
      ...commonLayerProps,
      url: config.url,
      outFields: ['*'],
      definitionExpression: config.definitionExpression,
      renderer: this.getBoundaryRenderer(config.layerKey) as never,
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
    const interactiveLayers = this.boundaryLayers.filter((layer) => {
      const config = ENABLED_BOUNDARY_CONFIGS.find((item) => item.id === layer.id);
      return layer.visible && config?.selectable !== false;
    });
    if (interactiveLayers.length === 0) {
      this.clearSelectionState();
      return;
    }

    const cachedGraphic = this.getRecentBoundaryHoverGraphic(screenX, screenY);
    const candidate = cachedGraphic
      ? this.resolveGraphicCandidate(cachedGraphic)
      : this.resolveCandidate(
          (await view.hitTest({ x: screenX, y: screenY }, { include: interactiveLayers })).results,
        );
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

    const resolvedSelection = this.resolveSelectionGeometry(
      candidate.geometry,
      mapPoint,
      candidate.config.type,
    );
    const selectionGeometry = resolvedSelection.geometry;

    this.setSelectionHighlight(selectionGeometry);
    this.appState.selectAOI({
      id: `${candidate.config.type}:${rawId}`,
      name: aoiName,
      type: candidate.config.type,
      geometryUrl: candidate.config.url,
      boundarySourceLayerKey: candidate.config.layerKey,
      boundarySourceId: candidate.config.id,
      boundaryGeometrySelection: resolvedSelection.geometrySelection,
      areaKm2: this.calculateAreaKm2(selectionGeometry),
    });
    this.appState.setRightSidebarMode('aoi');
    requestAnimationFrame(() => {
      void this.zoomToSelection(view, selectionGeometry);
    });
  }

  private enqueuePointerMove(
    view: InstanceType<typeof ArcGISMapView>,
    screenX: number,
    screenY: number,
  ): void {
    this.pendingHoverHitTest = {
      view,
      screenX,
      screenY,
      requestId: ++this.hoverRequestId,
    };
    this.startPendingHoverHitTest();
  }

  private startPendingHoverHitTest(): void {
    if (!this.pendingHoverHitTest || this.hoverHitTestsInFlight >= 2) {
      return;
    }

    const request = this.pendingHoverHitTest;
    this.pendingHoverHitTest = null;
    this.hoverHitTestsInFlight += 1;
    void this.handlePointerMove(request).finally(() => {
      this.hoverHitTestsInFlight -= 1;
      this.startPendingHoverHitTest();
    });
  }

  private async handlePointerMove({
    view,
    screenX,
    screenY,
    requestId,
  }: HoverHitTestRequest): Promise<void> {
    const interactiveLayers = [
      ...this.boundaryLayers.filter((layer) => {
        const config = ENABLED_BOUNDARY_CONFIGS.find((item) => item.id === layer.id);
        return layer.visible && config?.selectable !== false;
      }),
      ...this.supplementalHoverLayers.filter((layer) => layer.visible),
    ];

    if (interactiveLayers.length === 0) {
      this.clearHoverState();
      return;
    }

    try {
      const hit = await view.hitTest({ x: screenX, y: screenY }, { include: interactiveLayers });
      if (requestId <= this.lastAppliedHoverRequestId) {
        return;
      }
      this.lastAppliedHoverRequestId = requestId;

      const graphicHit = hit.results.find((result) => result.type === 'graphic');
      const graphic = graphicHit?.type === 'graphic' ? graphicHit.graphic : null;
      this.lastHoverHit = graphic ? { graphic, screenX, screenY } : null;
      this.applyHoverHighlight(view, graphic);
      this.setMapCursor(graphic ? 'pointer' : '');
    } catch (error: unknown) {
      if (requestId <= this.lastAppliedHoverRequestId) {
        return;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      this.clearHoverState();
      console.warn('[AdminBoundaryService] AOI hover hit test failed:', error);
    }
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
      if (!config || config.selectable === false) {
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

  private resolveGraphicCandidate(graphic: Graphic): HitTestCandidate | null {
    const layerId = graphic.layer?.id;
    if (typeof layerId !== 'string') {
      return null;
    }

    const config = ENABLED_BOUNDARY_CONFIGS.find((item) => item.id === layerId);
    if (!config || config.selectable === false) {
      return null;
    }

    return {
      config,
      attributes: (graphic.attributes ?? {}) as Record<string, unknown>,
      geometry: graphic.geometry ?? null,
    };
  }

  private getRecentBoundaryHoverGraphic(screenX: number, screenY: number): Graphic | null {
    const hit = this.lastHoverHit;
    if (
      !hit ||
      !this.boundaryLayers.includes(hit.graphic.layer as FeatureLayer | GeoJSONLayer) ||
      Math.hypot(hit.screenX - screenX, hit.screenY - screenY) > 4
    ) {
      return null;
    }
    return hit.graphic;
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

  private clearSelectionForHiddenBoundary(configs: BoundaryConfig[]): void {
    const selectedAoi = this.appState.selectedAOI$();
    if (!selectedAoi) {
      return;
    }

    const hidesSelectedAoiLayer = configs.some(
      (config) => config.selectable !== false && config.type === selectedAoi.type,
    );
    if (hidesSelectedAoiLayer) {
      this.clearSelectionState();
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
          width: boundaryStyle.style === 'none' ? 0 : boundaryStyle.width,
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
    if (!geometry) {
      this.clearSelectionHighlight();
      return;
    }

    this.setSelectionHighlight(geometry);
  }

  private registerHoverHighlightOptions(view: InstanceType<typeof ArcGISMapView>): void {
    const highlights = view.highlights;
    if (!highlights || highlights.some((options) => options.name === AOI_HOVER_HIGHLIGHT_NAME)) {
      return;
    }

    highlights.push({
      name: AOI_HOVER_HIGHLIGHT_NAME,
      color: AOI_HOVER_COLOR.slice(0, 3),
      haloOpacity: 1,
      fillOpacity: 0,
      shadowOpacity: 0,
    } as never);
  }

  private applyHoverHighlight(
    view: InstanceType<typeof ArcGISMapView>,
    graphic: Graphic | null,
  ): void {
    const featureKey = this.getHoverFeatureKey(graphic);
    if (featureKey === this.hoveredFeatureKey) {
      return;
    }

    this.hoveredFeatureKey = featureKey;
    this.hoverHighlightHandle?.remove();
    this.hoverHighlightHandle = graphic ? this.highlightLayerFeature(view, graphic) : null;
    // Only clone the outline into our graphics layer when the owning layer view
    // cannot highlight the feature itself.
    this.setHoverHighlight(this.hoverHighlightHandle ? null : (graphic?.geometry ?? null));
  }

  private highlightLayerFeature(
    view: InstanceType<typeof ArcGISMapView>,
    graphic: Graphic,
  ): { remove: () => void } | null {
    const layer = graphic.layer;
    if (!layer || this.getObjectId(graphic) === null) {
      return null;
    }

    const layerView = view.allLayerViews.find((candidate) => candidate.layer === layer) as
      | { highlight?: (target: Graphic, options: { name: string }) => { remove: () => void } }
      | undefined;
    if (typeof layerView?.highlight !== 'function') {
      return null;
    }

    try {
      return layerView.highlight(graphic, { name: AOI_HOVER_HIGHLIGHT_NAME });
    } catch (error: unknown) {
      console.warn('[AdminBoundaryService] AOI hover highlight failed:', error);
      return null;
    }
  }

  /**
   * Identifies the hovered feature so repeated moves within one boundary skip all
   * highlight work. Features without an object id get a unique key because they
   * cannot be compared across hit tests.
   */
  private getHoverFeatureKey(graphic: Graphic | null): string | null {
    if (!graphic) {
      return null;
    }

    const layerId = typeof graphic.layer?.id === 'string' ? graphic.layer.id : 'unknown-layer';
    const objectId = this.getObjectId(graphic);
    return objectId === null
      ? `${layerId}:unkeyed-${++this.unkeyedHoverCount}`
      : `${layerId}:${objectId}`;
  }

  private getObjectId(graphic: Graphic): number | string | null {
    const objectIdField = (graphic.layer as { objectIdField?: string } | null)?.objectIdField;
    const value = objectIdField ? graphic.attributes?.[objectIdField] : undefined;
    return typeof value === 'number' || typeof value === 'string' ? value : null;
  }

  private setHoverHighlight(geometry: Geometry | null): void {
    if (!this.aoiHoverLayer) {
      return;
    }
    if (geometry === this.hoveredGeometry) {
      return;
    }

    this.hoveredGeometry = geometry;
    if (!geometry) {
      if (this.hoverHighlightGraphic) {
        this.hoverHighlightGraphic.visible = false;
      }
      return;
    }

    const symbol = this.getInteractionSymbol(geometry, AOI_HOVER_COLOR, 2.5) as never;
    if (this.hoverHighlightGraphic) {
      this.hoverHighlightGraphic.geometry = geometry;
      this.hoverHighlightGraphic.symbol = symbol;
      this.hoverHighlightGraphic.visible = true;
      return;
    }

    this.hoverHighlightGraphic = new Graphic({ geometry, symbol });
    this.aoiHoverLayer.add(this.hoverHighlightGraphic);
  }

  private clearHoverState(): void {
    this.hoverRequestId += 1;
    this.lastAppliedHoverRequestId = this.hoverRequestId;
    this.pendingHoverHitTest = null;
    this.lastHoverHit = null;
    this.hoverHighlightHandle?.remove();
    this.hoverHighlightHandle = null;
    this.hoveredFeatureKey = null;
    this.setHoverHighlight(null);
    this.setMapCursor('');
  }

  private setMapCursor(cursor: '' | 'pointer'): void {
    if (this.view?.container instanceof HTMLElement) {
      this.view.container.style.cursor = cursor;
    }
  }

  private keepInteractionHighlightsOnTop(): void {
    if (!this.map) {
      return;
    }

    if (this.aoiHoverLayer) {
      this.map.reorder(this.aoiHoverLayer, this.map.layers.length - 1);
    }
    if (this.aoiHighlightLayer) {
      this.map.reorder(this.aoiHighlightLayer, this.map.layers.length - 1);
    }
  }

  private setSelectionHighlight(selectionGeometry: Geometry | null): void {
    if (!this.aoiHighlightLayer || !selectionGeometry) {
      return;
    }
    if (selectionGeometry === this.selectedHighlightGeometry) {
      return;
    }

    this.selectedHighlightGeometry = selectionGeometry;
    const symbol = this.getInteractionSymbol(selectionGeometry, AOI_SELECTION_COLOR, 3) as never;
    if (this.selectionHighlightGraphic) {
      this.selectionHighlightGraphic.geometry = selectionGeometry;
      this.selectionHighlightGraphic.symbol = symbol;
      this.selectionHighlightGraphic.visible = true;
      return;
    }

    this.selectionHighlightGraphic = new Graphic({ geometry: selectionGeometry, symbol });
    this.aoiHighlightLayer.add(this.selectionHighlightGraphic);
  }

  private clearSelectionHighlight(): void {
    this.selectedHighlightGeometry = null;
    if (this.selectionHighlightGraphic) {
      this.selectionHighlightGraphic.visible = false;
    }
  }

  private clearSelectionState(): void {
    this.clearSelectionHighlight();
    this.appState.clearAOI();
    this.appState.setRightSidebarMode(this.appState.hasActiveSolution() ? 'overview' : 'welcome');
  }

  private getLayerIndex(layerId: string): number {
    return this.map?.layers.findIndex((layer) => layer.id === layerId) ?? -1;
  }

  private getInteractionSymbol(
    geometry: Geometry,
    color: BoundaryStyle['color'],
    width: number,
  ): Record<string, unknown> {
    if (geometry.type === 'polyline') {
      return {
        type: 'simple-line',
        color,
        width,
        style: 'solid',
      };
    }

    if (geometry.type === 'point' || geometry.type === 'multipoint') {
      return {
        type: 'simple-marker',
        color,
        size: 12,
        outline: {
          color: [255, 255, 255, 255],
          width: 1.5,
        },
      };
    }

    return {
      type: 'simple-fill',
      color: [...color.slice(0, 3), 0],
      outline: {
        color,
        width,
        style: 'solid',
      },
    };
  }

  private resolveSelectionGeometry(
    geometry: Geometry | null,
    clickedPoint: InstanceType<typeof Point>,
    aoiType: AoiType,
  ): ResolvedSelectionGeometry {
    if (!geometry) {
      return { geometry: null };
    }

    // Merged SIRAP features are the analytical AOI. Their cached metrics and
    // provenance describe the complete feature, including every polygon.
    if (geometry.type !== 'polygon' || aoiType === 'sirap') {
      return { geometry, geometrySelection: 'whole-feature' };
    }

    const polygon = geometry as Polygon;
    if (polygon.rings.length <= 1) {
      return { geometry, geometrySelection: 'whole-feature' };
    }

    for (const ring of polygon.rings) {
      const ringPolygon = new Polygon({
        rings: [ring],
        spatialReference: polygon.spatialReference,
        hasM: polygon.hasM,
        hasZ: polygon.hasZ,
      });

      if (geometryEngine.contains(ringPolygon, clickedPoint)) {
        return { geometry: ringPolygon, geometrySelection: 'component' };
      }
    }

    return { geometry, geometrySelection: 'whole-feature' };
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

  private calculateAreaKm2(geometry: Geometry | null): number | undefined {
    if (!geometry || geometry.type !== 'polygon') {
      return undefined;
    }

    const area = geometryEngine.geodesicArea(geometry as Polygon, 'square-kilometers');
    return Number.isFinite(area) ? Math.abs(area) : undefined;
  }
}
