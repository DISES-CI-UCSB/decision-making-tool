import type { AOI, CachedSolutionMetricsDocument, MetricValue } from '@core/models';
import { aoiTypeToGeographyLevel, resolveCachedAoiMetrics } from './aoi-cached-metrics.utils';

describe('AOI cached metrics utilities', () => {
  const bogotaMetric = buildMetric('priority_area_in_region', 9);
  const document: CachedSolutionMetricsDocument = {
    solutionId: 'solution',
    generatedAt: '2026-07-20T00:00:00.000Z',
    geographies: {
      municipalities: {
        '11001': { name: 'Bogotá, D.C.', metrics: [bogotaMetric] },
      },
    },
  };

  it('maps fixed AOI types to cached geography levels', () => {
    expect(aoiTypeToGeographyLevel('department')).toBe('departments');
    expect(aoiTypeToGeographyLevel('municipality')).toBe('municipalities');
    expect(aoiTypeToGeographyLevel('custom')).toBeNull();
  });

  it('resolves a prefixed AOI id directly', () => {
    expect(resolveCachedAoiMetrics(document, buildAoi('municipality:11001', 'Bogota'))).toEqual([
      bogotaMetric,
    ]);
  });

  it('falls back to accent-insensitive scope names', () => {
    expect(
      resolveCachedAoiMetrics(document, buildAoi('municipality:missing', 'Bogota D.C.')),
    ).toEqual([bogotaMetric]);
  });

  it('returns no cached metrics for custom AOIs', () => {
    expect(
      resolveCachedAoiMetrics(document, {
        ...buildAoi('custom:drawn', 'Drawn AOI'),
        type: 'custom',
      }),
    ).toEqual([]);
  });
});

function buildAoi(id: string, name: string): AOI {
  return {
    id,
    name,
    type: 'municipality',
    geometryUrl: '/boundaries/municipalities.geojson',
  };
}

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
