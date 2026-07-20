import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { RUNTIME_MANIFEST_BLOB_URL } from '../../shared/runtime-manifest.constants.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(frontendRoot, '..');

const DEFAULT_UPLOAD_REPORT_PATH = path.resolve(repoRoot, 'data/cog/generated/upload-report.json');
const DEFAULT_MANIFEST_URL = RUNTIME_MANIFEST_BLOB_URL;
const DEFAULT_OUTPUT_DIR = path.resolve(
  frontendRoot,
  'development-artifacts/layer-manifest/publish',
);

function parseArgs(rawArgs) {
  const args = {
    uploadReportPath: DEFAULT_UPLOAD_REPORT_PATH,
    manifestUrl: DEFAULT_MANIFEST_URL,
    outputDir: DEFAULT_OUTPUT_DIR,
    publish: false,
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const value = rawArgs[index];
    if (value === '--help' || value === '-h') {
      args.help = true;
      continue;
    }
    if (value === '--upload-report') {
      args.uploadReportPath = path.resolve(
        process.cwd(),
        rawArgs[index + 1] ?? args.uploadReportPath,
      );
      index += 1;
      continue;
    }
    if (value === '--manifest-url') {
      args.manifestUrl = rawArgs[index + 1] ?? args.manifestUrl;
      index += 1;
      continue;
    }
    if (value === '--output-dir') {
      args.outputDir = path.resolve(process.cwd(), rawArgs[index + 1] ?? args.outputDir);
      index += 1;
      continue;
    }
    if (value === '--publish') {
      args.publish = true;
    }
  }

  return args;
}

function printUsage() {
  console.log('[publish-solution-cog-manifest] Usage:');
  console.log('  npm --prefix frontend run publish:solution-cog-manifest');
  console.log('  npm --prefix frontend run publish:solution-cog-manifest -- --publish');
  console.log(
    '  npm --prefix frontend run publish:solution-cog-manifest -- --upload-report data/cog/generated/upload-report.json',
  );
}

async function readJson(filePath) {
  const rawValue = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(rawValue);
}

async function fetchJson(url) {
  const uncachedUrl = `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;
  const response = await fetch(uncachedUrl, { method: 'GET', redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function solutionCogEntries(uploadReport) {
  if (uploadReport.dryRun === true) {
    throw new Error(
      'Upload report is marked dryRun=true; run upload:solutions-cogs without --dry-run before publishing.',
    );
  }

  const entries = Array.isArray(uploadReport.entries) ? uploadReport.entries : [];
  const usableEntries = entries.filter((entry) => {
    return (
      entry &&
      typeof entry.solutionId === 'string' &&
      typeof entry.expectedPublicUrl === 'string' &&
      ['uploaded', 'skipped'].includes(entry.status)
    );
  });
  if (usableEntries.length === 0) {
    throw new Error('Upload report has no uploaded/skipped solution COG entries to publish.');
  }
  return usableEntries;
}

function applyDisplayCogUrls(manifest, uploadReport) {
  const entries = solutionCogEntries(uploadReport);
  const displayCogUrlBySolutionId = new Map(
    entries.map((entry) => [entry.solutionId, entry.expectedPublicUrl]),
  );
  const updatedSolutionIds = [];

  const nextManifest = {
    ...manifest,
    generatedAt: new Date().toISOString(),
    solutions: manifest.solutions.map((solution) => {
      const displayCogUrl = displayCogUrlBySolutionId.get(solution.id);
      if (!displayCogUrl) {
        return solution;
      }
      updatedSolutionIds.push(solution.id);
      return {
        ...solution,
        displayCogUrl,
      };
    }),
  };

  const missing = entries
    .map((entry) => entry.solutionId)
    .filter((solutionId) => !updatedSolutionIds.includes(solutionId));
  if (missing.length > 0) {
    throw new Error(
      `Upload report references solution ids missing from manifest: ${missing.join(', ')}`,
    );
  }

  return {
    manifest: nextManifest,
    updatedSolutionIds,
  };
}

async function writeManifestArtifact(manifest, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(outputDir, `manifest.solution-cogs.${timestamp}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  return filePath;
}

async function runNodeScript(scriptPath, args) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: frontendRoot,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (stdout?.trim()) {
    console.log(stdout.trim());
  }
  if (stderr?.trim()) {
    console.error(stderr.trim());
  }
  return `${stdout ?? ''}\n${stderr ?? ''}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const uploadReport = await readJson(args.uploadReportPath);
  const manifest = await fetchJson(args.manifestUrl);
  const { manifest: updatedManifest, updatedSolutionIds } = applyDisplayCogUrls(
    manifest,
    uploadReport,
  );
  const artifactPath = await writeManifestArtifact(updatedManifest, args.outputDir);

  console.log(
    `[publish-solution-cog-manifest] wrote ${path.relative(repoRoot, artifactPath)} with ${updatedSolutionIds.length} displayCogUrl value(s)`,
  );

  await runNodeScript(path.resolve(frontendRoot, 'layer-manifest/validate-manifest.mjs'), [
    artifactPath,
  ]);

  if (!args.publish) {
    console.log(
      '[publish-solution-cog-manifest] validation passed. Re-run with --publish to upload manifest.',
    );
    return;
  }

  await runNodeScript(path.resolve(frontendRoot, 'layer-manifest/publish-manifest.mjs'), [
    '--source',
    artifactPath,
  ]);
}

main().catch((error) => {
  console.error(
    `[publish-solution-cog-manifest] ${(error instanceof Error && error.message) || String(error)}`,
  );
  process.exit(1);
});
