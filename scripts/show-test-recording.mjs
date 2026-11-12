import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * Opens the latest Playwright recording of one test in the local trace viewer.
 * Usage: npm run test:show-recording -- FBT-002
 * The viewer runs on this machine; the trace is never uploaded.
 */
const testId = process.argv[2];
if (!testId || !/^(FBT|FST|CCT|SST)-[0-9]+$/.test(testId)) {
  console.error('Usage: npm run test:show-recording -- <catalog test identifier, such as FBT-002>');
  process.exit(1);
}

// Relative, so a repository path with spaces survives the Windows shell.
const trace = path.join('.test-results', 'playwright-recordings', testId, 'trace.zip');
if (!existsSync(trace)) {
  console.error(`No recording for ${testId}. Create one with: npm run test:single -- ${testId} --record`);
  process.exit(1);
}

console.log(`Opening ${trace} in the Playwright trace viewer.`);
const viewer = spawn('npx', ['--no-install', 'playwright', 'show-trace', trace], {
  stdio: 'inherit',
  // Windows resolves npx through npx.cmd, which Node 22 only launches through a shell.
  shell: process.platform === 'win32',
});
viewer.on('exit', (code) => process.exit(code ?? 1));
