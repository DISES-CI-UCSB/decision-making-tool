import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourcePath = path.resolve(__dirname, '../../../data/boundaries/sirap_regions.geojson');
const targetPath = path.resolve(__dirname, '../../public/data/sirap-regions.geojson');

async function hashFile(filePath) {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

async function main() {
  let sourceHash;
  let targetHash;

  try {
    [sourceHash, targetHash] = await Promise.all([hashFile(sourcePath), hashFile(targetPath)]);
  } catch (error) {
    console.error(`[check:boundaries] Cannot verify the local boundary preview: ${error.message}`);
    console.error('[check:boundaries] Run `npm run sync:boundaries` to create or refresh it.');
    process.exit(1);
  }

  if (sourceHash !== targetHash) {
    console.error('[check:boundaries] The local boundary preview is out of date.');
    console.error('[check:boundaries] Run `npm run sync:boundaries` and then start the app again.');
    process.exit(1);
  }

  console.log('[check:boundaries] Local boundary preview is current');
}

main().catch((error) => {
  console.error(`[check:boundaries] ${error.message}`);
  process.exit(1);
});
