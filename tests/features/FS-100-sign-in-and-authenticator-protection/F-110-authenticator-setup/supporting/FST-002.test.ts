import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const frontendDirectory = path.join(repositoryRoot, 'frontend');
const angularCli = path.join(frontendDirectory, 'node_modules/@angular/cli/bin/ng.js');
const hookDirectory = path.join(frontendDirectory, 'src/app/core/services');
const e2eHookSource = path.join(hookDirectory, 'test-sign-in-hook.e2e.ts');
const productionHookSource = path.join(hookDirectory, 'test-sign-in-hook.ts');
/** The disposable test-account domain, as plain text or as the escaped form inside the hook's email pattern. */
const disposableDomain = /dmt-test\\?\.invalid/;
/** The window property Playwright sets and the hook reads; minifiers keep property names. */
const hookGlobalEntryPoint = '__dmtTestSignIn';

/** Runs `ng build --configuration production` into a temporary folder, using the committed production environment. */
async function buildProductionApp(outputPath: string): Promise<void> {
  const output: string[] = [];
  const exitCode = await new Promise<number>((resolve, reject) => {
    const build = spawn(
      process.execPath,
      [angularCli, 'build', '--configuration', 'production', '--output-path', outputPath],
      { cwd: frontendDirectory, env: { ...process.env, NG_CLI_ANALYTICS: 'false' } },
    );
    build.stdout.on('data', (chunk) => output.push(String(chunk)));
    build.stderr.on('data', (chunk) => output.push(String(chunk)));
    build.on('error', reject);
    build.on('exit', (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error(`The production build failed (exit ${exitCode}):\n${output.join('').slice(-4000)}`);
  }
}

async function emittedScriptsAndPages(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(js|mjs|html)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

test(
  'The production web app ships without the test-only email-and-password sign-in path.',
  async () => {
    const { TEST_SIGN_IN_HOOK_MARKER } = (await import(e2eHookSource)) as { TEST_SIGN_IN_HOOK_MARKER: string };
    expect(TEST_SIGN_IN_HOOK_MARKER.length, 'the hook marker is a non-empty string').toBeGreaterThan(0);
    const e2eHookText = await readFile(e2eHookSource, 'utf8');
    const productionHookText = await readFile(productionHookSource, 'utf8');
    expect(e2eHookText, 'the e2e hook source contains its marker').toContain(TEST_SIGN_IN_HOOK_MARKER);
    expect(e2eHookText, 'the e2e hook source reads its global entry point').toContain(hookGlobalEntryPoint);
    expect(productionHookText, 'the production stub does not contain the marker').not.toContain(
      TEST_SIGN_IN_HOOK_MARKER,
    );
    expect(productionHookText, 'the production stub does not read the global entry point').not.toContain(
      hookGlobalEntryPoint,
    );

    const outputPath = await mkdtemp(path.join(os.tmpdir(), 'dmt-fst-002-'));
    try {
      await buildProductionApp(outputPath);
      const files = await emittedScriptsAndPages(outputPath);
      expect(files.filter((file) => file.endsWith('.html')).length, 'emitted HTML pages').toBeGreaterThan(0);
      expect(files.filter((file) => /\.m?js$/.test(file)).length, 'emitted JavaScript files').toBeGreaterThan(0);

      const filesWithTestSignIn: string[] = [];
      const filesWithHookEntryPoint: string[] = [];
      for (const file of files) {
        const contents = await readFile(file, 'utf8');
        if (contents.includes(TEST_SIGN_IN_HOOK_MARKER) || disposableDomain.test(contents)) {
          filesWithTestSignIn.push(path.relative(outputPath, file));
        }
        if (contents.includes(hookGlobalEntryPoint)) {
          filesWithHookEntryPoint.push(path.relative(outputPath, file));
        }
      }
      expect(filesWithTestSignIn, 'emitted files that contain the hook marker or dmt-test.invalid').toEqual([]);
      expect(filesWithHookEntryPoint, 'emitted files that contain the __dmtTestSignIn global entry point').toEqual([]);
    } finally {
      await rm(outputPath, { recursive: true, force: true });
    }
  },
  300_000,
);
