import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from './load-local-env.mjs';
import { usesLocalPreviewManifest } from './validate-local-preview-manifest.mjs';
import {
  LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH,
  RUNTIME_MANIFEST_BLOB_URL,
} from '../shared/runtime-manifest.constants.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const environmentPath = path.join(frontendRoot, 'src/environments/environment.ts');
const manifestPath = path.join(frontendRoot, LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH);
const MANIFEST_BLOB_URL_ENV_VAR = 'MANIFEST_BLOB_URL';

async function fetchJson(url) {
  const uncachedUrl = `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;
  const response = await fetch(uncachedUrl, { method: 'GET', redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function syncLocalPreviewManifest({
  environmentSource,
  access = fs.access,
  readFile = fs.readFile,
  writeFile = fs.writeFile,
  mkdir = fs.mkdir,
  fetchManifest = fetchJson,
} = {}) {
  const resolvedEnvironmentSource =
    environmentSource ?? (await readFile(environmentPath, 'utf8'));

  if (!usesLocalPreviewManifest(resolvedEnvironmentSource)) {
    return { status: 'skipped', reason: 'remote_manifest' };
  }

  try {
    await access(manifestPath);
    return { status: 'skipped', reason: 'already_present' };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  const sourceUrl =
    process.env[MANIFEST_BLOB_URL_ENV_VAR]?.trim() || RUNTIME_MANIFEST_BLOB_URL;
  const manifest = await fetchManifest(sourceUrl);

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return { status: 'synced', sourceUrl, manifestPath };
}

async function main() {
  await loadLocalEnv(frontendRoot);

  const result = await syncLocalPreviewManifest();
  if (result.status === 'skipped' && result.reason === 'remote_manifest') {
    console.log('[sync:local-preview-manifest] skipped; development uses a remote manifest');
    return;
  }
  if (result.status === 'skipped' && result.reason === 'already_present') {
    console.log('[sync:local-preview-manifest] skipped; local preview manifest already present');
    return;
  }

  console.log(
    `[sync:local-preview-manifest] wrote ${path.relative(frontendRoot, result.manifestPath)} from ${result.sourceUrl}`,
  );
}

const isCalledDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCalledDirectly) {
  main().catch((error) => {
    console.error(`[sync:local-preview-manifest] ${error.message}`);
    process.exit(1);
  });
}
