import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { initializeApp, getApps } from 'firebase/app';
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { loadLocalEnv } from './load-local-env.mjs';
import {
  applyStyleRequestToManifest,
  findLatestPendingStyleRequest,
} from './manifest-style-request.mjs';
import { RUNTIME_MANIFEST_BLOB_URL } from '../shared/runtime-manifest.constants.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const MANIFEST_BLOB_URL_ENV_VAR = 'MANIFEST_BLOB_URL';
const FIRESTORE_COLLECTION = 'manifestStyleRequests';
const publishWorkDir = path.resolve(__dirname, '../development-artifacts/layer-manifest/publish');

function parseArgs(args) {
  let sourcePath = null;
  let publish = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--source') {
      sourcePath = path.resolve(process.cwd(), args[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (value === '--publish') {
      publish = true;
    }
  }
  return { sourcePath, publish };
}

async function runNodeScript(scriptPath, args) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: path.resolve(__dirname, '..'),
  });
  const output = `${stdout ?? ''}\n${stderr ?? ''}`;
  if (stdout?.trim()) {
    console.log(stdout.trim());
  }
  if (stderr?.trim()) {
    console.error(stderr.trim());
  }
  return output;
}

async function fetchJson(url) {
  const uncachedUrl = `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;
  const response = await fetch(uncachedUrl, { method: 'GET', redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function readJson(filePath) {
  const rawValue = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(rawValue);
}

async function loadLatestPublishedManifest() {
  const configuredBlobUrl =
    process.env[MANIFEST_BLOB_URL_ENV_VAR]?.trim() || RUNTIME_MANIFEST_BLOB_URL;
  return {
    manifest: await fetchJson(configuredBlobUrl),
    url: configuredBlobUrl,
  };
}

async function fetchLatestPendingFirestoreRequest() {
  const app = getApps().length > 0 ? getApps()[0] : initializeApp(getFirebaseConfig());
  const firestore = getFirestore(app);
  const snapshot = await getDocs(
    query(collection(firestore, FIRESTORE_COLLECTION), where('status', '==', 'pending')),
  );
  const requests = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  const request = findLatestPendingStyleRequest(requests);
  if (!request) {
    throw new Error(`No pending Firestore style request found in ${FIRESTORE_COLLECTION}.`);
  }
  return { firestore, request };
}

function getFirebaseConfig() {
  return {
    apiKey: process.env.FIREBASE_API_KEY ?? 'AIzaSyBlZ0fv5aT5ZSB9GVRAfvmV8mi8fxvf45E',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN ?? 'dises-decision-making-tool.firebaseapp.com',
    projectId: process.env.FIREBASE_PROJECT_ID ?? 'dises-decision-making-tool',
    storageBucket:
      process.env.FIREBASE_STORAGE_BUCKET ?? 'dises-decision-making-tool.firebasestorage.app',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID ?? '961351909896',
    appId: process.env.FIREBASE_APP_ID ?? '1:961351909896:web:81b07cc64cfe0ad7e4c7bd',
    measurementId: process.env.FIREBASE_MEASUREMENT_ID ?? 'G-EGXWGXG26X',
  };
}

async function markRequestPublished(firestore, requestId, publishedManifestUrl, manifest) {
  await updateDoc(doc(firestore, FIRESTORE_COLLECTION, requestId), {
    status: 'published',
    appliedAt: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
    publishedManifestUrl: publishedManifestUrl ?? null,
    appliedManifestVersion: manifest.version ?? null,
    appliedManifestGeneratedAt: manifest.generatedAt ?? null,
  });
}

async function buildStyleRequestFromLegacyFullManifest(
  sourcePath,
  latestManifest,
  sourceManifestUrl,
) {
  const styledManifest = await readJson(sourcePath);
  const request = {
    id: `legacy-source:${path.basename(sourcePath)}`,
    status: 'pending',
    editorName: styledManifest.manualEdit?.editorName ?? 'legacy-source',
    sourceManifestUrl,
    baseManifestVersion: styledManifest.version ?? null,
    baseManifestGeneratedAt: styledManifest.generatedAt ?? null,
    diffSummary: null,
    styleChanges: {
      categoryDefaults: [],
      subcategoryDefaults: [],
      layerStyles: [],
    },
  };

  const latestCategoriesById = new Map(
    latestManifest.categories.map((category) => [category.id, category]),
  );
  for (const styledCategory of styledManifest.categories ?? []) {
    const latestCategory = latestCategoriesById.get(styledCategory.id);
    if (!latestCategory) {
      continue;
    }
    if (!jsonEqual(latestCategory.styleDefaults ?? null, styledCategory.styleDefaults ?? null)) {
      request.styleChanges.categoryDefaults.push({
        categoryId: styledCategory.id,
        styleDefaults: styledCategory.styleDefaults ?? {},
      });
    }

    const latestSubcategoriesById = new Map(
      (latestCategory.subcategories ?? []).map((subcategory) => [subcategory.id, subcategory]),
    );
    for (const styledSubcategory of styledCategory.subcategories ?? []) {
      const latestSubcategory = latestSubcategoriesById.get(styledSubcategory.id);
      if (
        latestSubcategory &&
        !jsonEqual(latestSubcategory.styleDefaults ?? null, styledSubcategory.styleDefaults ?? null)
      ) {
        request.styleChanges.subcategoryDefaults.push({
          categoryId: styledCategory.id,
          subcategoryId: styledSubcategory.id,
          styleDefaults: styledSubcategory.styleDefaults ?? {},
        });
      }
    }
  }

  const latestLayersById = new Map(latestManifest.layers.map((layer) => [layer.id, layer]));
  for (const styledLayer of styledManifest.layers ?? []) {
    const latestLayer = latestLayersById.get(styledLayer.id);
    if (!latestLayer) {
      continue;
    }
    if (
      !jsonEqual(latestLayer.rendering ?? null, styledLayer.rendering ?? null) ||
      (latestLayer.styleOverride ?? null) !== (styledLayer.styleOverride ?? null)
    ) {
      request.styleChanges.layerStyles.push({
        layerId: styledLayer.id,
        rendering: styledLayer.rendering,
        styleOverride: styledLayer.styleOverride ?? null,
      });
    }
  }

  return request;
}

function jsonEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

async function writePublishArtifact(manifest, requestId) {
  await fs.mkdir(publishWorkDir, { recursive: true });
  const safeRequestId = requestId.replace(/[^a-z0-9_.:-]+/gi, '-').slice(0, 80);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.resolve(
    publishWorkDir,
    `manifest.styled.applied.${safeRequestId}.${timestamp}.json`,
  );
  await fs.writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  return filePath;
}

function extractPublishedManifestUrl(output) {
  const match = output.match(/\[publish:layer-manifest\] manifest URL: (https:\/\/\S+)/);
  return match?.[1] ?? null;
}

async function main() {
  await loadLocalEnv(path.resolve(__dirname, '..'));
  const { sourcePath: sourceArg, publish } = parseArgs(process.argv.slice(2));
  const { manifest: latestManifest, url: sourceManifestUrl } = await loadLatestPublishedManifest();
  let firestore = null;
  let request;

  if (sourceArg) {
    await fs.access(sourceArg);
    request = await buildStyleRequestFromLegacyFullManifest(
      sourceArg,
      latestManifest,
      sourceManifestUrl,
    );
    console.log(
      `[publish:styled-manifest] using explicit legacy source ${path.relative(repoRoot, sourceArg)} as style-only changes`,
    );
  } else {
    const firestoreResult = await fetchLatestPendingFirestoreRequest();
    firestore = firestoreResult.firestore;
    request = firestoreResult.request;
    console.log(`[publish:styled-manifest] using Firestore request ${request.id}`);
  }

  const manifestToPublish = applyStyleRequestToManifest(latestManifest, request);
  const publishSourcePath = await writePublishArtifact(manifestToPublish, request.id);
  console.log(
    `[publish:styled-manifest] wrote style-applied manifest ${path.relative(repoRoot, publishSourcePath)}`,
  );

  // Validate the supplied styled manifest before touching runtime/publish files.
  await runNodeScript(path.resolve(__dirname, './validate-manifest.mjs'), [publishSourcePath]);

  if (!publish) {
    console.log(
      '[publish:styled-manifest] validation passed. Re-run with --publish to upload and mark the request published.',
    );
    return;
  }

  // Publish to Vercel Blob using the existing archive + publish pipeline.
  const publishOutput = await runNodeScript(path.resolve(__dirname, './publish-manifest.mjs'), [
    '--source',
    publishSourcePath,
  ]);
  const publishedManifestUrl = extractPublishedManifestUrl(publishOutput);

  if (firestore) {
    await markRequestPublished(firestore, request.id, publishedManifestUrl, manifestToPublish);
    console.log(`[publish:styled-manifest] marked Firestore request ${request.id} as published`);
  }
}

main().catch((error) => {
  console.error(
    `[publish:styled-manifest] ${(error instanceof Error && error.message) || String(error)}`,
  );
  process.exit(1);
});
