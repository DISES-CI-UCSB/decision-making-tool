import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_RUNTIME_MANIFEST_RELATIVE_PATH } from '../shared/runtime-manifest.constants.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const publicRoot = path.join(frontendRoot, 'public');
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
    /^0\.2\.\d+$/.test(manifest.catalogVersion ?? ''),
    `local preview manifest must use catalog version 0.2.x; got ${manifest.catalogVersion ?? 'none'}`,
  );
  assert(
    solutions.length === 172 && landCount === 168 && marineCount === 4,
    `local preview manifest must contain 172 solutions (168 land, 4 marine); got ${solutions.length} (${landCount} land, ${marineCount} marine)`,
  );
  assert(
    !/https?:\/\/localhost(?::\d+)?\//.test(JSON.stringify(manifest)),
    'local preview manifest must not contain hard-coded localhost URLs',
  );

  const capabilityPreviewSolutions = solutions.filter(
    (solution) => solution.capabilities?.aoiCoverageMetrics === 'v2',
  );
  assert(
    capabilityPreviewSolutions.length <= 1,
    'local preview manifest may enable AOI coverage v2 for only one solution',
  );
  const locallyBackedSolutions =
    capabilityPreviewSolutions.length === 1
      ? capabilityPreviewSolutions
      : solutions.filter(
          (entry) => (entry.domain ?? entry.finderInputs?.domain ?? 'land') === 'land',
        );

  for (const solution of locallyBackedSolutions) {
    const urls = solution.precomputedMetricUrls;
    assert(
      urls?.speciesGoalsCatalog?.startsWith('/releases/'),
      `${solution.id} species goals catalog must use an origin-relative release URL`,
    );
    if (urls?.speciesGoalsTargetOverlay) {
      assert(
        urls.speciesGoalsTargetOverlay.startsWith('/releases/'),
        `${solution.id} species target overlay must use an origin-relative release URL`,
      );
    }
    assert(
      Object.values(urls?.speciesGoalsByGeography ?? {}).length === 6 &&
        Object.values(urls.speciesGoalsByGeography).every((url) => url.startsWith('/releases/')),
      `${solution.id} species geography shards must use six origin-relative release URLs`,
    );
    const metricUrls = Object.values(urls ?? {}).flatMap((value) =>
      value && typeof value === 'object' ? Object.values(value) : [value],
    );
    assert(
      metricUrls.every((url) => typeof url === 'string' && url.startsWith('/releases/')),
      `${solution.id} preview metrics must use origin-relative release URLs`,
    );
  }

  return { total: solutions.length, land: landCount, marine: marineCount };
}

export async function validateLocalPreviewSpeciesCompletionFiles(
  manifest,
  { root = publicRoot, access = fs.access } = {},
) {
  const capabilityPreviewSolutions = manifest.solutions.filter(
    (solution) => solution.capabilities?.aoiCoverageMetrics === 'v2',
  );
  const locallyBackedSolutions =
    capabilityPreviewSolutions.length === 1
      ? capabilityPreviewSolutions
      : manifest.solutions.filter(
          (solution) => (solution.domain ?? solution.finderInputs?.domain ?? 'land') === 'land',
        );
  const artifactUrls = new Set(
    locallyBackedSolutions.flatMap((solution) => {
      const urls = solution.precomputedMetricUrls;
      return [urls.speciesGoalsCatalog, ...Object.values(urls.speciesGoalsByGeography)];
    }),
  );

  for (const artifactUrl of artifactUrls) {
    const completionPath = path.resolve(root, `${artifactUrl.slice(1)}.complete.json`);
    assert(
      completionPath.startsWith(`${path.resolve(root)}${path.sep}`),
      `local species completion path escapes public root: ${artifactUrl}`,
    );
    try {
      await access(completionPath);
    } catch {
      throw new Error(`local species artifact is missing completion sidecar: ${artifactUrl}`);
    }
  }
}

async function main() {
  const environmentSource = await fs.readFile(environmentPath, 'utf8');
  if (!usesLocalPreviewManifest(environmentSource)) {
    console.log('[validate:local-preview-manifest] skipped; development uses a remote manifest');
    return;
  }

  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const counts = validateLocalPreviewManifest(manifest);
  await validateLocalPreviewSpeciesCompletionFiles(manifest);
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
