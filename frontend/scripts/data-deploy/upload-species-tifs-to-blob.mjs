import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from '../../layer-manifest/load-local-env.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, '../..');

const BLOB_TOKEN_ENV = 'BLOB_READ_WRITE_TOKEN';
const DEFAULT_BLOB_PREFIX = 'inputs/features/species/';
const DEFAULT_SOURCE = path.join(
  '/Users/woverbyethompson/Downloads/drive-download-20260501T221333Z-3-001/inputs/features/species',
);

const SPECIES_MANIFEST_SCRIPT = path.join(frontendRoot, 'layer-manifest/generate-species-manifest.mjs');

function readTruthyEnv(name) {
  const raw = process.env[name];
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function readPositiveInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

async function collectTifs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const lower = ent.name.toLowerCase();
    if (lower.endsWith('.tif') || lower.endsWith('.tiff')) {
      out.push(path.join(dir, ent.name));
    }
  }
  return out.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

async function putBlob(token, localPath, pathname) {
  await execFileAsync(
    'vercel',
    ['blob', 'put', localPath, '--pathname', pathname, '--force', '--rw-token', token, '--no-color'],
    { maxBuffer: 10 * 1024 * 1024 },
  );
}

async function main() {
  await loadLocalEnv(frontendRoot);

  const token = process.env[BLOB_TOKEN_ENV];
  if (!token) {
    throw new Error(`${BLOB_TOKEN_ENV} missing (set in repo or frontend .env.local)`);
  }

  const sourceDir = path.resolve(
    process.env.SPECIES_TIF_UPLOAD_SOURCE?.trim() || DEFAULT_SOURCE,
  );
  const blobPrefixRaw = process.env.SPECIES_TIF_BLOB_PREFIX?.trim() || DEFAULT_BLOB_PREFIX;
  const blobPrefix = blobPrefixRaw.endsWith('/') ? blobPrefixRaw : `${blobPrefixRaw}/`;
  const concurrency = readPositiveInt('SPECIES_TIF_UPLOAD_CONCURRENCY', 2);
  const maxFiles = process.env.SPECIES_TIF_UPLOAD_MAX
    ? Number.parseInt(process.env.SPECIES_TIF_UPLOAD_MAX, 10)
    : null;
  const dryRun = process.env.SPECIES_TIF_UPLOAD_DRY_RUN === '1';

  await fs.access(sourceDir);

  let files = await collectTifs(sourceDir);
  if (Number.isInteger(maxFiles) && maxFiles > 0) {
    files = files.slice(0, maxFiles);
  }

  console.log(
    `[upload-species-tifs] source=${sourceDir}\n` +
      `[upload-species-tifs] blob prefix=${blobPrefix}\n` +
      `[upload-species-tifs] files=${files.length} concurrency=${concurrency} dryRun=${dryRun}`,
  );

  if (files.length === 0) {
    console.log('[upload-species-tifs] nothing to upload');
    return;
  }

  if (dryRun) {
    console.log(`[upload-species-tifs] dry run first file would be: ${blobPrefix}${path.basename(files[0])}`);
    return;
  }

  let cursor = 0;
  let done = 0;
  let failed = 0;
  const total = files.length;
  const logEvery = 25;

  async function worker() {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= total) return;
      const localPath = files[i];
      const base = path.basename(localPath);
      const pathname = `${blobPrefix}${base}`;
      try {
        await putBlob(token, localPath, pathname);
      } catch (e) {
        failed += 1;
        console.error(
          `[upload-species-tifs] FAIL ${base}: ${(e instanceof Error && e.message) || String(e)}`,
        );
      } finally {
        done += 1;
        if (done % logEvery === 0 || done === total) {
          console.log(
            `[upload-species-tifs] progress ${done}/${total} (${((done / total) * 100).toFixed(1)}%) failures=${failed}`,
          );
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);

  console.log(`[upload-species-tifs] finished: uploaded attempts=${total - failed} failed=${failed}`);

  const runManifest = readTruthyEnv('SPECIES_TIF_UPLOAD_RUN_SPECIES_MANIFEST');
  if (runManifest && failed === 0) {
    console.log('[upload-species-tifs] running generate:species-manifest (SPECIES_TIF_UPLOAD_RUN_SPECIES_MANIFEST=1)...');
    await execFileAsync(process.execPath, [SPECIES_MANIFEST_SCRIPT], {
      cwd: frontendRoot,
      stdio: 'inherit',
      env: process.env,
    });
  } else if (runManifest && failed > 0) {
    console.warn(
      '[upload-species-tifs] skipping generate:species-manifest because uploads had failures (fix or run `npm run generate:species-manifest` manually)',
    );
  }

  if (failed > 0) process.exitCode = 2;
}

main().catch((e) => {
  console.error(`[upload-species-tifs] ${(e instanceof Error && e.message) || String(e)}`);
  process.exit(1);
});
