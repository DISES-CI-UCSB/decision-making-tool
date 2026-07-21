import { PUBLIC_BLOB_HOST } from '../../shared/runtime-manifest.constants.mjs';

const SOLUTION_GOALS_BLOB_DIRECTORY = 'metrics/goals';

export function createPrecomputedMetricUrls(layerId, roleInMetricCalculation) {
  if (roleInMetricCalculation === 'none') {
    return {};
  }
  if (roleInMetricCalculation === 'boundary_used_for_precomputed_metric_lookup') {
    return {
      byBoundaryFeature: `${PUBLIC_BLOB_HOST}/metrics/precomputed/${layerId}/by-feature.json`,
    };
  }
  return {
    national: `${PUBLIC_BLOB_HOST}/metrics/precomputed/${layerId}/nacional.json`,
  };
}

export function createSolutionPrecomputedMetricUrls(
  solutionId,
  existingUrls = {},
  displayUrl = null,
) {
  const safeSolutionId = String(solutionId).replace(/\//g, '_').replace(/ /g, '_');
  const compactCache = deriveNickRunsCompactCacheUrl(displayUrl, solutionId);

  return {
    ...existingUrls,
    goals: `${PUBLIC_BLOB_HOST}/${SOLUTION_GOALS_BLOB_DIRECTORY}/${safeSolutionId}.goals.json`,
    ...(compactCache ? { compactCache } : {}),
  };
}

function deriveNickRunsCompactCacheUrl(displayUrl, solutionId) {
  if (typeof displayUrl !== 'string') {
    return null;
  }
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
