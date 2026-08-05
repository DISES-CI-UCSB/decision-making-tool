import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadLocalEnv } from './load-local-env.mjs';
import { parseBlobListOutput } from './lib/blob-cli-output.mjs';
import {
  readArtifactVerifications,
  validateManifestArtifactCompleteness,
} from './lib/release-artifacts.mjs';
import { readSolutionCatalog } from './lib/solution-catalog.mjs';
import { validateManifest } from './validate-manifest.mjs';
import {
  LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH,
  RUNTIME_MANIFEST_BLOB_PATHNAME,
} from '../shared/runtime-manifest.constants.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BLOB_TOKEN_ENV_VAR = 'BLOB_READ_WRITE_TOKEN';
const DEFAULT_SOURCE_MANIFEST_PATH = path.resolve(
  __dirname,
  '..',
  LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH,
);
const DEFAULT_TARGET_PATHNAME = RUNTIME_MANIFEST_BLOB_PATHNAME;
const DEFAULT_ARCHIVE_PREFIX = 'manifest/archive/';
const IMMUTABLE_RELEASE_PREFIX = 'manifest/releases/';

export function parseArgs(rawArgs) {
  const args = {
    sourcePath: DEFAULT_SOURCE_MANIFEST_PATH,
    targetPathname: DEFAULT_TARGET_PATHNAME,
    archivePrefix: DEFAULT_ARCHIVE_PREFIX,
    catalogPath: null,
    artifactInventoryPaths: [],
    confirmReleaseId: null,
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
    if (value === '--source') {
      args.sourcePath = path.resolve(process.cwd(), rawArgs[index + 1] ?? args.sourcePath);
      index += 1;
      continue;
    }
    if (value === '--target') {
      args.targetPathname = rawArgs[index + 1] ?? args.targetPathname;
      index += 1;
      continue;
    }
    if (value === '--archive-prefix') {
      args.archivePrefix = rawArgs[index + 1] ?? args.archivePrefix;
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
    if (value === '--artifact-inventory') {
      const inventoryArg = rawArgs[index + 1];
      if (!inventoryArg || inventoryArg.startsWith('--')) {
        throw new Error('--artifact-inventory requires a path');
      }
      args.artifactInventoryPaths.push(path.resolve(process.cwd(), inventoryArg));
      index += 1;
      continue;
    }
    if (value === '--confirm-release') {
      args.confirmReleaseId = rawArgs[index + 1] ?? null;
      index += 1;
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
  console.log('[publish:layer-manifest] Usage:');
  console.log(
    '  npm --prefix frontend run publish:layer-manifest -- --source <manifest> --catalog <catalog> --artifact-inventory <verification.json> [--artifact-inventory <verification.json> ...] --dry-run',
  );
  console.log(
    '  npm --prefix frontend run publish:layer-manifest -- --source <manifest> --catalog <catalog> --artifact-inventory <verification.json> [--artifact-inventory <verification.json> ...] --confirm-release <releaseId>',
  );
}

async function listBlobByPrefix(token, prefix, limit = 10) {
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

async function putImmutableBlob(token, contents, pathnameToUpload) {
  const { put } = await import('@vercel/blob');
  return put(pathnameToUpload, contents, {
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

export function toImmutableReleasePathname(releaseId) {
  return `${IMMUTABLE_RELEASE_PREFIX}${releaseId}/revisions`;
}

export function createManifestRevisionId(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

export function toImmutableManifestPathname(releaseId, contents) {
  return `${toImmutableReleasePathname(releaseId)}/${createManifestRevisionId(contents)}.json`;
}

export function assertLiveManifestUnchanged(expected, observed) {
  const expectedIdentity = expected ? `${expected.pathname}:${expected.contentSha256}` : 'missing';
  const observedIdentity = observed ? `${observed.pathname}:${observed.contentSha256}` : 'missing';
  if (expectedIdentity !== observedIdentity) {
    throw new Error('live manifest changed during promotion; retry from a fresh dry run');
  }
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
    throw new Error(`failed to read ${blob.pathname}: HTTP ${response.status}`);
  }
  const contents = await response.text();
  const etag = response.headers.get('etag');
  if (!etag) {
    throw new Error(`failed to obtain an ETag concurrency guard for ${blob.pathname}`);
  }
  return {
    ...blob,
    contents,
    contentSha256: createManifestRevisionId(contents),
    etag,
  };
}

async function readLiveManifestIdentity(token, targetPathname) {
  const matches = await listBlobByPrefix(token, targetPathname, 5);
  const blob = matches.find((entry) => entry.pathname === targetPathname) ?? null;
  return fetchBlobIdentity(blob);
}

export async function inspectPromotionRemoteState(
  { token, targetPathname, immutablePathname, sourceContents },
  operations = {},
) {
  const readLive = operations.readLiveManifestIdentity ?? readLiveManifestIdentity;
  const listBlobs = operations.listBlobByPrefix ?? listBlobByPrefix;
  const fetchIdentity = operations.fetchBlobIdentity ?? fetchBlobIdentity;
  const currentRemoteManifest = await readLive(token, targetPathname);
  const immutableMatches = await listBlobs(token, immutablePathname, 5);
  const immutableManifest =
    immutableMatches.find((blob) => blob.pathname === immutablePathname) ?? null;
  if (immutableManifest) {
    const immutableIdentity = await fetchIdentity(immutableManifest);
    if (immutableIdentity.contents !== sourceContents) {
      throw new Error(
        `immutable release manifest already exists with different content: ${immutablePathname}`,
      );
    }
  }
  const checkedLiveManifest = await readLive(token, targetPathname);
  assertLiveManifestUnchanged(currentRemoteManifest, checkedLiveManifest);
  return { currentRemoteManifest, immutableManifest };
}

export async function main(rawArgs = process.argv.slice(2)) {
  await loadLocalEnv(path.resolve(__dirname, '..'));
  const args = parseArgs(rawArgs);
  if (args.help) {
    printUsage();
    return;
  }

  await fs.access(args.sourcePath);
  const sourceContents = await fs.readFile(args.sourcePath, 'utf-8');
  const manifest = JSON.parse(sourceContents);
  if (!manifest.releaseId) {
    throw new Error('promotion requires a release manifest with releaseId');
  }
  if (!args.catalogPath) {
    throw new Error('promotion requires --catalog <path>');
  }
  const catalog = await readSolutionCatalog(args.catalogPath);
  await validateManifest(manifest, args.sourcePath, { catalog });
  const artifactVerifications = await readArtifactVerifications(
    args.artifactInventoryPaths,
    catalog,
  );
  validateManifestArtifactCompleteness(manifest, artifactVerifications);
  if (args.confirmReleaseId !== manifest.releaseId && !args.dryRun) {
    throw new Error(
      `publishing release "${manifest.releaseId}" requires --confirm-release ${manifest.releaseId}`,
    );
  }
  console.log(
    `[publish:layer-manifest] validated release ${manifest.releaseId} (catalog ${manifest.catalogVersion})`,
  );
  const token = process.env[BLOB_TOKEN_ENV_VAR];
  if (!token) {
    throw new Error(`${BLOB_TOKEN_ENV_VAR} is required`);
  }

  const immutablePathname = toImmutableManifestPathname(manifest.releaseId, sourceContents);
  const { currentRemoteManifest, immutableManifest: existingImmutableManifest } =
    await inspectPromotionRemoteState({
      token,
      targetPathname: args.targetPathname,
      immutablePathname,
      sourceContents,
    });
  let immutableManifest = existingImmutableManifest;
  if (args.dryRun) {
    if (!currentRemoteManifest) {
      console.log(
        '[publish:layer-manifest] dry run: live pointer is absent; creation requires one release captain and --confirm-create-first-pointer',
      );
    }
    console.log(
      `[publish:layer-manifest] dry run: remote checks passed; would preserve ${immutablePathname}, archive ${args.targetPathname}, and atomically promote the immutable revision`,
    );
    return;
  }
  assertFirstPointerCreationConfirmed(currentRemoteManifest, args.confirmCreateFirstPointer);

  if (immutableManifest) {
    console.log(`[publish:layer-manifest] reusing immutable manifest ${immutablePathname}`);
  } else {
    immutableManifest = await putImmutableBlob(token, sourceContents, immutablePathname);
    console.log(`[publish:layer-manifest] preserved immutable manifest ${immutablePathname}`);
  }

  if (currentRemoteManifest) {
    const archivePathname = toArchivePathname(args.archivePrefix, new Date().toISOString());
    const archivedManifest = await putImmutableBlob(
      token,
      currentRemoteManifest.contents,
      archivePathname,
    );
    console.log(`[publish:layer-manifest] archived previous manifest to ${archivePathname}`);
    if (archivedManifest.url) {
      console.log(`[publish:layer-manifest] archive URL: ${archivedManifest.url}`);
    }
  } else if (!currentRemoteManifest) {
    console.log('[publish:layer-manifest] no previous remote manifest found to archive');
  }

  const liveImmediatelyBeforePromotion = await readLiveManifestIdentity(token, args.targetPathname);
  assertLiveManifestUnchanged(currentRemoteManifest, liveImmediatelyBeforePromotion);
  const promotedManifest = await putLiveManifest(
    token,
    sourceContents,
    args.targetPathname,
    currentRemoteManifest?.etag,
  );
  console.log(`[publish:layer-manifest] atomically promoted release to ${args.targetPathname}`);
  if (promotedManifest.url) {
    console.log(`[publish:layer-manifest] manifest URL: ${promotedManifest.url}`);
  }
}

const isCalledDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isCalledDirectly) {
  main().catch((error) => {
    console.error(
      `[publish:layer-manifest] ${(error instanceof Error && error.message) || String(error)}`,
    );
    process.exit(1);
  });
}
