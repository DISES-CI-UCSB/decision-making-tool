import { createRequire } from 'node:module';
import { PUBLIC_BLOB_HOST } from '../../shared/runtime-manifest.constants.mjs';
import { assertArtifactSafeSolutionIds } from './solution-catalog.mjs';

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
  assertArtifactSafeSolutionIds([solutionId]);
  const safeSolutionId = solutionId;
  const {
    mecByGeography: _existingMecByGeography,
    mecV2ByGeography: _existingMecV2ByGeography,
    speciesGoalsCatalog: _existingSpeciesGoalsCatalog,
    speciesGoalsByGeography: _existingSpeciesGoalsByGeography,
    speciesGoalsTargetOverlay: _existingSpeciesGoalsTargetOverlay,
    ...preservedUrls
  } = existingUrls;

  const releaseId = options.releaseId ?? null;
  const releaseRoot = releaseId ? `${RELEASE_CONTRACT.prefixRoot}/${releaseId}` : null;
  const goalsDirectory = releaseRoot
    ? `${releaseRoot}/${RELEASE_CONTRACT.goalsCurrentDirectory}`
    : SOLUTION_GOALS_BLOB_DIRECTORY;
  const compactDirectory = releaseRoot
    ? `${releaseRoot}/${RELEASE_CONTRACT.regularCompactDirectory}`
    : SOLUTION_COMPACT_CACHE_BLOB_DIRECTORY;
  const mecV2Directory = releaseRoot
    ? `${releaseRoot}/${RELEASE_CONTRACT.mecV2Directory}`
    : SOLUTION_MEC_V2_CACHE_BLOB_DIRECTORY;
  const speciesGoalsUrls =
    releaseRoot &&
    domain === 'land' &&
    hasValidatedSpeciesGoalsInventory(options.speciesGoalsInventory, solutionId, releaseId)
      ? createSpeciesGoalsUrls(
          safeSolutionId,
          releaseRoot,
          options.speciesGoalsBaseUrl ?? PUBLIC_BLOB_HOST,
        )
      : null;

  return {
    ...preservedUrls,
    goals: `${PUBLIC_BLOB_HOST}/${goalsDirectory}/${safeSolutionId}.goals.json`,
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
          ...(speciesGoalsUrls ?? {}),
        }
      : {}),
  };
}

function hasValidatedSpeciesGoalsInventory(inventory, solutionId, releaseId) {
  return (
    inventory?.format === 'species-goals-release-inventory-v1' &&
    inventory.validated === true &&
    inventory.solutionId === solutionId &&
    inventory.releaseId === releaseId &&
    inventory.catalogValidated === true &&
    Array.isArray(inventory.validatedGeographyLevels) &&
    inventory.validatedGeographyLevels.length === MEC_GEOGRAPHY_LEVELS.length &&
    MEC_GEOGRAPHY_LEVELS.every(
      (level, index) => inventory.validatedGeographyLevels[index] === level,
    )
  );
}

export function createSpeciesGoalsUrls(safeSolutionId, releaseRoot, baseUrl = PUBLIC_BLOB_HOST) {
  const catalogDirectory = `${releaseRoot}/${RELEASE_CONTRACT.speciesGoalsCatalogDirectory}`;
  const compactDirectory = `${releaseRoot}/${RELEASE_CONTRACT.speciesGoalsCompactDirectory}`;
  return {
    speciesGoalsCatalog: artifactUrl(baseUrl, `${catalogDirectory}/catalog.json`),
    speciesGoalsTargetOverlay: artifactUrl(
      baseUrl,
      `${releaseRoot}/${RELEASE_CONTRACT.speciesGoalsTargetOverlayPath}`,
    ),
    speciesGoalsByGeography: Object.fromEntries(
      MEC_GEOGRAPHY_LEVELS.map((level) => [
        level,
        artifactUrl(
          baseUrl,
          `${compactDirectory}/${safeSolutionId}/${level}.species-goals.compact.json`,
        ),
      ]),
    ),
  };
}

function artifactUrl(baseUrl, pathname) {
  return `${baseUrl.replace(/\/+$/, '')}/${pathname}`;
}

/**
 * Display COGs are published beside each release's source rasters, so the URL is
 * derived from the same basename rather than carried through preflight. Only the
 * domains listed in the release contract publish one; everything else falls back
 * to the plain display raster at runtime.
 */
export function createSolutionDisplayCogUrl(rasterFile, domain, { releaseId } = {}) {
  if (!releaseId || !RELEASE_CONTRACT.displayCogDomains.includes(domain)) {
    return null;
  }
  if (typeof rasterFile !== 'string' || !rasterFile.includes('.')) {
    throw new Error(`cannot derive a display COG URL without a raster file name (${rasterFile})`);
  }
  const basename = rasterFile.slice(0, rasterFile.lastIndexOf('.'));
  const directory = `${RELEASE_CONTRACT.prefixRoot}/${releaseId}/${RELEASE_CONTRACT.displayCogDirectory}/${domain}`;
  return `${PUBLIC_BLOB_HOST}/${directory}/${basename}${RELEASE_CONTRACT.displayCogSuffix}`;
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
