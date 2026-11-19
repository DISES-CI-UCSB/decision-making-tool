import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  assertLiveManifestUnchanged as assertPromotionLiveUnchanged,
  assertFirstPointerCreationConfirmed as assertPromotionFirstPointer,
  createLiveWriteOptions as createPromotionWriteOptions,
  createManifestRevisionId,
  inspectPromotionRemoteState,
  parseArgs as parsePublishArgs,
  toImmutableManifestPathname,
} from './publish-manifest.mjs';
import {
  assertLiveManifestUnchanged as assertRollbackLiveUnchanged,
  assertFirstPointerCreationConfirmed as assertRollbackFirstPointer,
  assertRollbackArchiveContract,
  createLiveWriteOptions as createRollbackWriteOptions,
  inspectRollbackRemoteState,
  parseArgs as parseRollbackArgs,
} from './rollback-manifest.mjs';

describe('release promotion tooling', () => {
  it('parses a non-publishing release promotion dry run', () => {
    const args = parsePublishArgs([
      '--source',
      'release-manifest.json',
      '--catalog',
      'solution-catalog.json',
      '--artifact-inventory',
      'regular-verification.json',
      '--artifact-inventory',
      'mec-verification.json',
      '--dry-run',
    ]);

    assert.equal(args.dryRun, true);
    assert.match(args.sourcePath, /release-manifest\.json$/);
    assert.match(args.catalogPath, /solution-catalog\.json$/);
    assert.equal(args.artifactInventoryPaths.length, 2);
    assert.equal(args.confirmReleaseId, null);
    assert.equal(args.expectedLiveSha256, null);
  });

  it('binds confirmed publication to the dry-run live digest', () => {
    const digest = 'a'.repeat(64);
    const args = parsePublishArgs([
      '--confirm-release',
      'release-one',
      '--expected-live-sha256',
      digest,
    ]);
    assert.equal(args.confirmReleaseId, 'release-one');
    assert.equal(args.expectedLiveSha256, digest);
  });

  it('creates a distinct immutable snapshot for each manifest revision', () => {
    const releaseId = 'catalog-2026-08-04';
    const first = toImmutableManifestPathname(releaseId, '{"style":"blue"}');
    const second = toImmutableManifestPathname(releaseId, '{"style":"green"}');

    assert.equal(
      first,
      `manifest/releases/${releaseId}/revisions/${createManifestRevisionId('{"style":"blue"}')}.json`,
    );
    assert.notEqual(first, second);
  });

  it('requires an explicit rollback mode separate from archive selection', () => {
    const preview = parseRollbackArgs([
      '--use',
      '0',
      '--catalog',
      'solution-catalog.json',
      '--dry-run',
    ]);
    const confirmed = parseRollbackArgs([
      '--use',
      '0',
      '--catalog',
      'solution-catalog.json',
      '--confirm-rollback',
      '--confirm-create-first-pointer',
    ]);

    assert.equal(preview.dryRun, true);
    assert.equal(preview.confirmRollback, false);
    assert.match(preview.catalogPath, /solution-catalog\.json$/);
    assert.equal(confirmed.dryRun, false);
    assert.equal(confirmed.confirmRollback, true);
    assert.equal(confirmed.confirmCreateFirstPointer, true);
  });

  it('fails promotion and rollback when the live manifest identity changes', () => {
    const expected = { pathname: 'manifest/manifest.json', contentSha256: 'a'.repeat(64) };
    const changed = { pathname: 'manifest/manifest.json', contentSha256: 'b'.repeat(64) };

    assert.doesNotThrow(() => assertPromotionLiveUnchanged(expected, { ...expected }));
    assert.doesNotThrow(() => assertRollbackLiveUnchanged(expected, { ...expected }));
    assert.throws(
      () => assertPromotionLiveUnchanged(expected, changed),
      /changed during promotion/,
    );
    assert.throws(() => assertRollbackLiveUnchanged(expected, changed), /changed during rollback/);
  });

  it('uses destination ETags for conditional live writes', () => {
    for (const createOptions of [createPromotionWriteOptions, createRollbackWriteOptions]) {
      assert.deepEqual(createOptions('"destination-etag"'), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        ifMatch: '"destination-etag"',
        contentType: 'application/json',
      });
      assert.deepEqual(createOptions(null), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: 'application/json',
      });
    }
  });

  it('requires explicit single-captain confirmation for first-pointer creation', () => {
    for (const assertFirstPointer of [assertPromotionFirstPointer, assertRollbackFirstPointer]) {
      assert.throws(
        () => assertFirstPointer(null, false),
        /--confirm-create-first-pointer and a single release captain/,
      );
      assert.doesNotThrow(() => assertFirstPointer(null, true));
      assert.doesNotThrow(() => assertFirstPointer({ etag: '"existing"' }, false));
    }
  });

  it('rejects legacy rollback archives without release identity', () => {
    assert.throws(() => assertRollbackArchiveContract({}), /releaseId and catalogVersion/);
    assert.throws(
      () => assertRollbackArchiveContract({ releaseId: 'release-one' }),
      /releaseId and catalogVersion/,
    );
    assert.doesNotThrow(() =>
      assertRollbackArchiveContract({
        releaseId: 'release-one',
        catalogVersion: '0.1.0',
      }),
    );
  });

  it('performs all read-only promotion checks before a dry run can return', async () => {
    const calls = [];
    const live = {
      pathname: 'manifest/manifest.json',
      contentSha256: 'a'.repeat(64),
    };
    const immutablePathname = 'manifest/releases/release-one/revisions/revision.json';
    const result = await inspectPromotionRemoteState(
      {
        token: 'not-a-real-token',
        targetPathname: live.pathname,
        immutablePathname,
        sourceContents: '{"releaseId":"release-one"}',
      },
      {
        readLiveManifestIdentity: async () => {
          calls.push('read-live');
          return { ...live };
        },
        listBlobByPrefix: async () => {
          calls.push('list-immutable');
          return [{ pathname: immutablePathname, url: 'https://example.com/revision.json' }];
        },
        fetchBlobIdentity: async () => {
          calls.push('read-immutable');
          return { contents: '{"releaseId":"release-one"}' };
        },
      },
    );

    assert.deepEqual(calls, ['read-live', 'list-immutable', 'read-immutable', 'read-live']);
    assert.equal(result.currentRemoteManifest.contentSha256, live.contentSha256);
  });

  it('re-reads the live pointer during rollback dry-run inspection', async () => {
    let readCount = 0;
    const live = {
      pathname: 'manifest/manifest.json',
      contentSha256: 'a'.repeat(64),
    };
    const result = await inspectRollbackRemoteState('not-a-real-token', live.pathname, {
      readLiveManifestIdentity: async () => {
        readCount += 1;
        return { ...live };
      },
    });

    assert.equal(readCount, 2);
    assert.equal(result.contentSha256, live.contentSha256);
  });
});
