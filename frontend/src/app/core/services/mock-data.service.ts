import { Injectable } from '@angular/core';
import {
  type Metric,
  type MetricReadinessStatus,
  type MetricValue,
  type Solution,
  type SolutionMetricsResponse,
} from '@core/models';

@Injectable({
  providedIn: 'root',
})
export class MockDataService {
  private readonly generatedAt = '2026-03-05T00:00:00.000Z';
  private readonly solutions: Solution[] = [
    {
      id: 'sol-001',
      name: 'Bosque Alto Andino',
      description: 'Prioritizes high-elevation forest connectivity.',
      matchPercentage: 86,
      geometryUrl: '/mock/geometry/solutions/sol-001.geojson',
      metadata: { solution: 'habitat-connectivity' },
      metrics: [
        this.metric('m-biodiversity', 'Biodiversity', 92, '%', 'ecology', 'percentage'),
        this.metric('m-carbon', 'Carbon Storage', 74, 'Mg', 'climate', 'number'),
        this.metric('m-cost', 'Implementation Cost', 2.1, 'M COP', 'finance', 'currency'),
      ],
    },
    {
      id: 'sol-002',
      name: 'Corredor Hidrico',
      description: 'Balances watershed protection and social access.',
      matchPercentage: 79,
      geometryUrl: '/mock/geometry/solutions/sol-002.geojson',
      metadata: { solution: 'watershed-protection' },
      metrics: [
        this.metric('m-biodiversity', 'Biodiversity', 83, '%', 'ecology', 'percentage'),
        this.metric('m-carbon', 'Carbon Storage', 69, 'Mg', 'climate', 'number'),
        this.metric('m-cost', 'Implementation Cost', 1.7, 'M COP', 'finance', 'currency'),
      ],
    },
    {
      id: 'sol-003',
      name: 'Paisaje Productivo Sostenible',
      description: 'Optimizes conservation and productive land use.',
      matchPercentage: 72,
      geometryUrl: '/mock/geometry/solutions/sol-003.geojson',
      metadata: { solution: 'mixed-use' },
      metrics: [
        this.metric('m-biodiversity', 'Biodiversity', 76, '%', 'ecology', 'percentage'),
        this.metric('m-carbon', 'Carbon Storage', 65, 'Mg', 'climate', 'number'),
        this.metric('m-cost', 'Implementation Cost', 1.3, 'M COP', 'finance', 'currency'),
      ],
    },
  ];

  private readonly metricDisplayMap: Record<
    string,
    {
      labelKey: string;
      formatHint: MetricValue['formatHint'];
    }
  > = {
    'm-biodiversity': {
      labelKey: 'metrics.biodiversity.label',
      formatHint: 'percent',
    },
    'm-carbon': {
      labelKey: 'metrics.carbon.label',
      formatHint: 'number',
    },
    'm-cost': {
      labelKey: 'metrics.cost.label',
      formatHint: 'currency',
    },
  };

  getSolutionById(id: string): Solution | null {
    return this.solutions.find((solution) => solution.id === id) ?? null;
  }

  getSolutions(): Solution[] {
    return this.solutions;
  }

  getSolutionMetrics(id: string): SolutionMetricsResponse | null {
    const solution = this.getSolutionById(id);
    if (!solution) {
      return null;
    }

    return {
      solutionId: solution.id,
      generatedAt: this.generatedAt,
      metrics: this.toMetricValues(solution.id, solution.metrics),
    };
  }

  private metric(
    id: string,
    name: string,
    value: number,
    unit: string,
    category: string,
    visualizationType: Metric['visualizationType'],
  ): Metric {
    return {
      id,
      name,
      value,
      unit,
      category,
      visualizationType,
    };
  }

  private toMetricValues(solutionId: string, metrics: Metric[]): MetricValue[] {
    return metrics.map((metric) => {
      const status = this.resolveStatus(solutionId, metric.id);
      const display = this.metricDisplayMap[metric.id] ?? {
        labelKey: `metrics.${metric.id}.label`,
        formatHint: 'number' as const,
      };

      if (status === 'ready') {
        return {
          metricId: metric.id,
          value: metric.value,
          unit: metric.unit,
          status,
          source: 'model-output',
          notes: null,
          labelKey: display.labelKey,
          formatHint: display.formatHint,
        };
      }

      const statusSourceMap: Partial<Record<Exclude<MetricReadinessStatus, 'ready'>, string>> = {
        derivation_needed: 'derivation-pipeline',
        blocked: 'blocked-upstream',
        pending: 'pending-ingestion',
        not_applicable: 'scope-excluded',
        empty: 'empty-boundary',
      };
      const statusNotesMap: Partial<Record<Exclude<MetricReadinessStatus, 'ready'>, string>> = {
        derivation_needed: 'Requires derivation from dependent layers before release.',
        blocked: 'Blocked due to missing source layer for this solution.',
        pending: 'Pending source ingestion and quality checks.',
        not_applicable: 'Metric is not available at this geography scope.',
        empty: 'Boundary does not intersect the solution raster extent.',
      };

      return {
        metricId: metric.id,
        value: null,
        unit: metric.unit,
        status,
        source: statusSourceMap[status] ?? 'unknown',
        notes: statusNotesMap[status] ?? null,
        labelKey: display.labelKey,
        formatHint: display.formatHint,
      };
    });
  }

  private resolveStatus(solutionId: string, metricId: string): MetricReadinessStatus {
    const statusBySolutionMetric: Record<string, MetricReadinessStatus> = {
      'sol-001:m-biodiversity': 'ready',
      'sol-001:m-carbon': 'derivation_needed',
      'sol-001:m-cost': 'ready',
      'sol-002:m-biodiversity': 'ready',
      'sol-002:m-carbon': 'pending',
      'sol-002:m-cost': 'ready',
      'sol-003:m-biodiversity': 'blocked',
      'sol-003:m-carbon': 'ready',
      'sol-003:m-cost': 'ready',
    };

    return statusBySolutionMetric[`${solutionId}:${metricId}`] ?? 'pending';
  }
}
