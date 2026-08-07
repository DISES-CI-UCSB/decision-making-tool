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

export interface SpeciesReferenceGroupSummary {
  id: string;
  label: string;
  reached17Count: number;
  reached30Count: number;
  totalCount: number;
}

export interface SpeciesReferenceSummary {
  reached17Count: number;
  reached30Count: number;
  totalCount: number | null;
  groups: SpeciesReferenceGroupSummary[];
}

export function readSpeciesReferenceSummary(metric: MetricValue): SpeciesReferenceSummary | null {
  const outcomes = metric.details?.thresholdOutcomes;
  if (!Array.isArray(outcomes) || outcomes.length !== 2) return null;
  const outcome17 = outcomes.find((outcome) => outcome.targetPercent === 17);
  const outcome30 = outcomes.find((outcome) => outcome.targetPercent === 30);
  if (!isFiniteCount(outcome17?.value) || !isFiniteCount(outcome30?.value)) return null;

  const summary17 = asRecord(outcome17.details?.['summary']);
  const summary30 = asRecord(outcome30.details?.['summary']);
  const total17 = summary17 ? readFiniteCount(summary17, 'total', 'totalSpeciesCount') : null;
  const total30 = summary30 ? readFiniteCount(summary30, 'total', 'totalSpeciesCount') : null;
  const totalCount = total17 !== null && total17 === total30 ? total17 : null;

  return {
    reached17Count: outcome17.value,
    reached30Count: outcome30.value,
    totalCount,
    groups: readReferenceGroups(outcome17.details?.['groups'], outcome30.details?.['groups']),
  };
}

export function formatSpeciesReferenceValue(
  metric: MetricValue,
  options: MetricFormatOptions,
): string | null {
  const summary = readSpeciesReferenceSummary(metric);
  if (!summary) return null;
  return `17%: ${formatCount(summary.reached17Count, options)} · 30%: ${formatCount(
    summary.reached30Count,
    options,
  )}`;
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

function readReferenceGroups(raw17: unknown, raw30: unknown): SpeciesReferenceGroupSummary[] {
  const groups17 = asRecord(raw17);
  const groups30 = asRecord(raw30);
  if (!groups17 || !groups30) return [];

  return Object.entries(groups17).flatMap(([id, value17]) => {
    const group17 = asRecord(value17);
    const group30 = asRecord(groups30[id]);
    if (!group17 || !group30) return [];
    const reached17Count = readFiniteCount(group17, 'met', 'metSpeciesCount');
    const reached30Count = readFiniteCount(group30, 'met', 'metSpeciesCount');
    const total17 = readFiniteCount(group17, 'total', 'totalSpeciesCount');
    const total30 = readFiniteCount(group30, 'total', 'totalSpeciesCount');
    if (
      reached17Count === null ||
      reached30Count === null ||
      total17 === null ||
      total17 !== total30
    ) {
      return [];
    }
    return [
      {
        id,
        label: typeof group17['label'] === 'string' ? group17['label'] : id,
        reached17Count,
        reached30Count,
        totalCount: total17,
      },
    ];
  });
}

function isFiniteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return asRecord(value) !== null;
}
