import { existsSync } from 'node:fs';
import husky from 'husky';

// Husky only installs from the folder that holds `.git`. A standalone frontend checkout
// holds it here; the workspace that holds frontend/ and backend/ holds it one level up.
if (existsSync('.git')) {
  report(husky('.husky'));
} else if (existsSync('../.git')) {
  process.chdir('..');
  report(husky('frontend/.husky'));
} else {
  console.log('[install-git-hooks] no .git found; skipping hook install');
}

function report(message) {
  if (message) {
    console.log(`[install-git-hooks] ${message}`);
  }
}
