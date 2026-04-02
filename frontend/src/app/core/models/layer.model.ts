export type ArcGISLayerType = 'feature' | 'tile' | 'imagery-tile' | 'graphics';

export interface LayerConfig {
  id: string;
  name: string;
  arcgisType: ArcGISLayerType;
  category: string;
  visible: boolean;
  opacity: number;
  /** Required for feature, tile, and imagery-tile layers; omit for graphics layers. */
  url?: string;
  symbology?: Record<string, unknown>;
}
