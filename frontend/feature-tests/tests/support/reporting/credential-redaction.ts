/**
 * Removes bearer credentials from text the runner prints or stores outside Playwright trace archives.
 * Playwright request errors include a call log with request headers, so a Firebase ID token can reach
 * error messages, stdout tails, and raw JSON reports. Trace archives themselves keep the real headers.
 */
const authorizationHeaderPattern = /(["']?authorization["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s"'\\,}]+/gi;
const bearerTokenPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/g;
/** Three base64url segments starting with a JSON header, the shape of a Firebase ID token. */
const jsonWebTokenPattern = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

export const redactedCredential = '[redacted]';

export function redactCredentials(text: string): string {
  return text
    .replace(authorizationHeaderPattern, `$1${redactedCredential}`)
    .replace(bearerTokenPattern, `Bearer ${redactedCredential}`)
    .replace(jsonWebTokenPattern, redactedCredential);
}

/** Redacts every string inside parsed JSON, so the result still serializes to valid JSON. */
export function redactJsonStrings(value: unknown): unknown {
  if (typeof value === 'string') return redactCredentials(value);
  if (Array.isArray(value)) return value.map(redactJsonStrings);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactJsonStrings(entry)]),
    );
  }
  return value;
}
