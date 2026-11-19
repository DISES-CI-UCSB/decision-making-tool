import { serviceConfig } from './service-config.ts';

/**
 * Fields that point at shared Colombia-wide assets. The app loads them next to every regional solution,
 * but they hold national data, so they are not regional-only files.
 */
export const COLOMBIA_WIDE_FIELDS = new Set(['mecNationalDenominator', 'speciesGoalsCatalog', 'speciesGoalsTargetOverlay']);

export interface RegionalOnlyFile {
  objectName: string;
  sirapId: string;
}

export interface RegionalFileInventory {
  manifestUrls: string[];
  /** Files referenced only by regional records of one region, sorted by object key. */
  files: RegionalOnlyFile[];
  /** Keys a regional record references that a national record also references. Left out of `files`. */
  sharedWithNational: string[];
  /** Keys referenced only through Colombia-wide fields of regional records. Left out of `files`. */
  colombiaWide: string[];
  /** Keys that regional records of more than one region reference outside Colombia-wide fields. */
  usedByMoreThanOneRegion: Array<{ objectName: string; sirapIds: string[] }>;
}

/** Thrown when a manifest host is unreachable, rate limited, or failing (429 or 5xx), so the checks never ran. */
export class ManifestsUnavailableError extends Error {}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

/**
 * Reads the catalog release index the web app loads, then every manifest it lists, and sorts each file
 * reference into regional or national. A layer or solution with a nonempty `sirapId` is regional; every
 * other record, and everything else in a manifest, is national.
 */
export async function loadRegionalFileInventory(): Promise<RegionalFileInventory> {
  const index = await fetchJson(serviceConfig.catalogReleaseIndexUrl);
  const batches = Array.isArray(index.batches) ? index.batches : [];
  const manifestUrls = batches.flatMap((batch) =>
    isObject(batch) && typeof batch.manifestUrl === 'string' ? [batch.manifestUrl] : [],
  );
  if (manifestUrls.length === 0) {
    throw new Error('The catalog release index lists no manifests.');
  }

  const regionsByKey = new Map<string, Set<string>>();
  const colombiaWideKeys = new Set<string>();
  const nationalKeys = new Set<string>();
  for (const manifestUrl of manifestUrls) {
    const manifest = await fetchJson(manifestUrl);
    for (const [field, value] of Object.entries(manifest)) {
      const records = (field === 'layers' || field === 'solutions') && Array.isArray(value) ? value : null;
      if (records === null) {
        collectReferences(value, field, false, (key) => nationalKeys.add(key));
        continue;
      }
      for (const record of records) {
        const sirapId = isObject(record) && typeof record.sirapId === 'string' ? record.sirapId.trim() : '';
        collectReferences(record, '', false, (key, colombiaWide) => {
          if (!sirapId) {
            nationalKeys.add(key);
          } else if (colombiaWide) {
            colombiaWideKeys.add(key);
          } else {
            regionsByKey.set(key, (regionsByKey.get(key) ?? new Set()).add(sirapId));
          }
        });
      }
    }
  }

  const files: RegionalOnlyFile[] = [];
  const sharedWithNational: string[] = [];
  const usedByMoreThanOneRegion: RegionalFileInventory['usedByMoreThanOneRegion'] = [];
  for (const [objectName, regions] of [...regionsByKey].sort(([a], [b]) => a.localeCompare(b))) {
    if (nationalKeys.has(objectName)) {
      sharedWithNational.push(objectName);
    } else if (regions.size > 1) {
      usedByMoreThanOneRegion.push({ objectName, sirapIds: [...regions].sort() });
    } else {
      files.push({ objectName, sirapId: [...regions][0] });
    }
  }
  const colombiaWide = [...colombiaWideKeys].filter((key) => !regionsByKey.has(key) && !nationalKeys.has(key)).sort();
  return { manifestUrls, files, sharedWithNational, colombiaWide, usedByMoreThanOneRegion };
}

/** Turns a manifest string into a bucket object key, or null when it does not point at a stored file. */
export function objectKeyFromReference(value: string, field: string): string | null {
  const text = value.trim();
  const prefixes = [
    `${serviceConfig.publicBlobHost}/`,
    `https://storage.googleapis.com/${serviceConfig.bucket}/`,
    `https://storage.cloud.google.com/${serviceConfig.bucket}/`,
    `gs://${serviceConfig.bucket}/`,
  ];
  const prefix = prefixes.find((candidate) => text.startsWith(candidate));
  let key: string;
  if (prefix !== undefined) {
    key = text.slice(prefix.length);
  } else if (!text.includes('://') && field.endsWith('Path') && text.includes('/')) {
    key = text;
  } else {
    return null;
  }
  key = key.split(/[?#]/)[0];
  try {
    key = key.split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
  return key.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..') ? key : null;
}

function collectReferences(
  node: JsonValue,
  field: string,
  colombiaWide: boolean,
  found: (key: string, colombiaWide: boolean) => void,
): void {
  if (typeof node === 'string') {
    const key = objectKeyFromReference(node, field);
    if (key !== null) {
      found(key, colombiaWide);
    }
  } else if (Array.isArray(node)) {
    for (const item of node) {
      collectReferences(item, field, colombiaWide, found);
    }
  } else if (isObject(node)) {
    for (const [childField, child] of Object.entries(node)) {
      collectReferences(child, childField, colombiaWide || COLOMBIA_WIDE_FIELDS.has(childField), found);
    }
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Manifests are inputs, not the service under test, so they load with plain fetch and stay out of the
 * Playwright trace; the national manifest alone is about 74 MB. The cache-busting query matches the web app.
 */
async function fetchJson(url: string): Promise<JsonObject> {
  const separator = url.includes('?') ? '&' : '?';
  let response: Response;
  try {
    response = await fetch(`${url}${separator}v=${Date.now()}`);
  } catch (error) {
    throw new ManifestsUnavailableError(`Could not reach ${url}: ${(error as Error).message}`);
  }
  if (response.status === 429 || response.status >= 500) {
    throw new ManifestsUnavailableError(`${url} returned ${response.status}.`);
  }
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}.`);
  }
  const document = (await response.json()) as JsonValue;
  if (!isObject(document)) {
    throw new ManifestsUnavailableError(`${url} is not a JSON object.`);
  }
  return document;
}
