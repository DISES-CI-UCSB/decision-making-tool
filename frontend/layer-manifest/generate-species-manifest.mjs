import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from './load-local-env.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const PUBLIC_BLOB_HOST = 'https://aagibolq28slyfof.public.blob.vercel-storage.com';
const SPECIES_BLOB_PREFIX = 'inputs/features/species/';
const OUTPUT_PATH = path.resolve(__dirname, '../public/data/layer-manifest/species.manifest.json');
const DEFAULT_VERSION = '0.1.0';
const DEFAULT_BINARY_SELECTED_COLOR = '#bf18ab';
const DEFAULT_CONTINUOUS_START_COLOR = '#f5d0fe';
const DEFAULT_CONTINUOUS_END_COLOR = '#86198f';
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_SAMPLE_GRID_SIZE = 128;
const DEFAULT_RASTER_READ_RETRY_ATTEMPTS = 4;
const DEFAULT_BASE_REQUEST_DELAY_MS = 300;
const DEFAULT_REQUEST_JITTER_MS = 900;
const PROGRESS_LOG_INTERVAL = 50;

const BLOB_TOKEN_ENV_VAR = 'BLOB_READ_WRITE_TOKEN';
const DEFAULT_SPECIES_MANIFEST_BLOB_PATHNAME = 'manifests/species.manifest.json';
const DEFAULT_SPECIES_MANIFEST_ARCHIVE_PREFIX = 'manifests/archive/';

