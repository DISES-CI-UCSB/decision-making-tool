import { expect } from 'vitest';
import { serviceConfig } from './service-config.ts';

export interface SignedUrlReply {
  status: number;
  headers: Headers;
  rawText: string;
  body: { url?: string; expires_at?: string; detail?: { status?: string } } | null;
}

/** Calls `POST /downloads/signed-url` on the deployed service. Pass no token to send no Authorization header. */
export async function requestSignedUrl(objectName: string, idToken?: string): Promise<SignedUrlReply> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idToken !== undefined) {
    headers.Authorization = `Bearer ${idToken}`;
  }
  const response = await fetch(`${serviceConfig.serviceUrl}/downloads/signed-url`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ object_name: objectName }),
  });
  const rawText = await response.text();
  let body: SignedUrlReply['body'] = null;
  try {
    body = JSON.parse(rawText) as SignedUrlReply['body'];
  } catch {
    body = null;
  }
  return { status: response.status, headers: response.headers, rawText, body };
}

/** Fetches the first bytes of a file through a signed link. A range request avoids downloading large files. */
export async function fetchFirstBytes(url: string): Promise<{ status: number; byteLength: number }> {
  const response = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
  const bytes = await response.arrayBuffer();
  return { status: response.status, byteLength: bytes.byteLength };
}

/** The same bucket file at its plain public address, with no signature. */
export async function fetchPlainBucketAddress(objectName: string): Promise<number> {
  const encoded = objectName.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`https://storage.googleapis.com/${serviceConfig.bucket}/${encoded}`);
  await response.arrayBuffer();
  return response.status;
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
  expect(reply.headers.get('cache-control')).toBe('no-store');
  const url = reply.body?.url;
  expect(typeof url).toBe('string');
  return url as string;
}
