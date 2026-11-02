/**
 * Feature-centered test runner. Every command validates the catalog first.
 *
 *   npm run test:features | test:core | test:shared | test:gate | test:all | test:fast-only
 *   npm run test:browser-deterministic | test:browser-live | test:browser-all
 *   npm run test:feature -- F-210         Tests associated with one Feature
 *   npm run test:feature-set -- FS-200    Tests associated with one Feature Set
 *   npm run test:single -- FBT-002        One permanent test, by catalog test identifier
 *
 * Options, after the selector:
 *   --headed   Show the browser window for browser tests. API and Vitest tests have no window.
 *   --record   Keep a Playwright trace of each selected Playwright test, plus a video for browser tests,
 *              in .test-results/playwright-recordings/<test id>/. Only the latest recording per test is kept.
 *
 * Watching tests. These runs are not stored in .test-results/latest.json:
 *   npm run test:ui -- feature F-210 | feature-set FS-200 | test FBT-002 | features | all
 *   npm run test:show-recording -- FBT-002
 *
 * Runners: *.test.ts files run on Vitest. *.api.spec.ts files (non-browser HTTP tests) run in the
 * Playwright `api` project; *.deterministic.spec.ts and *.live.spec.ts files run in the browser projects.
 */
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import playwrightConfig from '../playwright.config.ts';
import type { CatalogTest, TestCatalog } from '../tests/support/catalog/test-catalog.ts';
import { runReleaseGate } from '../tests/support/reporting/gate.ts';
import {
  commandReportLines,
  commandReportUsesColor,
  formatWallClock,
} from '../tests/support/reporting/command-report.ts';
import { redactJsonStrings } from '../tests/support/reporting/credential-redaction.ts';
import {
  executionStatus,
  finalAttemptAttachments,
  normalizePlaywrightResults,
  passedAfterRetryLines,
  type NormalizedTestResult,
} from '../tests/support/reporting/playwright-results.ts';
import {
  requiredGateDefinitionFingerprint,
  testDefinitionFingerprint,
} from '../tests/support/reporting/test-definition-fingerprint.ts';
import {
  introductionLines,
  type PlannedTest,
} from '../tests/support/reporting/run-progress.ts';
import { validateTestingFoundations } from '../tests/support/validation/foundations.ts';

const root = process.cwd();
const resultsDirectory = path.join(root, '.test-results');
const recordingsDirectory = path.join(resultsDirectory, 'playwright-recordings');
const cacheDirectory = process.env.TNC_TEST_CACHE_DIR
  ? path.resolve(process.env.TNC_TEST_CACHE_DIR)
  : path.join(root, '.test-cache');
const testCatalog = JSON.parse(
  await readFile(path.join(root, 'tests/support/catalog/test-catalog.json'), 'utf8'),
) as TestCatalog;

type ExecutionStateName = 'passed' | 'failed' | 'inconclusive';

type NormalizedResult = NormalizedTestResult;

interface Execution {
  name: ExecutionStateName;
  exitCode: number;
  durationMs: number;
  results: NormalizedResult[];
}

type PlaywrightProject = 'api' | 'deterministic' | 'live';

interface RunOptions {
  headed: boolean;
  record: boolean;
}

const isExecutable = (test: CatalogTest) => test.enforcement !== 'disabled';

/** The Playwright project that runs a test, or null for a Vitest test. */
function playwrightProjectFor(test: CatalogTest): PlaywrightProject | null {
  if (test.environment === 'browser') return test.browserMode === 'live' ? 'live' : 'deterministic';
  return test.sourceFile.endsWith('.api.spec.ts') ? 'api' : null;
}

const sourceFiles = (tests: CatalogTest[]) => [
  ...new Set(tests.map(({ sourceFile }) => sourceFile)),
];
const associatedWithFeature = (test: CatalogTest, featureId: string) =>
  test.owner === featureId || test.additionalFeatureAssociations.includes(featureId);

function featureSetTests(featureSetId: string): CatalogTest[] {
  const featureIds = new Set(
    testCatalog.features
      .filter((feature) => feature.featureSetId === featureSetId)
      .map(({ id }) => id),
  );
  return testCatalog.tests.filter(
    (test) =>
      (test.owner !== null && featureIds.has(test.owner)) ||
      test.additionalFeatureAssociations.some((id) => featureIds.has(id)),
  );
}

