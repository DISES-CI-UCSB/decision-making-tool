import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceDir = path.resolve(__dirname, '../../../data/solutions/nacional');
const targetDir = path.resolve(__dirname, '../../public/data/solutions');
const allowedExtensions = new Set(['.tif', '.csv', '.json']);

const formatMb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

async function ensureDirectory(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

async function removeStaleFiles(dir, allowedFiles) {
  const existing = await listFiles(dir);
  const stale = existing.filter((file) => !allowedFiles.has(file));
  await Promise.all(stale.map((file) => fs.rm(path.join(dir, file), { force: true })));
  return stale.length;
}

async function main() {
  await ensureDirectory(sourceDir);
  await ensureDirectory(targetDir);

  const sourceFiles = (await listFiles(sourceDir)).filter((file) =>
    allowedExtensions.has(path.extname(file).toLowerCase()),
  );
  if (sourceFiles.length === 0) {
    throw new Error(`No .tif/.csv/.json files found in ${sourceDir}`);
  }

  const sourceSet = new Set(sourceFiles);
  const removedCount = await removeStaleFiles(targetDir, sourceSet);

  let totalBytes = 0;
  for (const file of sourceFiles) {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(targetDir, file);
    const stats = await fs.stat(sourcePath);
    totalBytes += stats.size;
    await fs.copyFile(sourcePath, targetPath);
  }

  console.log(`Synced ${sourceFiles.length} files to ${targetDir}`);
  console.log(`Removed ${removedCount} stale files`);
  console.log(`Total synced size: ${formatMb(totalBytes)}`);
}

main().catch((error) => {
  console.error(`[sync:solutions] ${error.message}`);
  process.exit(1);
});
