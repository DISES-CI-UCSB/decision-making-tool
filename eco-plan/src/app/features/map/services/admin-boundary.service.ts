import { inject, Injectable, signal } from '@angular/core';
import Graphic from '@arcgis/core/Graphic';
import FeatureLayer from '@arcgis/core/layers/FeatureLayer';
import GeoJSONLayer from '@arcgis/core/layers/GeoJSONLayer';
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
  graphic: Graphic;
}

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
    visible: true,
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
  private boundaryLayers: (FeatureLayer | GeoJSONLayer)[] = [];
  private viewClickHandle: { remove: () => void } | null = null;
  private readonly defaultVisibilityByType: Record<AoiType, boolean> = {
    sirap: true,
    department: false,
    municipality: false,
  };
  readonly layerVisibilityByType$ = signal<Record<AoiType, boolean>>(this.defaultVisibilityByType);

  initialize(map: InstanceType<typeof ArcGISMap>, view: InstanceType<typeof ArcGISMapView>): void {
    if (this.boundaryLayers.length > 0) {
      return;
    }

    this.map = map;
    this.boundaryLayers = COLOMBIA_BOUNDARY_CONFIGS.map((config) => this.buildLayer(config));
    map.addMany(this.boundaryLayers);
    for (const layer of this.boundaryLayers) {
      void view.whenLayerView(layer).catch((error: unknown) => {
        console.error(`[AdminBoundaryService] failed to create layerview for "${layer.id}"`, error);
      });
    }
    this.viewClickHandle = view.on('click', (event) => {
      void this.handleMapClick(view, event.x, event.y);
    });
  }

  destroy(map: InstanceType<typeof ArcGISMap> | null): void {
    this.viewClickHandle?.remove();
    this.viewClickHandle = null;

    if (map && this.boundaryLayers.length > 0) {
      map.removeMany(this.boundaryLayers);
    }

    this.map = null;
    this.boundaryLayers = [];
  }

  setLayerVisibility(type: AoiType, visible: boolean): void {
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

  private async handleMapClick(
    view: InstanceType<typeof ArcGISMapView>,
    x: number,
    y: number,
  ): Promise<void> {
    const interactiveLayers = this.boundaryLayers.filter((layer) => layer.visible);
    if (interactiveLayers.length === 0) {
      return;
    }

    const hit = await view.hitTest({ x, y }, { include: interactiveLayers });
    if (!hit.results.length) {
      return;
    }

    const candidate = this.resolveCandidate(hit.results);
    if (!candidate) {
      return;
    }

    const aoiName = this.readFirstText(candidate.attributes, candidate.config.nameFields);
    const rawId = this.readFirstText(candidate.attributes, candidate.config.idFields);

    if (!aoiName || !rawId) {
      return;
    }

    if (candidate.config.type === 'sirap') {
      const popupLocation = view.toMap({ x, y });
      view.openPopup({
        title: aoiName,
        content: `SIRAP region: ${aoiName}`,
        location: popupLocation ?? undefined,
        features: [candidate.graphic],
      });
    }

    this.appState.selectAOI({
      id: `${candidate.config.type}:${rawId}`,
      name: aoiName,
      type: candidate.config.type,
      geometryUrl: candidate.config.url,
    });
    this.appState.setRightSidebarMode('aoi');
  }

  private resolveCandidate(results: ViewHit[]): HitTestCandidate | null {
    for (const result of results) {
      if (result.type !== 'graphic') {
        continue;
      }

      const layerId = result.graphic.layer?.id;
      if (!layerId) {
        continue;
      }

      const config = COLOMBIA_BOUNDARY_CONFIGS.find((item) => item.id === layerId);
      if (!config) {
        continue;
      }

      const attributes = (result.graphic.attributes ?? {}) as Record<string, unknown>;
      return { config, attributes, graphic: result.graphic };
    }

    return null;
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
}
