import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  bindManifestSolutionsToCatalog,
  assertArtifactSafeSolutionIds,
  SAFE_SOLUTION_ID_PATTERN,
  validateManifestAgainstCatalog,
  validateSolutionCatalog,
} from './solution-catalog.mjs';

const SHA256 = 'a'.repeat(64);
const BLOB_HOST = 'https://aagibolq28slyfof.public.blob.vercel-storage.com';

function createCatalog(overrides = {}) {
  return {
    format: 'solution-catalog-v1',
    catalogVersion: '0.1.0',
    releaseId: 'catalog-2026-08-04',
    expectedSolutionCount: 2,
    expectedLandSolutionCount: 1,
    expectedMarineSolutionCount: 1,
    solutions: [
      {
        solutionId: 'land_solution',
        solutionBasename: 'land_solution.tif',
        domain: 'land',
        rasterSha256: SHA256,
      },
      {
        solutionId: 'marine_solution',
        solutionBasename: 'marine_solution.tif',
        domain: 'marine',
        rasterSha256: SHA256,
      },
    ],
    ...overrides,
  };
}

describe('solution catalog contract', () => {
  it('accepts a pre-1.0 semantic catalog version', () => {
    assert.doesNotThrow(() =>
      validateSolutionCatalog(createCatalog({ catalogVersion: '0.2.0-beta.1' })),
    );
  });

  it('accepts Python scalar counts and checksum normalization with filename basenames', () => {
    const catalog = {
      format: 'solution-catalog-v1',
      catalogVersion: '0.3.1',
      releaseId: 'release-two',
      expectedSolutionCount: 1,
      expectedLandSolutionCount: 0,
      expectedMarineSolutionCount: 1,
      solutions: [
        {
          solutionId: 'solution-0',
          solutionBasename: 'solution-0.tif',
          domain: 'marine',
          rasterSha256: 'A'.repeat(64),
        },
      ],
    };

    assert.doesNotThrow(() => validateSolutionCatalog(catalog));
    assert.equal(catalog.solutions[0].rasterSha256, 'a'.repeat(64));
  });

  it('rejects a catalog whose declared domain counts do not match its entries', () => {
    assert.throws(
      () =>
        validateSolutionCatalog(
          createCatalog({ expectedLandSolutionCount: 0, expectedMarineSolutionCount: 2 }),
        ),
      /expectedLandSolutionCount is 0, but solutions contains 1 land entries/,
    );
  });

  it('requires a non-null valid raster checksum', () => {
    const catalog = createCatalog();
    delete catalog.solutions[0].rasterSha256;
    assert.throws(
      () => validateSolutionCatalog(catalog),
      /rasterSha256 must be a non-empty string/,
    );
    catalog.solutions[0].rasterSha256 = null;
    assert.throws(
      () => validateSolutionCatalog(catalog),
      /rasterSha256 must be a non-empty string/,
    );
    catalog.solutions[0].rasterSha256 = 'not-a-checksum';
    assert.throws(() => validateSolutionCatalog(catalog), /must be a SHA-256 hex digest/);
  });

  it('rejects unsorted IDs and duplicate basenames', () => {
    const unsorted = createCatalog();
    unsorted.solutions.reverse();
    assert.throws(
      () => validateSolutionCatalog(unsorted),
      /must be sorted lexically by solutionId/,
    );

    const duplicateBasename = createCatalog();
    duplicateBasename.solutions[1].solutionBasename =
      duplicateBasename.solutions[0].solutionBasename;
    assert.throws(
      () => validateSolutionCatalog(duplicateBasename),
      /duplicate solutionBasename values/,
    );
  });

  it('requires the exact lowercase .tif solution basename extension', () => {
    for (const invalidBasename of [
      'land_solution',
      'land_solution.tiff',
      'land_solution.TIF',
      'land_solution.Tif',
      'land_solution.json',
    ]) {
      const catalog = createCatalog();
      catalog.solutions[0].solutionBasename = invalidBasename;
      assert.throws(() => validateSolutionCatalog(catalog), /exact lowercase \.tif extension/);
    }
  });

  it('matches the canonical Python artifact-safe ID regex', () => {
    assert.equal(SAFE_SOLUTION_ID_PATTERN.source, String.raw`^[a-z0-9]+(?:[_-][a-z0-9]+)*$`);
    assert.doesNotThrow(() =>
      assertArtifactSafeSolutionIds(['fixture', 'fixture-land', 'fixture_land2']),
    );
    for (const unsafeId of [
      'Uppercase',
      'unsafe.id',
      'unsafe+id',
      'unsafe(id)',
      'unsafe/id',
      'unsafe id',
      '_leading',
      'trailing-',
      'repeated__separator',
      'repeated--separator',
      'mixed_-separator',
      'mixed-_separator',
    ]) {
      assert.throws(() => assertArtifactSafeSolutionIds([unsafeId]), /unsafe solutionId/);
    }
  });

  it('validates exact manifest counts and solution ID set', () => {
    const catalog = createCatalog();
    const manifest = {
      releaseId: catalog.releaseId,
      catalogVersion: catalog.catalogVersion,
      solutions: [
        createManifestSolution('land_solution', 'land'),
        createManifestSolution('marine_solution', 'marine'),
      ],
    };

    assert.doesNotThrow(() => validateManifestAgainstCatalog(manifest, catalog));
    assert.doesNotThrow(() =>
      validateManifestAgainstCatalog(
        {
          ...manifest,
          catalogVersion: '0.1.1',
          solutionCatalogVersion: catalog.catalogVersion,
        },
        catalog,
      ),
    );
    assert.throws(
      () =>
        validateManifestAgainstCatalog(
          {
            ...manifest,
            solutions: [
              createManifestSolution('land_solution', 'land'),
              createManifestSolution('unexpected_solution', 'marine'),
            ],
          },
          catalog,
        ),
      /missing: marine_solution; unexpected: unexpected_solution/,
    );
    assert.throws(
      () =>
        validateManifestAgainstCatalog(
          {
            ...manifest,
            solutions: [
              createManifestSolution('land_solution', 'marine'),
              createManifestSolution('marine_solution', 'land'),
            ],
          },
          catalog,
        ),
      /solution domains differ from catalog/,
    );
  });

  it('binds checksums and rejects raster or metadata identity mismatches', () => {
    const catalog = createCatalog();
    const solutions = [
      createManifestSolution('land_solution', 'land', { rasterSha256: undefined }),
      createManifestSolution('marine_solution', 'marine', { rasterSha256: undefined }),
    ];
    const bound = bindManifestSolutionsToCatalog(solutions, catalog);
    assert.equal(bound[0].rasterSha256, SHA256);

    const manifest = {
      releaseId: catalog.releaseId,
      catalogVersion: catalog.catalogVersion,
      solutions: bound,
    };
    manifest.solutions[0].rasterFile = 'wrong.tif';
    assert.throws(() => validateManifestAgainstCatalog(manifest, catalog), /rasterFile must match/);
    manifest.solutions[0] = createManifestSolution('land_solution', 'land', {
      rasterSha256: 'b'.repeat(64),
    });
    assert.throws(
      () => validateManifestAgainstCatalog(manifest, catalog),
      /rasterSha256 must match/,
    );
    manifest.solutions[0] = createManifestSolution('land_solution', 'land', {
      metadataUrl: `${BLOB_HOST}/metadata/wrong.json`,
    });
    assert.throws(() => validateManifestAgainstCatalog(manifest, catalog), /metadataUrl pathname/);
  });
});

function createManifestSolution(id, domain, overrides = {}) {
  return {
    id,
    domain,
    rasterFile: `${id}.tif`,
    metadataFile: `${id}.json`,
    blobPath: `solutions/${id}.tif`,
    displayUrl: `${BLOB_HOST}/solutions/${id}.tif`,
    metadataUrl: `${BLOB_HOST}/metadata/${id}.json`,
    rasterSha256: SHA256,
    ...overrides,
  };
}
