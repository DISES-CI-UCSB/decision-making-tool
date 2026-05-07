import { promises as fs } from 'node:fs';
import path from 'node:path';

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const separatorIndex = trimmed.indexOf('=');
  if (separatorIndex <= 0) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  if (!key) {
    return null;
  }

  let value = trimmed.slice(separatorIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

async function readEnvFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return raw
      .split(/\r?\n/g)
      .map((line) => parseLine(line))
      .filter((entry) => Boolean(entry));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Loads standard local env files without overriding already-defined process env values.
 */
export async function loadLocalEnv(frontendRoot) {
  const repoRoot = path.resolve(frontendRoot, '..');
  const candidateFiles = [
    path.resolve(repoRoot, '.env.local'),
    path.resolve(repoRoot, '.env.production.local'),
    path.resolve(frontendRoot, '.env.local'),
    path.resolve(frontendRoot, '.env.production.local'),
  ];

  for (const filePath of candidateFiles) {
    const entries = await readEnvFile(filePath);
    for (const { key, value } of entries) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}
