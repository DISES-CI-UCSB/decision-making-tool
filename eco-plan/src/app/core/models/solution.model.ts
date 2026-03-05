import type { Metric } from './metric.model';

export interface Solution {
  id: string;
  name: string;
  description?: string;
  matchPercentage: number;
  metadata?: Record<string, unknown>;
  geometryUrl: string;
  metrics: Metric[];
}
