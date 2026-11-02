import os from 'node:os';
import { defineConfig, devices } from '@playwright/test';
import { deterministicRequestAllowlist } from './tests/support/browser/deterministic-allowlist.ts';

type DeterministicProjectOptions = {
  deterministicRequestAllowlist: string[];
};

const testPort = process.env.TNC_TEST_PORT ?? '4177';
const testBaseUrl = `http://127.0.0.1:${testPort}`;
const artifactDirectory =
  process.env.TNC_PLAYWRIGHT_OUTPUT_DIR ??
  '.test-results/playwright-artifacts';
/** `--record` keeps a trace of every test and a video of every browser test. */
const recording = process.env.TNC_PLAYWRIGHT_RECORD === '1';

/** Projects that open the local web app in a browser. The `api` project only sends HTTP requests. */
const browserProjectNames = ['deterministic', 'live'];

function projectsNamedOnCommandLine(): string[] {
  const argv = process.argv;
  return argv.flatMap((argument, index) => {
    if (argument.startsWith('--project=')) return [argument.slice('--project='.length)];
    if (argument === '--project' && argv[index + 1]) return [argv[index + 1]];
    return [];
  });
}

/**
 * The local Angular app starts only when browser tests run. The test runner sets TNC_WEB_SERVER to
 * `on` or `off`. A direct `npx playwright test` starts it only when --project names a browser project.
 */
const startWebServer = process.env.TNC_WEB_SERVER
  ? process.env.TNC_WEB_SERVER === 'on'
  : projectsNamedOnCommandLine().some((name) => browserProjectNames.includes(name));

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** API tests create Firebase accounts on the live project, so their concurrency is set separately. */
const apiWorkers = positiveInteger(process.env.TNC_API_WORKERS, 5);

export default defineConfig<DeterministicProjectOptions>({
  testDir: './tests',
  testIgnore: '**/*.example.spec.ts',
  outputDir: artifactDirectory,
  fullyParallel: false,
  // Playwright's default cap (half the processors) stays, raised when needed so each project's own limit decides.
  workers: Math.max(apiWorkers, Math.floor(os.availableParallelism() / 2), 1),
  // Keep every attempt directory. A failed attempt's trace and screenshot stay
  // when a later retry passes.
  preserveOutput: 'always',
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: [['./tests/support/reporting/quiet-stdio-reporter.ts']],
  use: {
    baseURL: testBaseUrl,
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    // Playwright 1.64 keeps a failed attempt's trace when a later retry passes.
    trace: recording ? 'on' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: recording ? 'on' : 'off',
  },
  webServer: startWebServer
    ? {
        // Override with TNC_WEB_SERVER_COMMAND to serve another page server on 127.0.0.1:TNC_TEST_PORT.
        command: process.env.TNC_WEB_SERVER_COMMAND ?? 'node scripts/start-frontend-server.mjs',
        url: testBaseUrl,
        reuseExistingServer: process.env.TNC_REUSE_WEB_SERVER === '1',
        timeout: positiveInteger(process.env.TNC_WEB_SERVER_TIMEOUT_MS, 180000),
        stdout: 'ignore',
        stderr: 'pipe',
      }
    : undefined,
  projects: [
    {
      name: 'api',
      testMatch: '**/*.api.spec.ts',
      retries: 0,
      workers: apiWorkers,
    },
    {
      name: 'deterministic',
      testMatch: '**/*.deterministic.spec.ts',
      retries: 0,
      workers: 1,
      use: {
        ...devices['Desktop Chrome'],
        // Explicit external exceptions. Same-origin recorded fixtures and mocks stay allowed.
        deterministicRequestAllowlist: [...deterministicRequestAllowlist],
      },
    },
    {
      name: 'live',
      testMatch: '**/*.live.spec.ts',
      timeout: 90000,
      retries: 1,
      workers: 2,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
