import type { AoiType, LayerConfig, RuntimeLayerManifestRenderingConfig } from '@core/models';
import type {
  AdminBoundaryLayerKey,
  AdminBoundaryLineStyle,
} from '@features/map/services/admin-boundary.service';
import { VECTOR_OVERLAY_ARCGIS_LAYER_ID_BY_OVERLAY_ID } from '@features/map/services/manifest-raster-layer.service';
import {
  DEFAULT_SELECTED_LAYER_BORDER_STYLE,
  DEFAULT_SELECTED_LAYER_BORDER_WIDTH,
  DEFAULT_SELECTED_LAYER_FILL_DENSITY,
  DEFAULT_SELECTED_LAYER_FILL_STYLE,
  type SelectedLayerBorderStyle,
  type SelectedLayerFillStyle,
} from './map-layers-panel.config';

export type MapSyncDescriptor =
  | { type: 'solution-baseline' }
  | { type: 'solution-candidate' }
  | { type: 'solution-overlap' }
  | { type: 'app-state-layer'; layerId: string }
  | {
      type: 'manifest-raster';
      layerId: string;
      displayUrl: string;
      rendering: RuntimeLayerManifestRenderingConfig;
    }
  | {
      type: 'admin-boundary';
      boundaryType: AoiType;
      boundaryLayerKey: AdminBoundaryLayerKey;
    };

export interface MapSyncRow {
  id: string;
  selected: boolean;
  visible: boolean;
  opacity: number;
  color: string;
  fillStyle?: SelectedLayerFillStyle;
  fillDensity?: number;
  borderColor?: string;
  borderStyle?: SelectedLayerBorderStyle;
  borderWidth?: number;
  mapSync?: MapSyncDescriptor;
}

export interface MapSyncGroup {
  rows: MapSyncRow[];
}

export interface MapSyncTaxon extends MapSyncRow {
  species: MapSyncRow[];
}

export interface MapSyncPorts {
  solutionLayers: {
    setBaselineVisibility(visible: boolean): void;
    setBaselineOpacity(opacity: number): void;
    setBaselineColor(color: string): void;
    setCandidateVisibility(visible: boolean): void;
    setCandidateOpacity(opacity: number): void;
    setCandidateColor(color: string): void;
    setOverlapVisibility(visible: boolean): void;
    setOverlapOpacity(opacity: number): void;
    setOverlapColor(color: string): void;
    resolveLayerForSidebarType(
      type: 'solution-baseline' | 'solution-candidate' | 'solution-overlap',
    ): { id: string } | null;
    reorderLayersByIds(idsTopToBottom: string[]): void;
  };
  adminBoundaries: {
    setLayerStyle(
      key: AdminBoundaryLayerKey,
      style: { color: string; style: AdminBoundaryLineStyle; width: number },
    ): void;
    setLayerVisibility(key: AdminBoundaryLayerKey, visible: boolean): void;
    getLayerIdsByBoundaryKey(key: AdminBoundaryLayerKey): string[];
  };
  manifestRasters: {
    syncLayer(
      layerId: string,
      state: {
        displayUrl: string;
        visible: boolean;
        opacity: number;
        color: string;
        fillStyle: SelectedLayerFillStyle;
        fillDensity: number;
        borderColor: string;
        borderStyle: SelectedLayerBorderStyle;
        borderWidth: number;
        rendering: RuntimeLayerManifestRenderingConfig;
      },
      options: { selected: boolean },
    ): void;
  };
  appStateLayers: {
    get(): LayerConfig[];
    set(layers: LayerConfig[]): void;
  };
}

type RowLookup = () => MapSyncRow | null | undefined;

