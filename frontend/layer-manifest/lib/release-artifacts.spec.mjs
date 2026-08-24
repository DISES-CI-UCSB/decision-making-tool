import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BOUNDARY_SOURCES,
  canonicalJson,
} from './artifact-documents.mjs';
import {
  readArtifactVerifications,
  validateArtifactVerification,
  validateManifestArtifactCompleteness,
  validatePublishSummary,
  validatePublishSummaryArtifacts,
  validateVerificationAgainstSummary,
} from './release-artifacts.mjs';
import { solutionCatalogSha256 } from './solution-catalog.mjs';

const SHA256 = 'a'.repeat(64);

describe('release artifact verification', () => {
  it('requires verified inventories before release promotion', async () => {
    await assert.rejects(
      readArtifactVerifications([], createCatalog()),
      /requires at least one --artifact-inventory/,
    );
  });

  it('requires every domain-specific advertised artifact exactly once', () => {
    const manifest = createManifest();
    const urls = expectedUrls(manifest);
    const verification = createVerification(urls);

    assert.doesNotThrow(() => validateManifestArtifactCompleteness(manifest, [verification]));

    const missingMec = createVerification(urls.slice(0, -1));
    assert.throws(
      () => validateManifestArtifactCompleteness(manifest, [missingMec]),
      /verified artifact inventory differs from manifest \(missing:/,
    );

    const unexpectedMarineMec = createVerification([
      ...urls,
      'https://blob.example/releases/release-one/mec/v2/marine/national.json',
    ]);
    assert.throws(
      () => validateManifestArtifactCompleteness(manifest, [unexpectedMarineMec]),
      /unexpected:/,
    );
  });

  it('accepts one shared species target overlay URL across land solutions', () => {
    const manifest = createManifest();
    const overlayUrl =
      'https://blob.example/releases/release-one/species-goals/targets/v1/overlay.json';
    manifest.solutions[0].precomputedMetricUrls.speciesGoalsTargetOverlay = overlayUrl;
    manifest.solutions.push({
      id: 'land-two',
      domain: 'land',
      precomputedMetricUrls: {
        goals: 'https://blob.example/releases/release-one/goals/land-two.json',
        cache: 'https://blob.example/releases/release-one/regular/verbose/land-two.json',
        compactCache: 'https://blob.example/releases/release-one/regular/compact/land-two.json',
        speciesGoalsTargetOverlay: overlayUrl,
      },
    });
    const urls = [...new Set([...expectedUrls(manifest), overlayUrl])];

    assert.doesNotThrow(() =>
      validateManifestArtifactCompleteness(manifest, [createVerification(urls)]),
    );
  });

  it('accepts shared supplemental artifacts and their verified completion sidecars', () => {
    const manifest = createManifest();
    const catalogUrl =
      'https://blob.example/releases/release-one/species-goals/catalog/v1/catalog.json';
    const shardUrl =
      'https://blob.example/releases/release-one/species-goals/compact/v1/land/national.json';
    const outcomesUrl =
      'https://blob.example/releases/release-one/regular/compact/strategic-outcomes.json';
    for (const solution of manifest.solutions) {
      solution.precomputedMetricUrls.speciesGoalsCatalog = catalogUrl;
      solution.precomputedMetricUrls.strategicOutcomes = outcomesUrl;
    }
    manifest.solutions[0].precomputedMetricUrls.speciesGoalsByGeography = {
      national: shardUrl,
    };
    const urls = [
      ...new Set(expectedUrls(manifest)),
      `${catalogUrl}.complete.json`,
      `${shardUrl}.complete.json`,
    ];

    assert.doesNotThrow(() =>
      validateManifestArtifactCompleteness(manifest, [createVerification(urls)]),
    );
  });

  it('fails closed for unverified or checksum-mismatched publish summaries', () => {
    const failed = createVerification(['https://blob.example/artifact.json']);
    failed.ok = false;
    assert.throws(() => validateArtifactVerification(failed, 'inventory'), /ok=true/);

    const mismatched = createVerification(['https://blob.example/artifact.json']);
    mismatched.entries[0].remote.sha256 = 'b'.repeat(64);
    assert.throws(
      () => validateArtifactVerification(mismatched, 'inventory'),
      /local and remote checksums must match/,
    );

    const supplemental = createVerification(['https://blob.example/species-goals.json']);
    supplemental.entries[0].format = 'species-goals-compact-v1';
    assert.doesNotThrow(() => validateArtifactVerification(supplemental, 'inventory'));
  });

  it('binds each Python publish summary to the exact release catalog', () => {
    const catalog = createCatalog();
    const summary = {
      entries: [{ solutionId: 'land' }],
      failures: [],
      solutionCatalog: {
        releaseId: catalog.releaseId,
        catalogVersion: catalog.catalogVersion,
        sha256: solutionCatalogSha256(catalog),
      },
    };
    assert.doesNotThrow(() => validatePublishSummary(summary, catalog, 'publish-report.json'));
    summary.solutionCatalog.sha256 = 'b'.repeat(64);
    assert.throws(
      () => validatePublishSummary(summary, catalog, 'publish-report.json'),
      /must match the release catalog identity/,
    );
  });

  it('binds supplemental publish summaries to the complete release identity', () => {
    const catalog = createCatalog();
    const summary = {
      format: 'solution-release-supplemental-publish-report-v1',
      releaseId: catalog.releaseId,
      catalogVersion: catalog.catalogVersion,
      artifactCount: 1,
      complete: true,
      entries: [{ solutionId: 'land' }],
      failures: [],
    };

    assert.doesNotThrow(() => validatePublishSummary(summary, catalog, 'supplemental.json'));
    summary.releaseId = 'other-release';
    assert.throws(
      () => validatePublishSummary(summary, catalog, 'supplemental.json'),
      /must match the complete release identity/,
    );
  });

  it('requires verification URLs to exactly match their Python publish summary', () => {
    const verification = createVerification(['https://blob.example/artifact.json']);
    const summary = {
      entries: [{ expectedPublicUrl: 'https://blob.example/artifact.json' }],
    };
    assert.doesNotThrow(() =>
      validateVerificationAgainstSummary(verification, summary, 'inventory'),
    );
    summary.entries[0].expectedPublicUrl = 'https://blob.example/different.json';
    assert.throws(
      () => validateVerificationAgainstSummary(verification, summary, 'inventory'),
      /must exactly match source publish summary URLs/,
    );
  });

  it('rejects checksum-verified skeletal artifacts before promotion', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'manifest-artifact-'));
    const artifactPath = path.join(directory, 'skeletal.json');
    const artifactBytes = Buffer.from(
      JSON.stringify({
        solutionId: 'land',
        geographies: { national: { colombia: { metrics: [] } } },
      }),
    );
    await fs.writeFile(artifactPath, artifactBytes);
    const url = 'https://blob.example/releases/release-one/regular/land.json';
    const verification = createVerification([url]);
    verification.entries[0].local = {
      bytes: artifactBytes.byteLength,
      sha256: createHash('sha256').update(artifactBytes).digest('hex'),
    };
    verification.entries[0].remote = { ...verification.entries[0].local };
    const summary = {
      entries: [
        {
          solutionId: 'land',
          cachePath: artifactPath,
          expectedPublicUrl: url,
          catalogSignature: `metrics-catalog-v4:${'0'.repeat(64)}`,
        },
      ],
    };
    await assert.rejects(
      validatePublishSummaryArtifacts(verification, summary, 'inventory'),
      /solutionRaster must be an object/,
    );
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('promotes the shared Python compact artifact with the current SIRAP source', async () => {
    const fixturePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../data/metrics/fixtures/release-compact-artifact-v1.json',
    );
    const artifact = JSON.parse(await fs.readFile(fixturePath, 'utf-8'));
    artifact.metricsProvenance.boundaryProvenance.sources.siraps.url =
      BOUNDARY_SOURCES.siraps.url;
    artifact.metricsProvenance.boundaryProvenance.sha256 = canonicalSha256(
      artifact.metricsProvenance.boundaryProvenance.sources,
    );
    artifact.metricsProvenanceSha256 = canonicalSha256(artifact.metricsProvenance);
    const artifactBytes = Buffer.from(JSON.stringify(artifact));
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'manifest-artifact-'));
    const currentFixturePath = path.join(directory, 'release-compact-artifact-v1.json');
    await fs.writeFile(currentFixturePath, artifactBytes);
    const checksum = createHash('sha256').update(artifactBytes).digest('hex');
    const url = 'https://blob.example/releases/fixture-release/regular/compact/fixture-land.json';
    const verification = {
      format: 'metric-artifact-verification-v1',
      ok: true,
      entries: [
        {
          url,
          format: 'metrics-compact-v1',
          ok: true,
          local: { bytes: artifactBytes.byteLength, sha256: checksum },
          remote: { bytes: artifactBytes.byteLength, sha256: checksum },
        },
      ],
    };
    const summary = {
      entries: [
        {
          solutionId: 'fixture-land',
          cachePath: currentFixturePath,
          expectedPublicUrl: url,
          catalogSignature:
            'metrics-catalog-v4:609762e9ce722d85eff74f703b1de69e9e98d6830b791a162c02151ec7d4fe43',
        },
      ],
    };

    await assert.doesNotReject(
      validatePublishSummaryArtifacts(verification, summary, 'shared compact fixture'),
    );
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('rejects legacy goalsPath-only entries during new release promotion', async () => {
    const verification = createVerification(['https://blob.example/goals.json']);
    await assert.rejects(
      validatePublishSummaryArtifacts(
        verification,
        {
          entries: [
            {
              solutionId: 'land',
              goalsPath: '/tmp/legacy.goals.json',
              expectedPublicUrl: 'https://blob.example/goals.json',
            },
          ],
        },
        'inventory',
      ),
      /must declare cachePath/,
    );
  });
});

