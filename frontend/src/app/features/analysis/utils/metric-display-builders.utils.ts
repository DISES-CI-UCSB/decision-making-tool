import type {
  AnalysisMetricSectionFixture,
  MetricComparisonValue,
  MetricValue,
} from '@core/models';

export interface MetricSectionDefinition {
  id: string;
  labelKey: string;
}

export function buildMetricSections(
  metrics: MetricValue[],
  sectionLookup: Readonly<Record<string, MetricSectionDefinition>>,
  sectionOrder: readonly string[],
): AnalysisMetricSectionFixture[] {
  const grouped = new Map<string, AnalysisMetricSectionFixture>();

  for (const metric of metrics) {
    const definition = sectionLookup[metric.metricId];
    if (!definition) {
      continue;
    }

    const section = grouped.get(definition.id) ?? {
      sectionId: definition.id,
      sectionLabelKey: definition.labelKey,
      metrics: [],
    };
    section.metrics.push(metric);
    grouped.set(definition.id, section);
  }

  return sectionOrder
    .map((sectionId) => grouped.get(sectionId))
    .filter((section): section is AnalysisMetricSectionFixture => section !== undefined);
}

export function buildMetricComparisons(
  baselineMetrics: MetricValue[],
  candidateMetrics: MetricValue[],
): MetricComparisonValue[] {
  const candidateById = new Map(candidateMetrics.map((metric) => [metric.metricId, metric]));

  return baselineMetrics.flatMap((baseline) => {
    const candidate = candidateById.get(baseline.metricId);
    if (!candidate) {
      return [];
    }

    const delta =
      baseline.status === 'ready' &&
      candidate.status === 'ready' &&
      baseline.value !== null &&
      candidate.value !== null
        ? Number((candidate.value - baseline.value).toFixed(2))
        : null;

    return [
      {
        metricId: baseline.metricId,
        labelKey: baseline.labelKey,
        formatHint: baseline.formatHint,
        baseline,
        candidate,
        delta,
      },
    ];
  });
}
