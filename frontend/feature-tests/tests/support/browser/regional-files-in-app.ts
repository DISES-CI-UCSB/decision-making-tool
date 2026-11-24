import { expect, type Locator, type Page, type Request } from '@playwright/test';
import { COLOMBIA_WIDE_FIELDS, objectKeyFromReference } from '../downloads/regional-files.ts';
import { serviceConfig } from '../downloads/service-config.ts';
import type { TestAccount } from '../downloads/test-accounts.ts';
import { totpCode } from '../downloads/totp.ts';
import {
  approvedAccessControls,
  authenticatorCodeScreen,
  openAppSignedOut,
  provideTestSignInCredentials,
  signInWithGoogleThroughTestHook,
  submitAuthenticatorCode,
  waitForFreshCodeWindow,
} from './test-sign-in.ts';

/**
 * Helpers for live-local tests of regional (SIRAP) files in the web app: the stage A catalog shape, a record of
 * every file request that never stores a signature, and the regional user's sign-in and layer panel.
 */

/** The same-origin path the web app reads Private Layer Bucket files through until GTIC adds a CORS rule. */
export const privateFileProxyPath = '/private-files/';

const bucketOrigin = 'https://storage.googleapis.com';
const bucketAddressPrefix = `${bucketOrigin}/${serviceConfig.bucket}/`;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCatalogBatchRequest(url: URL): boolean {
  return url.origin === serviceConfig.publicBlobHost && url.pathname.endsWith('/manifest.json');
}

/**
 * Serves the published Runtime Catalog with one region's files at their Private Layer Bucket addresses, the shape
 * Cutover 1's stage A release publishes: bucket keys equal Vercel Blob paths, and Colombia-wide fields stay public.
 * Every other address is left as published, so the swap changes nothing once the published release already lists
 * bucket addresses. Call it before the page opens. Returns the object keys moved so far; the set fills as batches load.
 */
export async function listRegionFilesOnPrivateBucket(page: Page, sirapId: string): Promise<Set<string>> {
  const movedKeys = new Set<string>();
  await page.route(isCatalogBatchRequest, async (route) => {
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    const manifest = (await response.json()) as JsonValue;
    if (isObject(manifest)) {
      for (const field of ['layers', 'solutions']) {
        const records = manifest[field];
        if (!Array.isArray(records)) continue;
        manifest[field] = records.map((record) =>
          isObject(record) && typeof record.sirapId === 'string' && record.sirapId.trim() === sirapId
            ? moveToBucket(record, '', movedKeys)
            : record,
        );
      }
    }
    const headers = { ...response.headers() };
    delete headers['content-length'];
    delete headers['content-encoding'];
    await route.fulfill({ status: response.status(), headers, body: JSON.stringify(manifest) });
  });
  return movedKeys;
}

function moveToBucket(node: JsonValue, field: string, movedKeys: Set<string>): JsonValue {
  if (COLOMBIA_WIDE_FIELDS.has(field)) return node;
  if (typeof node === 'string') {
    const publicPrefix = `${serviceConfig.publicBlobHost}/`;
    const key = node.startsWith(publicPrefix) ? objectKeyFromReference(node, field) : null;
    if (key === null) return node;
    movedKeys.add(key);
    return `${bucketAddressPrefix}${node.slice(publicPrefix.length)}`;
  }
  if (Array.isArray(node)) return node.map((item) => moveToBucket(item, field, movedKeys));
  if (isObject(node)) {
    return Object.fromEntries(
      Object.entries(node).map(([childField, child]) => [childField, moveToBucket(child, childField, movedKeys)]),
    );
  }
  return node;
}

/**
 * How the browser reached a file. `private-file-proxy` and `bucket-signed` both carry a signed link; `bucket-plain`
 * is the bucket address without one, and `public-blob` is the old public Vercel Blob address.
 */
export type FileRequestRoute = 'private-file-proxy' | 'bucket-signed' | 'bucket-plain' | 'public-blob';

/** One file request. Holds the address without its query, so a signature never reaches a report. */
export interface FileRequestRecord {
  address: string;
  route: FileRequestRoute;
  objectKey: string;
  /** When the signed link expires, read from its X-Goog-Date and X-Goog-Expires values; null without a signed link. */
  signedLinkExpiresAtMs: number | null;
  startedAtMs: number;
  status: number | null;
  failure: string | null;
}

function decodedKey(pathname: string): string {
  try {
    return pathname.split('/').map(decodeURIComponent).join('/');
  } catch {
    return pathname;
  }
}

/** `X-Goog-Date` is `YYYYMMDDTHHMMSSZ`; the link expires `X-Goog-Expires` seconds later. */
function signedLinkExpiry(url: URL): number | null {
  const date = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(url.searchParams.get('X-Goog-Date') ?? '');
  const expiresSeconds = Number(url.searchParams.get('X-Goog-Expires'));
  if (!date || !Number.isFinite(expiresSeconds)) return null;
  const [, year, month, day, hour, minute, second] = date.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second) + expiresSeconds * 1000;
}

