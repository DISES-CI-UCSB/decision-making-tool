/**
 * Development-only summary of Identity Toolkit `accounts:lookup` after TOTP
 * (time-based one-time password) enrollment stays unconfirmed.
 * The logged line is a fixed shape. Tokens, emails, and raw payloads never leave this module.
 */

export const TOTP_DIAGNOSTIC_LOG_PREFIX = '[Auth][TOTP diagnostic]';

const ACCOUNTS_LOOKUP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';
const LOOKUP_TIMEOUT_MS = 5000;
const MAX_DIAGNOSTIC_LINE_LENGTH = 4000;

const SAFE_SIGN_IN_PROVIDERS = new Set([
  'anonymous',
  'apple.com',
  'custom',
  'emailLink',
  'facebook.com',
  'github.com',
  'google.com',
  'microsoft.com',
  'password',
  'phone',
  'playgames.google.com',
  'twitter.com',
  'yahoo.com',
]);

const SAFE_SECOND_FACTORS = new Set(['phone', 'totp']);

const INTERNAL_ERROR_CODES = new Set([
  'network',
  'timeout',
  'token-unavailable',
  'unavailable',
  'unreadable',
]);

const UNSAFE_DIAGNOSTIC_TEXT =
  /@|eyJ[A-Za-z0-9_-]{8,}|BEGIN |idToken|refreshToken|sessionInfo|secretKey|private_key|otpauth/i;

export interface TotpDiagnosticMfaEntry {
  hasEnrollmentId: boolean;
  hasEnrolledAt: boolean;
  hasDisplayName: boolean;
  hasPhoneInfo: boolean;
  totpInfoPresent: boolean;
  totpInfoType: string;
  totpInfoKeyCount: number;
}

export interface TotpDiagnosticTokenClaims {
  audMatchesConfiguredProject: boolean;
  signInProvider: string | null;
  tenantPresent: boolean;
  secondFactor: string | null;
  subjectMatchesCurrentUser: boolean;
}

export interface TotpAccountsLookupShape {
  usersLength: number;
  uidMatchesCurrentUser: boolean;
  tenantIdPresent: boolean;
  mfaInfoLength: number;
  mfaEntries: TotpDiagnosticMfaEntry[];
}

export interface TotpDiagnosticSummary extends TotpAccountsLookupShape, TotpDiagnosticTokenClaims {
  httpStatus: number;
}

