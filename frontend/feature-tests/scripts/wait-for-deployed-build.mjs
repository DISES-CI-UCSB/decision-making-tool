import { execFileSync } from 'node:child_process';

/**
 * Waits until a deployed site's /version.json reports the expected commit, so live tests never run against an
 * older deploy. The expected commit defaults to the newest commit on GTIC's Gitea frontend `test` branch, which the
 * test site's CI/CD builds; the subtree push gives it a different hash than the monorepo commit.
 *
 * Settings: DMT_TEST_APP_URL (site), DMT_EXPECTED_COMMIT (skip the Gitea lookup), DMT_DEPLOY_WAIT_MINUTES (default 15).
 */
const appUrl = (process.env.DMT_TEST_APP_URL ?? 'https://test-priorizandolanaturaleza.parquesnacionales.gov.co').replace(
  /\/$/,
  '',
);
const waitMs = Number(process.env.DMT_DEPLOY_WAIT_MINUTES ?? 15) * 60_000;
const pollMs = 15_000;

function expectedCommit() {
  const fromEnv = process.env.DMT_EXPECTED_COMMIT?.trim();
  if (fromEnv) return fromEnv;
  const output = execFileSync('git', ['ls-remote', 'gitea-frontend', 'refs/heads/test'], { encoding: 'utf-8' });
  const commit = output.split(/\s+/)[0];
  if (!commit) throw new Error('gitea-frontend has no test branch; set DMT_EXPECTED_COMMIT.');
  return commit;
}

async function deployedCommit() {
  try {
    const response = await fetch(`${appUrl}/version.json`, { cache: 'no-store' });
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return null;
    const body = await response.json();
    return typeof body?.commit === 'string' ? body.commit : null;
  } catch {
    return null;
  }
}

const expected = expectedCommit();
const deadline = Date.now() + waitMs;
console.log(`Waiting for ${appUrl} to serve commit ${expected.slice(0, 10)}.`);
for (;;) {
  const deployed = await deployedCommit();
  if (deployed === expected) {
    console.log(`Deployed: ${appUrl} serves commit ${expected.slice(0, 10)}.`);
    break;
  }
  if (Date.now() >= deadline) {
    console.error(
      `Deploy didn't land: ${appUrl} serves ${deployed?.slice(0, 10) ?? 'no version.json'}, expected ${expected.slice(0, 10)}.`,
    );
    process.exit(1);
  }
  console.log(`  still ${deployed?.slice(0, 10) ?? 'no version.json'}; checking again in ${pollMs / 1000} s.`);
  await new Promise((resolve) => setTimeout(resolve, pollMs));
}