function classifyFileRequest(rawUrl: string, appOrigin: string): Omit<FileRequestRecord, 'startedAtMs' | 'status' | 'failure'> | null {
  const url = new URL(rawUrl);
  const address = `${url.origin}${url.pathname}`;
  const signed = url.searchParams.has('X-Goog-Signature');
  const expiry = signed ? signedLinkExpiry(url) : null;
  if (url.origin === appOrigin && url.pathname.startsWith(privateFileProxyPath)) {
    return {
      address,
      route: 'private-file-proxy',
      objectKey: decodedKey(url.pathname.slice(privateFileProxyPath.length)),
      signedLinkExpiresAtMs: expiry,
    };
  }
  if (url.origin === bucketOrigin && url.pathname.startsWith(`/${serviceConfig.bucket}/`)) {
    return {
      address,
      route: signed ? 'bucket-signed' : 'bucket-plain',
      objectKey: decodedKey(url.pathname.slice(serviceConfig.bucket.length + 2)),
      signedLinkExpiresAtMs: expiry,
    };
  }
  if (url.origin === serviceConfig.publicBlobHost) {
    return { address, route: 'public-blob', objectKey: decodedKey(url.pathname.slice(1)), signedLinkExpiresAtMs: null };
  }
  return null;
}

/** Records every request for a stored file: through the Private File Proxy, the bucket, or Vercel Blob. */
export function recordFileRequests(page: Page, appOrigin: string): FileRequestRecord[] {
  const records: FileRequestRecord[] = [];
  const byRequest = new Map<Request, FileRequestRecord>();
  page.on('request', (request) => {
    const classified = classifyFileRequest(request.url(), appOrigin);
    if (!classified) return;
    const record: FileRequestRecord = { ...classified, startedAtMs: Date.now(), status: null, failure: null };
    records.push(record);
    byRequest.set(request, record);
  });
  page.on('requestfinished', async (request) => {
    const record = byRequest.get(request);
    if (record) record.status = (await request.response())?.status() ?? null;
  });
  page.on('requestfailed', (request) => {
    const record = byRequest.get(request);
    if (record) record.failure = request.failure()?.errorText ?? 'failed';
  });
  return records;
}

/** One request the page sent to the Blob URL Signing Service, without its token or the link it got back. */
export interface SigningRequestRecord {
  objectName: string | null;
  startedAtMs: number;
  status: number | null;
}

export function isSigningServiceRequest(url: URL): boolean {
  return url.pathname.endsWith('/downloads/signed-url');
}

/** The object key a signing request asks for, read from its JSON body. */
export function signingRequestObjectName(request: Request): string | null {
  try {
    const body = request.postDataJSON() as { object_name?: unknown } | null;
    return typeof body?.object_name === 'string' ? body.object_name : null;
  } catch {
    return null;
  }
}

export function recordSigningRequests(page: Page): SigningRequestRecord[] {
  const records: SigningRequestRecord[] = [];
  const byRequest = new Map<Request, SigningRequestRecord>();
  page.on('request', (request) => {
    if (!isSigningServiceRequest(new URL(request.url()))) return;
    const record: SigningRequestRecord = {
      objectName: signingRequestObjectName(request),
      startedAtMs: Date.now(),
      status: null,
    };
    records.push(record);
    byRequest.set(request, record);
  });
  page.on('requestfinished', async (request) => {
    const record = byRequest.get(request);
    if (record) record.status = (await request.response())?.status() ?? null;
  });
  return records;
}

/**
 * Makes the app's signing requests ask for links that live `lifeSeconds`, so a test can watch links expire in
 * minutes. The signing service never gives a link more life than its configured maximum.
 */
export async function shortenSignedLinks(page: Page, lifeSeconds: number): Promise<void> {
  await page.route(isSigningServiceRequest, async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    await route.continue({ postData: JSON.stringify({ ...body, expires_in_seconds: lifeSeconds }) });
  });
}

/**
 * Opens the app, signs the account in through the Test Sign-In Hook, and enters the next code from its
 * authenticator on the app's real code screen. Ends when the header offers SIRAP access.
 */
export async function signInWithAuthenticatorCode(
  page: Page,
  account: TestAccount,
  whenServicesRespond: (action: () => Promise<void>) => Promise<void>,
): Promise<void> {
  const authenticator = account.authenticator;
  if (!authenticator) throw new Error('The account was created without an authenticator.');
  const codeScreen = authenticatorCodeScreen(page);
  await provideTestSignInCredentials(page, account);
  await whenServicesRespond(async () => {
    await openAppSignedOut(page);
    await signInWithGoogleThroughTestHook(page);
  });
  await expect(codeScreen.getByRole('heading', { name: 'Enter authenticator code' })).toBeVisible();
  await waitForFreshCodeWindow(authenticator.lastCodeAcceptedAtMs, authenticator.parameters);
  await submitAuthenticatorCode(codeScreen, totpCode(authenticator.secretKey, authenticator.parameters, Date.now()));
  await whenServicesRespond(async () => {
    await expect(codeScreen).toHaveCount(0, { timeout: 20_000 });
    await expect(approvedAccessControls(page).sirapAccessButton).toBeVisible({ timeout: 20_000 });
  });
}

