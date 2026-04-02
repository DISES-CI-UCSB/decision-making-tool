import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const manifestPath = path.resolve(__dirname, '../manifest.json');
const sourceDir = path.resolve(__dirname, '../solutions');
const publicDir = path.resolve(__dirname, '../../../../eco-plan/public/data/solutions');

const toMb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getStatsOrThrow(filePath) {
  if (!(await exists(filePath))) {
    throw new Error(`Missing required file: ${filePath}`);
  }
  return fs.stat(filePath);
}

async function validateLocation(label, baseDir, requiredFiles, allowedExtensions) {
  const names = await fs.readdir(baseDir);
  const disallowed = names.filter((name) => !allowedExtensions.has(path.extname(name).toLowerCase()));
  if (disallowed.length > 0) {
    throw new Error(`${label} contains disallowed files: ${disallowed.join(', ')}`);
  }

  let totalBytes = 0;
  let maxFileBytes = 0;
  for (const file of requiredFiles) {
    const stats = await getStatsOrThrow(path.join(baseDir, file));
    if (!stats.isFile()) {
      throw new Error(`Expected file but found non-file: ${path.join(baseDir, file)}`);
    }
    totalBytes += stats.size;
    maxFileBytes = Math.max(maxFileBytes, stats.size);
  }

  return { totalBytes, maxFileBytes };
}

async function main() {
  const manifestRaw = await fs.readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(manifestRaw);
  const allowedExtensions = new Set(manifest.allowedExtensions ?? []);
  const requiredFiles = manifest.requiredFiles ?? [];
  const maxSingleFileBytes = manifest.limits?.maxSingleFileBytes ?? 50_000_000;
  const maxTotalBytes = manifest.limits?.maxTotalBytes ?? 80_000_000;

  if (requiredFiles.length === 0) {
    throw new Error('Manifest has no requiredFiles entries');
  }

  const sourceStats = await validateLocation('data/deploy source', sourceDir, requiredFiles, allowedExtensions);
  const publicStats = await validateLocation('eco-plan/public target', publicDir, requiredFiles, allowedExtensions);

  if (sourceStats.maxFileBytes > maxSingleFileBytes) {
    throw new Error(
      `Source contains file over maxSingleFileBytes (${toMb(maxSingleFileBytes)}): found ${toMb(sourceStats.maxFileBytes)}`,
    );
  }
  if (publicStats.maxFileBytes > maxSingleFileBytes) {
    throw new Error(
      `Public contains file over maxSingleFileBytes (${toMb(maxSingleFileBytes)}): found ${toMb(publicStats.maxFileBytes)}`,
    );
  }
  if (sourceStats.totalBytes > maxTotalBytes) {
    throw new Error(
      `Source total exceeds maxTotalBytes (${toMb(maxTotalBytes)}): found ${toMb(sourceStats.totalBytes)}`,
    );
  }
  if (publicStats.totalBytes > maxTotalBytes) {
    throw new Error(
      `Public total exceeds maxTotalBytes (${toMb(maxTotalBytes)}): found ${toMb(publicStats.totalBytes)}`,
    );
  }

  console.log('Deploy assets validation passed');
  console.log(`Required files: ${requiredFiles.length}`);
  console.log(`Source total: ${toMb(sourceStats.totalBytes)}, largest file: ${toMb(sourceStats.maxFileBytes)}`);
  console.log(`Public total: ${toMb(publicStats.totalBytes)}, largest file: ${toMb(publicStats.maxFileBytes)}`);
}

main().catch((error) => {
  console.error(`[validate:deploy-assets] ${error.message}`);
  process.exit(1);
});
