import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { extractBlobCliUrl, parseBlobListCursor, parseBlobListOutput } from './blob-cli-output.mjs';

describe('Blob CLI output helpers', () => {
  it('parses blob rows while ignoring CLI status and malformed lines', () => {
    const output = `
Vercel CLI 50.0.0
Fetching blobs
Uploaded At              Size  Pathname             URL
2026-07-20T12:00:00.000Z 123   inputs/example.tif   https://blob.example/inputs/example.tif
not a blob row
> To display the next page, run vercel blob list --cursor next-page
`;

    assert.deepStrictEqual(parseBlobListOutput(output), [
      {
        bytes: 123,
        pathname: 'inputs/example.tif',
        url: 'https://blob.example/inputs/example.tif',
      },
    ]);
  });

  it('parses the current Unicode table with Uploaded At and formatted sizes', () => {
    const output = `
Vercel CLI 50.1.0
Fetching blobs
│ Uploaded At               │ Size    │ Pathname                         │ URL                                      │
│ 2026-08-27T18:42:12.123Z │ 1.24 MB │ inputs/features/species/Ape.tif │ https://blob.example/inputs/Ape.tif     │
│ 2026-08-27T18:42:13.123Z │ 987 B   │ inputs/features/species/Bee.tif │ https://blob.example/inputs/Bee.tif     │
`;

    assert.deepStrictEqual(parseBlobListOutput(output), [
      {
        bytes: 1_240_000,
        pathname: 'inputs/features/species/Ape.tif',
        url: 'https://blob.example/inputs/Ape.tif',
      },
      {
        bytes: 987,
        pathname: 'inputs/features/species/Bee.tif',
        url: 'https://blob.example/inputs/Bee.tif',
      },
    ]);
  });

  it('extracts upload URLs and pagination cursors', () => {
    const output = 'Uploaded https://blob.example/file.json\nUse --cursor next-page';
    assert.strictEqual(extractBlobCliUrl(output), 'https://blob.example/file.json');
    assert.strictEqual(parseBlobListCursor(output), 'next-page');
  });
});
