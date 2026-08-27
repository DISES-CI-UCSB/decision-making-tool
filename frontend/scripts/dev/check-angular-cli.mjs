import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const angularCliPath = path.resolve(__dirname, '../../node_modules/.bin/ng');

async function main() {
  try {
    await access(angularCliPath);
  } catch {
    console.error('[check:dependencies] Angular CLI is unavailable because project dependencies are missing.');
    console.error('[check:dependencies] Run `npm ci` in the frontend directory, then retry `npm start`.');
    console.error(
      '[check:dependencies] `npm ci` recreates node_modules from package-lock.json without changing package.json.',
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`[check:dependencies] ${error.message}`);
  process.exit(1);
});
