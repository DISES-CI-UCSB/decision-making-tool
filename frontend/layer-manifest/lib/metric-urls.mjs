import { createRequire } from 'node:module';
import { PUBLIC_BLOB_HOST } from '../../shared/runtime-manifest.constants.mjs';

const require = createRequire(import.meta.url);
const RELEASE_CONTRACT = require('../release-contract.json');
const SOLUTION_GOALS_BLOB_DIRECTORY = 'metrics/goals';
const SOLUTION_COMPACT_CACHE_BLOB_DIRECTORY = 'metrics/nick-runs/2026-05-27/compact-cache';
const SOLUTION_MEC_CACHE_BLOB_DIRECTORY = 'metrics/mec-cache';
const SOLUTION_MEC_V2_CACHE_BLOB_DIRECTORY = 'metrics/mec-cache-v2';
export const MEC_GEOGRAPHY_LEVELS = Object.freeze([
  'national',
  'departments',
  'municipalities',
  'siraps',
  'runaps',
  'omecs',
]);

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
  domain = 'land',
  options = {},
) {
  const safeSolutionId = String(solutionId).replace(/\//g, '_').replace(/ /g, '_');
  const {
    mecByGeography: _existingMecByGeography,
    mecV2ByGeography: _existingMecV2ByGeography,
    ...preservedUrls
  } = existingUrls;

  const releaseId = options.releaseId ?? null;
  const releaseRoot = releaseId ? `${RELEASE_CONTRACT.prefixRoot}/${releaseId}` : null;
  const compactDirectory = releaseRoot
    ? `${releaseRoot}/${RELEASE_CONTRACT.regularCompactDirectory}`
    : SOLUTION_COMPACT_CACHE_BLOB_DIRECTORY;
  const mecV2Directory = releaseRoot
    ? `${releaseRoot}/${RELEASE_CONTRACT.mecV2Directory}`
    : SOLUTION_MEC_V2_CACHE_BLOB_DIRECTORY;

  return {
    ...preservedUrls,
    goals: `${PUBLIC_BLOB_HOST}/${SOLUTION_GOALS_BLOB_DIRECTORY}/${safeSolutionId}.goals.json`,
    ...(releaseRoot
      ? {
          cache: `${PUBLIC_BLOB_HOST}/${releaseRoot}/${RELEASE_CONTRACT.regularVerboseDirectory}/${safeSolutionId}.metrics.json`,
        }
      : {}),
    compactCache: `${PUBLIC_BLOB_HOST}/${compactDirectory}/${safeSolutionId}.metrics.compact.json`,
    ...(domain === 'land'
      ? {
          ...(!releaseRoot
            ? { mecByGeography: createMecUrls(safeSolutionId, SOLUTION_MEC_CACHE_BLOB_DIRECTORY) }
            : {}),
          mecV2ByGeography: createMecUrls(safeSolutionId, mecV2Directory),
        }
      : {}),
  };
}

export function defaultReleaseId() {
  return RELEASE_CONTRACT.defaultReleaseId;
}

export function createReleaseBoundaryUrls(releaseId) {
  if (!releaseId) return null;
  return {
    sirapBoundaryUrl: `${PUBLIC_BLOB_HOST}/${RELEASE_CONTRACT.sirapBoundaryPath}`,
    sirapMetadataUrl: `${PUBLIC_BLOB_HOST}/${RELEASE_CONTRACT.sirapMetadataPath}`,
  };
}

function createMecUrls(safeSolutionId, directory) {
  return Object.fromEntries(
    MEC_GEOGRAPHY_LEVELS.map((level) => [
      level,
      `${PUBLIC_BLOB_HOST}/${directory}/${safeSolutionId}/${level}.mec.compact.json`,
    ]),
  );
}
