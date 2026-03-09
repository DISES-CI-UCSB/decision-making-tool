import { Injectable } from '@angular/core';
import {
  type AnalysisMetricFixturesResponse,
  type AoiMetricsResponse,
  type CompareSolutionsResponse,
  type LayerConfig,
  type Metric,
  type MetricComparisonValue,
  type MetricReadinessStatus,
  type MetricValue,
  type Solution,
  type SolutionMetricsResponse,
} from '@core/models';

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
      metadata: { scenario: 'habitat-connectivity' },
      metrics: [
        this.metric('m-biodiversity', 'Biodiversity', 92, '%', 'ecology', 'percentage'),
        this.metric('m-carbon', 'Carbon Storage', 74, 't/ha', 'climate', 'number'),
        this.metric('m-cost', 'Implementation Cost', 2.1, 'M COP', 'finance', 'currency'),
      ],
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
        this.metric('m-cost', 'Implementation Cost', 1.7, 'M COP', 'finance', 'currency'),
      ],
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
        this.metric('m-cost', 'Implementation Cost', 1.3, 'M COP', 'finance', 'currency'),
      ],
    },
  ];

  private readonly layers: LayerConfig[] = [
    {
      id: 'layer-ecosystems',
      name: 'Ecosystems',
      arcgisType: 'feature',
      category: 'ecology',
      visible: true,
      opacity: 0.9,
      url: 'https://services.arcgis.com/mock/arcgis/rest/services/Ecosystems/FeatureServer/0',
      symbology: { style: 'fill', color: '#2f7d3d' },
    },
    {
      id: 'layer-protected-areas',
      name: 'Protected Areas',
      arcgisType: 'feature',
      category: 'governance',
      visible: true,
      opacity: 0.85,
      url: 'https://services.arcgis.com/mock/arcgis/rest/services/ProtectedAreas/FeatureServer/0',
      symbology: { style: 'outline', color: '#1e6fa8' },
    },
    {
      id: 'layer-human-footprint',
      name: 'Human Footprint',
      arcgisType: 'imagery-tile',
      category: 'pressure',
      visible: false,
      opacity: 0.65,
      url: 'https://services.arcgis.com/mock/arcgis/rest/services/HumanFootprint/ImageServer',
      symbology: { style: 'heatmap' },
    },
  ];

  private readonly layerStatsById: Record<string, LayerStats> = {
    'layer-ecosystems': {
      layerId: 'layer-ecosystems',
      featureCount: 1284,
      coveredAreaKm2: 48210,
      lastUpdated: '2026-03-01T12:00:00.000Z',
    },
    'layer-protected-areas': {
      layerId: 'layer-protected-areas',
      featureCount: 437,
      coveredAreaKm2: 23140,
      lastUpdated: '2026-03-01T12:00:00.000Z',
    },
    'layer-human-footprint': {
      layerId: 'layer-human-footprint',
      featureCount: 1,
      coveredAreaKm2: 1149200,
      lastUpdated: '2026-03-01T12:00:00.000Z',
    },
  };

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

  getAoiMetrics(solutionId: string, aoiId: string): AoiMetricsResponse | null {
    const baseResponse = this.getSolutionMetrics(solutionId);
    if (!baseResponse) {
      return null;
    }

    const aoiScale = aoiId.length % 2 === 0 ? 1.04 : 0.96;
    const metrics = baseResponse.metrics.map((metric) => {
      if (metric.status !== 'ready' || metric.value === null) {
        return metric;
      }
      return {
        ...metric,
        value: Number((metric.value * aoiScale).toFixed(2)),
        source: 'aoi-derived',
      };
    });

    return {
      solutionId,
      aoiId,
      generatedAt: this.generatedAt,
      metrics,
    };
  }

  compareSolutions(id1: string, id2: string): CompareSolutionsResponse | null {
    const baselineSolution = this.getSolutionById(id1);
    const candidateSolution = this.getSolutionById(id2);

    if (!baselineSolution || !candidateSolution) {
      return null;
    }

    const baselineValues = this.toMetricValues(baselineSolution.id, baselineSolution.metrics);
    const candidateValues = this.toMetricValues(candidateSolution.id, candidateSolution.metrics);
    const candidateByMetricId = new Map(
      candidateValues.map((metricValue) => [metricValue.metricId, metricValue]),
    );
    const metrics: MetricComparisonValue[] = baselineValues
      .map((baseline) => {
        const candidate = candidateByMetricId.get(baseline.metricId);
        if (!candidate) {
          return null;
        }

        return {
          metricId: baseline.metricId,
          labelKey: baseline.labelKey,
          formatHint: baseline.formatHint,
          baseline,
          candidate,
          delta: this.computeDelta(baseline, candidate),
        };
      })
      .filter((metric): metric is MetricComparisonValue => metric !== null);

    return {
      baselineSolutionId: baselineSolution.id,
      candidateSolutionId: candidateSolution.id,
      generatedAt: this.generatedAt,
      metrics,
    };
  }

  getLayers(): LayerConfig[] {
    return this.layers;
  }

  getLayerStats(layerId: string): LayerStats | null {
    return this.layerStatsById[layerId] ?? null;
  }

  findMatchingSolutions(targets: MatchingTarget[]): MatchingResult[] {
    const weights = new Map(targets.map((target) => [target.metricId, target.weight ?? 1]));

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
          distance: Number(distance.toFixed(2)),
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  getAnalysisMetricFixtures(solutionId: string): AnalysisMetricFixturesResponse | null {
    const metricsResponse = this.getSolutionMetrics(solutionId);
    if (!metricsResponse) {
      return null;
    }

    const find = (metricId: string): MetricValue | null =>
      metricsResponse.metrics.find((metric) => metric.metricId === metricId) ?? null;

    const ecologyMetrics = [find('m-biodiversity')].filter(
      (metric): metric is MetricValue => metric !== null,
    );
    const climateMetrics = [find('m-carbon')].filter(
      (metric): metric is MetricValue => metric !== null,
    );
    const financeMetrics = [find('m-cost')].filter(
      (metric): metric is MetricValue => metric !== null,
    );

    return {
      solutionId,
      generatedAt: this.generatedAt,
      sections: [
        {
          sectionId: 'ecology',
          sectionLabelKey: 'analysis.sections.ecology',
          metrics: ecologyMetrics,
        },
        {
          sectionId: 'climate',
          sectionLabelKey: 'analysis.sections.climate',
          metrics: climateMetrics,
        },
        {
          sectionId: 'finance',
          sectionLabelKey: 'analysis.sections.finance',
          metrics: financeMetrics,
        },
      ],
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

      const statusSourceMap: Record<Exclude<MetricReadinessStatus, 'ready'>, string> = {
        derivation_needed: 'derivation-pipeline',
        blocked: 'blocked-upstream',
        pending: 'pending-ingestion',
      };
      const statusNotesMap: Record<Exclude<MetricReadinessStatus, 'ready'>, string> = {
        derivation_needed: 'Requires derivation from dependent layers before release.',
        blocked: 'Blocked due to missing source layer for this solution.',
        pending: 'Pending source ingestion and quality checks.',
      };

      return {
        metricId: metric.id,
        value: null,
        unit: metric.unit,
        status,
        source: statusSourceMap[status],
        notes: statusNotesMap[status],
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

  private computeDelta(baseline: MetricValue, candidate: MetricValue): number | null {
    if (baseline.status !== 'ready' || candidate.status !== 'ready') {
      return null;
    }
    if (baseline.value === null || candidate.value === null) {
      return null;
    }

    return Number((candidate.value - baseline.value).toFixed(2));
  }
}
