import { expect, type APIRequestContext } from '@playwright/test';
import { serviceConfig } from './service-config.ts';

export interface SignedUrlReply {
  status: number;
  /** Response headers with lowercase names. */
  headers: Record<string, string>;
  rawText: string;
  body: { url?: string; expires_at?: string; detail?: { status?: string } } | null;
}

/**
 * Every call goes through Playwright's `request` fixture so it appears in the test's trace.
 * Calls `POST /downloads/signed-url` on the deployed service, or on `serviceUrl` when given.
 * Pass no token to send no Authorization header.
 */
export async function requestSignedUrl(
  request: APIRequestContext,
  objectName: string,
  idToken?: string,
  serviceUrl: string = serviceConfig.serviceUrl,
): Promise<SignedUrlReply> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idToken !== undefined) {
    headers.Authorization = `Bearer ${idToken}`;
  }
  const response = await request.post(`${serviceUrl}/downloads/signed-url`, {
    headers,
    data: JSON.stringify({ object_name: objectName }),
  });
  const rawText = await response.text();
  let body: SignedUrlReply['body'] = null;
  try {
    body = JSON.parse(rawText) as SignedUrlReply['body'];
  } catch {
    body = null;
  }
  return { status: response.status(), headers: response.headers(), rawText, body };
}

/** Fetches the first bytes of a file through a signed link. A range request avoids downloading large files. */
export async function fetchFirstBytes(
  request: APIRequestContext,
  url: string,
): Promise<{ status: number; byteLength: number; bytes: Buffer }> {
  const response = await request.get(url, { headers: { Range: 'bytes=0-1023' } });
  const bytes = await response.body();
  return { status: response.status(), byteLength: bytes.byteLength, bytes };
}

/** Sends a write method to a link that was signed only for GET. */
export async function sendWriteToSignedLink(
  request: APIRequestContext,
  url: string,
  method: 'PUT' | 'DELETE',
  data?: Buffer,
): Promise<{ status: number; text: string }> {
  const response = await request.fetch(url, { method, data });
  return { status: response.status(), text: await response.text() };
}

/** The same bucket file at its plain public address, with no signature. */
export async function fetchPlainBucketAddress(request: APIRequestContext, objectName: string): Promise<number> {
  const encoded = objectName.split('/').map(encodeURIComponent).join('/');
  const response = await request.get(`https://storage.googleapis.com/${serviceConfig.bucket}/${encoded}`);
  await response.body();
  return response.status();
}

/**
 * A refusal must carry a reason and never a link, in the parsed body or the raw text.
 * Link checks compare booleans so a wrongly issued signed URL never appears in a failure message.
 */
export function expectRefusedWithoutLink(reply: SignedUrlReply, status: number, reason?: string): void {
  expect(reply.status, `refusal reason: ${reply.body?.detail?.status}`).toBe(status);
  expect(reply.body?.url === undefined, 'refusal body must not contain a url').toBe(true);
  expect(reply.rawText.includes('X-Goog-Signature'), 'refusal text must not contain a signature').toBe(false);
  if (reason !== undefined) {
    expect(reply.body?.detail?.status).toBe(reason);
  }
}

/** An allowed reply carries a link and is never cached by the browser. */
export function expectLinkIssued(reply: SignedUrlReply): string {
  expect(reply.status, `refusal reason: ${reply.body?.detail?.status}`).toBe(200);
  expect(reply.headers['cache-control']).toBe('no-store');
  const url = reply.body?.url;
  expect(typeof url).toBe('string');
  return url as string;
}
