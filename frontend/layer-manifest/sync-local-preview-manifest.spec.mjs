import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { syncLocalPreviewManifest } from './sync-local-preview-manifest.mjs';

describe('sync local preview manifest', () => {
  it('skips when development uses a remote manifest', async () => {
    const result = await syncLocalPreviewManifest({
      environmentSource: "export const environment = { manifestBlobUrl: 'https://example.com/manifest.json' };",
      access: async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
    });

    assert.deepEqual(result, { status: 'skipped', reason: 'remote_manifest' });
  });

  it('skips when the local preview manifest already exists', async () => {
    const result = await syncLocalPreviewManifest({
      environmentSource:
        "export const environment = { manifestBlobUrl: '/data/layer-manifest/manifest.json' };",
      access: async () => undefined,
    });

    assert.deepEqual(result, { status: 'skipped', reason: 'already_present' });
  });

  it('fetches and writes the local preview manifest when missing', async () => {
    const writes = [];
    const result = await syncLocalPreviewManifest({
      environmentSource:
        "export const environment = { manifestBlobUrl: '/data/layer-manifest/manifest.json' };",
      access: async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
      mkdir: async () => undefined,
      writeFile: async (targetPath, contents) => {
        writes.push({ targetPath, contents });
      },
      fetchManifest: async (url) => {
        assert.match(url, /^https:\/\/.*\/manifest\/manifest\.json/);
        return { catalogVersion: '0.2.0', solutions: [] };
      },
    });

    assert.equal(result.status, 'synced');
    assert.equal(writes.length, 1);
    assert.match(writes[0].targetPath, /public\/data\/layer-manifest\/manifest\.json$/);
    assert.match(writes[0].contents, /"catalogVersion": "0.2.0"/);
  });
});
