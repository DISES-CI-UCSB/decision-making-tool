export type LayerType = 'vector' | 'raster';

export interface LayerConfig {
  id: string;
  name: string;
  type: LayerType;
  category: string;
  visible: boolean;
  opacity: number;
  symbology?: Record<string, unknown>;
}
