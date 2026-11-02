import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Serves the local Angular app for Playwright browser tests on 127.0.0.1:TNC_TEST_PORT.
 * It runs `ng serve` with frontend/proxy.conf.json, like `yarn start`, but skips the data-sync steps
 * that `yarn start` runs first. Set TNC_WEB_SERVER_COMMAND to use a different page server.
 */
const frontendDirectory = fileURLToPath(new URL('../frontend/', import.meta.url));
const angularCli = fileURLToPath(new URL('../frontend/node_modules/@angular/cli/bin/ng.js', import.meta.url));
const port = process.env.TNC_TEST_PORT ?? '4177';

if (!existsSync(angularCli)) {
  console.error(
    [
      'Browser tests need the local Angular app, but frontend dependencies are not installed',
      '(frontend/node_modules/@angular/cli is missing).',
      'Install them from the frontend folder with: node .yarn/releases/yarn-4.18.0.cjs install --immutable',
      `Or set TNC_WEB_SERVER_COMMAND to a command that serves the app on 127.0.0.1:${port}.`,
    ].join('\n'),
  );
  process.exit(1);
}

const server = spawn(
  process.execPath,
  [angularCli, 'serve', '--host', '127.0.0.1', '--port', port, '--proxy-config', 'proxy.conf.json'],
  {
    cwd: frontendDirectory,
    stdio: 'inherit',
    env: { ...process.env, NG_CLI_ANALYTICS: 'false' },
  },
);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}
server.on('exit', (code) => process.exit(code ?? 1));
