import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { speciesGoalsBaseUrlForOutput } from './build-release-manifest.mjs';
import {
  usesLocalPreviewManifest,
  validateLocalPreviewManifest,
  validateLocalPreviewSpeciesCompletionFiles,
} from './validate-local-preview-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localManifestPath = path.resolve(__dirname, '../public/data/layer-manifest/manifest.json');

describe('local preview manifest guard', () => {
  it('detects when development explicitly uses the local manifest', () => {
    assert.equal(
      usesLocalPreviewManifest(
        "export const environment = { manifestBlobUrl: '/data/layer-manifest/manifest.json' };",
      ),
      true,
    );
    assert.equal(usesLocalPreviewManifest("const manifestBlobUrl = '';"), false);
  });

  it('rejects a stale manifest without the v0.2 solution catalog', () => {
    assert.throws(() => validateLocalPreviewManifest({ version: '0.1.0' }), /solutions array/);
  });

  it('selects portable species URLs only for the served local manifest', () => {
    assert.strictEqual(speciesGoalsBaseUrlForOutput(localManifestPath), '');
    assert.strictEqual(
      speciesGoalsBaseUrlForOutput(path.resolve(__dirname, './release-manifest.json')),
      undefined,
    );
  });

  it('accepts one locally backed capability preview while leaving other URLs production-bound', () => {
    const levels = ['national', 'departments', 'municipalities', 'siraps', 'runaps', 'omecs'];
    const solutions = Array.from({ length: 168 }, (_, index) => ({
      id: `land-${index}`,
      domain: 'land',
      precomputedMetricUrls: {
        goals: `https://example.com/production/land-${index}.json`,
      },
    }));
    solutions.push(
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `marine-${index}`,
        domain: 'marine',
        precomputedMetricUrls: {},
      })),
    );
    const selected = solutions[0];
    selected.capabilities = { aoiCoverageMetrics: 'v2' };
    selected.precomputedMetricUrls = {
      goals: '/releases/release/goals/selected.goals.json',
      cache: '/releases/release/regular/verbose/selected.metrics.json',
      compactCache: '/releases/release/regular/compact/selected.metrics.compact.json',
      mecV2ByGeography: Object.fromEntries(
        levels.map((level) => [
          level,
          `/releases/release/mec/v2/selected/${level}.mec.compact.json`,
        ]),
      ),
      speciesGoalsCatalog: '/releases/release/species-goals/catalog/v1/catalog.json',
      speciesGoalsByGeography: Object.fromEntries(
        levels.map((level) => [
          level,
          `/releases/release/species-goals/compact/v1/selected/${level}.json`,
        ]),
      ),
    };

    assert.deepEqual(
      validateLocalPreviewManifest({
        catalogVersion: '0.2.0',
        solutions,
      }),
      { total: 172, land: 168, marine: 4 },
    );
  });

  it('requires completion sidecars for every advertised local species artifact', async () => {
    const levels = ['national', 'departments', 'municipalities', 'siraps', 'runaps', 'omecs'];
    const artifactUrls = [
      '/releases/release/species-goals/catalog/v1/catalog.json',
      ...levels.map((level) => `/releases/release/species-goals/compact/v1/selected/${level}.json`),
    ];
    const manifest = {
      solutions: [
        {
          id: 'selected',
          domain: 'land',
          capabilities: { aoiCoverageMetrics: 'v2' },
          precomputedMetricUrls: {
            speciesGoalsCatalog: artifactUrls[0],
            speciesGoalsByGeography: Object.fromEntries(
              levels.map((level, index) => [level, artifactUrls[index + 1]]),
            ),
          },
        },
      ],
    };
    const observedPaths = [];

    await validateLocalPreviewSpeciesCompletionFiles(manifest, {
      root: '/preview-public',
      access: async (candidate) => observedPaths.push(candidate),
    });
    assert.deepEqual(
      observedPaths,
      artifactUrls.map((url) => path.resolve('/preview-public', `${url.slice(1)}.complete.json`)),
    );

    await assert.rejects(
      validateLocalPreviewSpeciesCompletionFiles(manifest, {
        root: '/preview-public',
        access: async (candidate) => {
          if (candidate === observedPaths[1]) throw new Error('ENOENT');
        },
      }),
      /missing completion sidecar.*national/,
    );
  });

  it('validates the actual local release manifest when present', async (context) => {
    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(localManifestPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        context.skip('ignored local preview manifest is not present');
        return;
      }
      throw error;
    }

    assert.deepEqual(validateLocalPreviewManifest(manifest), {
      total: 172,
      land: 168,
      marine: 4,
    });

    const land = manifest.solutions.find((solution) => solution.domain === 'land');
    land.precomputedMetricUrls.speciesGoalsCatalog =
      'http://localhost:4200/releases/release/species-goals/catalog/v1/catalog.json';
    assert.throws(
      () => validateLocalPreviewManifest(manifest),
      /must not contain hard-coded localhost URLs/,
    );
  });
});
