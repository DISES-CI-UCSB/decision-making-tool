import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadLocalEnv } from './load-local-env.mjs';
import { readSolutionCatalog } from './lib/solution-catalog.mjs';
import { validateManifest } from './validate-manifest.mjs';
import { RUNTIME_MANIFEST_BLOB_PATHNAME } from '../shared/runtime-manifest.constants.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_ARCHIVE_PREFIX = 'manifest/archive/';
const DEFAULT_LIMIT = 50;
const DEFAULT_TARGET_PATH = RUNTIME_MANIFEST_BLOB_PATHNAME;
const BLOB_TOKEN_ENV_VAR = 'BLOB_READ_WRITE_TOKEN';

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

export function parseArgs(rawArgs) {
  const args = {
    prefix: DEFAULT_ARCHIVE_PREFIX,
    limit: DEFAULT_LIMIT,
    use: null,
    to: DEFAULT_TARGET_PATH,
    catalogPath: null,
    confirmRollback: false,
    confirmCreateFirstPointer: false,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const value = rawArgs[index];
    if (value === '--help' || value === '-h') {
      args.help = true;
      continue;
    }
    if (value === '--prefix') {
      args.prefix = rawArgs[index + 1] ?? args.prefix;
      index += 1;
      continue;
    }
    if (value === '--limit') {
      const nextValue = Number(rawArgs[index + 1]);
      if (Number.isFinite(nextValue) && nextValue > 0) {
        args.limit = Math.floor(nextValue);
      }
      index += 1;
      continue;
    }
    if (value === '--use') {
      args.use = rawArgs[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (value === '--to') {
      args.to = rawArgs[index + 1] ?? args.to;
      index += 1;
      continue;
    }
    if (value === '--catalog') {
      const catalogArg = rawArgs[index + 1];
      if (!catalogArg || catalogArg.startsWith('--')) {
        throw new Error('--catalog requires a path');
      }
      args.catalogPath = path.resolve(process.cwd(), catalogArg);
      index += 1;
      continue;
    }
    if (value === '--confirm-rollback') {
      args.confirmRollback = true;
      continue;
    }
    if (value === '--confirm-create-first-pointer') {
      args.confirmCreateFirstPointer = true;
      continue;
    }
    if (value === '--dry-run') {
      args.dryRun = true;
    }
  }

  return args;
}

function printUsage() {
  console.log('[rollback:layer-manifest] Usage:');
  console.log('  npm --prefix frontend run rollback:layer-manifest');
  console.log(
    '  npm --prefix frontend run rollback:layer-manifest -- --use <index|pathname|url> --catalog <catalog> --dry-run',
  );
  console.log(
    '  npm --prefix frontend run rollback:layer-manifest -- --use 0 --catalog <catalog> --confirm-rollback',
  );
}

async function listArchiveBlobs(token, prefix, limit) {
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

  return parseBlobListOutput(`${stdout}\n${stderr}`)
    .filter((blob) => blob.pathname.endsWith('.json'))
    .sort((a, b) => b.pathname.localeCompare(a.pathname));
}

function resolveSelectedBlob(blobs, useValue) {
  if (!useValue) {
    return null;
  }

  if (/^\d+$/.test(useValue)) {
    const index = Number(useValue);
    return blobs[index] ?? null;
  }

  return blobs.find((blob) => blob.pathname === useValue || blob.url === useValue) ?? null;
}

async function putLiveManifest(token, contents, pathname, destinationEtag) {
  const { put } = await import('@vercel/blob');
  return put(pathname, contents, {
    ...createLiveWriteOptions(destinationEtag),
    token,
  });
}

export function createLiveWriteOptions(destinationEtag) {
  return {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: Boolean(destinationEtag),
    ...(destinationEtag ? { ifMatch: destinationEtag } : {}),
    contentType: 'application/json',
  };
}

export function assertFirstPointerCreationConfirmed(currentManifest, confirmed) {
  if (!currentManifest && !confirmed) {
    throw new Error(
      'creating the first live manifest pointer requires --confirm-create-first-pointer and a single release captain',
    );
  }
}

async function putImmutableBlob(token, contents, pathname) {
  const { put } = await import('@vercel/blob');
  return put(pathname, contents, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: 'application/json',
    token,
  });
}

function toArchivePathname(archivePrefix, timestampIso) {
  const safePrefix = archivePrefix.endsWith('/') ? archivePrefix : `${archivePrefix}/`;
  return `${safePrefix}manifest.${timestampIso.replace(/[:.]/g, '-')}.json`;
}

async function listBlobByPrefix(token, prefix, limit = 5) {
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

async function fetchBlobIdentity(blob) {
  if (!blob) return null;
  const separator = blob.url.includes('?') ? '&' : '?';
  const response = await fetch(`${blob.url}${separator}verify=${Date.now()}-${Math.random()}`, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${blob.pathname}: HTTP ${response.status}`);
  }
  const contents = await response.text();
  const etag = response.headers.get('etag');
  if (!etag) {
    throw new Error(`Failed to obtain an ETag concurrency guard for ${blob.pathname}`);
  }
  return {
    ...blob,
    contents,
    contentSha256: createHash('sha256').update(contents).digest('hex'),
    etag,
  };
}

async function readLiveManifestIdentity(token, pathname) {
  const matches = await listBlobByPrefix(token, pathname);
  const blob = matches.find((entry) => entry.pathname === pathname) ?? null;
  return fetchBlobIdentity(blob);
}

export function assertLiveManifestUnchanged(expected, observed) {
  const expectedIdentity = expected ? `${expected.pathname}:${expected.contentSha256}` : 'missing';
  const observedIdentity = observed ? `${observed.pathname}:${observed.contentSha256}` : 'missing';
  if (expectedIdentity !== observedIdentity) {
    throw new Error('live manifest changed during rollback; retry from a fresh dry run');
  }
}

export function assertRollbackArchiveContract(manifest) {
  if (!manifest?.releaseId || !manifest?.catalogVersion) {
    throw new Error('rollback archive must declare releaseId and catalogVersion');
  }
}

export async function inspectRollbackRemoteState(token, pathname, operations = {}) {
  const readLive = operations.readLiveManifestIdentity ?? readLiveManifestIdentity;
  const currentManifest = await readLive(token, pathname);
  const checkedCurrentManifest = await readLive(token, pathname);
  assertLiveManifestUnchanged(currentManifest, checkedCurrentManifest);
  return currentManifest;
}

export async function main(rawArgs = process.argv.slice(2)) {
  await loadLocalEnv(path.resolve(__dirname, '..'));
  const args = parseArgs(rawArgs);
  if (args.help) {
    printUsage();
    return;
  }

  const token = process.env[BLOB_TOKEN_ENV_VAR];
  if (!token) {
    throw new Error(`${BLOB_TOKEN_ENV_VAR} is required to inspect and restore archived manifests`);
  }

  const archivedBlobs = await listArchiveBlobs(token, args.prefix, args.limit);
  if (archivedBlobs.length === 0) {
    console.log(
      `[rollback:layer-manifest] No archived manifests found for prefix "${args.prefix}"`,
    );
    return;
  }

  console.log(
    `[rollback:layer-manifest] Found ${archivedBlobs.length} archived manifest(s) under "${args.prefix}"`,
  );
  archivedBlobs.forEach((blob, index) => {
    console.log(`[rollback:layer-manifest] [${index}] ${blob.pathname} (${blob.bytes} bytes)`);
    console.log(`[rollback:layer-manifest]      ${blob.url}`);
  });

  if (!args.use) {
    console.log(
      '[rollback:layer-manifest] Pass --use <index|pathname|url> to republish one archive.',
    );
    return;
  }

  const selected = resolveSelectedBlob(archivedBlobs, args.use);
  if (!selected) {
    throw new Error(`Could not resolve --use "${args.use}" to a listed archive entry`);
  }
  if (!args.catalogPath) {
    throw new Error('rollback selection requires --catalog <path>');
  }
  const catalog = await readSolutionCatalog(args.catalogPath);
  const selectedIdentity = await fetchBlobIdentity(selected);
  const selectedManifest = JSON.parse(selectedIdentity.contents);
  assertRollbackArchiveContract(selectedManifest);
  await validateManifest(selectedManifest, selected.pathname, { catalog });
  console.log(
    `[rollback:layer-manifest] Validated archived release ${selectedManifest.releaseId} (catalog ${selectedManifest.catalogVersion})`,
  );

  const currentManifest = await inspectRollbackRemoteState(token, args.to);
  if (args.dryRun) {
    if (!currentManifest) {
      console.log(
        '[rollback:layer-manifest] dry run: live pointer is absent; creation requires one release captain and --confirm-create-first-pointer',
      );
    }
    console.log(
      `[rollback:layer-manifest] dry run: would archive "${args.to}" and atomically replace it from ${selected.pathname}`,
    );
    return;
  }
  if (!args.confirmRollback) {
    throw new Error('rollback requires --confirm-rollback after reviewing the selected archive');
  }
  assertFirstPointerCreationConfirmed(currentManifest, args.confirmCreateFirstPointer);

  if (currentManifest) {
    const archivePathname = toArchivePathname(args.prefix, new Date().toISOString());
    await putImmutableBlob(token, currentManifest.contents, archivePathname);
    console.log(`[rollback:layer-manifest] Archived current manifest to "${archivePathname}"`);
  }

  const liveImmediatelyBeforeRollback = await readLiveManifestIdentity(token, args.to);
  assertLiveManifestUnchanged(currentManifest, liveImmediatelyBeforeRollback);
  const rolledBackManifest = await putLiveManifest(
    token,
    selectedIdentity.contents,
    args.to,
    currentManifest?.etag,
  );
  console.log(`[rollback:layer-manifest] Republished archive to pathname "${args.to}"`);
  console.log(`[rollback:layer-manifest] Source archive: ${selected.url}`);
  if (rolledBackManifest.url) {
    console.log(`[rollback:layer-manifest] New manifest URL: ${rolledBackManifest.url}`);
  }
}

const isCalledDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isCalledDirectly) {
  main().catch((error) => {
    console.error(
      `[rollback:layer-manifest] ${(error instanceof Error && error.message) || String(error)}`,
    );
    process.exit(1);
  });
}
