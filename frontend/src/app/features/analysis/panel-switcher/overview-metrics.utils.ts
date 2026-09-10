import type { GoalFeatureRow, HydratedSpeciesGoalsRecord, MetricValue } from '@core/models';
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

export const SPECIES_GOALS_TAXA_IDS = [
  'mammals',
  'birds',
  'amphibians',
  'reptiles',
  'plants',
] as const;

export type SpeciesGoalsTaxonId = (typeof SPECIES_GOALS_TAXA_IDS)[number];

export interface SpeciesGoalsTaxaRollup {
  id: SpeciesGoalsTaxonId;
  metCount: number;
  totalCount: number;
  pctMet: number | null;
  reached17Count: number;
  reached30Count: number;
}

const SPECIES_GOALS_TAXA_ALIASES: Record<string, SpeciesGoalsTaxonId> = {
  mammal: 'mammals',
  mammals: 'mammals',
  bird: 'birds',
  birds: 'birds',
  amphibian: 'amphibians',
  amphibia: 'amphibians',
  amphibians: 'amphibians',
  reptile: 'reptiles',
  reptiles: 'reptiles',
  plant: 'plants',
  plants: 'plants',
};

export function normalizeSpeciesGoalsTaxonId(
  value: string | null | undefined,
): SpeciesGoalsTaxonId | null {
  if (!value) {
    return null;
  }
  return SPECIES_GOALS_TAXA_ALIASES[value.trim().toLowerCase()] ?? null;
}

/** Roll up the species-goals catalog the breakdown modal already loads. */
export function rollupSpeciesGoalsTaxa(
  records: readonly HydratedSpeciesGoalsRecord[] | null | undefined,
): SpeciesGoalsTaxaRollup[] {
  if (!records?.length) {
    return [];
  }

  const buckets = new Map<
    SpeciesGoalsTaxonId,
    { met: number; targeted: number; total: number; reached17: number; reached30: number }
  >();
  for (const id of SPECIES_GOALS_TAXA_IDS) {
    buckets.set(id, { met: 0, targeted: 0, total: 0, reached17: 0, reached30: 0 });
  }

  for (const record of records) {
    if (record.availability === 'unavailable') {
      continue;
    }
    const taxonId = normalizeSpeciesGoalsTaxonId(record.group);
    if (!taxonId) {
      continue;
    }
    const bucket = buckets.get(taxonId);
    if (!bucket) {
      continue;
    }
    bucket.total += 1;
    if (record.configured_target_met !== null) {
      bucket.targeted += 1;
      if (record.configured_target_met) {
        bucket.met += 1;
      }
    }
    if (record.met_17_percent) {
      bucket.reached17 += 1;
    }
    if (record.met_30_percent) {
      bucket.reached30 += 1;
    }
  }

  return SPECIES_GOALS_TAXA_IDS.flatMap((id) => {
    const bucket = buckets.get(id);
    if (!bucket || bucket.total === 0) {
      return [];
    }
    const hasConfiguredTargets = bucket.targeted > 0;
    return [
      {
        id,
        metCount: hasConfiguredTargets ? bucket.met : 0,
        totalCount: bucket.total,
        pctMet: hasConfiguredTargets ? (bucket.met / bucket.total) * 100 : null,
        reached17Count: bucket.reached17,
        reached30Count: bucket.reached30,
      },
    ];
  });
}

export interface EcosystemGoalsOverview {
  metCount: number;
  totalCount: number;
  pctMet: number | null;
  reached17Count: number;
  reached30Count: number;
}

export function summarizeEcosystemGoals(
  features: readonly GoalFeatureRow[],
): EcosystemGoalsOverview {
  const metCount = features.filter((feature) => feature.met === true).length;
  const totalCount = features.length;
  return {
    metCount,
    totalCount,
    pctMet: totalCount > 0 ? (metCount / totalCount) * 100 : null,
    reached17Count: countFeaturesAtCoverage(features, 0.17),
    reached30Count: countFeaturesAtCoverage(features, 0.3),
  };
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

function countFeaturesAtCoverage(features: readonly GoalFeatureRow[], threshold: number): number {
  return features.filter(
    (feature) => feature.relativeHeld !== null && feature.relativeHeld >= threshold,
  ).length;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return asRecord(value) !== null;
}
