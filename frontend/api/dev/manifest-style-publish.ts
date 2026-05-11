import { copy, list, put } from '@vercel/blob';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type DocumentData } from 'firebase-admin/firestore';

const BLOB_TOKEN_ENV_VAR = 'BLOB_READ_WRITE_TOKEN';
const WRITE_GUARD_ENV_VAR = 'ENABLE_MANIFEST_EDITOR_WRITES';
const PRODUCTION_WRITE_GUARD_ENV_VAR = 'ALLOW_PRODUCTION_MANIFEST_EDITOR_WRITES';
const FIREBASE_PROJECT_ID_ENV_VAR = 'FIREBASE_PROJECT_ID';
const FIREBASE_SERVICE_ACCOUNT_JSON_ENV_VAR = 'FIREBASE_SERVICE_ACCOUNT_JSON';
const FIREBASE_CLIENT_EMAIL_ENV_VAR = 'FIREBASE_CLIENT_EMAIL';
const FIREBASE_PRIVATE_KEY_ENV_VAR = 'FIREBASE_PRIVATE_KEY';
const DEFAULT_FIREBASE_PROJECT_ID = 'dises-decision-making-tool';
const FIRESTORE_COLLECTION = 'manifestStyleRequests';
const TARGET_PATH = 'manifest/manifest.json';
const ARCHIVE_PREFIX = 'manifest/archive/';
const STYLE_DEFAULT_FIELDS = ['selectedColor', 'startColor', 'endColor'];
const CATEGORY_PATH_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*(?:\.[a-z0-9]+(?:_[a-z0-9]+)*)?$/;

interface ManifestPublishRequest {
  requestId?: unknown;
}

interface VercelRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface VercelResponse {
  status(statusCode: number): VercelResponse;
  json(payload: unknown): void;
}

interface RuntimeLayerManifest {
  version: string;
  generatedAt: string;
  publicBlobHost: string;
  sourceCsv: string;
  categories: ManifestCategory[];
  layers: ManifestLayer[];
  solutions: unknown[];
  manualEdit?: {
    editorName: string;
    editedAt: string;
    source?: string | null;
  };
}

interface ManifestCategory {
  id: string;
  styleDefaults?: StyleDefaults;
  subcategories?: ManifestSubcategory[];
  [key: string]: unknown;
}

interface ManifestSubcategory {
  id: string;
  styleDefaults?: StyleDefaults;
  [key: string]: unknown;
}

interface ManifestLayer {
  id: string;
  category: string;
  rendering?: RenderingConfig | null;
  styleOverride?: boolean | null;
  [key: string]: unknown;
}

interface StyleDefaults {
  selectedColor?: string | null;
  startColor?: string | null;
  endColor?: string | null;
}

type RenderingConfig = Record<string, unknown>;

interface ManifestStyleRequestData {
  editorName?: unknown;
  status?: unknown;
  styleChanges?: unknown;
  diffSummary?: unknown;
  sourceManifestUrl?: unknown;
}

interface StyleChanges {
  categoryDefaults: CategoryDefaultsChange[];
  subcategoryDefaults: SubcategoryDefaultsChange[];
  layerStyles: LayerStyleChange[];
}

interface CategoryDefaultsChange {
  categoryId: string;
  styleDefaults: StyleDefaults;
}

interface SubcategoryDefaultsChange {
  categoryId: string;
  subcategoryId: string;
  styleDefaults: StyleDefaults;
}

interface LayerStyleChange {
  layerId: string;
  rendering?: RenderingConfig | null;
  styleOverride?: boolean | null;
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    await publishManifestStyleRequest(req, res);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.statusCode).json({ message: error.message });
      return;
    }

    console.error(
      '[manifest-style-publish]',
      (error instanceof Error && error.message) || String(error),
    );
    res.status(500).json({ message: 'Manifest style publish failed' });
  }
}

