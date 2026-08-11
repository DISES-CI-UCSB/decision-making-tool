import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { speciesGoalsBaseUrlForOutput } from './build-release-manifest.mjs';
import {
  usesLocalPreviewManifest,
  validateLocalPreviewManifest,
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
