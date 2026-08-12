import {
  METRIC_COMPATIBLE_SIRAP_BOUNDARY_SOURCES,
  PRODUCTION_SIRAP_BOUNDARY_SOURCE,
  type AOI,
  type CachedSolutionMetricsDocument,
  type GeographyLevel,
  type MetricValue,
} from '@core/models';

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
  if (!document || !isMetricCompatibleAoiSource(aoi)) {
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

export function isMetricCompatibleAoiSource(aoi: AOI): boolean {
  if (aoi.type !== 'sirap') {
    return true;
  }
  if (aoi.boundaryGeometrySelection !== 'whole-feature') {
    return false;
  }

  return (
    (aoi.boundarySourceLayerKey === PRODUCTION_SIRAP_BOUNDARY_SOURCE.layerKey &&
      aoi.boundarySourceId === PRODUCTION_SIRAP_BOUNDARY_SOURCE.sourceId) ||
    METRIC_COMPATIBLE_SIRAP_BOUNDARY_SOURCES.some(
      (source) =>
        source.layerKey === aoi.boundarySourceLayerKey && source.sourceId === aoi.boundarySourceId,
    )
  );
}

export function extractRawAoiScopeId(prefixedAoiId: string): string {
  const separatorIndex = prefixedAoiId.indexOf(':');
  return separatorIndex === -1
    ? prefixedAoiId.trim()
    : prefixedAoiId.slice(separatorIndex + 1).trim();
}

export function normalizeScopeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}