async function publishManifestStyleRequest(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    throw new HttpError(405, 'Method not allowed');
  }

  if (!isTruthy(process.env[WRITE_GUARD_ENV_VAR])) {
    throw new HttpError(403, `${WRITE_GUARD_ENV_VAR} is not enabled`);
  }

  if (
    process.env['VERCEL_ENV'] === 'production' &&
    !isTruthy(process.env[PRODUCTION_WRITE_GUARD_ENV_VAR])
  ) {
    throw new HttpError(403, 'Production manifest writes are disabled');
  }

  const token = process.env[BLOB_TOKEN_ENV_VAR];
  if (!token) {
    throw new HttpError(500, 'Manifest publish environment is not configured');
  }

  const requestId = parseRequestId(req.body);
  const idToken = readBearerToken(req.headers);
  const app = getFirebaseAdminApp();
  let decodedToken: { uid: string };
  try {
    decodedToken = await getAuth(app).verifyIdToken(idToken);
  } catch {
    throw new HttpError(
      500,
      'Firebase Admin could not verify the signed-in user token. Check that FIREBASE_SERVICE_ACCOUNT_JSON belongs to the same Firebase project as FIREBASE_PROJECT_ID.',
    );
  }
  const firestore = getFirestore(app);

  const userSnapshot = await firestore.collection('users').doc(decodedToken.uid).get();
  if (!hasManifestStylePublishAccess(userSnapshot.data())) {
    throw new HttpError(403, 'Your account does not have manifest style publish access');
  }

  const requestRef = firestore.collection(FIRESTORE_COLLECTION).doc(requestId);
  const requestSnapshot = await requestRef.get();
  if (!requestSnapshot.exists) {
    throw new HttpError(404, `Manifest style request ${requestId} was not found`);
  }

  const request = requestSnapshot.data() as ManifestStyleRequestData;
  if (request.status !== 'pending') {
    throw new HttpError(409, `Manifest style request ${requestId} is not pending`);
  }

  const styleChanges = parseStyleChanges(request.styleChanges);
  const editorName = readNonEmptyString(request.editorName, 'editorName');
  const currentManifestBlob = await getCurrentManifestBlob(token);
  if (!currentManifestBlob) {
    throw new HttpError(404, `No current Vercel Blob manifest found at ${TARGET_PATH}`);
  }

  const latestManifest = await fetchJson(currentManifestBlob.url);
  assertRuntimeLayerManifest(latestManifest);
  assertLayerCategoryPaths(latestManifest);

  const publishedAt = new Date().toISOString();
  const manifestToPublish = applyStyleChangesToManifest(latestManifest, {
    editorName,
    styleChanges,
    publishedAt,
  });
  assertRuntimeLayerManifest(manifestToPublish);
  assertLayerCategoryPaths(manifestToPublish);

  const archivePath = `${ARCHIVE_PREFIX}manifest.${publishedAt.replace(/[:.]/g, '-')}.json`;
  const archiveBlob = await copy(currentManifestBlob.url, archivePath, {
    access: 'public',
    token,
  });

  const publishedBlob = await put(TARGET_PATH, JSON.stringify(manifestToPublish, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token,
  });

  await requestRef.update({
    status: 'published',
    appliedAt: FieldValue.serverTimestamp(),
    publishedAt: FieldValue.serverTimestamp(),
    publishedBy: decodedToken.uid,
    publishedManifestUrl: publishedBlob.url,
    appliedManifestVersion: manifestToPublish.version ?? null,
    appliedManifestGeneratedAt: manifestToPublish.generatedAt ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  res.status(200).json({
    message: 'Manifest style request published',
    requestId,
    targetPath: TARGET_PATH,
    archivePath,
    archiveUrl: archiveBlob.url,
    manifestUrl: publishedBlob.url,
    publishedAt,
    editorName,
    sourceManifestUrl: request.sourceManifestUrl ?? null,
    diffSummary: request.diffSummary ?? null,
  });
}

function parseRequestId(body: unknown): string {
  const parsedBody = parseRequestBody(body);
  const requestId = parsedBody.requestId;
  if (typeof requestId !== 'string' || requestId.trim().length === 0) {
    throw new HttpError(400, 'requestId is required');
  }
  return requestId.trim();
}

function parseRequestBody(body: unknown): ManifestPublishRequest {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as ManifestPublishRequest;
    } catch {
      return {};
    }
  }

  return body && typeof body === 'object' ? (body as ManifestPublishRequest) : {};
}

function readBearerToken(headers: VercelRequest['headers']): string {
  const headerValue = headers['authorization'] ?? headers['Authorization'];
  const authorization = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new HttpError(401, 'Authorization bearer token is required');
  }
  return match[1].trim();
}