function readTruthyEnv(name) {
  const raw = process.env[name];
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function readOptionalStringEnv(name, fallbackValue) {
  const raw = process.env[name]?.trim();
  return raw ? raw : fallbackValue;
}

function readPositiveIntEnv(name, fallbackValue) {
  const raw = process.env[name];
  if (!raw) {
    return fallbackValue;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function readOptionalPositiveIntEnv(name) {
  const raw = process.env[name];
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readNonNegativeIntEnv(name, fallbackValue) {
  const raw = process.env[name];
  if (!raw) {
    return fallbackValue;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallbackValue;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomIntInclusive(min, max) {
  if (max <= min) {
    return min;
  }
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function sleepWithJitter(baseMs, jitterMs) {
  const jitter = randomIntInclusive(0, Math.max(0, jitterMs));
  await sleep(Math.max(0, baseMs) + jitter);
}

function parseBlobListOutput(output) {
  const blobs = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Vercel CLI') || trimmed.startsWith('Fetching blobs')) {
      continue;
    }
    if (trimmed.startsWith('Uploaded At') || trimmed.startsWith('> To display')) {
      continue;
    }

    const match = trimmed.match(/^\S+\s+(\d+)\s+(\S+)\s+(https:\/\/\S+)$/);
    if (!match) {
      continue;
    }

    blobs.push({
      bytes: Number(match[1]),
      pathname: match[2],
      url: match[3],
    });
  }

  return blobs;
}

function parseNextCursor(output) {
  const match = output.match(/--cursor\s+([^\s`]+)/);
  return match ? match[1] : null;
}

function extractBlobCliUrl(output) {
  const match = output.match(/https:\/\/\S+/);
  return match ? match[0] : null;
}

async function listBlobsByPrefixForUpload(token, prefix, limit) {
  const { stdout, stderr } = await execFileAsync('vercel', [
    'blob',
    'list',
    '--rw-token',
    token,
    '--limit',
    String(limit),
    '--prefix',
    prefix,
    '--no-color',
  ]);
  return parseBlobListOutput(`${stdout}\n${stderr}`);
}

async function copyBlobForUpload(token, fromUrlOrPathname, toPathname) {
  const { stdout, stderr } = await execFileAsync('vercel', [
    'blob',
    'copy',
    fromUrlOrPathname,
    toPathname,
    '--rw-token',
    token,
    '--no-color',
  ]);
  return extractBlobCliUrl(`${stdout}\n${stderr}`);
}

async function putBlobForUpload(token, sourcePath, pathnameToUpload) {
  const { stdout, stderr } = await execFileAsync('vercel', [
    'blob',
    'put',
    sourcePath,
    '--pathname',
    pathnameToUpload,
    '--force',
    '--rw-token',
    token,
    '--no-color',
  ]);
  return extractBlobCliUrl(`${stdout}\n${stderr}`);
}

function speciesManifestArchivePathname(archivePrefix, timestampIso) {
  const safePrefix = archivePrefix.endsWith('/') ? archivePrefix : `${archivePrefix}/`;
  return `${safePrefix}species.manifest.${timestampIso.replace(/[:.]/g, '-')}.json`;
}

async function publishSpeciesManifestToVercelBlob(options) {
  const {
    token,
    sourcePath,
    targetPathname,
    archivePrefix,
    skipArchive,
  } = options;

  await fs.access(sourcePath);

  const listMatches = await listBlobsByPrefixForUpload(token, targetPathname, 8);
  const currentRemote = listMatches.find((blob) => blob.pathname === targetPathname) ?? null;

  if (currentRemote && !skipArchive) {
    const archivePathname = speciesManifestArchivePathname(archivePrefix, new Date().toISOString());
    const archivedUrl = await copyBlobForUpload(token, currentRemote.url, archivePathname);
    console.log(`[generate:species-manifest] archived previous species manifest to ${archivePathname}`);
    if (archivedUrl) {
      console.log(`[generate:species-manifest] species manifest archive URL: ${archivedUrl}`);
    }
  } else if (!currentRemote) {
    console.log('[generate:species-manifest] no previous remote species manifest found to archive');
  }

  const uploadedUrl = await putBlobForUpload(token, sourcePath, targetPathname);
  console.log(`[generate:species-manifest] published species manifest to blob pathname ${targetPathname}`);
  if (uploadedUrl) {
    console.log(`[generate:species-manifest] species manifest URL: ${uploadedUrl}`);
  }
}

async function listBlobPage(prefix, cursor = null, limit = 100) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('BLOB_READ_WRITE_TOKEN is required to list Vercel Blob contents');
  }

  const args = [
    'blob',
    'list',
    '--rw-token',
    process.env.BLOB_READ_WRITE_TOKEN,
    '--limit',
    String(limit),
    '--prefix',
    prefix,
    '--no-color',
  ];
  if (cursor) {
    args.push('--cursor', cursor);
  }

  const { stdout, stderr } = await execFileAsync('vercel', args);
  const output = `${stdout}\n${stderr}`;
  return {
    blobs: parseBlobListOutput(output),
    nextCursor: parseNextCursor(output),
  };
}

async function listAllSpeciesBlobs() {
  const all = [];
  let cursor = null;
  let page = 1;

  while (true) {
    console.log(`[generate:species-manifest] listing blob page ${page}...`);
    const { blobs, nextCursor } = await listBlobPage(SPECIES_BLOB_PREFIX, cursor);
    all.push(...blobs);
    const cursorHint = nextCursor ? 'yes (more pages if blobs exist)' : 'no (last page)';
    console.log(
      `[generate:species-manifest] list page ${page}: +${blobs.length} row(s); nextCursor=${cursorHint}; running total listed rows: ${all.length}`,
    );
    if (!nextCursor) {
      break;
    }
    cursor = nextCursor;
    page += 1;
  }

  const nonEmpty = all.filter((blob) => blob.bytes > 0);
  const tifs = nonEmpty.filter((blob) => {
    const lowerPath = blob.pathname.toLowerCase();
    return lowerPath.endsWith('.tif') || lowerPath.endsWith('.tiff');
  });
  const skippedEmpty = all.length - nonEmpty.length;
  const skippedNonTif = nonEmpty.length - tifs.length;
  if (skippedEmpty || skippedNonTif) {
    console.log(
      `[generate:species-manifest] listed ${all.length} total row(s); kept ${tifs.length} non-empty .tif/.tiff (skipped ${skippedEmpty} empty, ${skippedNonTif} non-tif)`,
    );
  }

  return tifs;
}

function normalizeNumericValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function inferNoDataValue({ explicitNoDataValue, values }) {
  if (typeof explicitNoDataValue === 'number') {
    return explicitNoDataValue;
  }

  if (values.includes(255)) {
    return 255;
  }
  if (values.includes(-32768)) {
    return -32768;
  }
  if (values.includes(65535)) {
    return 65535;
  }
  return null;
}

function summarizeValues(sampleValues, noDataValue) {
  const validValues = [];
  let integerLikeCount = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const uniqueValueSet = new Set();

  for (const rawValue of sampleValues) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      continue;
    }
    if (typeof noDataValue === 'number' && value === noDataValue) {
      continue;
    }

    validValues.push(value);
    if (Math.abs(value - Math.round(value)) <= 1e-6) {
      integerLikeCount += 1;
    }
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
    uniqueValueSet.add(value);
  }

  if (validValues.length === 0) {
    return null;
  }

  const uniqueValues = [...uniqueValueSet].sort((a, b) => a - b);
  const sortedValues = [...validValues].sort((a, b) => a - b);
  const nonIntegerRatio = (validValues.length - integerLikeCount) / validValues.length;

  return {
    sortedValues,
    uniqueValues,
    uniqueCount: uniqueValues.length,
    sampleCount: validValues.length,
    nonIntegerRatio,
    min,
    max,
  };
}

function quantile(sortedValues, q) {
  if (sortedValues.length === 0) {
    return null;
  }
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }
  const clampedQ = Math.max(0, Math.min(1, q));
  const index = (sortedValues.length - 1) * clampedQ;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  if (lower === upper) {
    return sortedValues[lower];
  }
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function classifySpeciesRaster(summary) {
  const isBinaryLike = summary.nonIntegerRatio <= 0.01 && summary.uniqueCount <= 3;
  return isBinaryLike ? 'binary' : 'continuous';
}

function inferSelectedValue(uniqueValues, noDataValue) {
  const candidates = uniqueValues.filter((value) => {
    if (typeof noDataValue === 'number' && value === noDataValue) {
      return false;
    }
    return true;
  });
  if (candidates.includes(1)) {
    return 1;
  }
  const nonZero = candidates.find((value) => value !== 0);
  if (typeof nonZero === 'number') {
    return nonZero;
  }
  return candidates[0] ?? 1;
}

function stripSpeciesFilenameSuffix(fileStem) {
  return fileStem.replace(/_?\d+_MAXENT$/i, '').replace(/_MAXENT$/i, '');
}

function normalizeScientificName(pathname) {
  const fileName = path.posix.basename(pathname).replace(/\.[^.]+$/, '');
  const stem = stripSpeciesFilenameSuffix(fileName);
  const tokens = stem.split('_').map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return 'Unknown species';
  }
  return tokens
    .map((token, index) =>
      index === 0
        ? `${token.charAt(0).toUpperCase()}${token.slice(1).toLowerCase()}`
        : token.toLowerCase(),
    )
    .join(' ');
}

function toLayerId(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

async function fetchArrayBufferWithRetry(url, maxAttempts, pacing) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await sleepWithJitter(pacing.baseRequestDelayMs, pacing.requestJitterMs);
      const response = await fetch(url, { method: 'GET', redirect: 'follow' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.arrayBuffer();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) {
        break;
      }
      await sleepWithJitter(250 * attempt, pacing.retryJitterMs);
    }
  }
  throw lastError;
}

async function inspectSpeciesRaster(url, sampleGridSize, maxAttempts, pacing) {
  const { fromArrayBuffer } = await import('geotiff');
  const rasterBytes = await fetchArrayBufferWithRetry(url, maxAttempts, pacing);
  const tiff = await fromArrayBuffer(rasterBytes);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const sampleWidth = Math.max(1, Math.min(width, sampleGridSize));
  const sampleHeight = Math.max(1, Math.min(height, sampleGridSize));
  const explicitNoDataValue = normalizeNumericValue(image.getGDALNoData());
  const sampleValues = await image.readRasters({
    samples: [0],
    interleave: true,
    width: sampleWidth,
    height: sampleHeight,
  });
  const noDataValue = inferNoDataValue({
    explicitNoDataValue,
    values: [...new Set(Array.from(sampleValues, (v) => Number(v)).filter(Number.isFinite))],
  });
  const summary = summarizeValues(sampleValues, noDataValue);
  if (!summary) {
    throw new Error('No valid sampled raster values after filtering noData/non-finite cells.');
  }

  const classification = classifySpeciesRaster(summary);
  if (classification === 'binary') {
    return {
      classification,
      rendering: {
        valueType: 'binary',
        renderMode: 'mask',
        noDataValue,
        selectedValue: inferSelectedValue(summary.uniqueValues, noDataValue),
        selectedColor: DEFAULT_BINARY_SELECTED_COLOR,
      },
    };
  }

  let p01 = quantile(summary.sortedValues, 0.01);
  let p99 = quantile(summary.sortedValues, 0.99);
  if (typeof p01 !== 'number' || typeof p99 !== 'number' || p99 <= p01) {
    p01 = summary.min;
    p99 = summary.max;
  }

  return {
    classification,
    rendering: {
      valueType: 'continuous',
      renderMode: 'gradient',
      noDataValue,
      minValue: p01,
      maxValue: p99,
      startColor: DEFAULT_CONTINUOUS_START_COLOR,
      endColor: DEFAULT_CONTINUOUS_END_COLOR,
    },
  };
}

async function inspectSpeciesRasterWithRetry(url, sampleGridSize, maxAttempts, pacing) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await inspectSpeciesRaster(url, sampleGridSize, maxAttempts, pacing);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) {
        break;
      }
      await sleepWithJitter(200 * attempt, pacing.retryJitterMs);
    }
  }
  throw lastError;
}

async function buildSpeciesLayer(blob, sampleGridSize, retryAttempts, pacing) {
  const scientificName = normalizeScientificName(blob.pathname);
  const id = toLayerId(scientificName);
  const { rendering } = await inspectSpeciesRasterWithRetry(
    blob.url,
    sampleGridSize,
    retryAttempts,
    pacing,
  );

  return {
    id,
    taxonId: null,
    taxonLabel: null,
    commonName: scientificName,
    scientificName,
    displayUrl: blob.url,
    rendering,
  };
}

async function processWithConcurrency(blobs, sampleGridSize, concurrency, retryAttempts, pacing) {
  const results = new Array(blobs.length);
  let cursor = 0;
  let completed = 0;
  let failures = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= blobs.length) {
        return;
      }

      const blob = blobs[index];
      try {
        results[index] = await buildSpeciesLayer(blob, sampleGridSize, retryAttempts, pacing);
      } catch (error) {
        failures += 1;
        console.error(
          `[generate:species-manifest] failed for ${blob.pathname}: ${
            (error instanceof Error && error.message) || String(error)
          }`,
        );
      } finally {
        completed += 1;
        if (completed % PROGRESS_LOG_INTERVAL === 0 || completed === blobs.length) {
          const percent = ((completed / blobs.length) * 100).toFixed(1);
          console.log(
            `[generate:species-manifest] progress ${completed}/${blobs.length} (${percent}%) | failures: ${failures}`,
          );
        }
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return {
    layers: results.filter((entry) => entry !== undefined),
    failures,
  };
}

async function main() {
  await loadLocalEnv(path.resolve(__dirname, '..'));

  const concurrency = readPositiveIntEnv('SPECIES_MANIFEST_CONCURRENCY', DEFAULT_CONCURRENCY);
  const sampleGridSize = readPositiveIntEnv(
    'SPECIES_RASTER_SAMPLE_GRID_SIZE',
    DEFAULT_SAMPLE_GRID_SIZE,
  );
  const retryAttempts = readPositiveIntEnv(
    'SPECIES_MANIFEST_RASTER_READ_RETRY_ATTEMPTS',
    DEFAULT_RASTER_READ_RETRY_ATTEMPTS,
  );
  const baseRequestDelayMs = readNonNegativeIntEnv(
    'SPECIES_MANIFEST_BASE_REQUEST_DELAY_MS',
    DEFAULT_BASE_REQUEST_DELAY_MS,
  );
  const requestJitterMs = readNonNegativeIntEnv(
    'SPECIES_MANIFEST_REQUEST_JITTER_MS',
    DEFAULT_REQUEST_JITTER_MS,
  );
  const retryJitterMs = readNonNegativeIntEnv(
    'SPECIES_MANIFEST_RETRY_JITTER_MS',
    DEFAULT_REQUEST_JITTER_MS,
  );
  const maxLayers = readOptionalPositiveIntEnv('SPECIES_MANIFEST_MAX_LAYERS');

  console.log(
    `[generate:species-manifest] starting (concurrency=${concurrency}, sampleGrid=${sampleGridSize}, retries=${retryAttempts}, baseDelayMs=${baseRequestDelayMs}, requestJitterMs=${requestJitterMs}, retryJitterMs=${retryJitterMs})`,
  );
  const blobs = await listAllSpeciesBlobs();
  const targetBlobs = maxLayers ? blobs.slice(0, maxLayers) : blobs;
  console.log(
    `[generate:species-manifest] discovered ${blobs.length} species raster(s); processing ${targetBlobs.length}`,
  );

  const { layers, failures } = await processWithConcurrency(
    targetBlobs,
    sampleGridSize,
    concurrency,
    retryAttempts,
    {
      baseRequestDelayMs,
      requestJitterMs,
      retryJitterMs,
    },
  );
  const manifest = {
    version: DEFAULT_VERSION,
    generatedAt: new Date().toISOString(),
    publicBlobHost: PUBLIC_BLOB_HOST,
    sourcePrefix: SPECIES_BLOB_PREFIX,
    layerCount: layers.length,
    layers,
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

  console.log(`[generate:species-manifest] wrote ${path.relative(repoRoot, OUTPUT_PATH)}`);

  const skipBlobUpload = readTruthyEnv('SPECIES_MANIFEST_SKIP_BLOB_UPLOAD');
  const partialRun = maxLayers !== null;
  const allowPartialUpload = readTruthyEnv('SPECIES_MANIFEST_ALLOW_PARTIAL_UPLOAD');

  if (!skipBlobUpload && partialRun && !allowPartialUpload) {
    console.log(
      '[generate:species-manifest] skipping blob upload (SPECIES_MANIFEST_MAX_LAYERS set; use SPECIES_MANIFEST_ALLOW_PARTIAL_UPLOAD=1 to upload partial manifest)',
    );
  } else if (!skipBlobUpload) {
    const token = process.env[BLOB_TOKEN_ENV_VAR];
    if (!token) {
      console.warn(`[generate:species-manifest] skipping blob upload (${BLOB_TOKEN_ENV_VAR} missing after local write)`);
    } else {
      const targetPathname = readOptionalStringEnv(
        'SPECIES_MANIFEST_BLOB_PATHNAME',
        DEFAULT_SPECIES_MANIFEST_BLOB_PATHNAME,
      );
      const archivePrefix = readOptionalStringEnv(
        'SPECIES_MANIFEST_ARCHIVE_PREFIX',
        DEFAULT_SPECIES_MANIFEST_ARCHIVE_PREFIX,
      );
      const skipArchive = readTruthyEnv('SPECIES_MANIFEST_SKIP_ARCHIVE');
      await publishSpeciesManifestToVercelBlob({
        token,
        sourcePath: OUTPUT_PATH,
        targetPathname,
        archivePrefix,
        skipArchive,
      });
    }
  }

  console.log(`[generate:species-manifest] completed with ${failures} failed layer(s)`);
  if (failures > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(`[generate:species-manifest] ${(error instanceof Error && error.message) || String(error)}`);
  process.exit(1);
});
