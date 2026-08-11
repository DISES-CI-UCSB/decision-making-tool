import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH } from '../shared/runtime-manifest.constants.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const environmentPath = path.join(frontendRoot, 'src/environments/environment.ts');
const manifestPath = path.join(frontendRoot, LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH);
const localManifestPublicPath = `/${LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH.replace(/^public\//, '')}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function usesLocalPreviewManifest(environmentSource) {
  const escapedPath = localManifestPublicPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`manifestBlobUrl:\\s*['"]${escapedPath}['"]`).test(environmentSource);
}

export function validateLocalPreviewManifest(manifest) {
  const solutions = manifest?.solutions;
  assert(Array.isArray(solutions), 'local preview manifest must contain a solutions array');

  const landCount = solutions.filter(
    (solution) => (solution.domain ?? solution.finderInputs?.domain ?? 'land') === 'land',
  ).length;
  const marineCount = solutions.length - landCount;

  assert(
    manifest.catalogVersion === '0.2.0',
    `local preview manifest must use catalogVersion 0.2.0; got ${manifest.catalogVersion ?? 'none'}`,
  );
  assert(
    solutions.length === 172 && landCount === 168 && marineCount === 4,
    `local preview manifest must contain 172 solutions (168 land, 4 marine); got ${solutions.length} (${landCount} land, ${marineCount} marine)`,
  );
  assert(
    !/https?:\/\/localhost(?::\d+)?\//.test(JSON.stringify(manifest)),
    'local preview manifest must not contain hard-coded localhost URLs',
  );

  for (const solution of solutions.filter(
    (entry) => (entry.domain ?? entry.finderInputs?.domain ?? 'land') === 'land',
  )) {
    const urls = solution.precomputedMetricUrls;
    assert(
      urls?.speciesGoalsCatalog?.startsWith('/releases/'),
      `${solution.id} species goals catalog must use an origin-relative release URL`,
    );
    assert(
      urls?.speciesGoalsTargetOverlay?.startsWith('/releases/'),
      `${solution.id} species target overlay must use an origin-relative release URL`,
    );
    assert(
      Object.values(urls?.speciesGoalsByGeography ?? {}).length === 6 &&
        Object.values(urls.speciesGoalsByGeography).every((url) => url.startsWith('/releases/')),
      `${solution.id} species geography shards must use six origin-relative release URLs`,
    );
  }

  return { total: solutions.length, land: landCount, marine: marineCount };
}

async function main() {
  const environmentSource = await fs.readFile(environmentPath, 'utf8');
  if (!usesLocalPreviewManifest(environmentSource)) {
    console.log('[validate:local-preview-manifest] skipped; development uses a remote manifest');
    return;
  }

  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const counts = validateLocalPreviewManifest(manifest);
  console.log(
    `[validate:local-preview-manifest] passed (${counts.total} solutions: ${counts.land} land, ${counts.marine} marine)`,
  );
}

const isCalledDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCalledDirectly) {
  main().catch((error) => {
    console.error(`[validate:local-preview-manifest] ${error.message}`);
    process.exit(1);
  });
}
