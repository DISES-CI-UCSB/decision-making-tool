import type {
  CachedSolutionMetricsDocument,
  GeographyLevel,
  GeographyMetricsScope,
  MetricValue,
  SolutionMetricsResponse,
} from '@core/models';

export const CACHED_METRICS_BLOB_PREFIX = 'metrics/cache';
export const CACHED_METRICS_SUFFIX = '.metrics.json';

export function toSafeSolutionId(solutionId: string): string {
  return solutionId.replace(/\//g, '_').replace(/ /g, '_');
}

export function buildCachedMetricsBlobPath(solutionId: string): string {
  return `${CACHED_METRICS_BLOB_PREFIX}/${toSafeSolutionId(solutionId)}${CACHED_METRICS_SUFFIX}`;
}

export function buildCachedMetricsUrl(blobHost: string, solutionId: string): string {
  const host = blobHost.replace(/\/+$/, '');
  return `${host}/${buildCachedMetricsBlobPath(solutionId)}`;
}

export function deriveBlobHostFromUrl(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function nationalMetrics(
  document: CachedSolutionMetricsDocument | null | undefined,
): MetricValue[] {
  return document?.geographies?.national?.['colombia']?.metrics ?? [];
}

export function metricsForScope(
  document: CachedSolutionMetricsDocument | null | undefined,
  level: GeographyLevel | string,
  scopeId: string,
): MetricValue[] {
  return document?.geographies?.[level]?.[scopeId]?.metrics ?? [];
}

export function geographyScope(
  document: CachedSolutionMetricsDocument | null | undefined,
  level: GeographyLevel | string,
  scopeId: string,
): GeographyMetricsScope | null {
  return document?.geographies?.[level]?.[scopeId] ?? null;
}

/** Wrap legacy flat mock responses into the cached multi-geography shape. */
export function wrapFlatMetricsResponse(
  response: SolutionMetricsResponse,
): CachedSolutionMetricsDocument {
  return {
    solutionId: response.solutionId,
    generatedAt: response.generatedAt,
    geographies: {
      national: {
        colombia: {
          name: 'Colombia',
          metrics: response.metrics,
        },
      },
    },
  };
}
