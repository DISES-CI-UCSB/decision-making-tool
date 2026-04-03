import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourcePath = path.resolve(__dirname, '../../boundaries/sirap_regions.geojson');
const targetDir = path.resolve(__dirname, '../../../frontend/public/data');
const targetPath = path.join(targetDir, 'sirap-regions.geojson');

async function main() {
  await fs.mkdir(targetDir, { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  console.log(`Synced boundary file to ${targetPath}`);
}

main().catch((error) => {
  console.error(`[sync:boundaries] ${error.message}`);
  process.exit(1);
});