export const scenarioFinder = (page: Page) =>
  page.getByRole('dialog').filter({ has: page.getByRole('radiogroup', { name: 'Planning domain' }) });

export const mapLayersPanel = (page: Page) =>
  page.getByRole('complementary').filter({ has: page.getByRole('heading', { name: 'Map Layers' }) });

/** The innermost layer-list card whose name button reads exactly `name`. */
export function availableLayer(page: Page, name: string): Locator {
  return mapLayersPanel(page)
    .getByRole('article')
    .filter({ has: page.getByRole('button', { name, exact: true }) })
    .filter({ hasNot: page.getByRole('article') });
}

export function layerDownloadButton(page: Page, name: string): Locator {
  return availableLayer(page, name).getByRole('button', { name: `Download ${name}`, exact: true });
}

export function layerDisplayToggle(page: Page, name: string): Locator {
  return mapLayersPanel(page).getByRole('button', { name: `Toggle display for ${name}` });
}

/**
 * Waits until a scenario metrics file (a `.metrics` object key) started at or after `sinceMs` has loaded through a
 * signed link. The overview's export button is no proof: it turns on even when every metrics read failed.
 */
export async function expectSignedMetricsRead(fileRequests: FileRequestRecord[], sinceMs: number): Promise<void> {
  await expect
    .poll(
      () =>
        fileRequests.some(
          ({ objectKey, route, startedAtMs, status, failure }) =>
            objectKey.includes('.metrics') &&
            (route === 'private-file-proxy' || route === 'bucket-signed') &&
            startedAtMs >= sinceMs &&
            failure === null &&
            (status === 200 || status === 206),
        ),
      { message: 'a scenario metrics file loaded through a signed link', timeout: 30_000 },
    )
    .toBe(true);
}

/** Opens the scenario finder from the header, or from the layer panel's Change button once a scenario is active. */
export async function openScenarioFinder(page: Page): Promise<void> {
  const change = mapLayersPanel(page).getByRole('button', { name: 'Change', exact: true });
  if (await change.isVisible()) {
    await change.click();
  } else {
    await page.getByRole('button', { name: 'Select scenario' }).click();
  }
  await expect(scenarioFinder(page).getByRole('radiogroup', { name: 'Planning domain' })).toBeVisible();
}

/** Chooses View map in the open finder and waits for the scenario's layer list with the Ecosystems group open. */
export async function viewMap(
  page: Page,
  whenServicesRespond: (action: () => Promise<void>) => Promise<void>,
): Promise<void> {
  const finder = scenarioFinder(page);
  const viewMapButton = finder.getByRole('button', { name: 'View map', exact: true });
  const panel = mapLayersPanel(page);
  await whenServicesRespond(async () => {
    await expect(viewMapButton).toBeEnabled({ timeout: 20_000 });
    await viewMapButton.click();
    await expect(finder).toHaveCount(0, { timeout: 20_000 });
    await expect(panel.getByRole('heading', { name: 'Active Scenario' })).toBeVisible({ timeout: 20_000 });
  });
  const ecosystemGroup = panel.getByRole('button', { name: /^Ecosystems \d+ layers?$/ });
  if ((await ecosystemGroup.getAttribute('aria-expanded')) !== 'true') await ecosystemGroup.click();
  await expect(ecosystemGroup).toHaveAttribute('aria-expanded', 'true');
}

/** Picks the SIRAP scope and one region in the open finder. */
export async function chooseSirapRegion(page: Page, regionLabel: string): Promise<void> {
  const finder = scenarioFinder(page);
  await finder.getByRole('radio', { name: 'SIRAP', exact: true }).click();
  await finder.getByRole('combobox').selectOption({ label: regionLabel });
}

/** Turns on a layer's display and waits until its file has loaded and the layer reads as displayed. */
export async function displayLayer(
  page: Page,
  name: string,
  fileName: string,
  whenServicesRespond: (action: () => Promise<void>) => Promise<void>,
): Promise<Buffer> {
  const fileLoaded = page.waitForResponse(
    (response) => decodeURIComponent(new URL(response.url()).pathname).endsWith(`/${fileName}`) && response.ok(),
    { timeout: 30_000 },
  );
  await availableLayer(page, name).getByRole('button', { name: 'Display', exact: true }).click();
  let body: Buffer = Buffer.alloc(0);
  await whenServicesRespond(async () => {
    body = await (await fileLoaded).body();
  });
  await expect(layerDisplayToggle(page, name)).toHaveAttribute('aria-pressed', 'true');
  return body;
}

/** Report-safe copies of the records, with no signed link, token, or account detail. */
export function requestEvidence(fileRequests: FileRequestRecord[], signingRequests: SigningRequestRecord[]): string {
  return JSON.stringify({ fileRequests, signingRequests }, null, 2);
}