export class MapLayersPanelMapSync {
  private readonly afterPaintFrames = new Map<string, number>();
  private readonly afterPaintTasks = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly opacityFrames = new Map<string, number>();
  private readonly colorFrames = new Map<string, number>();
  private stackingFrame: number | null = null;
  private stackingTask: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ports: MapSyncPorts,
    private readonly requestFrame: (callback: FrameRequestCallback) => number = (callback) =>
      requestAnimationFrame(callback),
    private readonly cancelFrame: (frameId: number) => void = (frameId) =>
      cancelAnimationFrame(frameId),
    private readonly scheduleTask: (callback: () => void) => ReturnType<typeof setTimeout> = (
      callback,
    ) => setTimeout(callback, 0),
    private readonly cancelTask: (taskId: ReturnType<typeof setTimeout>) => void = (taskId) =>
      clearTimeout(taskId),
  ) {}

  syncRow(row: MapSyncRow): void {
    const descriptor = row.mapSync;
    if (!descriptor) {
      return;
    }

    if (descriptor.type === 'solution-baseline') {
      this.ports.solutionLayers.setBaselineVisibility(row.visible);
      this.ports.solutionLayers.setBaselineOpacity(row.opacity / 100);
      this.ports.solutionLayers.setBaselineColor(row.color);
      return;
    }
    if (descriptor.type === 'solution-candidate') {
      this.ports.solutionLayers.setCandidateVisibility(row.visible);
      this.ports.solutionLayers.setCandidateOpacity(row.opacity / 100);
      this.ports.solutionLayers.setCandidateColor(row.color);
      return;
    }
    if (descriptor.type === 'solution-overlap') {
      this.ports.solutionLayers.setOverlapVisibility(row.visible);
      this.ports.solutionLayers.setOverlapOpacity(row.opacity / 100);
      this.ports.solutionLayers.setOverlapColor(row.color);
      return;
    }
    if (descriptor.type === 'admin-boundary') {
      this.ports.adminBoundaries.setLayerStyle(descriptor.boundaryLayerKey, {
        color: row.borderColor ?? row.color,
        style: toAdminBoundaryLineStyle(row.borderStyle),
        width: row.borderWidth ?? DEFAULT_SELECTED_LAYER_BORDER_WIDTH,
      });
      this.ports.adminBoundaries.setLayerVisibility(descriptor.boundaryLayerKey, row.visible);
      return;
    }
    if (descriptor.type === 'manifest-raster') {
      this.ports.manifestRasters.syncLayer(
        descriptor.layerId,
        {
          displayUrl: descriptor.displayUrl,
          visible: row.visible,
          opacity: row.opacity / 100,
          color: row.color,
          fillStyle: row.fillStyle ?? DEFAULT_SELECTED_LAYER_FILL_STYLE,
          fillDensity: row.fillDensity ?? DEFAULT_SELECTED_LAYER_FILL_DENSITY,
          borderColor: row.borderColor ?? row.color,
          borderStyle: row.borderStyle ?? DEFAULT_SELECTED_LAYER_BORDER_STYLE,
          borderWidth: row.borderWidth ?? DEFAULT_SELECTED_LAYER_BORDER_WIDTH,
          rendering: applyRowColorToRendering(descriptor.rendering, row.color),
        },
        { selected: row.selected },
      );
      return;
    }

    const layers = this.ports.appStateLayers.get();
    const index = layers.findIndex((layer) => layer.id === descriptor.layerId);
    if (index < 0) {
      return;
    }
    const nextLayers = [...layers];
    nextLayers[index] = {
      ...layers[index],
      visible: row.visible,
      opacity: row.opacity / 100,
    };
    this.ports.appStateLayers.set(nextLayers);
  }

  syncRows(rows: readonly MapSyncRow[]): void {
    for (const row of rows) {
      this.syncRow(row);
    }
  }

  scheduleAfterPaintSync(rowKey: string, findLiveRow: RowLookup): void {
    this.cancelAfterPaintRowSync(rowKey);
    const beforePaintFrame = this.requestFrame(() => {
      this.afterPaintFrames.delete(rowKey);
      const afterPaintTask = this.scheduleTask(() => {
        const row = findLiveRow();
        if (row) {
          this.syncRow(row);
        }
        this.afterPaintTasks.delete(rowKey);
      });
      this.afterPaintTasks.set(rowKey, afterPaintTask);
    });
    this.afterPaintFrames.set(rowKey, beforePaintFrame);
  }

  scheduleOpacitySync(rowKey: string, findLiveRow: RowLookup): void {
    this.scheduleRowSync(this.opacityFrames, rowKey, findLiveRow);
  }

  scheduleColorSync(rowKey: string, findLiveRow: RowLookup): void {
    this.scheduleRowSync(this.colorFrames, rowKey, findLiveRow);
  }

  scheduleStackingSync(
    order: readonly string[],
    overlays: readonly MapSyncRow[],
    groups: readonly MapSyncGroup[],
    taxa: readonly MapSyncTaxon[],
    prioritizedOrder?: readonly string[],
  ): void {
    const effectiveOrder = prioritizedOrder ?? order;
    this.cancelStackingSync();
    this.stackingFrame = this.requestFrame(() => {
      this.stackingFrame = null;
      this.stackingTask = this.scheduleTask(() => {
        this.syncStacking(effectiveOrder, overlays, groups, taxa);
        this.stackingTask = null;
      });
    });
  }

  syncStacking(
    order: readonly string[],
    overlays: readonly MapSyncRow[],
    groups: readonly MapSyncGroup[],
    taxa: readonly MapSyncTaxon[],
  ): void {
    const descriptors = selectedDescriptorsById(overlays, groups, taxa);
    const layerIds = order.flatMap((rowId) => this.resolveLayerIds(descriptors.get(rowId)));
    if (layerIds.length > 0) {
      this.ports.solutionLayers.reorderLayersByIds(layerIds);
    }
  }

  dispose(): void {
    this.cancelFrames(this.afterPaintFrames);
    for (const taskId of this.afterPaintTasks.values()) {
      this.cancelTask(taskId);
    }
    this.afterPaintTasks.clear();
    this.cancelFrames(this.opacityFrames);
    this.cancelFrames(this.colorFrames);
    this.cancelStackingSync();
  }

  private cancelAfterPaintRowSync(rowKey: string): void {
    const previousFrame = this.afterPaintFrames.get(rowKey);
    if (previousFrame !== undefined) {
      this.cancelFrame(previousFrame);
      this.afterPaintFrames.delete(rowKey);
    }
    const previousTask = this.afterPaintTasks.get(rowKey);
    if (previousTask !== undefined) {
      this.cancelTask(previousTask);
      this.afterPaintTasks.delete(rowKey);
    }
  }

  private cancelStackingSync(): void {
    if (this.stackingFrame !== null) {
      this.cancelFrame(this.stackingFrame);
      this.stackingFrame = null;
    }
    if (this.stackingTask !== null) {
      this.cancelTask(this.stackingTask);
      this.stackingTask = null;
    }
  }

  private scheduleRowSync(
    frames: Map<string, number>,
    rowKey: string,
    findLiveRow: RowLookup,
  ): void {
    const previousFrame = frames.get(rowKey);
    if (previousFrame !== undefined) {
      this.cancelFrame(previousFrame);
    }
    const frameId = this.requestFrame(() => {
      const row = findLiveRow();
      if (row) {
        this.syncRow(row);
      }
      frames.delete(rowKey);
    });
    frames.set(rowKey, frameId);
  }

  private resolveLayerIds(descriptor: MapSyncDescriptor | undefined): string[] {
    if (!descriptor) {
      return [];
    }
    if (descriptor.type === 'manifest-raster' || descriptor.type === 'app-state-layer') {
      return [
        VECTOR_OVERLAY_ARCGIS_LAYER_ID_BY_OVERLAY_ID[descriptor.layerId] ?? descriptor.layerId,
      ];
    }
    if (descriptor.type === 'admin-boundary') {
      return this.ports.adminBoundaries.getLayerIdsByBoundaryKey(descriptor.boundaryLayerKey);
    }
    const layer = this.ports.solutionLayers.resolveLayerForSidebarType(descriptor.type);
    return layer ? [layer.id] : [];
  }

  private cancelFrames(frames: Map<string, number>): void {
    for (const frameId of frames.values()) {
      this.cancelFrame(frameId);
    }
    frames.clear();
  }
}

