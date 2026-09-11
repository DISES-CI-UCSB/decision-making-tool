import type { GoalFeatureRow, HydratedSpeciesGoalsRecord, MetricValue } from '@core/models';
import { describe, expect, it } from 'vitest';
import type { MetricFormatOptions } from '../utils/metric-presentation.utils';
import {
  formatSpeciesReferenceValue,
  formatSpeciesGroupsProtectedValue,
  normalizeSpeciesGoalsTaxonId,
  overviewMetricCandidateIds,
  readSpeciesReferenceSummary,
  resolveOverviewMetric,
  rollupSpeciesGoalsTaxa,
  summarizeEcosystemGoals,
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

describe('summarizeEcosystemGoals', () => {
  it('uses one goals feature universe for target and checkpoint counts', () => {
    const features = Array.from({ length: 417 }, (_, index) =>
      buildGoalFeature(index, index < 194 ? 0.3 : 0.17),
    );

    expect(summarizeEcosystemGoals(features)).toEqual({
      metCount: 417,
      totalCount: 417,
      pctMet: 100,
      reached17Count: 417,
      reached30Count: 194,
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

describe('species-goals taxa rollup', () => {
  it('normalizes Mesa and catalog taxon aliases', () => {
    expect(normalizeSpeciesGoalsTaxonId('Amphibia')).toBe('amphibians');
    expect(normalizeSpeciesGoalsTaxonId('Amphibians')).toBe('amphibians');
    expect(normalizeSpeciesGoalsTaxonId('mammals')).toBe('mammals');
    expect(normalizeSpeciesGoalsTaxonId('unknown')).toBeNull();
  });

  it('counts every available catalog row and only configured-target hits', () => {
    const records = [
      buildSpeciesGoalsRecord('frog-met', 'Amphibians', true, true, false),
      ...Array.from({ length: 3 }, (_, index) =>
        buildSpeciesGoalsRecord(`frog-extra-${index}`, 'Amphibia', null, false, false),
      ),
      buildSpeciesGoalsRecord('bear', 'Mammals', false, true, true),
      buildSpeciesGoalsRecord('ghost-frog', 'Amphibians', true, true, true, 'unavailable'),
    ];

    expect(rollupSpeciesGoalsTaxa(records)).toEqual([
      {
        id: 'mammals',
        metCount: 0,
        totalCount: 1,
        pctMet: 0,
        reached17Count: 1,
        reached30Count: 1,
      },
      {
        id: 'amphibians',
        metCount: 1,
        totalCount: 4,
        pctMet: 25,
        reached17Count: 1,
        reached30Count: 0,
      },
    ]);
  });

  it('uses 17/30 checkpoints when a taxon has no configured targets', () => {
    const records = [
      buildSpeciesGoalsRecord('frog-a', 'amphibians', null, true, false),
      buildSpeciesGoalsRecord('frog-b', 'amphibians', null, true, true),
    ];

    expect(rollupSpeciesGoalsTaxa(records)).toEqual([
      {
        id: 'amphibians',
        metCount: 0,
        totalCount: 2,
        pctMet: null,
        reached17Count: 2,
        reached30Count: 1,
      },
    ]);
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

function buildSpeciesGoalsRecord(
  id: string,
  group: string,
  configuredTargetMet: boolean | null,
  met17: boolean,
  met30: boolean,
  availability: HydratedSpeciesGoalsRecord['availability'] = 'available',
): HydratedSpeciesGoalsRecord {
  return {
    id,
    scientific_name: id,
    group,
    iucn_status: null,
    range_area_km2: 10,
    range_in_aoi_area_km2: 10,
    range_in_aoi_pct: 100,
    solution_covered_in_aoi_area_km2: 1,
    solution_covered_in_aoi_pct: 10,
    pre_existing_covered_in_aoi_area_km2: 0,
    pre_existing_covered_in_aoi_pct: 0,
    new_covered_in_aoi_area_km2: 1,
    new_covered_in_aoi_pct: 10,
    availability,
    no_range_in_scope: false,
    configured_target_percent: configuredTargetMet === null ? null : 17,
    met_17_percent: met17,
    met_30_percent: met30,
    configured_target_met: configuredTargetMet,
  };
}

function buildGoalFeature(index: number, relativeHeld: number): GoalFeatureRow {
  return {
    featureId: `ecosystem-${index}`,
    featureName: `Ecosystem ${index}`,
    featureType: 'ecosystems',
    met: true,
    totalAmount: 100,
    absoluteTarget: 17,
    absoluteHeld: relativeHeld * 100,
    absoluteShortfall: 0,
    relativeTarget: 0.17,
    relativeHeld,
    relativeShortfall: 0,
    scenario: 'test',
  };
}
