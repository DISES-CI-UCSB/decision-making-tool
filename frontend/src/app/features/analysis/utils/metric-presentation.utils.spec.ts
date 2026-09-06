import type { MetricComparisonValue, MetricValue } from '@core/models';
import {
  displayableMetricValue,
  formatAreaValue,
  formatMetricDelta,
  formatMetricValue,
  formatNumber,
  formatSpeciesCoveragePercent,
  isDisplayableMetricValue,
  metricAvailabilityNote,
} from './metric-presentation.utils';

describe('metric presentation utilities', () => {
  const options = { areaUnit: 'km2', locale: 'es', mode: 'full' } as const;

  it('normalizes units and converts only area metrics', () => {
    const area = buildMetric('priority_area_in_region', 9, 'km2');
    const marineAreas = [
      buildMetric('coral_reef_coverage', 1.25, 'km2'),
      buildMetric('marine_mangrove_coverage', 2.5, 'km²'),
      buildMetric('seagrass_coverage', 3.75, 'km2'),
    ];
    const carbon = buildMetric('carbon_storage_biomass', 40, 'Mg·km²');

    expect(formatMetricValue(area, options, '--')).toBe('9 km²');
    expect(formatMetricValue(carbon, options, '--')).toBe('40 Mg·km²');
    expect(formatMetricValue(area, { ...options, areaUnit: 'hectares' }, '--')).toBe('900 ha');
    expect(
      marineAreas.map((metric) =>
        formatMetricValue(metric, { ...options, areaUnit: 'hectares' }, '--'),
      ),
    ).toEqual(['125 ha', '250 ha', '375 ha']);
    expect(formatMetricValue(carbon, { ...options, areaUnit: 'hectares' }, '--')).toBe('40 Mg·km²');
  });

  it('formats percentages, unavailable values, and signed area deltas', () => {
    const percent = buildMetric('national_contribution', 1.25, '%', 'percent');
    const area = buildMetric('priority_area_in_region', 9, 'km²');
    const comparison: MetricComparisonValue = {
      metricId: area.metricId,
      labelKey: area.labelKey,
      formatHint: area.formatHint,
      baseline: { ...area, value: 7 },
      candidate: area,
      delta: 2,
    };

    expect(formatMetricValue(percent, options, '--')).toBe('1,3%');
    expect(formatMetricValue({ ...percent, value: null }, options, 'Unavailable')).toBe(
      'Unavailable',
    );
    expect(formatMetricDelta(comparison, options, '--')).toBe('+2 km²');
    expect(formatMetricDelta(comparison, { ...options, areaUnit: 'hectares' }, '--')).toBe(
      '+200 ha',
    );
  });

  it('keeps locale-aware compact formatting pure', () => {
    expect(formatNumber(2_300, { locale: 'es', mode: 'compact' }, 0, 1)).toBe('2,3 mil');
    expect(formatNumber(2_300, { locale: 'en', mode: 'compact' }, 0, 1)).toBe('2.3K');
    expect(formatAreaValue(2.5, options)).toBe('2,5 km²');
  });

  it('displays partial values with an explicit source warning', () => {
    const metric: MetricValue = {
      ...buildMetric('threatened_species_secured', 27, 'count'),
      status: 'partial',
      notes: 'Calculated from the available species inventory.',
      details: {
        speciesException: {
          excluded: 2,
        },
      },
    };

    expect(isDisplayableMetricValue(metric)).toBe(true);
    expect(displayableMetricValue(metric)).toBe(27);
    expect(formatMetricValue(metric, options, '--')).toBe('27');
    expect(metricAvailabilityNote(metric)).toEqual({
      key: 'analysis.common.partialSpeciesSources',
      counts: { excluded: 2 },
    });
  });

  it('reports the release species-exception coverage when the artifact carries catalog totals', () => {
    const metric: MetricValue = {
      ...buildMetric('species_groups_protected', 8_043, 'count'),
      status: 'partial',
      details: {
        speciesException: { catalogTotal: 8_300, availableExpected: 8_298, excluded: 2 },
      },
    };

    expect(metricAvailabilityNote(metric)).toEqual({
      key: 'analysis.common.partialSpeciesCoverage',
      counts: { available: 8_298, total: 8_300 },
    });
  });

  it('withholds partial metrics that carry no value, and never notes complete metrics', () => {
    const targetless: MetricValue = {
      ...buildMetric('species_groups_protected', null, 'count'),
      status: 'partial',
    };
    const marine: MetricValue = {
      ...buildMetric('species_richness_mammals', null, 'count'),
      status: 'not_applicable',
    };
    const complete = buildMetric('ecosystem_coverage', 327_030, 'km2');

    expect(displayableMetricValue(targetless)).toBeNull();
    expect(displayableMetricValue(marine)).toBeNull();
    expect(metricAvailabilityNote(complete)).toBeNull();
    expect(metricAvailabilityNote(marine)).toBeNull();
  });
});

describe('formatSpeciesCoveragePercent', () => {
  it('uses adaptive decimals so non-zero values never display as 0%', () => {
    expect(formatSpeciesCoveragePercent(50, 'en')).toBe('50%');
    expect(formatSpeciesCoveragePercent(0.148, 'en')).toBe('0.1%');
    expect(formatSpeciesCoveragePercent(0.0148, 'en')).toBe('0.01%');
    expect(formatSpeciesCoveragePercent(0, 'en')).toBe('0%');
  });

  it('formats small percentages with locale-aware separators', () => {
    expect(formatSpeciesCoveragePercent(0.0148, 'es')).toBe('0,01%');
  });
});

function buildMetric(
  metricId: string,
  value: number | null,
  unit: string,
  formatHint: MetricValue['formatHint'] = 'number',
): MetricValue {
  return {
    metricId,
    value,
    unit,
    status: value === null ? 'pending' : 'ready',
    source: 'test',
    notes: null,
    labelKey: `metrics.${metricId}`,
    formatHint,
  };
}
