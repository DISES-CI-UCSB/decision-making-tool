import type {
  CachedSolutionMetricsDocument,
  CompactSolutionMetricsDocument,
  GeographyLevel,
  GeographyMetricsScope,
  MetricValue,
  SolutionMetricsResponse,
} from '@core/models';

export const CACHED_METRICS_BLOB_PREFIX = 'metrics/cache';
export const CACHED_METRICS_SUFFIX = '.metrics.json';
export const COMPACT_METRICS_FORMAT = 'metrics-compact-v1';

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

export function isCompactMetricsDocument(
  document: CachedSolutionMetricsDocument | CompactSolutionMetricsDocument,
): document is CompactSolutionMetricsDocument {
  return 'format' in document && document.format === COMPACT_METRICS_FORMAT;
}

export function expandCompactMetricsDocument(
  document: CompactSolutionMetricsDocument,
): CachedSolutionMetricsDocument {
  const geographies: CachedSolutionMetricsDocument['geographies'] = {};

  for (const [level, scopes] of Object.entries(document.geographies)) {
    if (!scopes) continue;
    geographies[level] = Object.fromEntries(
      Object.entries(scopes).map(([scopeId, scope]) => [
        scopeId,
        {
          ...(scope.name ? { name: scope.name } : {}),
          ...(scope.kind ? { kind: scope.kind } : {}),
          ...(scope.subtype ? { subtype: scope.subtype } : {}),
          metrics: scope.metrics.map(
            ([metricIndex, value, statusIndex, sourceIndex, notesIndex, details]) => {
              const [metricId, unit, labelKey, formatHint] = document.metricCatalog[metricIndex];
              return {
                metricId,
                value,
                unit,
                status: document.statusCatalog[statusIndex],
                source: document.sourceCatalog[sourceIndex],
                notes: document.notesCatalog[notesIndex],
                labelKey,
                formatHint,
                ...(details !== undefined ? { details } : {}),
              };
            },
          ),
        },
      ]),
    );
  }

  return {
    solutionId: document.solutionId,
    generatedAt: document.generatedAt,
    geographies,
  };
}

export function normalizeMetricsDocument(
  document: CachedSolutionMetricsDocument | CompactSolutionMetricsDocument,
): CachedSolutionMetricsDocument {
  return isCompactMetricsDocument(document) ? expandCompactMetricsDocument(document) : document;
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