function selectTests(mode: string | undefined, selector: string | undefined): CatalogTest[] {
  const enabled = testCatalog.tests.filter(isExecutable);
  switch (mode) {
    case 'fast-only':
      return enabled.filter((test) => test.environment === 'non-browser' && test.fast);
    case 'features':
      return enabled.filter((test) => test.category === 'feature-behavior');
    case 'core':
      return enabled.filter((test) => test.category === 'critical-core');
    case 'shared':
      return enabled.filter((test) => test.category === 'shared-supporting');
    case 'browser-deterministic':
      return enabled.filter((test) => test.browserMode === 'deterministic');
    case 'browser-live':
      return enabled.filter((test) => test.browserMode === 'live');
    case 'browser-all':
      return enabled.filter((test) => test.environment === 'browser');
    case 'feature':
      if (!testCatalog.features.some(({ id }) => id === selector)) {
        throw new Error(`Unknown Feature selector: ${selector ?? '(missing)'}.`);
      }
      return enabled.filter((test) => associatedWithFeature(test, selector ?? ''));
    case 'feature-set':
      if (!testCatalog.featureSets.some(({ id }) => id === selector)) {
        throw new Error(`Unknown Feature Set selector: ${selector ?? '(missing)'}.`);
      }
      return featureSetTests(selector ?? '').filter(isExecutable);
    case 'test': {
      const test = testCatalog.tests.find(({ id }) => id === selector);
      if (!test) throw new Error(`Unknown test selector: ${selector ?? '(missing)'}.`);
      if (!isExecutable(test)) {
        throw new Error(`${test.id} is disabled, so normal commands do not run it.`);
      }
      return [test];
    }
    case 'all':
      return enabled;
    default:
      throw new Error(`Unknown test command mode: ${mode ?? '(missing)'}.`);
  }
}

function requiredTests(category: CatalogTest['category']): CatalogTest[] {
  return testCatalog.tests.filter(
    (test) =>
      isExecutable(test) && test.enforcement === 'required' && test.category === category,
  );
}

