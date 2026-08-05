import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { PUBLIC_BLOB_HOST } from '../../shared/runtime-manifest.constants.mjs';

export const SOLUTION_CATALOG_FORMAT = 'solution-catalog-v1';

const RELEASE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const SAFE_SOLUTION_ID_PATTERN = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
const DOMAINS = ['land', 'marine'];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNonEmptyString(value, label) {
  assert(
    typeof value === 'string' && value.trim().length > 0,
    `${label} must be a non-empty string`,
  );
}

function assertCount(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative integer`);
}

function catalogCounts(catalog) {
  const total = catalog.expectedSolutionCount;
  const land = catalog.expectedLandSolutionCount;
  const marine = catalog.expectedMarineSolutionCount;
  assertCount(total, 'catalog.expectedSolutionCount');
  assertCount(land, 'catalog.expectedLandSolutionCount');
  assertCount(marine, 'catalog.expectedMarineSolutionCount');
  assert(
    land + marine === total,
    'catalog.expectedSolutionCount must equal expectedLandSolutionCount + expectedMarineSolutionCount',
  );
  return { total, land, marine };
}

export function validateSolutionCatalog(catalog) {
  assert(
    catalog && typeof catalog === 'object' && !Array.isArray(catalog),
    'catalog must be an object',
  );
  assert(
    catalog.format === SOLUTION_CATALOG_FORMAT,
    `catalog.format must be "${SOLUTION_CATALOG_FORMAT}"`,
  );
  assertNonEmptyString(catalog.catalogVersion, 'catalog.catalogVersion');
  assert(
    SEMVER_PATTERN.test(catalog.catalogVersion),
    'catalog.catalogVersion must be a semantic version (pre-1.0 versions such as 0.1.0 are supported)',
  );
  assertNonEmptyString(catalog.releaseId, 'catalog.releaseId');
  assert(
    RELEASE_ID_PATTERN.test(catalog.releaseId),
    'catalog.releaseId must be lowercase and hyphenated',
  );
  const counts = catalogCounts(catalog);
  assert(Array.isArray(catalog.solutions), 'catalog.solutions must be an array');
  assert(catalog.solutions.length > 0, 'catalog.solutions must be non-empty');
  assert(
    catalog.solutions.length === counts.total,
    `catalog.solutions must contain exactly ${counts.total} entries; got ${catalog.solutions.length}`,
  );

  const solutionIds = [];
  const solutionBasenames = [];
  for (const [index, solution] of catalog.solutions.entries()) {
    const label = `catalog.solutions[${index}]`;
    assert(
      solution && typeof solution === 'object' && !Array.isArray(solution),
      `${label} must be an object`,
    );
    assertNonEmptyString(solution.solutionId, `${label}.solutionId`);
    assertNonEmptyString(solution.solutionBasename, `${label}.solutionBasename`);
    assert(
      !/[\\/]/.test(solution.solutionBasename),
      `${label}.solutionBasename must be a basename`,
    );
    assert(
      /^.+\.tif$/.test(solution.solutionBasename),
      `${label}.solutionBasename must end with the exact lowercase .tif extension`,
    );
    assert(
      DOMAINS.includes(solution.domain),
      `${label}.domain must be one of: ${DOMAINS.join(', ')}`,
    );
    assertNonEmptyString(solution.rasterSha256, `${label}.rasterSha256`);
    assert(
      SHA256_PATTERN.test(solution.rasterSha256.toLowerCase()),
      `${label}.rasterSha256 must be a SHA-256 hex digest`,
    );
    solution.rasterSha256 = solution.rasterSha256.toLowerCase();
    solutionIds.push(solution.solutionId);
    solutionBasenames.push(solution.solutionBasename);
  }

  const duplicateIds = solutionIds.filter((id, index) => solutionIds.indexOf(id) !== index);
  assert(
    duplicateIds.length === 0,
    `catalog.solutions contains duplicate solutionId values: ${[...new Set(duplicateIds)].join(', ')}`,
  );
  assertArtifactSafeSolutionIds(solutionIds);
  const duplicateBasenames = solutionBasenames.filter(
    (basename, index) => solutionBasenames.indexOf(basename) !== index,
  );
  assert(
    duplicateBasenames.length === 0,
    `catalog.solutions contains duplicate solutionBasename values: ${[...new Set(duplicateBasenames)].join(', ')}`,
  );
  const sortedSolutionIds = [...solutionIds].sort();
  assert(
    solutionIds.every((id, index) => id === sortedSolutionIds[index]),
    'catalog.solutions must be sorted lexically by solutionId',
  );

  const landCount = catalog.solutions.filter((solution) => solution.domain === 'land').length;
  const marineCount = catalog.solutions.filter((solution) => solution.domain === 'marine').length;
  assert(
    landCount === counts.land,
    `catalog expectedLandSolutionCount is ${counts.land}, but solutions contains ${landCount} land entries`,
  );
  assert(
    marineCount === counts.marine,
    `catalog expectedMarineSolutionCount is ${counts.marine}, but solutions contains ${marineCount} marine entries`,
  );

  return catalog;
}

export function validateManifestAgainstCatalog(manifest, catalog) {
  validateSolutionCatalog(catalog);
  const counts = catalogCounts(catalog);
  assert(
    manifest.releaseId === catalog.releaseId,
    `manifest releaseId must match catalog releaseId "${catalog.releaseId}"`,
  );
  assert(
    manifest.catalogVersion === catalog.catalogVersion,
    `manifest catalogVersion must match catalog catalogVersion "${catalog.catalogVersion}"`,
  );

  const manifestIds = new Set(manifest.solutions.map((solution) => solution.id));
  const catalogIds = new Set(catalog.solutions.map((solution) => solution.solutionId));
  const catalogById = new Map(catalog.solutions.map((solution) => [solution.solutionId, solution]));
  const missing = [...catalogIds].filter((id) => !manifestIds.has(id));
  const unexpected = [...manifestIds].filter((id) => !catalogIds.has(id));
  const domainMismatches = manifest.solutions
    .filter(
      (solution) =>
        catalogById.has(solution.id) &&
        catalogById.get(solution.id).domain !== solutionDomain(solution),
    )
    .map(
      (solution) =>
        `${solution.id} (catalog: ${catalogById.get(solution.id).domain}, manifest: ${solutionDomain(solution)})`,
    );

  assert(
    manifest.solutions.length === counts.total,
    `release manifest must contain exactly ${counts.total} solutions; got ${manifest.solutions.length}`,
  );
  const landCount = manifest.solutions.filter(
    (solution) => solutionDomain(solution) === 'land',
  ).length;
  const marineCount = manifest.solutions.length - landCount;
  assert(
    landCount === counts.land,
    `release manifest must contain exactly ${counts.land} land solutions; got ${landCount}`,
  );
  assert(
    marineCount === counts.marine,
    `release manifest must contain exactly ${counts.marine} marine solutions; got ${marineCount}`,
  );
  assert(
    missing.length === 0 && unexpected.length === 0,
    `release manifest solution ID set differs from catalog (missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'})`,
  );
  assert(
    domainMismatches.length === 0,
    `release manifest solution domains differ from catalog: ${domainMismatches.join(', ')}`,
  );
  for (const solution of manifest.solutions) {
    const catalogSolution = catalogById.get(solution.id);
    if (catalogSolution) {
      validateSolutionRasterIdentity(solution, catalogSolution);
    }
  }
}

