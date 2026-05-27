import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlobNotFoundError, head, put } from '@vercel/blob';
import { loadLocalEnv } from '../../layer-manifest/load-local-env.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(frontendRoot, '..');

const BLOB_TOKEN_ENV = 'BLOB_READ_WRITE_TOKEN';
const DEFAULT_PUBLISH_REPORT_PATH = path.resolve(repoRoot, 'data/cog/generated/publish-report.json');
const DEFAULT_UPLOAD_REPORT_PATH = path.resolve(repoRoot, 'data/cog/generated/upload-report.json');

function parseArgs(rawArgs) {
  const args = {
    publishReportPath: DEFAULT_PUBLISH_REPORT_PATH,
    uploadReportPath: DEFAULT_UPLOAD_REPORT_PATH,
    solutionIds: [],
    limit: null,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const value = rawArgs[index];
    if (value === '--help' || value === '-h') {
      args.help = true;
      continue;
    }
    if (value === '--report') {
      args.publishReportPath = path.resolve(process.cwd(), rawArgs[index + 1] ?? args.publishReportPath);
      index += 1;
      continue;
    }
    if (value === '--output') {
      args.uploadReportPath = path.resolve(process.cwd(), rawArgs[index + 1] ?? args.uploadReportPath);
      index += 1;
      continue;
    }
    if (value === '--solution-id') {
      args.solutionIds.push(rawArgs[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (value === '--limit') {
      args.limit = Number.parseInt(rawArgs[index + 1] ?? '', 10);
      index += 1;
      continue;
    }
    if (value === '--dry-run') {
      args.dryRun = true;
    }
  }

  args.solutionIds = args.solutionIds.filter(Boolean);
  if (!Number.isInteger(args.limit) || args.limit <= 0) {
    args.limit = null;
  }
  return args;
}

function printUsage() {
  console.log('[upload-solutions-cogs] Usage:');
  console.log('  npm --prefix frontend run upload:solutions-cogs');
  console.log('  npm --prefix frontend run upload:solutions-cogs -- --solution-id ecos17_estr30_runap_hf');
  console.log('  npm --prefix frontend run upload:solutions-cogs -- --dry-run --limit 1');
}

async function readJson(filePath) {
  const rawValue = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(rawValue);
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function previousEntriesByBlobPath(uploadReport) {
  const entries = Array.isArray(uploadReport?.entries) ? uploadReport.entries : [];
  return new Map(
    entries
      .filter((entry) => entry?.expectedBlobPath)
      .map((entry) => [entry.expectedBlobPath, entry]),
  );
}

function selectEntries(publishReport, args) {
  let entries = Array.isArray(publishReport.entries) ? publishReport.entries : [];
  if (args.solutionIds.length > 0) {
    const wanted = new Set(args.solutionIds);
    entries = entries.filter((entry) => wanted.has(String(entry.solutionId)));
    const found = new Set(entries.map((entry) => String(entry.solutionId)));
    const missing = [...wanted].filter((solutionId) => !found.has(solutionId));
    if (missing.length > 0) {
      throw new Error(`Requested solution ids not found in publish report: ${missing.join(', ')}`);
    }
  }
  if (args.limit !== null) {
    entries = entries.slice(0, args.limit);
  }
  return entries;
}

function assertUploadableEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Publish report contains a non-object entry.');
  }
  for (const key of ['solutionId', 'stagedPath', 'expectedBlobPath', 'expectedPublicUrl']) {
    if (typeof entry[key] !== 'string' || entry[key].trim().length === 0) {
      throw new Error(`Publish report entry for ${entry.solutionId ?? '<unknown>'} missing ${key}.`);
    }
  }
  if (entry.cogValidation?.isValidCog !== true) {
    throw new Error(`Refusing to upload ${entry.solutionId}: publish report does not mark it as a valid COG.`);
  }
}

async function sha256File(filePath) {
  const buffer = await fs.readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}

async function headBlob(pathname, token) {
  try {
    return await head(pathname, { token });
  } catch (error) {
    if (error instanceof BlobNotFoundError || error?.name === 'BlobNotFoundError') {
      return null;
    }
    throw error;
  }
}

function stripEtagQuotes(etag) {
  return typeof etag === 'string' ? etag.replace(/^W\//, '').replace(/^"|"$/g, '') : null;
}

function shouldSkip({ remoteBlob, previousEntry, localSha256, localBytes }) {
  if (!remoteBlob || remoteBlob.size !== localBytes) {
    return false;
  }

  if (stripEtagQuotes(remoteBlob.etag) === localSha256) {
    return true;
  }

  return previousEntry?.cogSha256 === localSha256 && previousEntry?.remoteEtag === remoteBlob.etag;
}

async function uploadCog({ token, entry, remoteBlob, localPath, dryRun }) {
  if (dryRun) {
    return {
      url: entry.expectedPublicUrl,
      pathname: entry.expectedBlobPath,
      size: entry.cogBytes,
      etag: remoteBlob?.etag ?? null,
      uploadedAt: null,
    };
  }

  const body = await fs.readFile(localPath);
  return put(entry.expectedBlobPath, body, {
    access: 'public',
    allowOverwrite: Boolean(remoteBlob),
    contentType: 'image/tiff',
    token,
    ...(remoteBlob?.etag ? { ifMatch: remoteBlob.etag } : {}),
  });
}

async function writeUploadReport(uploadReportPath, report) {
  await fs.mkdir(path.dirname(uploadReportPath), { recursive: true });
  const existingReport = await readJsonIfExists(uploadReportPath);
  if (existingReport) {
    const runsDir = path.join(path.dirname(uploadReportPath), 'runs');
    await fs.mkdir(runsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.copyFile(uploadReportPath, path.join(runsDir, `upload-report.${timestamp}.json`));
  }
  await fs.writeFile(uploadReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
}

function countStatuses(entries) {
  return entries.reduce((counts, entry) => {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
    return counts;
  }, {});
}

async function main() {
  await loadLocalEnv(frontendRoot);
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const token = process.env[BLOB_TOKEN_ENV];
  if (!token) {
    throw new Error(`${BLOB_TOKEN_ENV} missing (set in repo or frontend .env.local)`);
  }

  const publishReport = await readJson(args.publishReportPath);
  const previousReport = await readJsonIfExists(args.uploadReportPath);
  const previousEntries = previousEntriesByBlobPath(previousReport);
  const selectedEntries = selectEntries(publishReport, args);
  const outputEntries = [];
  const failures = [];

  console.log(
    `[upload-solutions-cogs] report=${path.relative(repoRoot, args.publishReportPath)} entries=${selectedEntries.length} dryRun=${args.dryRun}`,
  );

  for (const [index, entry] of selectedEntries.entries()) {
    const startedAt = Date.now();
    try {
      assertUploadableEntry(entry);
      const localPath = path.resolve(repoRoot, entry.stagedPath);
      await fs.access(localPath);
      const stats = await fs.stat(localPath);
      const localSha256 = await sha256File(localPath);
      const localBytes = stats.size;
      const remoteBlob = await headBlob(entry.expectedBlobPath, token);
      const previousEntry = previousEntries.get(entry.expectedBlobPath);

      if (shouldSkip({ remoteBlob, previousEntry, localSha256, localBytes })) {
        outputEntries.push({
          solutionId: entry.solutionId,
          solutionName: entry.solutionName ?? null,
          expectedBlobPath: entry.expectedBlobPath,
          expectedPublicUrl: entry.expectedPublicUrl,
          stagedPath: entry.stagedPath,
          status: 'skipped',
          cogSha256: localSha256,
          cogBytes: localBytes,
          remoteEtag: remoteBlob.etag,
          remoteSize: remoteBlob.size,
          remoteUploadedAt: remoteBlob.uploadedAt?.toISOString?.() ?? null,
          uploadSeconds: 0,
        });
        console.log(`[upload-solutions-cogs] [${index + 1}/${selectedEntries.length}] skipped ${entry.solutionId}`);
        continue;
      }

      const uploadedBlob = await uploadCog({
        token,
        entry,
        remoteBlob,
        localPath,
        dryRun: args.dryRun,
      });
      outputEntries.push({
        solutionId: entry.solutionId,
        solutionName: entry.solutionName ?? null,
        expectedBlobPath: entry.expectedBlobPath,
        expectedPublicUrl: uploadedBlob.url ?? entry.expectedPublicUrl,
        stagedPath: entry.stagedPath,
        status: args.dryRun ? 'dry-run' : 'uploaded',
        cogSha256: localSha256,
        cogBytes: localBytes,
        remoteEtag: uploadedBlob.etag ?? null,
        remoteSize: uploadedBlob.size ?? localBytes,
        remoteUploadedAt: uploadedBlob.uploadedAt?.toISOString?.() ?? null,
        uploadSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
      });
      console.log(
        `[upload-solutions-cogs] [${index + 1}/${selectedEntries.length}] ${args.dryRun ? 'would upload' : 'uploaded'} ${entry.solutionId}`,
      );
    } catch (error) {
      failures.push({
        solutionId: entry?.solutionId ?? null,
        expectedBlobPath: entry?.expectedBlobPath ?? null,
        error: (error instanceof Error && error.message) || String(error),
      });
      console.error(
        `[upload-solutions-cogs] [${index + 1}/${selectedEntries.length}] FAILED ${entry?.solutionId ?? '<unknown>'}: ${
          (error instanceof Error && error.message) || String(error)
        }`,
      );
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    sourcePublishReport: path.relative(repoRoot, args.publishReportPath),
    uploadReportPath: path.relative(repoRoot, args.uploadReportPath),
    dryRun: args.dryRun,
    statusCounts: countStatuses(outputEntries),
    entries: outputEntries,
    failures,
  };
  await writeUploadReport(args.uploadReportPath, report);
  console.log(`[upload-solutions-cogs] wrote upload report -> ${path.relative(repoRoot, args.uploadReportPath)}`);
  console.log(
    `[upload-solutions-cogs] done: ${outputEntries.length} entries, ${failures.length} failure(s), statuses=${JSON.stringify(report.statusCounts)}`,
  );

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[upload-solutions-cogs] ${(error instanceof Error && error.message) || String(error)}`);
  process.exit(1);
});