async function runProcess(
  command: string,
  args: string[],
  environment: Record<string, string> = {},
) {
  const startedAt = performance.now();
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      // Windows resolves npx through npx.cmd, which Node 22 only launches through a shell.
      shell: process.platform === 'win32',
      env: { ...process.env, ...environment },
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
  return {
    exitCode,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function vitestResults(
  report: unknown,
  selected: CatalogTest[],
  processFailed: boolean,
): NormalizedResult[] {
  const testResults = asRecord(report)?.testResults;
  const files = Array.isArray(testResults) ? testResults : [];
  return selected.map((test) => {
    const file = files
      .map(asRecord)
      .find((item) => typeof item?.name === 'string' && item.name.endsWith(test.sourceFile));
    const assertionResults = Array.isArray(file?.assertionResults) ? file.assertionResults : [];
    const assertion = assertionResults
      .map(asRecord)
      .find((item) => item?.title === test.name);
    const status = assertion?.status ?? file?.status;
    const perfStats = asRecord(file?.perfStats);
    const runtime = typeof perfStats?.runtime === 'number' ? perfStats.runtime : 0;
    const duration = typeof assertion?.duration === 'number' ? assertion.duration : runtime;
    const durationMs = Math.round(duration);
    return {
      id: test.id,
      state:
        status === 'passed'
          ? 'passed'
          : status === 'pending' || status === 'skipped'
            ? 'skipped'
            : processFailed
              ? 'failed'
              : 'unexecuted',
      durationMs,
      totalDurationMs: durationMs,
    };
  });
}

/** Reads a raw runner report and rewrites it with bearer credentials removed. */
async function readRedactedReport(file: string): Promise<unknown> {
  const report = await readJson(file);
  if (report === null) return null;
  const redacted = redactJsonStrings(report);
  if (JSON.stringify(redacted) !== JSON.stringify(report)) {
    await writeFile(file, `${JSON.stringify(redacted, null, 2)}\n`);
  }
  return redacted;
}

function plannedTests(selected: CatalogTest[]): PlannedTest[] {
  return selected.map(({ id, name, durationBudgetMs }) => ({ id, name, durationBudgetMs }));
}

function vitestWorkerCount(): number {
  const processors =
    typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  // Same cap Vitest uses for a non-watch forks pool: one fewer than the available processors, at least one.
  return Math.max(processors - 1, 1);
}

function playwrightWorkerCount(project: PlaywrightProject): number {
  const workers = playwrightConfig.projects?.find((entry) => entry.name === project)?.workers;
  return typeof workers === 'number' && workers > 0 ? workers : 1;
}

const testPort = process.env.TNC_TEST_PORT ?? String(42000 + (process.pid % 10000));

/** Environment for one Playwright run. The local web app starts only when a browser project runs. */
function playwrightEnvironment(projects: PlaywrightProject[], options: RunOptions): Record<string, string> {
  const browserProjects = projects.filter((project) => project !== 'api');
  return {
    TNC_WEB_SERVER: browserProjects.length ? 'on' : 'off',
    TNC_PLAYWRIGHT_RECORD: options.record ? '1' : '0',
    TNC_TEST_PORT: testPort,
    ...(browserProjects.length === 1
      ? {
          VITE_TEST_MODE: 'true',
          VITE_TEST_RENDERER: browserProjects[0] === 'deterministic' ? 'three' : 'arcgis',
        }
      : {}),
  };
}

function announceRun(selected: CatalogTest[], workers: number): string {
  const tests = plannedTests(selected);
  for (const line of introductionLines(tests, workers)) console.log(line);
  return JSON.stringify({ tests });
}

async function runVitest(selected: CatalogTest[], runKey: string): Promise<Execution> {
  if (!selected.length) return { name: 'passed', exitCode: 0, durationMs: 0, results: [] };
  const workers = vitestWorkerCount();
  const output = path.join(resultsDirectory, `raw-vitest-${runKey}.json`);
  const processResult = await runProcess(
    'npx',
    [
      '--no-install',
      'vitest',
      'run',
      ...sourceFiles(selected),
      '--reporter=json',
      '--reporter=tests/support/reporting/vitest-progress-reporter.ts',
      `--outputFile.json=${output}`,
      '--maxWorkers',
      String(workers),
    ],
    { TNC_TEST_RUN_PLAN: announceRun(selected, workers) },
  );
  const results = vitestResults(await readRedactedReport(output), selected, processResult.exitCode !== 0);
  return {
    ...executionStatus(selected, results),
    durationMs: processResult.durationMs,
    results,
  };
}

/**
 * Replaces each test's recording with the trace and video from its final attempt.
 * Trace archives keep request headers, including test-account ID tokens, so they stay on this machine.
 */
async function saveRecordings(report: unknown, selected: CatalogTest[], results: NormalizedResult[]) {
  for (const test of selected) {
    const attachments = finalAttemptAttachments(report, test, root);
    if (!attachments.some(({ name }) => name === 'trace')) {
      console.warn(`No recording was produced for ${test.id}; any earlier recording is unchanged.`);
      continue;
    }
    const directory = path.join(recordingsDirectory, test.id);
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    const files: string[] = [];
    for (const attachment of attachments) {
      const fileName =
        attachment.name === 'trace' ? 'trace.zip' : `video${path.extname(attachment.path) || '.webm'}`;
      await copyFile(attachment.path, path.join(directory, fileName));
      await rm(attachment.path, { force: true });
      files.push(fileName);
    }
    const recording = {
      id: test.id,
      name: test.name,
      recordedAt: new Date().toISOString(),
      state: results.find(({ id }) => id === test.id)?.state ?? 'unexecuted',
      files,
    };
    await writeFile(path.join(directory, 'recording.json'), `${JSON.stringify(recording, null, 2)}\n`);
    console.log(`Recording saved for ${test.id}. Open it with: npm run test:show-recording -- ${test.id}`);
  }
}

async function runPlaywright(
  selected: CatalogTest[],
  project: PlaywrightProject,
  runKey: string,
  options: RunOptions,
): Promise<Execution> {
  if (!selected.length) return { name: 'passed', exitCode: 0, durationMs: 0, results: [] };
  const report = path.join(resultsDirectory, `raw-playwright-${runKey}-${project}.json`);
  // Playwright never starts more workers than there are test files to share out.
  const workers = Math.min(playwrightWorkerCount(project), sourceFiles(selected).length);
  const headed = options.headed && project !== 'api';
  const processResult = await runProcess(
    'npx',
    [
      '--no-install',
      'playwright',
      'test',
      ...sourceFiles(selected),
      `--project=${project}`,
      '--reporter=json,tests/support/reporting/quiet-stdio-reporter.ts',
      ...(headed ? ['--headed'] : []),
    ],
    {
      ...playwrightEnvironment([project], options),
      TNC_TEST_RUN_PLAN: announceRun(selected, workers),
      TNC_PLAYWRIGHT_OUTPUT_DIR: path.join(
        resultsDirectory,
        `playwright-artifacts-${runKey}-${project}`,
      ),
      PLAYWRIGHT_JSON_OUTPUT_FILE: report,
    },
  );
  const reportData = await readRedactedReport(report);
  const results = normalizePlaywrightResults(reportData, selected, processResult.exitCode !== 0, root);
  if (options.record) await saveRecordings(reportData, selected, results);
  return {
    ...executionStatus(selected, results),
    durationMs: processResult.durationMs,
    results,
  };
}

async function execute(
  selected: CatalogTest[],
  runKey: string,
  options: RunOptions = { headed: false, record: false },
): Promise<Execution> {
  const vitestTests = selected.filter((test) => playwrightProjectFor(test) === null);
  if (options.record && vitestTests.length) {
    console.log(`--record applies to Playwright tests only. Not recorded: ${vitestTests.map(({ id }) => id).join(', ')}.`);
  }
  if (options.headed && selected.length && !selected.some(({ environment }) => environment === 'browser')) {
    console.log('--headed has no effect here: no browser test is selected.');
  }
  const runs = [await runVitest(vitestTests, runKey)];
  for (const project of ['api', 'deterministic', 'live'] as const) {
    runs.push(
      await runPlaywright(
        selected.filter((test) => playwrightProjectFor(test) === project),
        project,
        runKey,
        options,
      ),
    );
  }
  const results = runs.flatMap((run) => run.results);
  return {
    ...executionStatus(selected, results),
    durationMs: runs.reduce((total, run) => total + run.durationMs, 0),
    results,
  };
}

/** Opens Playwright UI mode for the selected tests. Nothing is stored in latest.json or history.json. */
async function openUiMode(kind: string | undefined, selector: string | undefined): Promise<number> {
  if (!kind) {
    throw new Error('Usage: npm run test:ui -- feature F-210 | feature-set FS-200 | test FBT-002 | features | all');
  }
  const selected = selectTests(kind, selector);
  const viewable = selected.filter((test) => playwrightProjectFor(test) !== null);
  const vitestOnly = selected.filter((test) => playwrightProjectFor(test) === null);
  if (vitestOnly.length) {
    console.log(
      `Playwright UI mode shows Playwright tests only. Not shown (Vitest): ${vitestOnly.map(({ id }) => id).join(', ')}.`,
    );
  }
  if (!viewable.length) {
    throw new Error('No Playwright test matches this selection, so there is nothing to show in UI mode.');
  }
  const projects = [...new Set(viewable.map((test) => playwrightProjectFor(test) as PlaywrightProject))];
  console.log(`Opening Playwright UI mode for ${viewable.map(({ id }) => id).join(', ')}.`);
  console.log('UI mode runs are for watching; their results are not stored in .test-results/latest.json.');
  const { exitCode } = await runProcess(
    'npx',
    [
      '--no-install',
      'playwright',
      'test',
      '--ui',
      ...sourceFiles(viewable),
      ...projects.map((project) => `--project=${project}`),
    ],
    {
      ...playwrightEnvironment(projects, { headed: false, record: false }),
      TNC_PLAYWRIGHT_OUTPUT_DIR: path.join(resultsDirectory, 'playwright-ui-artifacts'),
    },
  );
  return exitCode;
}

function lifecycleFor(test: CatalogTest | undefined): string {
  return testCatalog.features.find(({ id }) => id === test?.owner)?.lifecycle ?? 'not-applicable';
}

function recordedTestResult(result: NormalizedResult, timestamp: string) {
  const test = testCatalog.tests.find(({ id }) => id === result.id);
  return {
    ...result,
    timestamp,
    lifecycle: lifecycleFor(test),
    enforcement: test?.enforcement,
    ...(test ? { definitionFingerprint: testDefinitionFingerprint(test) } : {}),
  };
}

function pruneRetiredTestResults(latestTests: Record<string, unknown>) {
  const permanentTestIds = new Set(testCatalog.tests.map(({ id }) => id));
  for (const storedId of Object.keys(latestTests)) {
    if (!permanentTestIds.has(storedId)) {
      delete latestTests[storedId];
    }
  }
}

async function recordRun(
  command: string,
  selector: string | null,
  selected: CatalogTest[],
  execution: Execution,
  gateStatus?: string,
) {
  const timestamp = new Date().toISOString();
  // durationMs is the final attempt. Earlier attempts stay in totalDurationMs.
  const budgetWarnings = execution.results.flatMap((result) => {
    const test = testCatalog.tests.find(({ id }) => id === result.id);
    return test && result.durationMs > test.durationBudgetMs
      ? [{ id: result.id, measuredMs: result.durationMs, budgetMs: test.durationBudgetMs }]
      : [];
  });
  const latestFile = path.join(resultsDirectory, 'latest.json');
  const storedLatest = asRecord(await readJson(latestFile));
  const latestTests = asRecord(storedLatest?.tests) ?? {};
  const selectedTestIds = selected.map(({ id }) => id);
  const latest = {
    ...(storedLatest ?? {}),
    generatedAt: timestamp,
    lastCommand: command,
    lastSelector: selector,
    lastSelectedTestIds: selectedTestIds,
    lastCommandStatus: execution.name,
    lastCommandDurationMs: execution.durationMs,
    tests: latestTests,
    ...(gateStatus
      ? {
          gateStatus,
          gateGeneratedAt: timestamp,
          gateDurationMs: execution.durationMs,
          requiredGateDefinitionFingerprint: requiredGateDefinitionFingerprint(testCatalog.tests),
        }
      : {}),
  };
  pruneRetiredTestResults(latestTests);
  for (const result of execution.results) {
    latestTests[result.id] = recordedTestResult(result, timestamp);
  }
  await writeFile(latestFile, `${JSON.stringify(latest, null, 2)}\n`);

  const historyFile = path.join(resultsDirectory, 'history.json');
  const storedHistory = await readJson(historyFile);
  const history = Array.isArray(storedHistory) ? storedHistory : [];
  history.push({
    timestamp,
    command,
    selector,
    selectedTestIds,
    status: execution.name,
    durationMs: execution.durationMs,
    budgetWarnings,
    results: execution.results.map((result) => recordedTestResult(result, timestamp)),
    ...(gateStatus
      ? {
          gateStatus,
          gateGeneratedAt: timestamp,
          gateDurationMs: execution.durationMs,
          requiredGateDefinitionFingerprint: requiredGateDefinitionFingerprint(testCatalog.tests),
        }
      : {}),
  });
  await writeFile(historyFile, `${JSON.stringify(history.slice(-20), null, 2)}\n`);

  console.log('');
  for (const line of commandReportLines(
    testCatalog.tests,
    execution.results,
    commandReportUsesColor(),
  )) {
    console.log(line);
  }
  console.log(`Total time: ${formatWallClock(execution.durationMs)}`);
  for (const line of passedAfterRetryLines(execution.results)) console.log(line);
  if (budgetWarnings.length) {
    console.warn(`Duration budget warnings: ${JSON.stringify(budgetWarnings)}.`);
  }
}

async function runGate(options: RunOptions): Promise<number> {
  const coreRequired = requiredTests('critical-core');
  const featureRequired = requiredTests('feature-behavior');
  // An empty Critical Core phase stays allowed when required Feature Behavior tests exist.
  // Zero required tests across both phases is inconclusive and is never stored as Passed.
  if (coreRequired.length === 0 && featureRequired.length === 0) {
    console.error('Release gate inconclusive: no required tests are configured.');
    await recordRun(
      'gate',
      null,
      [],
      { name: 'inconclusive', exitCode: 2, durationMs: 0, results: [] },
      'inconclusive',
    );
    return 2;
  }

  const executed: Array<{ selected: CatalogTest[]; execution: Execution }> = [];
  const gate = await runReleaseGate(async (phase) => {
    const selected =
      phase === 'core' ? requiredTests('critical-core') : requiredTests('feature-behavior');
    console.log(
      phase === 'core'
        ? 'Release gate phase 1/2: Critical Core.'
        : 'Release gate phase 2/2: required Feature Behavior tests.',
    );
    const execution = await execute(selected, `gate-${phase}-${Date.now()}`, options);
    executed.push({ selected, execution });
    return { status: execution.name, durationMs: execution.durationMs };
  });

  if (gate.diagnosticCommand) {
    console.error(`Release gate ${gate.status}. Diagnose with: ${gate.diagnosticCommand}`);
  }

  const exitCode = gate.status === 'passed' ? 0 : gate.status === 'inconclusive' ? 2 : 1;
  await recordRun(
    'gate',
    null,
    executed.flatMap((entry) => entry.selected),
    {
      name: gate.status,
      exitCode,
      durationMs: gate.phases.reduce((total, phase) => total + phase.result.durationMs, 0),
      results: executed.flatMap((entry) => entry.execution.results),
    },
    gate.status,
  );
  return exitCode;
}

const supportedFlags = new Set(['--headed', '--record']);

function commandLine(argv: string[]) {
  const flags = argv.filter((argument) => argument.startsWith('--'));
  const unknown = flags.filter((flag) => !supportedFlags.has(flag));
  if (unknown.length) {
    throw new Error(`Unknown option ${unknown.join(' ')}. Supported options: --headed, --record.`);
  }
  const positional = argv.filter((argument) => !argument.startsWith('--'));
  return {
    positional,
    options: { headed: flags.includes('--headed'), record: flags.includes('--record') },
  };
}

await mkdir(resultsDirectory, { recursive: true });
await mkdir(cacheDirectory, { recursive: true });
console.log(`Test cache: ${cacheDirectory}.`);

try {
  const foundationErrors = await validateTestingFoundations(root, testCatalog);
  if (foundationErrors.length) throw new Error(foundationErrors.join('\n'));

  const { positional, options } = commandLine(process.argv.slice(2));
  const [mode, selector] = positional;
  if (mode === 'ui') {
    if (options.headed || options.record) {
      console.log('UI mode records a trace of every run and has its own browser controls; --headed and --record are ignored.');
    }
    process.exitCode = await openUiMode(positional[1], positional[2]);
  } else if (mode === 'gate') {
    process.exitCode = await runGate(options);
  } else {
    const selected = selectTests(mode, selector);
    if (mode === 'fast-only') {
      const excluded = testCatalog.tests.filter(
        (test) => isExecutable(test) && test.environment === 'non-browser' && !test.fast,
      );
      console.log(
        `Fast-only rule: declarative fast=true for non-browser tests. Excluded: ${
          excluded.map(({ id }) => id).join(', ') || 'none'
        }.`,
      );
    }
    const execution = await execute(selected, `${mode}-${Date.now()}`, options);
    let lintExitCode = 0;
    if (mode === 'all') {
      lintExitCode = (await runProcess('npm', ['run', 'lint'])).exitCode;
      const requiredReleaseTests = [
        ...requiredTests('critical-core'),
        ...requiredTests('feature-behavior'),
      ];
      const releaseEligibility =
        requiredReleaseTests.length === 0
          ? 'inconclusive; not verified'
          : requiredReleaseTests.every((test) =>
                execution.results.some(
                  (result) => result.id === test.id && result.state === 'passed',
                ),
              )
            ? 'passed'
            : 'not passed';
      console.log(
        `Release eligibility: ${releaseEligibility}. Diagnostic health: ${
          execution.exitCode === 0 && lintExitCode === 0 ? 'passed' : 'unsuccessful'
        }.`,
      );
    }
    await recordRun(mode, selector ?? null, selected, execution);
    process.exitCode = lintExitCode ? 1 : execution.exitCode;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
