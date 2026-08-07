import type { MetricValue } from '@core/models';
import { describe, expect, it } from 'vitest';
import type { MetricFormatOptions } from '../utils/metric-presentation.utils';
import {
  formatSpeciesReferenceValue,
  formatSpeciesGroupsProtectedValue,
  overviewMetricCandidateIds,
  readSpeciesReferenceSummary,
  resolveOverviewMetric,
} from './overview-metrics.utils';

const compactOptions: MetricFormatOptions = {
  areaUnit: 'km2',
  locale: 'en',
  mode: 'compact',
};

describe('formatSpeciesGroupsProtectedValue', () => {
  it('formats the compact summary as a met / total ratio', () => {
    const metric = buildMetric('species_groups_protected', 245, {
      summary: { met: 245, total: 251 },
    });

    expect(formatSpeciesGroupsProtectedValue(metric, compactOptions)).toBe('245 / 251');
  });

  it('preserves compact and full-value tooltip formatting', () => {
    const metric = buildMetric('species_groups_protected', 1_245, {
      summary: { met: 1_245, total: 2_500 },
    });

    expect(formatSpeciesGroupsProtectedValue(metric, compactOptions)).toBe('1.2K / 2.5K');
    expect(
      formatSpeciesGroupsProtectedValue(metric, {
        ...compactOptions,
        mode: 'full',
      }),
    ).toBe('1,245 / 2,500');
  });

  it('preserves a real zero numerator', () => {
    const metric = buildMetric('species_groups_protected', 0, {
      summary: { metSpeciesCount: 0, totalSpeciesCount: 251 },
    });

    expect(formatSpeciesGroupsProtectedValue(metric, compactOptions)).toBe('0 / 251');
  });

  it('falls back to the metric count when either summary value is absent', () => {
    const metric = buildMetric('species_groups_protected', 7, {
      summary: { met: 7 },
    });

    expect(formatSpeciesGroupsProtectedValue(metric, compactOptions)).toBe('7');
  });
});

describe('species reference outcomes', () => {
  it('formats and exposes the authoritative compact 17% and 30% summaries', () => {
    const metric = buildMetric('species_groups_protected', 0, {
      thresholdOutcomes: [
        {
          targetPercent: 17,
          value: 7793,
          details: {
            summary: { metSpeciesCount: 7793, totalSpeciesCount: 8132 },
            groups: {
              birds: { label: 'Birds', metSpeciesCount: 1440, totalSpeciesCount: 1490 },
            },
          },
        },
        {
          targetPercent: 30,
          value: 1529,
          details: {
            summary: { metSpeciesCount: 1529, totalSpeciesCount: 8132 },
            groups: {
              birds: { label: 'Birds', metSpeciesCount: 313, totalSpeciesCount: 1490 },
            },
          },
        },
      ],
    });
    metric.value = null;
    metric.status = 'partial';

    expect(formatSpeciesReferenceValue(metric, compactOptions)).toBe('17%: 7.8K · 30%: 1.5K');
    expect(readSpeciesReferenceSummary(metric)).toEqual({
      reached17Count: 7793,
      reached30Count: 1529,
      totalCount: 8132,
      groups: [
        {
          id: 'birds',
          label: 'Birds',
          reached17Count: 1440,
          reached30Count: 313,
          totalCount: 1490,
        },
      ],
    });
  });
});

describe('resolveOverviewMetric', () => {
  const landMangroves = buildMetric('mangrove_coverage', 12);
  const marineMangroves = buildMetric('marine_mangrove_coverage', 34);
  const metricsById = new Map([
    [landMangroves.metricId, landMangroves],
    [marineMangroves.metricId, marineMangroves],
  ]);

  it('selects the land mangrove metric for a land solution', () => {
    expect(overviewMetricCandidateIds('mangrove_coverage', 'land')).toEqual(['mangrove_coverage']);
    expect(resolveOverviewMetric(metricsById, 'mangrove_coverage', 'land')).toBe(landMangroves);
  });

  it('selects the marine mangrove metric for a marine solution', () => {
    expect(overviewMetricCandidateIds('mangrove_coverage', 'marine')).toEqual([
      'marine_mangrove_coverage',
    ]);
    expect(resolveOverviewMetric(metricsById, 'mangrove_coverage', 'marine')).toBe(marineMangroves);
  });
});

function buildMetric(
  metricId: string,
  value: number,
  details?: Record<string, unknown>,
): MetricValue {
  return {
    metricId,
    value,
    unit: 'count',
    status: 'ready',
    source: 'test',
    notes: null,
    labelKey: `metrics.${metricId}`,
    formatHint: 'number',
    details,
  };
}