export function applyRowColorToRendering(
  rendering: RuntimeLayerManifestRenderingConfig,
  color: string,
): RuntimeLayerManifestRenderingConfig {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return rendering;
  }
  if (rendering.renderMode === 'mask') {
    return { ...rendering, selectedColor: color };
  }
  if (rendering.renderMode === 'gradient') {
    return { ...rendering, endColor: color };
  }
  return rendering;
}

function toAdminBoundaryLineStyle(
  borderStyle: SelectedLayerBorderStyle | undefined,
): AdminBoundaryLineStyle {
  if (borderStyle === 'none') {
    return 'none';
  }
  if (borderStyle === 'dotted') {
    return 'dot';
  }
  if (borderStyle === 'dashed') {
    return 'long-dash';
  }
  return 'solid';
}

function selectedDescriptorsById(
  overlays: readonly MapSyncRow[],
  groups: readonly MapSyncGroup[],
  taxa: readonly MapSyncTaxon[],
): Map<string, MapSyncDescriptor> {
  const descriptors = new Map<string, MapSyncDescriptor>();
  const add = (row: MapSyncRow): void => {
    if (row.selected && row.mapSync) {
      descriptors.set(row.id, row.mapSync);
    }
  };
  overlays.forEach(add);
  groups.forEach((group) => group.rows.forEach(add));
  taxa.forEach((taxon) => {
    add(taxon);
    taxon.species.forEach(add);
  });
  return descriptors;
}
