import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Writes /version.json into the built site so a live check can confirm which commit a deployed site runs.
 * CI provides GITHUB_SHA (Gitea Actions sets it too); a local build falls back to the checkout's HEAD.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const builtSiteRoot = path.resolve(__dirname, '../../dist/eco-plan/browser');

function readCommit() {
  const fromCi = process.env.GITHUB_SHA?.trim();
  if (fromCi) return fromCi;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

const buildInfo = { commit: readCommit(), builtAt: new Date().toISOString() };
await writeFile(path.join(builtSiteRoot, 'version.json'), `${JSON.stringify(buildInfo, null, 2)}\n`, 'utf-8');
console.log(`[write-build-info] version.json commit ${buildInfo.commit}`);
