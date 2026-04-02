export type MetricVisualizationType = 'number' | 'percentage' | 'currency' | 'chart' | 'map';

export interface Metric {
  id: string;
  name: string;
  value: number;
  unit: string;
  category: string;
  visualizationType: MetricVisualizationType;
  description?: string;
}
