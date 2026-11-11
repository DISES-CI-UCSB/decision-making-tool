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

/**
 * Live browser tests open the deployed web app. Set DMT_TEST_APP_URL to target a preview deployment,
 * or a page server you started yourself, such as `yarn start` in frontend/ on http://localhost:4200.
 * A protected Vercel preview also needs VERCEL_AUTOMATION_BYPASS_SECRET (tests/support/browser/vercel-preview-bypass.ts).
 */
const liveAppUrl = (process.env.DMT_TEST_APP_URL ?? 'https://decision-making-tool-tau.vercel.app').replace(
  /\/+$/,
  '',
);

/**
 * Projects that open the local web app. The `live` project opens the deployed app; `api` only sends HTTP requests.
 * `live-local` runs live browser tests against the local app built with the `e2e` Angular configuration, the only
 * build that contains the Test Sign-In Hook.
 */
const localAppProjectNames = ['deterministic', 'live-local'];
const testSignInHookProjectNames = ['live-local'];

function projectsNamedOnCommandLine(): string[] {
  const argv = process.argv;
  return argv.flatMap((argument, index) => {
    if (argument.startsWith('--project=')) return [argument.slice('--project='.length)];
    if (argument === '--project' && argv[index + 1]) return [argv[index + 1]];
    return [];
  });
}

/**
 * The local Angular app starts only when deterministic or live-local browser tests run. The test runner sets
 * TNC_WEB_SERVER to `on` or `off`, and TNC_WEB_SERVER_CONFIGURATION to `e2e` when live-local tests run.
 * A direct `npx playwright test` decides from the projects named with --project.
 */
const startWebServer = process.env.TNC_WEB_SERVER
  ? process.env.TNC_WEB_SERVER === 'on'
  : projectsNamedOnCommandLine().some((name) => localAppProjectNames.includes(name));
/** One page server serves every local project, so a run that includes live-local serves the e2e build to all of them. */
const serveTestSignInHook = process.env.TNC_WEB_SERVER_CONFIGURATION
  ? process.env.TNC_WEB_SERVER_CONFIGURATION === 'e2e'
  : projectsNamedOnCommandLine().some((name) => testSignInHookProjectNames.includes(name));

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
        command:
          process.env.TNC_WEB_SERVER_COMMAND ??
          `node scripts/start-frontend-server.mjs${serveTestSignInHook ? ' --configuration e2e' : ''}`,
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
      use: { ...devices['Desktop Chrome'], baseURL: liveAppUrl },
    },
    {
      // Live browser tests that sign in disposable accounts through the Test Sign-In Hook. They talk to the real
      // Firebase project, but the app itself is this checkout served locally with the e2e configuration.
      name: 'live-local',
      testMatch: '**/*.live-local.spec.ts',
      timeout: 90000,
      retries: 1,
      workers: 2,
      use: { ...devices['Desktop Chrome'], baseURL: testBaseUrl },
    },
  ],
});