function getFirebaseAdminApp(): App {
  const existingApp = getApps()[0];
  if (existingApp) {
    return existingApp;
  }

  const projectId = process.env[FIREBASE_PROJECT_ID_ENV_VAR] ?? DEFAULT_FIREBASE_PROJECT_ID;
  const serviceAccountJson = process.env[FIREBASE_SERVICE_ACCOUNT_JSON_ENV_VAR]?.trim();
  if (serviceAccountJson) {
    let serviceAccount: Record<string, unknown>;
    try {
      serviceAccount = JSON.parse(serviceAccountJson) as Record<string, unknown>;
    } catch {
      throw new HttpError(
        500,
        `${FIREBASE_SERVICE_ACCOUNT_JSON_ENV_VAR} is not valid JSON. Paste the full Firebase service account JSON into Vercel as a server-side environment variable.`,
      );
    }
    return initializeFirebaseAdminApp({
      credential: cert(serviceAccount),
      projectId: readServiceAccountProjectId(serviceAccount) ?? projectId,
    });
  }

  const clientEmail = process.env[FIREBASE_CLIENT_EMAIL_ENV_VAR]?.trim();
  const privateKey = process.env[FIREBASE_PRIVATE_KEY_ENV_VAR]?.replace(/\\n/g, '\n');
  if (clientEmail && privateKey) {
    return initializeFirebaseAdminApp({
      credential: cert({ projectId, clientEmail, privateKey }),
      projectId,
    });
  }

  throw new HttpError(
    500,
    `Firebase Admin credentials are not configured. Add ${FIREBASE_SERVICE_ACCOUNT_JSON_ENV_VAR} in Vercel, or add both ${FIREBASE_CLIENT_EMAIL_ENV_VAR} and ${FIREBASE_PRIVATE_KEY_ENV_VAR}.`,
  );
}

function initializeFirebaseAdminApp(options: Parameters<typeof initializeApp>[0]): App {
  try {
    return initializeApp(options);
  } catch {
    throw new HttpError(
      500,
      'Firebase Admin credentials are present but invalid. Re-copy the Firebase service account JSON from Firebase Console and redeploy.',
    );
  }
}

function readServiceAccountProjectId(serviceAccount: Record<string, unknown>): string | null {
  const projectId = serviceAccount['project_id'];
  return typeof projectId === 'string' && projectId.trim() ? projectId.trim() : null;
}

function hasManifestStylePublishAccess(userData: DocumentData | undefined): boolean {
  if (!userData || userData['status'] !== 'active') {
    return false;
  }

  const tier = userData['tier'];
  return (
    (typeof tier === 'number' && tier >= 3) ||
    userData['role'] === 'science_publisher' ||
    userData['role'] === 'admin' ||
    userData['isAdmin'] === true
  );
}

async function getCurrentManifestBlob(
  token: string,
): Promise<{ pathname: string; url: string } | null> {
  const result = await list({
    prefix: TARGET_PATH,
    limit: 10,
    token,
  });
  return result.blobs.find((blob) => blob.pathname === TARGET_PATH) ?? null;
}

