import FeatureLayer from '@arcgis/core/layers/FeatureLayer';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import ImageryTileLayer from '@arcgis/core/layers/ImageryTileLayer';
import TileLayer from '@arcgis/core/layers/TileLayer';

import type { LayerConfig } from '@core/models';

export type ArcGISLayer = FeatureLayer | TileLayer | ImageryTileLayer | GraphicsLayer;

/**
 * Given a LayerConfig, instantiates and returns the matching ArcGIS layer.
 * The caller is responsible for adding the layer to the map.
 */
export function layerFactory(config: LayerConfig): ArcGISLayer {
  const base = { id: config.id, opacity: config.opacity, visible: config.visible };

  switch (config.arcgisType) {
    case 'feature':
      return new FeatureLayer({ ...base, url: config.url });

    case 'tile':
      return new TileLayer({ ...base, url: config.url });

    case 'imagery-tile':
      return new ImageryTileLayer({ ...base, url: config.url });

    case 'graphics':
      return new GraphicsLayer(base);

    default: {
      // Exhaustiveness check — TypeScript will error here if a new type is added without handling it.
      const _unreachable: never = config.arcgisType;
      throw new Error(`[layerFactory] Unhandled arcgisType: ${_unreachable}`);
    }
  }
}
