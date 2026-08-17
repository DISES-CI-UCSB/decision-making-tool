import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWithNumberLiterals, validateArtifactDocument } from './artifact-documents.mjs';
import { solutionCatalogSha256 } from './solution-catalog.mjs';

export const ARTIFACT_VERIFICATION_FORMAT = 'metric-artifact-verification-v1';
const SUPPLEMENTAL_PUBLISH_REPORT_FORMAT = 'solution-release-supplemental-publish-report-v1';
const SUPPLEMENTAL_ARTIFACT_FORMATS = new Set([
  'species-goals-catalog-v1',
  'species-goals-catalog-completion-v1',
  'species-goals-compact-v1',
  'species-goals-completion-v1',
  'species-target-overlays-v1',
  'strategic-ecosystem-outcomes-v1',
]);
const SHARED_ARTIFACT_ROLES = new Set([
  'speciesGoalsCatalog',
  'speciesGoalsTargetOverlay',
  'strategicOutcomes',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

export async function readArtifactVerifications(paths, catalog) {
  assert(paths.length > 0, 'release promotion requires at least one --artifact-inventory <path>');
  return Promise.all(
    paths.map(async (inventoryPath) => {
      const document = JSON.parse(await fs.readFile(inventoryPath, 'utf-8'));
      validateArtifactVerification(document, inventoryPath);
      const publishSummary = await readPublishSummary(document.sourceReport, inventoryPath);
      validatePublishSummary(publishSummary, catalog, document.sourceReport);
      validateVerificationAgainstSummary(document, publishSummary, inventoryPath);
      await validatePublishSummaryArtifacts(document, publishSummary, inventoryPath, catalog);
      return document;
    }),
  );
}

export async function validatePublishSummaryArtifacts(verification, summary, label, catalog) {
  const verificationByUrl = new Map(verification.entries.map((entry) => [entry.url, entry]));
  const catalogById = new Map(
    (catalog?.solutions ?? []).map((solution) => [solution.solutionId, solution]),
  );
  const catalogSha256 = catalog ? solutionCatalogSha256(catalog) : undefined;
  await Promise.all(
    summary.entries.map(async (entry, index) => {
      const entryLabel = `${label} source artifact ${index}`;
      const localPath = entry.cachePath;
      assert(
        typeof localPath === 'string' && localPath.length > 0,
        `${entryLabel} must declare cachePath`,
      );
      const verificationEntry = verificationByUrl.get(entry.expectedPublicUrl);
      const artifactBytes = await readRepoFile(localPath);
      assert(
        verificationEntry?.local.bytes === artifactBytes.byteLength &&
          verificationEntry?.local.sha256 ===
            createHash('sha256').update(artifactBytes).digest('hex'),
        `${entryLabel} current local bytes must match the verified inventory checksum`,
      );
      const artifactText = artifactBytes.toString('utf-8');
      const document = JSON.parse(artifactText);
      const documentFormat = document.format ?? 'metrics-verbose-v1';
      assert(
        verificationEntry?.format === documentFormat,
        `${entryLabel} verification format must match the artifact document`,
      );
      assert(
        entry.artifactSha256 === undefined ||
          entry.artifactSha256 === verificationEntry.local.sha256,
        `${entryLabel} publish summary checksum must match the verified artifact`,
      );
      if (SUPPLEMENTAL_ARTIFACT_FORMATS.has(documentFormat)) {
        const artifactReleaseId = document.releaseId ?? document.provenance?.releaseId;
        assert(
          artifactReleaseId === catalog?.releaseId,
          `${entryLabel} supplemental artifact must match the release identity`,
        );
        return;
      }
      if (documentFormat === 'metrics-verbose-v1' || documentFormat === 'metrics-compact-v1') {
        assert(
          typeof entry.catalogSignature === 'string' && entry.catalogSignature.length > 0,
          `${entryLabel} publish summary must declare catalogSignature`,
        );
      }
      const catalogSolution = catalogById.get(entry.solutionId);
      validateArtifactDocument(
        document,
        {
          solutionId: entry.solutionId,
          geographyLevel: entry.geographyLevel,
          solutionDomain: entry.solutionDomain ?? catalogSolution?.domain,
          solutionBasename: entry.solutionBasename ?? catalogSolution?.solutionBasename,
          rasterSha256: entry.rasterCacheSha256 ?? catalogSolution?.rasterSha256,
          catalogSignature: entry.catalogSignature,
          releaseId: catalog?.releaseId,
          catalogVersion: catalog?.catalogVersion,
          catalogSha256,
          catalogSpeciesException: catalog?.speciesException,
          speciesTargetPolicyEvidence: entry.speciesTargetPolicyEvidence,
        },
        entryLabel,
        {
          numberLiteralDocument:
            documentFormat === 'metrics-compact-v1'
              ? parseWithNumberLiterals(artifactText)
              : undefined,
        },
      );
    }),
  );
}

export function validateVerificationAgainstSummary(verification, summary, label) {
  const verifiedUrls = verification.entries.map((entry) => entry.url).sort();
  const summaryUrls = summary.entries.map((entry) => entry.expectedPublicUrl).sort();
  assert(
    summaryUrls.every((url) => typeof url === 'string' && url.length > 0),
    `${label} source publish summary entries must declare expectedPublicUrl`,
  );
  assert(
    JSON.stringify(verifiedUrls) === JSON.stringify(summaryUrls),
    `${label} verification entries must exactly match source publish summary URLs`,
  );
}

export function validatePublishSummary(summary, catalog, label) {
  const expectedCatalogSha = solutionCatalogSha256(catalog);
  assert(
    Array.isArray(summary?.entries) && summary.entries.length > 0,
    `${label} must contain entries`,
  );
  assert(
    !Array.isArray(summary.failures) || summary.failures.length === 0,
    `${label} must not contain failures`,
  );
  if (summary.format === SUPPLEMENTAL_PUBLISH_REPORT_FORMAT) {
    assert(
      summary.complete === true &&
        summary.releaseId === catalog.releaseId &&
        summary.catalogVersion === catalog.catalogVersion &&
        summary.artifactCount === summary.entries.length,
      `${label} supplemental report must match the complete release identity`,
    );
    return;
  }
  assert(
    summary.solutionCatalog?.releaseId === catalog.releaseId &&
      summary.solutionCatalog?.catalogVersion === catalog.catalogVersion &&
      summary.solutionCatalog?.sha256 === expectedCatalogSha,
    `${label} solutionCatalog must match the release catalog identity`,
  );
}

export function validateManifestArtifactCompleteness(manifest, verifications) {
  const expectedUrls = new Map();
  for (const solution of manifest.solutions) {
    for (const [role, url] of requiredArtifactUrls(solution)) {
      if (expectedUrls.has(url)) {
        assert(
          SHARED_ARTIFACT_ROLES.has(role) && expectedUrls.get(url)?.endsWith(`:${role}`),
          `manifest advertises duplicate artifact URL: ${url}`,
        );
        continue;
      }
      expectedUrls.set(url, `${solution.id}:${role}`);
    }
  }

  const verifiedUrls = new Map();
  for (const verification of verifications) {
    validateArtifactVerification(verification, 'artifact inventory');
    for (const entry of verification.entries) {
      assert(
        !verifiedUrls.has(entry.url),
        `artifact inventories contain duplicate URL: ${entry.url}`,
      );
      verifiedUrls.set(entry.url, entry);
    }
  }

  const missing = [...expectedUrls.keys()].filter((url) => !verifiedUrls.has(url));
  const unexpected = [...verifiedUrls.keys()].filter(
    (url) => !expectedUrls.has(url) && !isExpectedCompletionSidecar(url, expectedUrls),
  );
  assert(
    missing.length === 0 && unexpected.length === 0,
    `verified artifact inventory differs from manifest (missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'})`,
  );
}

export function validateArtifactVerification(verification, label) {
  assert(
    verification?.format === ARTIFACT_VERIFICATION_FORMAT,
    `${label} must use format "${ARTIFACT_VERIFICATION_FORMAT}"`,
  );
  assert(verification.ok === true, `${label} must have ok=true`);
  assert(
    Array.isArray(verification.entries) && verification.entries.length > 0,
    `${label} must contain entries`,
  );
  for (const [index, entry] of verification.entries.entries()) {
    const entryLabel = `${label}.entries[${index}]`;
    assert(entry?.ok === true, `${entryLabel} must have ok=true`);
    assert(typeof entry.url === 'string' && entry.url.length > 0, `${entryLabel}.url is required`);
    assert(
      [
        'metrics-verbose-v1',
        'metrics-compact-v1',
        'conservation-goals-v1',
        'mec-compact-v2',
        ...SUPPLEMENTAL_ARTIFACT_FORMATS,
      ].includes(entry.format),
      `${entryLabel}.format must identify a supported release document`,
    );
    for (const side of ['local', 'remote']) {
      assert(
        Number.isSafeInteger(entry[side]?.bytes) && entry[side].bytes > 0,
        `${entryLabel}.${side}.bytes must be a positive integer`,
      );
      assert(
        typeof entry[side]?.sha256 === 'string' && /^[0-9a-f]{64}$/.test(entry[side].sha256),
        `${entryLabel}.${side}.sha256 must be a lowercase SHA-256 digest`,
      );
    }
    assert(
      entry.local.bytes === entry.remote.bytes && entry.local.sha256 === entry.remote.sha256,
      `${entryLabel} local and remote checksums must match`,
    );
  }
}

async function readPublishSummary(sourceReport, inventoryPath) {
  assert(
    typeof sourceReport === 'string' && sourceReport.length > 0,
    `${inventoryPath}.sourceReport is required`,
  );
  const candidates = path.isAbsolute(sourceReport)
    ? [sourceReport]
    : [path.resolve(process.cwd(), sourceReport), path.resolve(repoRoot, sourceReport)];
  for (const candidate of candidates) {
    try {
      return JSON.parse(await fs.readFile(candidate, 'utf-8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`could not read source publish summary: ${sourceReport}`);
}

async function readRepoFile(filePath) {
  const candidates = path.isAbsolute(filePath)
    ? [filePath]
    : [path.resolve(process.cwd(), filePath), path.resolve(repoRoot, filePath)];
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`could not read local artifact: ${filePath}`);
}

function requiredArtifactUrls(solution) {
  const urls = solution.precomputedMetricUrls ?? {};
  const required = [
    ['goals', urls.goals],
    ['regularVerbose', urls.cache],
    ['regularCompact', urls.compactCache],
  ];
  if (solution.domain === 'land') {
    for (const [level, url] of Object.entries(urls.mecV2ByGeography ?? {})) {
      required.push([`mecV2:${level}`, url]);
    }
    if (urls.speciesGoalsCatalog) {
      required.push(['speciesGoalsCatalog', urls.speciesGoalsCatalog]);
    }
    if (urls.speciesGoalsTargetOverlay) {
      required.push(['speciesGoalsTargetOverlay', urls.speciesGoalsTargetOverlay]);
    }
    if (urls.strategicOutcomes) {
      required.push(['strategicOutcomes', urls.strategicOutcomes]);
    }
    for (const [level, url] of Object.entries(urls.speciesGoalsByGeography ?? {})) {
      required.push([`speciesGoals:${level}`, url]);
    }
  }
  return required;
}

function isExpectedCompletionSidecar(url, expectedUrls) {
  if (!url.endsWith('.complete.json')) return false;
  const payloadUrl = url.slice(0, -'.complete.json'.length);
  const expectedRole = expectedUrls.get(payloadUrl);
  return (
    expectedRole?.endsWith(':speciesGoalsCatalog') || expectedRole?.includes(':speciesGoals:')
  );
}
