import type {
  CachedSolutionMetricsDocument,
  CompactSolutionMetricsDocument,
  GeographyLevel,
  GeographyMetricsScope,
  MetricValue,
  RuntimeSolutionPrecomputedMetricUrls,
  SolutionMetricsResponse,
} from '@core/models';

export const CACHED_METRICS_BLOB_PREFIX = 'metrics/cache';
export const CACHED_METRICS_SUFFIX = '.metrics.json';
export const GOALS_BLOB_PREFIX = 'metrics/goals';
export const GOALS_SUFFIX = '.goals.json';
export const COMPACT_METRICS_FORMAT = 'metrics-compact-v1';
export const PRECOMPUTED_METRIC_URL_KEYS = {
  cache: ['compactCache', 'compact', 'cache'],
  goals: ['goals'],
} as const;

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

export function buildGoalsUrl(blobHost: string, solutionId: string): string {
  const host = blobHost.replace(/\/+$/, '');
  return `${host}/${GOALS_BLOB_PREFIX}/${toSafeSolutionId(solutionId)}${GOALS_SUFFIX}`;
}

export function getPrecomputedMetricUrl(
  urls: RuntimeSolutionPrecomputedMetricUrls | undefined,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const url = urls?.[key];
    if (typeof url === 'string' && url) {
      return url;
    }
  }
  return null;
}

export function deriveBlobHostFromUrl(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function buildStagingCompactMetricsUrl(
  displayUrl: string,
  solutionId: string,
): string | null {
  try {
    const url = new URL(displayUrl);
    const run = url.pathname.match(/^\/solutions\/nick-runs\/([^/]+)\//)?.[1];
    return run
      ? `${url.origin}/metrics/nick-runs/${run}/compact-cache/${solutionId}.metrics.compact.json`
      : null;
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
          ...(scope.scopeState ? { scopeState: scope.scopeState } : {}),
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
    ...(document.metricsProvenance ? { metricsProvenance: document.metricsProvenance } : {}),
    ...(document.primaryGeography ? { primaryGeography: document.primaryGeography } : {}),
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
  const primary = document?.primaryGeography;
  if (primary) {
    return document?.geographies?.[primary.level]?.[primary.scopeId]?.metrics ?? [];
  }
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
