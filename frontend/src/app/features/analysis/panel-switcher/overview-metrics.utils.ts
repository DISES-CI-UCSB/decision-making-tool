import type { MetricValue } from '@core/models';
import {
  formatNumber,
  formatPanelMetric,
  type MetricFormatOptions,
} from '../utils/metric-presentation.utils';

export type OverviewPlanningDomain = 'land' | 'marine';

export function overviewMetricCandidateIds(
  metricId: string,
  domain: OverviewPlanningDomain,
): string[] {
  if (metricId !== 'mangrove_coverage') {
    return [metricId];
  }

  return domain === 'marine' ? ['marine_mangrove_coverage'] : ['mangrove_coverage'];
}

export function resolveOverviewMetric(
  metricsById: ReadonlyMap<string, MetricValue>,
  metricId: string,
  domain: OverviewPlanningDomain,
): MetricValue | undefined {
  return overviewMetricCandidateIds(metricId, domain)
    .map((candidateId) => metricsById.get(candidateId))
    .find((metric): metric is MetricValue => metric !== undefined);
}

export function formatSpeciesGroupsProtectedValue(
  metric: MetricValue,
  options: MetricFormatOptions,
): string {
  const ratio = readSpeciesSummaryRatio(metric.details);
  if (!ratio) {
    return formatPanelMetric(metric, options);
  }

  return `${formatCount(ratio.met, options)} / ${formatCount(ratio.total, options)}`;
}

function readSpeciesSummaryRatio(
  details: Record<string, unknown> | undefined,
): { met: number; total: number } | null {
  const summary = details?.['summary'];
  if (!isRecord(summary)) {
    return null;
  }

  const met = readFiniteCount(summary, 'met', 'metSpeciesCount');
  const total = readFiniteCount(summary, 'total', 'totalSpeciesCount');
  return met === null || total === null ? null : { met, total };
}

function readFiniteCount(
  summary: Record<string, unknown>,
  primaryKey: string,
  artifactKey: string,
): number | null {
  const value = summary[primaryKey] ?? summary[artifactKey];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function formatCount(value: number, options: MetricFormatOptions): string {
  return formatNumber(value, options, 0, 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
