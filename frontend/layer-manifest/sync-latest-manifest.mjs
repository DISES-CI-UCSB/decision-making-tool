import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const generatedManifestPath = path.resolve(__dirname, '../public/data/layer-manifest/manifest.json');
const devLatestManifestPath = path.resolve(__dirname, './latest/manifest.latest.json');
const MANIFEST_BLOB_URL_ENV_VAR = 'MANIFEST_BLOB_URL';

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

async function fetchJson(url) {
  const response = await fetch(url, { method: 'GET', redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function resolveManifestSource() {
  const configuredBlobUrl = process.env[MANIFEST_BLOB_URL_ENV_VAR]?.trim() || null;

  if (configuredBlobUrl) {
    try {
      const manifest = await fetchJson(configuredBlobUrl);
      return {
        manifest,
        sourceType: 'manifest_blob_url',
        sourceUrl: configuredBlobUrl,
      };
    } catch (error) {
      console.warn(
        `[sync-latest-manifest] Failed blob fetch from ${configuredBlobUrl}. Falling back to local generated manifest.`,
      );
      console.warn(`[sync-latest-manifest] ${(error instanceof Error && error.message) || String(error)}`);
    }
  }

  const manifest = await readJson(generatedManifestPath);
  return {
    manifest,
    sourceType: 'local_generated_manifest',
    sourceUrl: null,
  };
}

async function main() {
  const { manifest, sourceType, sourceUrl } = await resolveManifestSource();
  const payload = {
    _meta: {
      note:
        'This manifest is stored here to aid developers. While the runtime app reads the manifest.json stored at MANIFEST_BLOB_URL, the latest version retrieved by the runtime app is stored here for debugging purposes.',
      syncedAt: new Date().toISOString(),
      sourceType,
      sourceUrl,
      manifestBlobUrlEnvVar: MANIFEST_BLOB_URL_ENV_VAR,
      runtimeManifestPublicPath: '/data/layer-manifest/manifest.json',
      generatedManifestPath: path.relative(repoRoot, generatedManifestPath),
    },
    manifest,
  };

  await fs.mkdir(path.dirname(devLatestManifestPath), { recursive: true });
  await fs.writeFile(devLatestManifestPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');

  console.log(`[sync-latest-manifest] wrote ${path.relative(repoRoot, devLatestManifestPath)}`);
}

main().catch((error) => {
  console.error(`[sync-latest-manifest] ${(error instanceof Error && error.message) || String(error)}`);
  process.exit(1);
});
