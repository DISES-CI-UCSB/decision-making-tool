import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serviceConfig } from './service-config.ts';

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend');
const startupTimeoutMs = 60_000;
/** Enough of the server log to explain a failed start. Uvicorn's access log has paths and statuses, never headers. */
const logTailLength = 4_000;

export interface LocalSigningServiceOptions {
  port?: number;
  /** Link lifetime. The backend ignores values under 60 and uses its 900-second default instead. */
  signedUrlTtlSeconds: number;
}

export interface LocalSigningService {
  /** Base URL, such as http://127.0.0.1:8838, to pass to `requestSignedUrl`. */
  url: string;
  stop(): Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function healthStatus(url: string): Promise<number | null> {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2_000) });
    await response.arrayBuffer();
    return response.status;
  } catch {
    return null;
  }
}

/**
 * The three test files as a JSON object map, the smallest catalog shape the backend accepts.
 * Regional keys carry their region, so the local server applies the same access rules as the deployed one.
 */
function testCatalog(): string {
  return JSON.stringify({
    objects: {
      [serviceConfig.objects.national]: { sirap_id: null },
      [serviceConfig.objects.orinoquia]: { sirap_id: 'orinoquia' },
      [serviceConfig.objects.ejeCafetero]: { sirap_id: 'eje-cafetero' },
    },
  });
}

function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const forceTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    child.once('exit', () => {
      clearTimeout(forceTimer);
      resolve();
    });
    child.kill();
  });
}

/**
 * Starts the backend Metrics API from this checkout on 127.0.0.1 with real Firebase and bucket credentials,
 * a small download catalog, and the given link lifetime. Link caching is off, so every request signs a new link.
 * Runtime files go to a temporary folder that `stop()` removes.
 */
export async function startLocalSigningService(options: LocalSigningServiceOptions): Promise<LocalSigningService> {
  const port = options.port ?? serviceConfig.localServicePort;
  const url = `http://127.0.0.1:${port}`;
  for (const [label, file] of [
    ['Backend Python (DMT_TEST_BACKEND_PYTHON)', serviceConfig.backendPython],
    ['Firebase Admin key (DMT_TEST_FIREBASE_ADMIN_KEY_FILE)', serviceConfig.adminKeyFile],
    ['Bucket signing key (DMT_TEST_GCS_SIGNER_KEY_FILE)', serviceConfig.gcsSignerKeyFile],
  ]) {
    if (!existsSync(file)) throw new Error(`${label} was not found at ${file}.`);
  }
  if ((await healthStatus(url)) !== null) {
    throw new Error(`Something already answers on ${url}. Stop it so the test does not use a server with other settings.`);
  }

  const runtimeDirectory = await mkdtemp(path.join(os.tmpdir(), 'dmt-local-signing-'));
  const catalogPath = path.join(runtimeDirectory, 'download-catalog.json');
  await writeFile(catalogPath, testCatalog(), 'utf8');

  const child = spawn(
    serviceConfig.backendPython,
    ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: backendDirectory,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        DMT_ARTIFACT_REQUIRED: 'false',
        DMT_ARTIFACT_DIR: path.join(runtimeDirectory, 'artifacts'),
        DMT_SIRAP_ARTIFACT_ROOT: path.join(runtimeDirectory, 'artifacts', 'sirap'),
        DMT_SOLUTION_CACHE_DIR: path.join(runtimeDirectory, 'solutions'),
        DMT_CUSTOM_POLYGON_JOB_DB: path.join(runtimeDirectory, 'jobs.sqlite3'),
        DMT_FIREBASE_PROJECT_ID: serviceConfig.firebaseWebConfig.projectId,
        DMT_GCS_BUCKET: serviceConfig.bucket,
        DMT_DOWNLOAD_CATALOG_PATH: catalogPath,
        // Inline JSON keys win over files in the backend, so clear any inherited ones.
        FIREBASE_SERVICE_ACCOUNT_JSON: '',
        DMT_GCS_SERVICE_ACCOUNT_JSON: '',
        DMT_FIREBASE_SERVICE_ACCOUNT_FILE: serviceConfig.adminKeyFile,
        DMT_GCS_SERVICE_ACCOUNT_FILE: serviceConfig.gcsSignerKeyFile,
        DMT_GCS_SIGNED_URL_TTL_SECONDS: String(options.signedUrlTtlSeconds),
        DMT_GCS_URL_CACHE_TTL_SECONDS: '0',
      },
    },
  );
  let logTail = '';
  const keepTail = (chunk: Buffer) => {
    logTail = (logTail + chunk.toString('utf8')).slice(-logTailLength);
  };
  child.stdout?.on('data', keepTail);
  child.stderr?.on('data', keepTail);

  // On Windows a virtual environment's python.exe is a launcher that starts the real interpreter as its own
  // child, so the server can keep answering and holding its files briefly after the launcher exits.
  async function stop(): Promise<void> {
    await stopProcess(child);
    const quietDeadline = Date.now() + 10_000;
    while (Date.now() < quietDeadline && (await healthStatus(url)) !== null) await delay(250);
    await rm(runtimeDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(
      () => undefined,
    );
  }

  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      await stop();
      throw new Error(`The local Metrics API exited with code ${child.exitCode} before it was ready.\n${logTail}`);
    }
    if ((await healthStatus(url)) === 200) return { url, stop };
    await delay(250);
  }
  await stop();
  throw new Error(`The local Metrics API was not ready on ${url} within ${startupTimeoutMs / 1000} s.\n${logTail}`);
}

/**
 * Run directly to keep a local server up until Ctrl+C, for example to point other download tests at it:
 * node --experimental-strip-types tests/support/downloads/local-signing-service.ts [link lifetime in seconds]
 * then set DMT_TEST_SERVICE_URL=http://127.0.0.1:8838 for the test command.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void startLocalSigningService({ signedUrlTtlSeconds: Number(process.argv[2] ?? 900) }).then((service) => {
    console.log(`Local Metrics API ready at ${service.url}. Press Ctrl+C to stop.`);
    const shutDown = () => void service.stop().then(() => process.exit(0));
    process.once('SIGINT', shutDown);
    process.once('SIGTERM', shutDown);
  });
}
