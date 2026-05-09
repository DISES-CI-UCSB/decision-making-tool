import { copy, list, put } from '@vercel/blob';

const BLOB_TOKEN_ENV_VAR = 'BLOB_READ_WRITE_TOKEN';
const WRITE_GUARD_ENV_VAR = 'ENABLE_MANIFEST_EDITOR_WRITES';
const PRODUCTION_WRITE_GUARD_ENV_VAR = 'ALLOW_PRODUCTION_MANIFEST_EDITOR_WRITES';
const TARGET_PATH = 'manifest/manifest.json';
const ARCHIVE_PREFIX = 'manifest/archive/';
const SUPPORTED_MANIFEST_VERSION = '0.2.0';

interface ManifestPublishRequest {
  manifest?: unknown;
  editorName?: string;
  sourceManifestUrl?: string;
  diffSummary?: unknown;
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

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  if (!isTruthy(process.env[WRITE_GUARD_ENV_VAR])) {
    res.status(403).json({ message: `${WRITE_GUARD_ENV_VAR} is not enabled` });
    return;
  }

  if (
    process.env['VERCEL_ENV'] === 'production' &&
    !isTruthy(process.env[PRODUCTION_WRITE_GUARD_ENV_VAR])
  ) {
    res.status(403).json({ message: 'Production manifest writes are disabled' });
    return;
  }

  const token = process.env[BLOB_TOKEN_ENV_VAR];
  if (!token) {
    res.status(500).json({ message: 'Manifest publish environment is not configured' });
    return;
  }

  const body = parseRequestBody(req.body);
  if (!isRuntimeLayerManifestLike(body.manifest)) {
    res.status(400).json({ message: 'Request body must include a runtime layer manifest' });
    return;
  }
  if (body.manifest.version !== SUPPORTED_MANIFEST_VERSION) {
    res.status(409).json({
      message: `Manifest version ${body.manifest.version} does not match the supported version ${SUPPORTED_MANIFEST_VERSION}. Re-publish the source manifest before saving editor changes.`,
    });
    return;
  }
  const editorName = body.editorName?.trim();
  if (!editorName) {
    res.status(400).json({ message: 'editorName is required for manifest publishing' });
    return;
  }

  const timestamp = new Date().toISOString();
  const archivePath = `${ARCHIVE_PREFIX}manifest.${timestamp.replace(/[:.]/g, '-')}.json`;
  const manifestToPublish = {
    ...body.manifest,
    generatedAt: timestamp,
    manualEdit: {
      editorName,
      editedAt: timestamp,
      source: 'manifest-style-editor-save-for-all',
    },
  };

  const currentManifest = await getCurrentManifestBlob(token);
  let archiveUrl: string | null = null;
  if (currentManifest) {
    const archiveBlob = await copy(currentManifest.url, archivePath, {
      access: 'public',
      token,
    });
    archiveUrl = archiveBlob.url;
  }

  const publishedBlob = await put(TARGET_PATH, JSON.stringify(manifestToPublish, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token,
  });

  res.status(200).json({
    message: 'Manifest published',
    targetPath: TARGET_PATH,
    archivePath,
    archiveUrl,
    manifestUrl: publishedBlob.url,
    generatedAt: timestamp,
    editorName,
    sourceManifestUrl: body.sourceManifestUrl ?? null,
    diffSummary: body.diffSummary ?? null,
  });
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

function isRuntimeLayerManifestLike(value: unknown): value is {
  version: string;
  generatedAt: string;
  publicBlobHost: string;
  sourceCsv: string;
  categories: unknown[];
  layers: unknown[];
} {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const manifest = value as Record<string, unknown>;
  return (
    typeof manifest['version'] === 'string' &&
    typeof manifest['generatedAt'] === 'string' &&
    typeof manifest['publicBlobHost'] === 'string' &&
    typeof manifest['sourceCsv'] === 'string' &&
    Array.isArray(manifest['categories']) &&
    Array.isArray(manifest['layers'])
  );
}

async function getCurrentManifestBlob(token: string): Promise<{ url: string } | null> {
  const result = await list({
    prefix: TARGET_PATH,
    limit: 10,
    token,
  });
  return result.blobs.find((blob) => blob.pathname === TARGET_PATH) ?? null;
}

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes'].includes(value?.trim().toLowerCase() ?? '');
}
