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
    console.error('[check:dependencies] Run `yarn install --immutable` in the frontend directory, then retry `yarn start`.');
    console.error(
      '[check:dependencies] `yarn install --immutable` recreates node_modules from yarn.lock without changing package.json.',
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`[check:dependencies] ${error.message}`);
  process.exit(1);
});
