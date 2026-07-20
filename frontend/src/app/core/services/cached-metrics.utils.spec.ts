import {
  buildCachedMetricsBlobPath,
  buildCachedMetricsUrl,
  buildGoalsUrl,
  buildStagingCompactMetricsUrl,
  expandCompactMetricsDocument,
  getPrecomputedMetricUrl,
  metricsForScope,
  nationalMetrics,
  PRECOMPUTED_METRIC_URL_KEYS,
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
    expect(
      buildGoalsUrl('https://aagibolq28slyfof.public.blob.vercel-storage.com/', 'nick runs/ecos17'),
    ).toBe(
      'https://aagibolq28slyfof.public.blob.vercel-storage.com/metrics/goals/nick_runs_ecos17.goals.json',
    );
  });

  it('prefers manifest metric URLs in the declared order', () => {
    expect(
      getPrecomputedMetricUrl(
        {
          cache: 'cache-url',
          compact: 'compact-url',
        },
        PRECOMPUTED_METRIC_URL_KEYS.cache,
      ),
    ).toBe('compact-url');
    expect(getPrecomputedMetricUrl(undefined, PRECOMPUTED_METRIC_URL_KEYS.goals)).toBeNull();
  });

  it('builds an explicit compact metrics fallback for staging runs', () => {
    expect(
      buildStagingCompactMetricsUrl(
        'https://example.com/solutions/nick-runs/2026-05-27/example.tif',
        'example',
      ),
    ).toBe(
      'https://example.com/metrics/nick-runs/2026-05-27/compact-cache/example.metrics.compact.json',
    );
    expect(
      buildStagingCompactMetricsUrl(
        'https://example.com/solutions/nacional/example.tif',
        'example',
      ),
    ).toBeNull();
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

  it('expands compact metrics documents into the cached metrics shape', () => {
    const document = expandCompactMetricsDocument({
      format: 'metrics-compact-v1',
      solutionId: 'demo',
      generatedAt: '2026-05-28T00:00:00Z',
      metricCatalog: [
        ['national_contribution', '%', 'metrics.national_contribution', 'percent'],
        ['species_groups_protected', 'count', 'metrics.species_groups_protected', 'number'],
      ],
      statusCatalog: ['ready'],
      sourceCatalog: ['raster:solution', 'solution:metadataUrl:summary_csv'],
      notesCatalog: [null, 'See details.groups for per-group ratios.'],
      geographies: {
        national: {
          colombia: {
            name: 'Colombia',
            metrics: [
              [0, 12.5, 0, 0, 0],
              [
                1,
                245,
                0,
                1,
                1,
                {
                  summary: { metSpeciesCount: 245, totalSpeciesCount: 251 },
                  groups: {
                    mammals: {
                      label: 'Mammals',
                      metSpeciesCount: 245,
                      totalSpeciesCount: 251,
                    },
                  },
                },
              ],
            ],
          },
        },
      },
    });

    expect(nationalMetrics(document)).toEqual([
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
      {
        metricId: 'species_groups_protected',
        value: 245,
        unit: 'count',
        status: 'ready',
        source: 'solution:metadataUrl:summary_csv',
        notes: 'See details.groups for per-group ratios.',
        labelKey: 'metrics.species_groups_protected',
        formatHint: 'number',
        details: {
          summary: { metSpeciesCount: 245, totalSpeciesCount: 251 },
          groups: {
            mammals: {
              label: 'Mammals',
              metSpeciesCount: 245,
              totalSpeciesCount: 251,
            },
          },
        },
      },
    ]);
  });
});
