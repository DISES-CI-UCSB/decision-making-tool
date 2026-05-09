import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadLocalEnv } from './load-local-env.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const defaultManualEditsDir = path.resolve(
  __dirname,
  '../development-artifacts/layer-manifest/manual-edits',
);
const legacyManualEditsDir = path.resolve(
  repoRoot,
  'development-artifacts/layer-manifest/manual-edits',
);
const localManifestPath = path.resolve(__dirname, '../public/data/layer-manifest/manifest.json');

function parseArgs(args) {
  let sourcePath = null;
  let publish = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--source') {
      sourcePath = path.resolve(process.cwd(), args[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (value === '--publish') {
      publish = true;
    }
  }
  return { sourcePath, publish };
}

async function detectLatestStyledManifest(manualEditsDir) {
  const candidateDirs = [
    manualEditsDir,
    legacyManualEditsDir,
    path.resolve(os.homedir(), 'Downloads'),
  ];
  for (const directoryPath of candidateDirs) {
    let entries;
    const candidates = [];
    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (
        entry.isFile() &&
        entry.name.endsWith('.json') &&
        entry.name.startsWith('manifest.styled.')
      ) {
        const filePath = path.join(directoryPath, entry.name);
        const stat = await fs.stat(filePath);
        candidates.push({ filePath, stat });
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
      return candidates[0]?.filePath ?? null;
    }
  }

  return null;
}

async function runNodeScript(scriptPath, args) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: path.resolve(__dirname, '..'),
  });
  if (stdout?.trim()) {
    console.log(stdout.trim());
  }
  if (stderr?.trim()) {
    console.error(stderr.trim());
  }
}

async function assertStyledManifestHasSolutions(sourcePath) {
  const rawValue = await fs.readFile(sourcePath, 'utf-8');
  const manifest = JSON.parse(rawValue);
  if (Array.isArray(manifest.solutions)) {
    return;
  }

  throw new Error(
    [
      `Styled manifest is missing the required solutions array: ${sourcePath}`,
      'Load the current Blob manifest in the style editor, save/download a fresh manifest.styled.*.json file, then rerun this command.',
    ].join('\n'),
  );
}

async function main() {
  await loadLocalEnv(path.resolve(__dirname, '..'));
  const { sourcePath: sourceArg, publish } = parseArgs(process.argv.slice(2));
  const sourcePath = sourceArg ?? (await detectLatestStyledManifest(defaultManualEditsDir));

  if (!sourcePath) {
    throw new Error(
      `No styled manifest found. Save one into ${defaultManualEditsDir} or ~/Downloads (manifest.styled.<editor>.<timestamp>.json), or pass --source <path>.`,
    );
  }

  await fs.access(sourcePath);
  console.log(`[publish:styled-manifest] using ${sourcePath}`);
  await assertStyledManifestHasSolutions(sourcePath);

  // Validate the supplied styled manifest before touching runtime/publish files.
  await runNodeScript(path.resolve(__dirname, './validate-manifest.mjs'), [sourcePath]);

  if (!publish) {
    console.log('[publish:styled-manifest] validation passed. Re-run with --publish to upload.');
    return;
  }

  // Promote the approved styled manifest to the runtime local manifest.
  await fs.copyFile(sourcePath, localManifestPath);
  console.log(
    `[publish:styled-manifest] copied ${path.relative(repoRoot, sourcePath)} -> ${path.relative(repoRoot, localManifestPath)}`,
  );

  // Publish to Vercel Blob using the existing archive + publish pipeline.
  await runNodeScript(path.resolve(__dirname, './publish-manifest.mjs'), [
    '--source',
    localManifestPath,
  ]);
}

main().catch((error) => {
  console.error(`[publish:styled-manifest] ${(error instanceof Error && error.message) || String(error)}`);
  process.exit(1);
});