export interface TotpLookupDependencies {
  production: boolean;
  apiKey: string;
  projectId: string;
  currentUid: string;
  getIdToken: (forceRefresh: boolean) => Promise<string>;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

export function shouldRunTotpEnrollmentDiagnostic(
  production: boolean,
  enrolledAfterRefresh: boolean,
): boolean {
  return production === false && enrolledAfterRefresh === false;
}

export function sanitizeDiagnosticErrorCode(value: unknown): string {
  if (typeof value !== 'string') {
    return 'unavailable';
  }
  const code = value.trim();
  if (INTERNAL_ERROR_CODES.has(code)) {
    return code;
  }
  if (/^(?:auth|totp)\/[a-z0-9-]+$/.test(code)) {
    return code;
  }
  if (/^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(code) && code.length <= 64) {
    return code;
  }
  return 'unavailable';
}

export function isSafeTotpDiagnosticLine(line: string): boolean {
  return (
    line.startsWith(`${TOTP_DIAGNOSTIC_LOG_PREFIX} `) &&
    line.length <= MAX_DIAGNOSTIC_LINE_LENGTH &&
    !UNSAFE_DIAGNOSTIC_TEXT.test(line)
  );
}

export function summarizeAccountsLookupBody(
  body: unknown,
  currentUid: string,
): TotpAccountsLookupShape {
  if (!isRecord(body)) {
    return emptyLookupShape();
  }
  const users = field(body, 'users');
  if (!Array.isArray(users)) {
    return emptyLookupShape();
  }
  const records = users.filter(isRecord);
  const matched =
    currentUid.length > 0
      ? records.find((user) => field(user, 'localId') === currentUid)
      : undefined;
  const selected = matched ?? records[0] ?? null;
  const mfaInfoValue = selected ? field(selected, 'mfaInfo') : undefined;
  const mfaInfo = Array.isArray(mfaInfoValue) ? mfaInfoValue : [];
  return {
    usersLength: users.length,
    uidMatchesCurrentUser: matched !== undefined,
    tenantIdPresent: selected ? isPresent(field(selected, 'tenantId')) : false,
    mfaInfoLength: mfaInfo.length,
    mfaEntries: mfaInfo.map(summarizeMfaEntry),
  };
}

export function summarizeIdTokenClaims(
  idToken: string,
  currentUid: string,
  projectId: string,
): TotpDiagnosticTokenClaims {
  const payload = decodeJwtPayload(idToken);
  if (!isRecord(payload)) {
    return emptyClaims();
  }
  const firebaseValue = field(payload, 'firebase');
  const firebase = isRecord(firebaseValue) ? firebaseValue : {};
  const signInProvider = field(firebase, 'sign_in_provider');
  const secondFactor = field(firebase, 'sign_in_second_factor');
  const tenant = field(firebase, 'tenant');
  return {
    audMatchesConfiguredProject: audienceMatches(field(payload, 'aud'), projectId),
    signInProvider:
      typeof signInProvider === 'string' && SAFE_SIGN_IN_PROVIDERS.has(signInProvider)
        ? signInProvider
        : null,
    tenantPresent: typeof tenant === 'string' && tenant.length > 0,
    secondFactor:
      typeof secondFactor === 'string' && SAFE_SECOND_FACTORS.has(secondFactor)
        ? secondFactor
        : null,
    subjectMatchesCurrentUser: currentUid.length > 0 && field(payload, 'sub') === currentUid,
  };
}

export function buildTotpDiagnosticSummary(input: {
  httpStatus: number;
  body: unknown;
  idToken: string;
  currentUid: string;
  projectId: string;
}): TotpDiagnosticSummary {
  return {
    httpStatus: safeHttpStatus(input.httpStatus),
    ...summarizeAccountsLookupBody(input.body, input.currentUid),
    ...summarizeIdTokenClaims(input.idToken, input.currentUid, input.projectId),
  };
}

export function formatTotpDiagnosticLine(summary: TotpDiagnosticSummary): string {
  return `${TOTP_DIAGNOSTIC_LOG_PREFIX} ${JSON.stringify(summary)}`;
}

export function formatTotpDiagnosticFailure(httpStatus: number, errorCode: unknown): string {
  return `${TOTP_DIAGNOSTIC_LOG_PREFIX} ${JSON.stringify({
    httpStatus: safeHttpStatus(httpStatus),
    errorCode: sanitizeDiagnosticErrorCode(errorCode),
  })}`;
}

export async function reportUnconfirmedTotpLookup(deps: TotpLookupDependencies): Promise<void> {
  if (deps.production !== false) {
    return;
  }
  try {
    await runUnconfirmedTotpLookup(deps);
  } catch {
    try {
      emitTotpDiagnosticLine(deps.log, formatTotpDiagnosticFailure(0, 'unavailable'));
    } catch {
      // Logging must not change the enrollment result.
    }
  }
}

function emitTotpDiagnosticLine(log: TotpLookupDependencies['log'], line: string): void {
  const write = log ?? defaultLog;
  if (!isSafeTotpDiagnosticLine(line)) {
    write(formatTotpDiagnosticFailure(0, 'unavailable'));
    return;
  }
  write(line);
}

async function runUnconfirmedTotpLookup(deps: TotpLookupDependencies): Promise<void> {
  if (!deps.apiKey) {
    emitTotpDiagnosticLine(deps.log, formatTotpDiagnosticFailure(0, 'unavailable'));
    return;
  }
  let idToken: string;
  try {
    idToken = await deps.getIdToken(true);
  } catch (error) {
    const code = isRecord(error)
      ? sanitizeDiagnosticErrorCode(field(error, 'code'))
      : 'unavailable';
    emitTotpDiagnosticLine(
      deps.log,
      formatTotpDiagnosticFailure(0, code === 'unavailable' ? 'token-unavailable' : code),
    );
    return;
  }
  if (typeof idToken !== 'string' || idToken.length === 0) {
    emitTotpDiagnosticLine(deps.log, formatTotpDiagnosticFailure(0, 'token-unavailable'));
    return;
  }

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    response = await fetchImpl(`${ACCOUNTS_LOOKUP_URL}?key=${encodeURIComponent(deps.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
  } catch (error) {
    emitTotpDiagnosticLine(deps.log, formatTotpDiagnosticFailure(0, lookupThrownCode(error)));
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await response.text());
  } catch {
    emitTotpDiagnosticLine(deps.log, formatTotpDiagnosticFailure(response.status, 'unreadable'));
    return;
  }
  if (!response.ok) {
    emitTotpDiagnosticLine(
      deps.log,
      formatTotpDiagnosticFailure(response.status, readIdentityToolkitErrorCode(parsed)),
    );
    return;
  }
  emitTotpDiagnosticLine(
    deps.log,
    formatTotpDiagnosticLine(
      buildTotpDiagnosticSummary({
        httpStatus: response.status,
        body: parsed,
        idToken,
        currentUid: deps.currentUid,
        projectId: deps.projectId,
      }),
    ),
  );
}

function readIdentityToolkitErrorCode(body: unknown): string {
  const error = isRecord(body) ? field(body, 'error') : undefined;
  if (!isRecord(error)) {
    return 'unavailable';
  }
  const message = sanitizeDiagnosticErrorCode(field(error, 'message'));
  if (message !== 'unavailable') {
    return message;
  }
  return sanitizeDiagnosticErrorCode(field(error, 'status'));
}

function lookupThrownCode(error: unknown): string {
  const name = isRecord(error) ? field(error, 'name') : '';
  const errorName = typeof name === 'string' ? name : '';
  if (errorName === 'TimeoutError' || errorName === 'AbortError') {
    return 'timeout';
  }
  return 'network';
}

function summarizeMfaEntry(entry: unknown): TotpDiagnosticMfaEntry {
  if (!isRecord(entry)) {
    return {
      hasEnrollmentId: false,
      hasEnrolledAt: false,
      hasDisplayName: false,
      hasPhoneInfo: false,
      totpInfoPresent: false,
      totpInfoType: 'invalid',
      totpInfoKeyCount: 0,
    };
  }
  const totp = summarizeTotpInfo(entry);
  return {
    hasEnrollmentId: isPresent(field(entry, 'mfaEnrollmentId')),
    hasEnrolledAt: isPresent(field(entry, 'enrolledAt')),
    hasDisplayName: isPresent(field(entry, 'displayName')),
    hasPhoneInfo: isPresent(field(entry, 'phoneInfo')),
    totpInfoPresent: totp.present,
    totpInfoType: totp.type,
    totpInfoKeyCount: totp.keyCount,
  };
}

function summarizeTotpInfo(entry: Record<string, unknown>): {
  present: boolean;
  type: string;
  keyCount: number;
} {
  if (!Object.prototype.hasOwnProperty.call(entry, 'totpInfo')) {
    return { present: false, type: 'missing', keyCount: 0 };
  }
  const value = field(entry, 'totpInfo');
  if (value === null) {
    return { present: false, type: 'null', keyCount: 0 };
  }
  if (Array.isArray(value)) {
    return { present: true, type: 'array', keyCount: value.length };
  }
  if (typeof value === 'object') {
    return { present: true, type: 'object', keyCount: Object.keys(value).length };
  }
  return { present: true, type: typeof value, keyCount: 0 };
}

function emptyLookupShape(): TotpAccountsLookupShape {
  return {
    usersLength: 0,
    uidMatchesCurrentUser: false,
    tenantIdPresent: false,
    mfaInfoLength: 0,
    mfaEntries: [],
  };
}

function emptyClaims(): TotpDiagnosticTokenClaims {
  return {
    audMatchesConfiguredProject: false,
    signInProvider: null,
    tenantPresent: false,
    secondFactor: null,
    subjectMatchesCurrentUser: false,
  };
}

function audienceMatches(aud: unknown, projectId: string): boolean {
  if (!projectId) {
    return false;
  }
  if (typeof aud === 'string') {
    return aud === projectId;
  }
  return Array.isArray(aud) && aud.some((item) => item === projectId);
}

function decodeJwtPayload(idToken: string): unknown {
  const segment = idToken.split('.')[1];
  if (!segment) {
    return null;
  }
  try {
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
    const base64 = padded.padEnd(Math.ceil(padded.length / 4) * 4, '=');
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function isPresent(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.length > 0;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'boolean') {
    return true;
  }
  return isRecord(value) || Array.isArray(value);
}

function field(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeHttpStatus(status: number): number {
  if (!Number.isInteger(status) || status < 0 || status > 599) {
    return 0;
  }
  return status;
}

function defaultLog(line: string): void {
  console.info(line);
}