export function bindManifestSolutionsToCatalog(solutions, catalog) {
  validateSolutionCatalog(catalog);
  const catalogById = new Map(catalog.solutions.map((entry) => [entry.solutionId, entry]));
  return solutions.map((solution) => {
    const catalogSolution = catalogById.get(solution.id);
    assert(catalogSolution, `manifest solution "${solution.id}" is not present in the catalog`);
    const boundSolution = {
      ...solution,
      rasterSha256: catalogSolution.rasterSha256,
    };
    validateSolutionRasterIdentity(boundSolution, catalogSolution);
    return boundSolution;
  });
}

export async function readSolutionCatalog(catalogPath) {
  assertNonEmptyString(catalogPath, 'catalog path');
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf-8'));
  return validateSolutionCatalog(catalog);
}

export function solutionCatalogSha256(catalog) {
  validateSolutionCatalog(catalog);
  const canonicalCatalog = {
    format: SOLUTION_CATALOG_FORMAT,
    catalogVersion: catalog.catalogVersion,
    releaseId: catalog.releaseId,
    expectedSolutionCount: catalog.expectedSolutionCount,
    expectedLandSolutionCount: catalog.expectedLandSolutionCount,
    expectedMarineSolutionCount: catalog.expectedMarineSolutionCount,
    solutions: catalog.solutions.map((solution) => ({
      solutionId: solution.solutionId,
      solutionBasename: solution.solutionBasename,
      domain: solution.domain,
      rasterSha256: solution.rasterSha256,
    })),
  };
  return createHash('sha256').update(canonicalJson(canonicalCatalog)).digest('hex');
}

function solutionDomain(solution) {
  const explicitDomain = solution.domain ?? solution.finderInputs?.domain;
  if (DOMAINS.includes(explicitDomain)) {
    return explicitDomain;
  }
  return solution.scope === 'marine' || solution.blobPath?.startsWith('solutions/marine/')
    ? 'marine'
    : 'land';
}

function validateSolutionRasterIdentity(solution, catalogSolution) {
  const pathBasename = solution.blobPath?.split('/').filter(Boolean).at(-1);
  assert(pathBasename, `${solution.id} blobPath must identify a raster basename`);
  assert(
    solution.rasterFile === pathBasename,
    `${solution.id} rasterFile must match the blobPath basename "${pathBasename}"`,
  );
  assert(
    catalogSolution.solutionBasename === pathBasename,
    `${solution.id} raster basename must match catalog solutionBasename "${catalogSolution.solutionBasename}"`,
  );
  assert(
    solution.rasterSha256 === catalogSolution.rasterSha256,
    `${solution.id} rasterSha256 must match the catalog checksum`,
  );

  const displayUrl = parseUrl(solution.displayUrl, `${solution.id} displayUrl`);
  assert(
    displayUrl.origin === new URL(PUBLIC_BLOB_HOST).origin,
    `${solution.id} displayUrl must use the configured Blob origin`,
  );
  assert(
    decodeURIComponent(displayUrl.pathname.replace(/^\/+/, '')) === solution.blobPath,
    `${solution.id} displayUrl pathname must match blobPath`,
  );
  const metadataUrl = parseUrl(solution.metadataUrl, `${solution.id} metadataUrl`);
  assert(
    metadataUrl.origin === new URL(PUBLIC_BLOB_HOST).origin,
    `${solution.id} metadataUrl must use the configured Blob origin`,
  );
  const metadataBasename = decodeURIComponent(metadataUrl.pathname.split('/').at(-1));
  assert(
    metadataBasename === solution.metadataFile,
    `${solution.id} metadataUrl pathname must match metadataFile`,
  );
}

export function assertArtifactSafeSolutionIds(solutionIds) {
  for (const solutionId of solutionIds) {
    assert(
      typeof solutionId === 'string' && SAFE_SOLUTION_ID_PATTERN.test(solutionId),
      `unsafe solutionId "${solutionId}" is not allowed in artifact paths`,
    );
  }
}

function parseUrl(value, label) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