async function fetchJson(url: string): Promise<unknown> {
  const uncachedUrl = `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;
  const response = await fetch(uncachedUrl, { method: 'GET', redirect: 'follow' });
  if (!response.ok) {
    throw new HttpError(
      502,
      `Failed to load latest manifest: ${response.status} ${response.statusText}`,
    );
  }
  return response.json();
}

function applyStyleChangesToManifest(
  manifest: RuntimeLayerManifest,
  request: { editorName: string; styleChanges: StyleChanges; publishedAt: string },
): RuntimeLayerManifest {
  const categoryIds = new Set(manifest.categories.map((category) => category.id));
  const layerIds = new Set(manifest.layers.map((layer) => layer.id));

  for (const change of request.styleChanges.categoryDefaults) {
    if (!categoryIds.has(change.categoryId)) {
      throw new HttpError(409, `Style request references unknown category "${change.categoryId}"`);
    }
  }

  for (const change of request.styleChanges.subcategoryDefaults) {
    const category = manifest.categories.find((entry) => entry.id === change.categoryId);
    const subcategory = category?.subcategories?.find((entry) => entry.id === change.subcategoryId);
    if (!category || !subcategory) {
      throw new HttpError(
        409,
        `Style request references unknown subcategory "${change.categoryId}.${change.subcategoryId}"`,
      );
    }
  }

  for (const change of request.styleChanges.layerStyles) {
    if (!layerIds.has(change.layerId)) {
      throw new HttpError(409, `Style request references unknown layer "${change.layerId}"`);
    }
  }

  return {
    ...manifest,
    categories: applyDefaultChanges(
      manifest.categories,
      request.styleChanges.categoryDefaults,
      request.styleChanges.subcategoryDefaults,
    ),
    layers: applyLayerStyleChanges(manifest.layers, request.styleChanges.layerStyles),
    manualEdit: {
      editorName: request.editorName,
      editedAt: request.publishedAt,
      source: 'manifest-style-request',
    },
  };
}

function applyDefaultChanges(
  categories: ManifestCategory[],
  categoryDefaults: CategoryDefaultsChange[],
  subcategoryDefaults: SubcategoryDefaultsChange[],
): ManifestCategory[] {
  const categoryDefaultsById = new Map(
    categoryDefaults.map((change) => [change.categoryId, pruneStyleDefaults(change.styleDefaults)]),
  );
  const subcategoryDefaultsByPath = new Map(
    subcategoryDefaults.map((change) => [
      `${change.categoryId}.${change.subcategoryId}`,
      pruneStyleDefaults(change.styleDefaults),
    ]),
  );

  return categories.map((category) => {
    const nextCategory = categoryDefaultsById.has(category.id)
      ? { ...category, styleDefaults: categoryDefaultsById.get(category.id) }
      : category;
    if (!nextCategory.subcategories?.length) {
      return nextCategory;
    }

    return {
      ...nextCategory,
      subcategories: nextCategory.subcategories.map((subcategory) => {
        const key = `${nextCategory.id}.${subcategory.id}`;
        return subcategoryDefaultsByPath.has(key)
          ? { ...subcategory, styleDefaults: subcategoryDefaultsByPath.get(key) }
          : subcategory;
      }),
    };
  });
}

function applyLayerStyleChanges(
  layers: ManifestLayer[],
  layerStyles: LayerStyleChange[],
): ManifestLayer[] {
  const layerStylesById = new Map(layerStyles.map((change) => [change.layerId, change]));
  return layers.map((layer) => {
    const change = layerStylesById.get(layer.id);
    if (!change) {
      return layer;
    }

    return {
      ...layer,
      rendering: copyJson(change.rendering ?? layer.rendering),
      styleOverride: change.styleOverride ?? null,
    };
  });
}

function parseStyleChanges(value: unknown): StyleChanges {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Style request is missing styleChanges');
  }

  const changes = value as Record<string, unknown>;
  return {
    categoryDefaults: parseCategoryDefaults(changes['categoryDefaults']),
    subcategoryDefaults: parseSubcategoryDefaults(changes['subcategoryDefaults']),
    layerStyles: parseLayerStyles(changes['layerStyles']),
  };
}

function parseCategoryDefaults(value: unknown): CategoryDefaultsChange[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    const change = readRecord(entry, `styleChanges.categoryDefaults[${index}]`);
    return {
      categoryId: readNonEmptyString(change['categoryId'], `categoryDefaults[${index}].categoryId`),
      styleDefaults: parseStyleDefaults(change['styleDefaults'], `categoryDefaults[${index}]`),
    };
  });
}

function parseSubcategoryDefaults(value: unknown): SubcategoryDefaultsChange[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    const change = readRecord(entry, `styleChanges.subcategoryDefaults[${index}]`);
    return {
      categoryId: readNonEmptyString(
        change['categoryId'],
        `subcategoryDefaults[${index}].categoryId`,
      ),
      subcategoryId: readNonEmptyString(
        change['subcategoryId'],
        `subcategoryDefaults[${index}].subcategoryId`,
      ),
      styleDefaults: parseStyleDefaults(change['styleDefaults'], `subcategoryDefaults[${index}]`),
    };
  });
}

function parseLayerStyles(value: unknown): LayerStyleChange[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    const change = readRecord(entry, `styleChanges.layerStyles[${index}]`);
    const styleOverride = change['styleOverride'];
    let parsedStyleOverride: boolean | null = null;
    if (typeof styleOverride === 'boolean') {
      parsedStyleOverride = styleOverride;
    } else if (styleOverride !== undefined && styleOverride !== null) {
      throw new HttpError(400, `layerStyles[${index}].styleOverride must be boolean or null`);
    }

    return {
      layerId: readNonEmptyString(change['layerId'], `layerStyles[${index}].layerId`),
      rendering: parseRenderingConfig(change['rendering'], `layerStyles[${index}].rendering`),
      styleOverride: parsedStyleOverride,
    };
  });
}

function parseStyleDefaults(value: unknown, label: string): StyleDefaults {
  const record = readRecord(value, `${label}.styleDefaults`);
  const defaults: StyleDefaults = {};
  for (const [fieldName, fieldValue] of Object.entries(record)) {
    if (!STYLE_DEFAULT_FIELDS.includes(fieldName)) {
      throw new HttpError(400, `${label}.styleDefaults.${fieldName} is not editable`);
    }
    assertHexColorOrNull(fieldValue, `${label}.styleDefaults.${fieldName}`);
    defaults[fieldName as keyof StyleDefaults] = fieldValue;
  }
  return defaults;
}

function parseRenderingConfig(value: unknown, label: string): RenderingConfig | null {
  if (value === null || value === undefined) {
    return null;
  }
  const rendering = readRecord(value, label);
  for (const fieldName of ['selectedColor', 'startColor', 'endColor']) {
    if (fieldName in rendering) {
      assertHexColorOrNull(rendering[fieldName], `${label}.${fieldName}`);
    }
  }
  return copyJson(rendering);
}

function pruneStyleDefaults(defaults: StyleDefaults): StyleDefaults {
  return Object.fromEntries(
    STYLE_DEFAULT_FIELDS.map((fieldName) => [
      fieldName,
      defaults[fieldName as keyof StyleDefaults] ?? null,
    ]).filter(([, value]) => value != null && value !== ''),
  ) as StyleDefaults;
}

function assertRuntimeLayerManifest(value: unknown): asserts value is RuntimeLayerManifest {
  if (!value || typeof value !== 'object') {
    throw new HttpError(400, 'Manifest must be an object');
  }

  const manifest = value as Record<string, unknown>;
  if (
    typeof manifest['version'] !== 'string' ||
    typeof manifest['generatedAt'] !== 'string' ||
    typeof manifest['publicBlobHost'] !== 'string' ||
    typeof manifest['sourceCsv'] !== 'string' ||
    !Array.isArray(manifest['categories']) ||
    !Array.isArray(manifest['layers']) ||
    !Array.isArray(manifest['solutions'])
  ) {
    throw new HttpError(400, 'Latest manifest is missing required runtime fields');
  }
}

function assertLayerCategoryPaths(manifest: RuntimeLayerManifest): void {
  const categoryIds = new Set(manifest.categories.map((category) => category.id));
  const subcategoryIdsByCategory = new Map(
    manifest.categories.map((category) => [
      category.id,
      new Set((category.subcategories ?? []).map((subcategory) => subcategory.id)),
    ]),
  );

  for (const layer of manifest.layers) {
    const { categoryId, subcategoryId } = parseCategoryPath(layer.category);
    if (!categoryIds.has(categoryId)) {
      throw new HttpError(409, `Layer "${layer.id}" references unknown category "${categoryId}"`);
    }
    if (subcategoryId && !subcategoryIdsByCategory.get(categoryId)?.has(subcategoryId)) {
      throw new HttpError(
        409,
        `Layer "${layer.id}" references unknown subcategory "${categoryId}.${subcategoryId}"`,
      );
    }
  }
}

function parseCategoryPath(category: unknown): {
  categoryId: string;
  subcategoryId: string | null;
} {
  if (typeof category !== 'string' || !CATEGORY_PATH_PATTERN.test(category)) {
    throw new HttpError(409, `layer.category "${String(category)}" is invalid`);
  }
  const [categoryId, subcategoryId = null] = category.split('.');
  return { categoryId, subcategoryId };
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(400, `${label} must be a non-empty string`);
  }
  return value.trim();
}

function assertHexColorOrNull(value: unknown, label: string): asserts value is string | null {
  if (value !== null && (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value))) {
    throw new HttpError(400, `${label} must be null or a #RRGGBB color`);
  }
}

function copyJson<T>(value: T): T {
  return value == null ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes'].includes(value?.trim().toLowerCase() ?? '');
}
