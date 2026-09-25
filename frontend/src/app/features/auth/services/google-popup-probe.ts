/**
 * Development-only Google popup sign-in probe.
 * Console lines use a fixed prefix and a closed JSON schema. Tokens, claims,
 * emails, UIDs, OTP codes, QR secrets, factor IDs, resolver hints, and raw
 * Firebase payloads never leave this module.
 */

import { sanitizeDiagnosticErrorCode } from './totp-enrollment-diagnostic';

export const GOOGLE_POPUP_PROBE_LOG_PREFIX = '[Auth][Google popup probe]';

const MAX_PROBE_LINE_LENGTH = 4000;
const SAFE_SECOND_FACTORS = new Set(['phone', 'totp']);
const UNSAFE_PROBE_TEXT =
  /@|eyJ[A-Za-z0-9_-]{8,}|BEGIN |idToken|refreshToken|sessionInfo|secretKey|private_key|otpauth/i;

export type GooglePopupProbeOutcome = 'resolved' | 'mfa-required' | 'rejected';

export interface GooglePopupProbeEvent {
  event: 'popup-result';
  outcome: GooglePopupProbeOutcome;
  errorCode?: string;
  currentUserPresent: boolean;
  enrolledFactorCount: number;
  secondFactorClaimPresent: boolean;
}

/**
 * Narrow user snapshot for the probe. Must not include token, claims, email,
 * UID, or factor IDs.
 */
export interface GooglePopupProbeUserSnapshot {
  enrolledFactorCount: number;
  getIdTokenResult: (forceRefresh: boolean) => Promise<{ signInSecondFactor: string | null }>;
}

export interface GooglePopupProbeInput {
  outcome: GooglePopupProbeOutcome;
  errorCode?: unknown;
  currentUserPresent: boolean;
  snapshot?: (() => GooglePopupProbeUserSnapshot | null) | GooglePopupProbeUserSnapshot | null;
}

export function isSafeGooglePopupProbeLine(line: string): boolean {
  return (
    line.startsWith(`${GOOGLE_POPUP_PROBE_LOG_PREFIX} `) &&
    line.length <= MAX_PROBE_LINE_LENGTH &&
    !UNSAFE_PROBE_TEXT.test(line)
  );
}

export function sanitizeGooglePopupProbeErrorCode(value: unknown): string {
  return sanitizeDiagnosticErrorCode(value);
}

export function secondFactorClaimPresent(value: unknown): boolean {
  return typeof value === 'string' && SAFE_SECOND_FACTORS.has(value);
}

/** Reads only the SDK scalar. Never touches token or claims. */
export function signInSecondFactorFromIdTokenResult(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) {
    return null;
  }
  const value = (result as { signInSecondFactor?: unknown }).signInSecondFactor;
  return typeof value === 'string' ? value : null;
}

export function formatGooglePopupProbeLine(event: GooglePopupProbeEvent): string {
  return `${GOOGLE_POPUP_PROBE_LOG_PREFIX} ${JSON.stringify(closedProbePayload(event))}`;
}

export async function emitGooglePopupProbe(
  production: boolean,
  input: GooglePopupProbeInput,
  log?: (line: string) => void,
): Promise<void> {
  if (production) {
    return;
  }
  try {
    const line = formatGooglePopupProbeLine(await collectGooglePopupProbeEvent(input));
    const write = log ?? defaultLog;
    if (!isSafeGooglePopupProbeLine(line)) {
      write(`${GOOGLE_POPUP_PROBE_LOG_PREFIX} {"event":"unavailable"}`);
      return;
    }
    write(line);
  } catch {
    // Probe output must not change the sign-in result.
  }
}

export async function collectGooglePopupProbeEvent(
  input: GooglePopupProbeInput,
): Promise<GooglePopupProbeEvent> {
  const snapshot = resolveSnapshot(input.snapshot);
  return closedProbePayload({
    event: 'popup-result',
    outcome: sanitizeOutcome(input.outcome),
    errorCode: readProbeErrorCode(input.errorCode),
    currentUserPresent: input.currentUserPresent === true,
    enrolledFactorCount: safeEnrolledFactorCount(snapshot),
    secondFactorClaimPresent:
      input.outcome === 'resolved' ? await readSecondFactorClaimPresent(snapshot) : false,
  });
}

function resolveSnapshot(
  snapshot: GooglePopupProbeInput['snapshot'],
): GooglePopupProbeUserSnapshot | null {
  if (typeof snapshot === 'function') {
    return snapshot();
  }
  return snapshot ?? null;
}

function sanitizeOutcome(outcome: unknown): GooglePopupProbeOutcome {
  if (outcome === 'resolved' || outcome === 'mfa-required' || outcome === 'rejected') {
    return outcome;
  }
  return 'rejected';
}

function readProbeErrorCode(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && value !== null && 'code' in value) {
    const code = (value as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function safeEnrolledFactorCount(
  source: { enrolledFactorCount?: unknown } | null | undefined,
): number {
  const count = source?.enrolledFactorCount;
  return Number.isInteger(count) && typeof count === 'number' && count >= 0 ? count : 0;
}

async function readSecondFactorClaimPresent(
  snapshot: GooglePopupProbeUserSnapshot | null,
): Promise<boolean> {
  if (!snapshot) {
    return false;
  }
  try {
    const result = await snapshot.getIdTokenResult(false);
    return secondFactorClaimPresent(result.signInSecondFactor);
  } catch {
    return false;
  }
}

function closedProbePayload(event: GooglePopupProbeEvent): GooglePopupProbeEvent {
  const payload: GooglePopupProbeEvent = {
    event: 'popup-result',
    outcome: sanitizeOutcome(event.outcome),
    currentUserPresent: event.currentUserPresent === true,
    enrolledFactorCount: safeEnrolledFactorCount(event),
    secondFactorClaimPresent: event.secondFactorClaimPresent === true,
  };
  if (payload.outcome !== 'resolved') {
    payload.errorCode = sanitizeGooglePopupProbeErrorCode(event.errorCode);
  }
  return payload;
}

function defaultLog(line: string): void {
  console.info(line);
}
