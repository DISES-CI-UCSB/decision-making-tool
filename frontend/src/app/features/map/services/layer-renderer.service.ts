import { Injectable } from '@angular/core';

import type ArcGISMap from '@arcgis/core/Map';
import type Layer from '@arcgis/core/layers/Layer';

import type { LayerConfig } from '@core/models';
import { layerFactory } from '../utils/layer-factory';

@Injectable({ providedIn: 'root' })
export class LayerRendererService {
  private map: InstanceType<typeof ArcGISMap> | null = null;
  private readonly managedLayerIds = new Set<string>();

  /** Call once after the ArcGIS Map instance is created. */
  initialize(map: InstanceType<typeof ArcGISMap>): void {
    this.map = map;
  }

  /** Add a single layer to the map from a LayerConfig. No-ops if the id already exists. */
  addLayer(config: LayerConfig): void {
    if (!this.map) return;
    if (this.findLayer(config.id)) {
      console.warn(`[LayerRendererService] layer "${config.id}" is already on the map — skipped`);
      return;
    }
    this.map.add(layerFactory(config));
    this.managedLayerIds.add(config.id);
  }

  /** Remove a layer from the map by id. No-ops if not found. */
  removeLayer(id: string): void {
    if (!this.map) return;
    const layer = this.findLayer(id);
    if (layer) this.map.remove(layer);
    this.managedLayerIds.delete(id);
  }

  /**
   * Move an existing layer to a new position in the map's layer stack.
   * Index 0 is drawn first (bottom); higher indices are drawn on top.
   */
  reorderLayer(id: string, newIndex: number): void {
    if (!this.map) return;
    const layer = this.findLayer(id);
    if (layer) this.map.reorder(layer, newIndex);
  }

  /** Update the visibility of a layer without recreating it. */
  setLayerVisibility(id: string, visible: boolean): void {
    const layer = this.findLayer(id);
    if (layer) layer.visible = visible;
  }

  /** Update the opacity of a layer without recreating it. */
  setLayerOpacity(id: string, opacity: number): void {
    const layer = this.findLayer(id);
    if (layer) layer.opacity = opacity;
  }

  /**
   * Reconcile the map's layer collection against a fresh set of LayerConfigs:
   * - Layers on the map but absent from configs → removed.
   * - Layers in configs but absent from the map → added.
   * - Layers present in both → visibility and opacity updated in place.
   */
  syncLayers(configs: LayerConfig[]): void {
    if (!this.map) return;

    const configMap = new Map(configs.map((c) => [c.id, c]));

    // Remove only layers this service manages that are no longer in config.
    const toRemove = this.map.layers
      .filter((l) => this.managedLayerIds.has(l.id) && !configMap.has(l.id))
      .toArray();
    this.map.removeMany(toRemove);
    toRemove.forEach((layer) => this.managedLayerIds.delete(layer.id));

    // Add new layers; update existing ones
    for (const config of configs) {
      const existing = this.findLayer(config.id);
      if (existing) {
        existing.visible = config.visible;
        existing.opacity = config.opacity;
        this.managedLayerIds.add(config.id);
      } else {
        this.addLayer(config);
      }
    }
  }

  private findLayer(id: string): Layer | null {
    return (this.map?.layers.find((l) => l.id === id) as Layer | undefined) ?? null;
  }
}