function createManifest() {
  return {
    solutions: [
      {
        id: 'land',
        domain: 'land',
        precomputedMetricUrls: {
          goals: 'https://blob.example/releases/release-one/goals/land.json',
          cache: 'https://blob.example/releases/release-one/regular/verbose/land.json',
          compactCache: 'https://blob.example/releases/release-one/regular/compact/land.json',
          mecV2ByGeography: Object.fromEntries(
            ['national', 'departments', 'municipalities', 'siraps', 'runaps', 'omecs'].map(
              (level) => [
                level,
                `https://blob.example/releases/release-one/mec/v2/land/${level}.json`,
              ],
            ),
          ),
        },
      },
      {
        id: 'marine',
        domain: 'marine',
        precomputedMetricUrls: {
          goals: 'https://blob.example/releases/release-one/goals/marine.json',
          cache: 'https://blob.example/releases/release-one/regular/verbose/marine.json',
          compactCache: 'https://blob.example/releases/release-one/regular/compact/marine.json',
        },
      },
    ],
  };
}

function expectedUrls(manifest) {
  return manifest.solutions.flatMap((solution) => {
    const urls = solution.precomputedMetricUrls;
    return [
      urls.goals,
      urls.cache,
      urls.compactCache,
      ...Object.values(urls.mecV2ByGeography ?? {}),
      ...(urls.speciesGoalsCatalog ? [urls.speciesGoalsCatalog] : []),
      ...(urls.speciesGoalsTargetOverlay ? [urls.speciesGoalsTargetOverlay] : []),
      ...(urls.strategicOutcomes ? [urls.strategicOutcomes] : []),
      ...Object.values(urls.speciesGoalsByGeography ?? {}),
    ];
  });
}

function createVerification(urls) {
  return {
    format: 'metric-artifact-verification-v1',
    ok: true,
    entries: urls.map((url) => ({
      url,
      format: 'metrics-verbose-v1',
      ok: true,
      local: { bytes: 100, sha256: SHA256 },
      remote: { bytes: 100, sha256: SHA256 },
    })),
  };
}

function createCatalog() {
  return {
    format: 'solution-catalog-v1',
    catalogVersion: '0.1.0',
    releaseId: 'release-one',
    expectedSolutionCount: 2,
    expectedLandSolutionCount: 1,
    expectedMarineSolutionCount: 1,
    solutions: [
      {
        solutionId: 'land',
        solutionBasename: 'land.tif',
        domain: 'land',
        rasterSha256: SHA256,
      },
      {
        solutionId: 'marine',
        solutionBasename: 'marine.tif',
        domain: 'marine',
        rasterSha256: SHA256,
      },
    ],
  };
}

function canonicalSha256(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf-8').digest('hex');
}
