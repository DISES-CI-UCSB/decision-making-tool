import type { AOI, CachedSolutionMetricsDocument, GeographyLevel, MetricValue } from '@core/models';

export function aoiTypeToGeographyLevel(type: AOI['type']): GeographyLevel | null {
  switch (type) {
    case 'department':
      return 'departments';
    case 'municipality':
      return 'municipalities';
    case 'sirap':
      return 'siraps';
    case 'runap':
      return 'runaps';
    case 'omec':
      return 'omecs';
    default:
      return null;
  }
}

export function resolveCachedAoiMetrics(
  document: CachedSolutionMetricsDocument | null,
  aoi: AOI,
): MetricValue[] {
  if (!document) {
    return [];
  }

  const level = aoiTypeToGeographyLevel(aoi.type);
  if (!level) {
    return [];
  }

  const geographies = document.geographies[level] ?? {};
  const directCandidates = [extractRawAoiScopeId(aoi.id), aoi.name].filter(
    (candidate) => candidate.trim().length > 0,
  );
  for (const scopeId of directCandidates) {
    const metrics = geographies[scopeId]?.metrics ?? [];
    if (metrics.length > 0) {
      return metrics;
    }
  }

  const normalizedAoiName = normalizeScopeLabel(aoi.name);
  for (const [scopeId, scope] of Object.entries(geographies)) {
    if (
      normalizeScopeLabel(scopeId) === normalizedAoiName ||
      normalizeScopeLabel(scope.name ?? '') === normalizedAoiName
    ) {
      return scope.metrics ?? [];
    }
  }

  return [];
}

function extractRawAoiScopeId(prefixedAoiId: string): string {
  const separatorIndex = prefixedAoiId.indexOf(':');
  return separatorIndex === -1
    ? prefixedAoiId.trim()
    : prefixedAoiId.slice(separatorIndex + 1).trim();
}

function normalizeScopeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}
