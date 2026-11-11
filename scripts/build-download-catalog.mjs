import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const builder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'backend', 'scripts', 'build_download_catalog.py');
const pythonCommands = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];

for (const command of pythonCommands) {
  const result = spawnSync(command, [builder, ...process.argv.slice(2)], { stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') continue;
  process.exit(result.status ?? 1);
}
console.error(`No Python interpreter found (tried ${pythonCommands.join(', ')}).`);
process.exit(1);
