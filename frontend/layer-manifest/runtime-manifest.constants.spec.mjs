import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOCAL_RUNTIME_MANIFEST_PUBLIC_PATH,
  LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH,
  PUBLIC_BLOB_HOST,
  RUNTIME_MANIFEST_BLOB_PATHNAME,
  RUNTIME_MANIFEST_BLOB_URL,
} from '../shared/runtime-manifest.constants.mjs';

test('runtime manifest constants describe the same public and local assets', () => {
  assert.equal(RUNTIME_MANIFEST_BLOB_URL, `${PUBLIC_BLOB_HOST}/${RUNTIME_MANIFEST_BLOB_PATHNAME}`);
  assert.equal(
    LOCAL_RUNTIME_MANIFEST_PUBLIC_PATH,
    `/${LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH.replace(/^public\//, '')}`,
  );
});
