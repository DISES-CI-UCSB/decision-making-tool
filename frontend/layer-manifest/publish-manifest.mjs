import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadLocalEnv } from './load-local-env.mjs';
import { LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH, RUNTIME_MANIFEST_BLOB_PATHNAME } from '../shared/runtime-manifest.constants.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BLOB_TOKEN_ENV_VAR = 'BLOB_READ_WRITE_TOKEN';
const DEFAULT_SOURCE_MANIFEST_PATH = path.resolve(__dirname, '..', LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH);
const DEFAULT_TARGET_PATHNAME = RUNTIME_MANIFEST_BLOB_PATHNAME;
const DEFAULT_ARCHIVE_PREFIX = 'manifest/archive/';

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

function extractFirstUrl(output) {
  const match = output.match(/https:\/\/\S+/);
  return match ? match[0] : null;
}

function parseArgs(rawArgs) {
  const args = {
    sourcePath: DEFAULT_SOURCE_MANIFEST_PATH,
    targetPathname: DEFAULT_TARGET_PATHNAME,
    archivePrefix: DEFAULT_ARCHIVE_PREFIX,
    skipArchive: false,
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
    if (value === '--skip-archive') {
      args.skipArchive = true;
    }
  }

  return args;
}

function printUsage() {
  console.log('[publish:layer-manifest] Usage:');
  console.log('  npm --prefix frontend run publish:layer-manifest');
  console.log(
    '  npm --prefix frontend run publish:layer-manifest -- --target manifest/manifest.json --archive-prefix manifest/archive/',
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

async function copyBlob(token, fromUrlOrPathname, toPathname) {
  const { stdout, stderr } = await execFileAsync('vercel', [
    'blob',
    'copy',
    fromUrlOrPathname,
    toPathname,
    '--rw-token',
    token,
    '--no-color',
  ]);
  const output = `${stdout}\n${stderr}`;
  return {
    output,
    copiedUrl: extractFirstUrl(output),
  };
}

async function putBlob(token, sourcePath, pathnameToUpload) {
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
  const output = `${stdout}\n${stderr}`;
  return {
    output,
    uploadedUrl: extractFirstUrl(output),
  };
}

function toArchivePathname(archivePrefix, timestampIso) {
  const safePrefix = archivePrefix.endsWith('/') ? archivePrefix : `${archivePrefix}/`;
  return `${safePrefix}manifest.${timestampIso.replace(/[:.]/g, '-')}.json`;
}

async function main() {
  await loadLocalEnv(path.resolve(__dirname, '..'));
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const token = process.env[BLOB_TOKEN_ENV_VAR];
  if (!token) {
    throw new Error(`${BLOB_TOKEN_ENV_VAR} is required`);
  }

  await fs.access(args.sourcePath);

  const currentRemoteMatches = await listBlobByPrefix(token, args.targetPathname, 5);
  const currentRemoteManifest = currentRemoteMatches.find((blob) => blob.pathname === args.targetPathname) ?? null;

  if (currentRemoteManifest && !args.skipArchive) {
    const archivePathname = toArchivePathname(args.archivePrefix, new Date().toISOString());
    const { copiedUrl } = await copyBlob(token, currentRemoteManifest.url, archivePathname);
    console.log(`[publish:layer-manifest] archived previous manifest to ${archivePathname}`);
    if (copiedUrl) {
      console.log(`[publish:layer-manifest] archive URL: ${copiedUrl}`);
    }
  } else if (!currentRemoteManifest) {
    console.log('[publish:layer-manifest] no previous remote manifest found to archive');
  }

  const { uploadedUrl } = await putBlob(token, args.sourcePath, args.targetPathname);
  console.log(`[publish:layer-manifest] published local manifest to ${args.targetPathname}`);
  if (uploadedUrl) {
    console.log(`[publish:layer-manifest] manifest URL: ${uploadedUrl}`);
  }
}

main().catch((error) => {
  console.error(`[publish:layer-manifest] ${(error instanceof Error && error.message) || String(error)}`);
  process.exit(1);
});
