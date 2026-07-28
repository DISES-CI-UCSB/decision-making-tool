import type { MetricComparisonValue, MetricValue } from '@core/models';
import {
  formatAreaValue,
  formatMetricDelta,
  formatMetricValue,
  formatNumber,
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
