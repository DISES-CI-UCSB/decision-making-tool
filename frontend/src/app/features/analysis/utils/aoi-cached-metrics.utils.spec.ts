import type { AOI, CachedSolutionMetricsDocument, MetricValue } from '@core/models';
import {
  aoiTypeToGeographyLevel,
  isMetricCompatibleAoiSource,
  resolveCachedAoiMetrics,
} from './aoi-cached-metrics.utils';

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

  it.each([
    ['siraps', 'aoi-siraps-combined-colombia'],
    ['siraps_territorial_updated', 'aoi-siraps-territorial-updated-colombia'],
    ['siraps_thematic', 'aoi-siraps-thematic-colombia'],
  ])('preserves cached SIRAP metrics for production source %s', (layerKey, sourceId) => {
    const aoi = buildSirapAoi(layerKey, sourceId);
    const sirapDocument = buildSirapDocument(bogotaMetric);

    expect(isMetricCompatibleAoiSource(aoi)).toBe(true);
    expect(resolveCachedAoiMetrics(sirapDocument, aoi)).toEqual([bogotaMetric]);
  });

  it('resolves a regional packet from its declared singular SIRAP primary scope', () => {
    const aoi = {
      ...buildSirapAoi('siraps', 'aoi-siraps-combined-colombia'),
      id: 'sirap:eje-cafetero',
      name: 'SIRAP Eje Cafetero',
    };
    const sirapDocument: CachedSolutionMetricsDocument = {
      solutionId: 'regional-solution',
      generatedAt: '2026-08-29T00:00:00.000Z',
      primaryGeography: { level: 'sirap', scopeId: 'eje-cafetero' },
      geographies: {
        sirap: {
          'eje-cafetero': { name: 'SIRAP Eje Cafetero', metrics: [bogotaMetric] },
        },
      },
    };

    expect(resolveCachedAoiMetrics(sirapDocument, aoi)).toEqual([bogotaMetric]);
  });

  it('does not resolve a singular SIRAP scope for a mismatched or undeclared primary geography', () => {
    const aoi = {
      ...buildSirapAoi('siraps', 'aoi-siraps-combined-colombia'),
      id: 'sirap:eje-cafetero',
      name: 'SIRAP Eje Cafetero',
    };
    const document = buildSirapPrimaryDocument('orinoquia', bogotaMetric);

    expect(resolveCachedAoiMetrics(document, aoi)).toEqual([]);
    expect(resolveCachedAoiMetrics({ ...document, primaryGeography: undefined }, aoi)).toEqual([]);
  });

  it('does not resolve a singular SIRAP primary scope for a component selection', () => {
    const aoi = {
      ...buildSirapAoi('siraps', 'aoi-siraps-combined-colombia'),
      id: 'sirap:eje-cafetero',
      boundaryGeometrySelection: 'component' as const,
    };

    expect(
      resolveCachedAoiMetrics(buildSirapPrimaryDocument('eje-cafetero', bogotaMetric), aoi),
    ).toEqual([]);
  });

  it('rejects cached SIRAP metrics from the outdated territorial source', () => {
    const aoi = buildSirapAoi('siraps_territorial', 'aoi-siraps-territorial-colombia');

    expect(isMetricCompatibleAoiSource(aoi)).toBe(false);
    expect(resolveCachedAoiMetrics(buildSirapDocument(bogotaMetric), aoi)).toEqual([]);
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

function buildSirapAoi(boundarySourceLayerKey: string, boundarySourceId: string): AOI {
  return {
    id: 'sirap:territorial_territorial_amazonia_3',
    name: 'Territorial Amazonia',
    type: 'sirap',
    geometryUrl: '/inputs/boundaries/sirap/example.geojson',
    boundarySourceLayerKey,
    boundarySourceId,
    boundaryGeometrySelection: 'whole-feature',
  };
}

function buildSirapDocument(metric: MetricValue): CachedSolutionMetricsDocument {
  return {
    solutionId: 'solution',
    generatedAt: '2026-07-20T00:00:00.000Z',
    geographies: {
      siraps: {
        territorial_territorial_amazonia_3: {
          name: 'Territorial Amazonia',
          metrics: [metric],
        },
      },
    },
  };
}

function buildSirapPrimaryDocument(
  scopeId: string,
  metric: MetricValue,
): CachedSolutionMetricsDocument {
  return {
    solutionId: 'regional-solution',
    generatedAt: '2026-08-29T00:00:00.000Z',
    primaryGeography: { level: 'sirap', scopeId },
    geographies: {
      sirap: {
        [scopeId]: { metrics: [metric] },
      },
    },
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
