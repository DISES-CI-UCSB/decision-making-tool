import { PUBLIC_BLOB_HOST, VERCEL_BLOB_HOST } from './runtime-manifest.constants';

/**
 * Sends a public Vercel Blob address to the public file bucket, keeping its path and query.
 * Every other address is returned unchanged, including a Private Layer Bucket URL.
 */
export function toPublicFileUrl(url: string): string {
  if (!url.startsWith(VERCEL_BLOB_HOST)) {
    return url;
  }
  const boundary = url.charAt(VERCEL_BLOB_HOST.length);
  if (boundary !== '' && boundary !== '/' && boundary !== '?' && boundary !== '#') {
    return url;
  }
  return `${PUBLIC_BLOB_HOST}${url.slice(VERCEL_BLOB_HOST.length)}`;
}
