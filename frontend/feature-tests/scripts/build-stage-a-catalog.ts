import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  loadRegionalFileInventory,
  publicFilePrefixes,
} from '../tests/support/downloads/regional-files.ts';
import { serviceConfig } from '../tests/support/downloads/service-config.ts';

/**
 * Builds a stage A copy of the Runtime Catalog release the web app loads: every regional-only file points at its
 * Private Layer Bucket address, and everything else, including files shared with national records and Colombia-wide
 * fields, stays on Vercel Blob. Only manifests with moved files are rewritten; the rest keep their published address.
 *
 * Usage: node --experimental-strip-types scripts/build-stage-a-catalog.ts <release-suffix> <output-dir>
 * The output folder mirrors Vercel Blob pathnames. Upload it with backend/layer-manifest tooling or `@vercel/blob`
 * `put` (public, no random suffix, no overwrite), then point a build at the new catalog release index.
 */
const [suffix, outputDir] = process.argv.slice(2);
if (!suffix || !outputDir) {
  console.error('Usage: build-stage-a-catalog.ts <release-suffix> <output-dir>');
  process.exit(1);
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

const publicWritePrefix = `${serviceConfig.publicBlobHost}/`;
const bucketPrefix = `https://storage.googleapis.com/${serviceConfig.bucket}/`;

function matchingPublicPrefix(url: string): string | undefined {
  return publicFilePrefixes().find((prefix) => url.startsWith(prefix));
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function blobPathname(url: string): string {
  const prefix = matchingPublicPrefix(url);
  if (!prefix) throw new Error(`${url} is not on a public file host.`);
  return url.slice(prefix.length);
}

function withSuffix(pathname: string): string {
  const parts = pathname.split('/');
  parts[parts.length - 2] = `${parts[parts.length - 2]}-${suffix}`;
  return parts.join('/');
}

function moveRegionalFiles(
  node: JsonValue,
  regionalKeys: Set<string>,
  moved: Set<string>,
): JsonValue {
  if (typeof node === 'string') {
    const prefix = matchingPublicPrefix(node);
    if (!prefix) return node;
    const key = decodeURIComponent(node.slice(prefix.length).split(/[?#]/)[0]);
    if (!regionalKeys.has(key)) return node;
    moved.add(key);
    return `${bucketPrefix}${node.slice(prefix.length)}`;
  }
  if (Array.isArray(node)) return node.map((item) => moveRegionalFiles(item, regionalKeys, moved));
  if (isObject(node)) {
    return Object.fromEntries(
      Object.entries(node).map(([field, child]) => [
        field,
        moveRegionalFiles(child, regionalKeys, moved),
      ]),
    );
  }
  return node;
}

async function fetchJson(url: string): Promise<JsonObject> {
  const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`);
  if (!response.ok) throw new Error(`${url} returned ${response.status}.`);
  return (await response.json()) as JsonObject;
}

async function writeJson(pathname: string, value: JsonValue): Promise<void> {
  const target = path.join(outputDir, pathname);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(value), 'utf-8');
  console.log(`  wrote ${pathname}`);
}

const inventory = await loadRegionalFileInventory();
if (inventory.usedByMoreThanOneRegion.length > 0) {
  throw new Error(
    `${inventory.usedByMoreThanOneRegion.length} files are used by more than one region; fix the catalog first.`,
  );
}
const regionalKeys = new Set(inventory.files.map((file) => file.objectName));
console.log(`${regionalKeys.size} regional-only files move to the bucket.`);

const index = await fetchJson(serviceConfig.catalogReleaseIndexUrl);
const allMoved = new Set<string>();
const batches: JsonValue[] = [];
for (const batch of Array.isArray(index.batches) ? index.batches : []) {
  if (!isObject(batch) || typeof batch.manifestUrl !== 'string') {
    batches.push(batch);
    continue;
  }
  const moved = new Set<string>();
  const manifest = moveRegionalFiles(
    await fetchJson(batch.manifestUrl),
    regionalKeys,
    moved,
  ) as JsonObject;
  if (moved.size === 0) {
    console.log(`Batch ${String(batch.id)}: no regional files, keeps ${batch.manifestUrl}`);
    batches.push(batch);
    continue;
  }
  const manifestPathname = withSuffix(blobPathname(batch.manifestUrl));
  console.log(`Batch ${String(batch.id)}: ${moved.size} files moved.`);
  await writeJson(manifestPathname, manifest);
  moved.forEach((key) => allMoved.add(key));
  batches.push({ ...batch, manifestUrl: `${publicWritePrefix}${manifestPathname}` });
}

const missing = [...regionalKeys].filter((key) => !allMoved.has(key));
if (missing.length > 0) {
  throw new Error(
    `${missing.length} regional files were not rewritten, for example ${missing[0]}.`,
  );
}

const indexPathname = withSuffix(blobPathname(serviceConfig.catalogReleaseIndexUrl));
await writeJson(indexPathname, {
  ...index,
  batches,
  releaseId: `${String(index.releaseId)}-${suffix}`,
  stageA: { privateLayerBucket: serviceConfig.bucket, movedFileCount: allMoved.size },
});
await writeJson('moved-object-keys.json', [...allMoved].sort());
console.log(`Catalog release index: ${publicWritePrefix}${indexPathname}`);
