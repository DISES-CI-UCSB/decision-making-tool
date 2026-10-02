/**
 * Development-only TOTP enrollment persistence probe.
 * Console lines use a fixed prefix and a closed JSON schema. Tokens, emails,
 * OTP codes, secrets, and raw Firebase payloads never leave this module.
 */

import {
  lookupAccountsPersistence,
  sanitizeDiagnosticErrorCode,
  type TotpAccountsLookupRequestDeps,
  type TotpPersistenceLookupResult,
} from './totp-enrollment-diagnostic';

export const TOTP_PROBE_LOG_PREFIX = '[Auth][TOTP probe]';

const MAX_PROBE_LINE_LENGTH = 4000;
const SAFE_FACTOR_IDS = new Set(['phone', 'totp']);
const UNSAFE_PROBE_TEXT =
  /@|eyJ[A-Za-z0-9_-]{8,}|BEGIN |idToken|refreshToken|sessionInfo|secretKey|private_key|otpauth/i;

export type TotpProbeFactorId = 'phone' | 'totp';

export interface TotpProbeEnrollStart {
  event: 'enroll-start';
}

export interface TotpProbeEnrollResult {
  event: 'enroll-result';
  outcome: 'ok' | 'error';
  errorCode?: string;
}

export interface TotpProbeLocalFactorCheck {
  event: 'local-factor-check';
  factorIds: TotpProbeFactorId[];
  factorCount: number;
}

export interface TotpProbePersistenceLookup {
  event: 'persistence-lookup';
  /** Token-based accounts:lookup only. Not a durable Admin user-record read. */
  scope: 'id-token';
  httpStatus: number;
  userCount: number;
  uidMatches: boolean;
  mfaInfoLength: number;
  totpInfoPresent: boolean;
  errorCode?: string;
}

export type TotpProbeEvent =
  | TotpProbeEnrollStart
  | TotpProbeEnrollResult
  | TotpProbeLocalFactorCheck
  | TotpProbePersistenceLookup;

export function isSafeTotpProbeLine(line: string): boolean {
  return (
    line.startsWith(`${TOTP_PROBE_LOG_PREFIX} `) &&
    line.length <= MAX_PROBE_LINE_LENGTH &&
    !UNSAFE_PROBE_TEXT.test(line)
  );
}

export function sanitizeTotpProbeErrorCode(value: unknown): string {
  return sanitizeDiagnosticErrorCode(value);
}

export function enrollResultFromThrown(error: unknown): TotpProbeEnrollResult {
  return {
    event: 'enroll-result',
    outcome: 'error',
    errorCode: sanitizeTotpProbeErrorCode(readAuthErrorCode(error)),
  };
}

export function summarizeLocalFactorCheck(
  factors: readonly { factorId: string }[],
): TotpProbeLocalFactorCheck {
  const factorIds = factors
    .map((factor) => factor.factorId)
    .filter((id): id is TotpProbeFactorId => SAFE_FACTOR_IDS.has(id));
  return {
    event: 'local-factor-check',
    factorIds,
    factorCount: factorIds.length,
  };
}

export function persistenceLookupEvent(
  lookup: TotpPersistenceLookupResult,
): TotpProbePersistenceLookup {
  return {
    event: 'persistence-lookup',
    scope: 'id-token',
    httpStatus: lookup.httpStatus,
    userCount: lookup.userCount,
    uidMatches: lookup.uidMatches,
    mfaInfoLength: lookup.mfaInfoLength,
    totpInfoPresent: lookup.totpInfoPresent,
    ...(lookup.errorCode ? { errorCode: sanitizeTotpProbeErrorCode(lookup.errorCode) } : {}),
  };
}

/**
 * Token-based accounts:lookup is a session-scoped echo. Confirm enrollment
 * from the local reload only. `lookup` stays on the signature so callers can
 * still emit the diagnostic without treating it as durable proof.
 */
export function enrollmentConfirmedFromProbe(
  production: boolean,
  localEnrolled: boolean,
  lookup: Pick<TotpPersistenceLookupResult, 'totpInfoPresent' | 'errorCode'>,
): boolean {
  void production;
  void lookup;
  return localEnrolled;
}

export function formatTotpProbeLine(event: TotpProbeEvent): string {
  return `${TOTP_PROBE_LOG_PREFIX} ${JSON.stringify(closedProbePayload(event))}`;
}

export function emitTotpProbeEvent(
  production: boolean,
  event: TotpProbeEvent,
  log?: (line: string) => void,
): void {
  if (production) {
    return;
  }
  try {
    const line = formatTotpProbeLine(event);
    const write = log ?? defaultLog;
    if (!isSafeTotpProbeLine(line)) {
      write(`${TOTP_PROBE_LOG_PREFIX} {"event":"unavailable"}`);
      return;
    }
    write(line);
  } catch {
    // Probe output must not change the enrollment result.
  }
}

export async function probeEnrollmentPersistence(
  deps: TotpAccountsLookupRequestDeps,
): Promise<TotpPersistenceLookupResult> {
  return lookupAccountsPersistence(deps, false);
}

function closedProbePayload(event: TotpProbeEvent): TotpProbeEvent {
  switch (event.event) {
    case 'enroll-start':
      return { event: 'enroll-start' };
    case 'enroll-result':
      return event.outcome === 'error'
        ? {
            event: 'enroll-result',
            outcome: 'error',
            errorCode: sanitizeTotpProbeErrorCode(event.errorCode),
          }
        : { event: 'enroll-result', outcome: 'ok' };
    case 'local-factor-check':
      return summarizeLocalFactorCheck(event.factorIds.map((factorId) => ({ factorId })));
    case 'persistence-lookup':
      return persistenceLookupEvent(event);
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function readAuthErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function defaultLog(line: string): void {
  console.info(line);
}
