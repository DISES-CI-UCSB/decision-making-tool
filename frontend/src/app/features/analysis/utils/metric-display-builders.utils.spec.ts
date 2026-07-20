import type { MetricValue } from '@core/models';
import { buildMetricComparisons, buildMetricSections } from './metric-display-builders.utils';

describe('metric display builders', () => {
  it('groups DTO metrics in the requested display order', () => {
    const biodiversity = buildMetric('biodiversity', 4);
    const carbon = buildMetric('carbon', 8);

    expect(
      buildMetricSections(
        [carbon, biodiversity, buildMetric('unmapped', 1)],
        {
          biodiversity: { id: 'ecology', labelKey: 'sections.ecology' },
          carbon: { id: 'climate', labelKey: 'sections.climate' },
        },
        ['ecology', 'climate'],
      ),
    ).toEqual([
      {
        sectionId: 'ecology',
        sectionLabelKey: 'sections.ecology',
        metrics: [biodiversity],
      },
      {
        sectionId: 'climate',
        sectionLabelKey: 'sections.climate',
        metrics: [carbon],
      },
    ]);
  });

  it('builds comparisons only for matching DTO metrics', () => {
    const baseline = buildMetric('area', 7);
    const pendingBaseline = {
      ...buildMetric('pending', 5),
      status: 'pending' as const,
      value: null,
    };
    const comparisons = buildMetricComparisons(
      [baseline, pendingBaseline, buildMetric('missing', 1)],
      [buildMetric('area', 9), buildMetric('pending', 8)],
    );

    expect(comparisons.map(({ metricId, delta }) => ({ metricId, delta }))).toEqual([
      { metricId: 'area', delta: 2 },
      { metricId: 'pending', delta: null },
    ]);
  });
});

function buildMetric(metricId: string, value: number): MetricValue {
  return {
    metricId,
    value,
    unit: 'km²',
    status: 'ready',
    source: 'test',
    notes: null,
    labelKey: `metrics.${metricId}`,
    formatHint: 'number',
  };
}
