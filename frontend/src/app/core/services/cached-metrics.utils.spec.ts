import {
  buildCachedMetricsBlobPath,
  buildCachedMetricsUrl,
  metricsForScope,
  nationalMetrics,
  toSafeSolutionId,
  wrapFlatMetricsResponse,
} from './cached-metrics.utils';

describe('cached-metrics.utils', () => {
  it('builds deterministic blob paths from solution ids', () => {
    expect(toSafeSolutionId('ecos17_estr30_runap_hf')).toBe('ecos17_estr30_runap_hf');
    expect(buildCachedMetricsBlobPath('ecos17_estr30_runap_hf')).toBe(
      'metrics/cache/ecos17_estr30_runap_hf.metrics.json',
    );
    expect(
      buildCachedMetricsUrl(
        'https://aagibolq28slyfof.public.blob.vercel-storage.com',
        'ecos17_estr30_runap_hf',
      ),
    ).toBe(
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/metrics/cache/ecos17_estr30_runap_hf.metrics.json',
    );
  });

  it('reads national metrics from a cached document', () => {
    const document = wrapFlatMetricsResponse({
      solutionId: 'demo',
      generatedAt: '2026-05-22T00:00:00Z',
      metrics: [
        {
          metricId: 'national_contribution',
          value: 12.5,
          unit: '%',
          status: 'ready',
          source: 'raster:solution',
          notes: null,
          labelKey: 'metrics.national_contribution',
          formatHint: 'percent',
        },
      ],
    });

    expect(nationalMetrics(document)).toHaveLength(1);
    expect(nationalMetrics(document)[0].metricId).toBe('national_contribution');
  });

  it('reads scoped metrics for departments and municipalities', () => {
    const document = wrapFlatMetricsResponse({
      solutionId: 'demo',
      generatedAt: '2026-05-22T00:00:00Z',
      metrics: [],
    });
    document.geographies.departments = {
      '05': {
        name: 'Antioquia',
        metrics: [
          {
            metricId: 'priority_area_in_region',
            value: 1000,
            unit: 'km2',
            status: 'ready',
            source: 'raster:solution',
            notes: null,
            labelKey: 'metrics.priority_area_total',
            formatHint: 'number',
          },
        ],
      },
    };

    expect(metricsForScope(document, 'departments', '05')).toHaveLength(1);
    expect(metricsForScope(document, 'municipalities', '05001')).toEqual([]);
  });
});
