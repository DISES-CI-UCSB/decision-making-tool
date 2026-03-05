import { Injectable } from '@angular/core';
import { type LayerConfig, type Metric, type Solution } from '@core/models';

export interface LayerStats {
  layerId: string;
  featureCount: number;
  coveredAreaKm2: number;
  lastUpdated: string;
}

export interface MatchingTarget {
  metricId: string;
  targetValue: number;
  weight?: number;
}

export interface MatchingResult {
  solutionId: string;
  score: number;
  distance: number;
}

export interface SolutionComparisonMetric {
  metricId: string;
  name: string;
  baselineValue: number;
  candidateValue: number;
  delta: number;
}

export interface SolutionComparison {
  baselineSolution: Solution;
  candidateSolution: Solution;
  metricDiffs: SolutionComparisonMetric[];
}

@Injectable({
  providedIn: 'root'
})
export class MockDataService {
  private readonly solutions: Solution[] = [
    {
      id: 'sol-001',
      name: 'Bosque Alto Andino',
      description: 'Prioritizes high-elevation forest connectivity.',
      matchPercentage: 86,
      geometryUrl: '/mock/geometry/solutions/sol-001.geojson',
      metadata: { scenario: 'habitat-connectivity' },
      metrics: [
        this.metric('m-biodiversity', 'Biodiversity', 92, '%', 'ecology', 'percentage'),
        this.metric('m-carbon', 'Carbon Storage', 74, 't/ha', 'climate', 'number'),
        this.metric('m-cost', 'Implementation Cost', 2.1, 'M COP', 'finance', 'currency')
      ]
    },
    {
      id: 'sol-002',
      name: 'Corredor Hidrico',
      description: 'Balances watershed protection and social access.',
      matchPercentage: 79,
      geometryUrl: '/mock/geometry/solutions/sol-002.geojson',
      metadata: { scenario: 'watershed-protection' },
      metrics: [
        this.metric('m-biodiversity', 'Biodiversity', 83, '%', 'ecology', 'percentage'),
        this.metric('m-carbon', 'Carbon Storage', 69, 't/ha', 'climate', 'number'),
        this.metric('m-cost', 'Implementation Cost', 1.7, 'M COP', 'finance', 'currency')
      ]
    },
    {
      id: 'sol-003',
      name: 'Paisaje Productivo Sostenible',
      description: 'Optimizes conservation and productive land use.',
      matchPercentage: 72,
      geometryUrl: '/mock/geometry/solutions/sol-003.geojson',
      metadata: { scenario: 'mixed-use' },
      metrics: [
        this.metric('m-biodiversity', 'Biodiversity', 76, '%', 'ecology', 'percentage'),
        this.metric('m-carbon', 'Carbon Storage', 65, 't/ha', 'climate', 'number'),
        this.metric('m-cost', 'Implementation Cost', 1.3, 'M COP', 'finance', 'currency')
      ]
    }
  ];

  private readonly layers: LayerConfig[] = [
    {
      id: 'layer-ecosystems',
      name: 'Ecosystems',
      type: 'vector',
      category: 'ecology',
      visible: true,
      opacity: 0.9,
      symbology: { style: 'fill', color: '#2f7d3d' }
    },
    {
      id: 'layer-protected-areas',
      name: 'Protected Areas',
      type: 'vector',
      category: 'governance',
      visible: true,
      opacity: 0.85,
      symbology: { style: 'outline', color: '#1e6fa8' }
    },
    {
      id: 'layer-human-footprint',
      name: 'Human Footprint',
      type: 'raster',
      category: 'pressure',
      visible: false,
      opacity: 0.65,
      symbology: { style: 'heatmap' }
    }
  ];

  private readonly layerStatsById: Record<string, LayerStats> = {
    'layer-ecosystems': {
      layerId: 'layer-ecosystems',
      featureCount: 1284,
      coveredAreaKm2: 48210,
      lastUpdated: '2026-03-01T12:00:00.000Z'
    },
    'layer-protected-areas': {
      layerId: 'layer-protected-areas',
      featureCount: 437,
      coveredAreaKm2: 23140,
      lastUpdated: '2026-03-01T12:00:00.000Z'
    },
    'layer-human-footprint': {
      layerId: 'layer-human-footprint',
      featureCount: 1,
      coveredAreaKm2: 1149200,
      lastUpdated: '2026-03-01T12:00:00.000Z'
    }
  };

  getSolutionById(id: string): Solution | null {
    return this.solutions.find((solution) => solution.id === id) ?? null;
  }

  getSolutionMetrics(id: string): Metric[] {
    return this.getSolutionById(id)?.metrics ?? [];
  }

  getAoiMetrics(solutionId: string, aoiId: string): Metric[] {
    const baseMetrics = this.getSolutionMetrics(solutionId);
    if (baseMetrics.length === 0) {
      return [];
    }

    const aoiScale = aoiId.length % 2 === 0 ? 1.04 : 0.96;
    return baseMetrics.map((metric) => ({
      ...metric,
      value: Number((metric.value * aoiScale).toFixed(2))
    }));
  }

  compareSolutions(id1: string, id2: string): SolutionComparison | null {
    const baselineSolution = this.getSolutionById(id1);
    const candidateSolution = this.getSolutionById(id2);

    if (!baselineSolution || !candidateSolution) {
      return null;
    }

    const candidateMetricsById = new Map(
      candidateSolution.metrics.map((metric) => [metric.id, metric])
    );
    const metricDiffs: SolutionComparisonMetric[] = baselineSolution.metrics
      .map((baselineMetric) => {
        const candidateMetric = candidateMetricsById.get(baselineMetric.id);
        if (!candidateMetric) {
          return null;
        }

        return {
          metricId: baselineMetric.id,
          name: baselineMetric.name,
          baselineValue: baselineMetric.value,
          candidateValue: candidateMetric.value,
          delta: Number((candidateMetric.value - baselineMetric.value).toFixed(2))
        };
      })
      .filter((diff): diff is SolutionComparisonMetric => diff !== null);

    return {
      baselineSolution,
      candidateSolution,
      metricDiffs
    };
  }

  getLayers(): LayerConfig[] {
    return this.layers;
  }

  getLayerStats(layerId: string): LayerStats | null {
    return this.layerStatsById[layerId] ?? null;
  }

  findMatchingSolutions(targets: MatchingTarget[]): MatchingResult[] {
    const weights = new Map(
      targets.map((target) => [target.metricId, target.weight ?? 1])
    );

    return this.solutions
      .map((solution) => {
        const distance = targets.reduce((sum, target) => {
          const metric = solution.metrics.find((m) => m.id === target.metricId);
          if (!metric) {
            return sum;
          }
          const weight = weights.get(target.metricId) ?? 1;
          return sum + Math.abs(metric.value - target.targetValue) * weight;
        }, 0);

        const score = Math.max(0, 100 - distance);
        return {
          solutionId: solution.id,
          score: Number(score.toFixed(2)),
          distance: Number(distance.toFixed(2))
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  private metric(
    id: string,
    name: string,
    value: number,
    unit: string,
    category: string,
    visualizationType: Metric['visualizationType']
  ): Metric {
    return {
      id,
      name,
      value,
      unit,
      category,
      visualizationType
    };
  }
}
