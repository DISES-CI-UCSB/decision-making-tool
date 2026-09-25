/**
 * Development-only identity-context probe.
 * Console lines use a fixed prefix and a closed JSON schema. Tokens, claims
 * objects, UIDs, emails, API keys, OTP codes, QR secrets, factor IDs,
 * enrollment IDs, and raw Firebase payloads never leave this module.
 */

export const IDENTITY_CONTEXT_PROBE_LOG_PREFIX = '[Auth][Identity context probe]';

const MAX_PROBE_LINE_LENGTH = 4000;
const SAFE_SIGN_IN_PROVIDERS = new Set(['anonymous', 'custom', 'google.com', 'password', 'phone']);
const SAFE_SECOND_FACTORS = new Set(['phone', 'totp']);
const UNSAFE_PROBE_TEXT =
  /@|eyJ[A-Za-z0-9_-]{8,}|BEGIN |idToken|refreshToken|sessionInfo|secretKey|private_key|otpauth/i;

export type IdentityContextSignInProvider =
  | 'anonymous'
  | 'custom'
  | 'google.com'
  | 'password'
  | 'phone';

export interface IdentityContextProbeEvent {
  event: 'identity-context';
  audMatchesConfiguredProject: boolean;
  subjectMatchesCurrentUser: boolean;
  tokenTenantPresent: boolean;
  authTenantPresent: boolean;
  signInProvider: IdentityContextSignInProvider | null;
  secondFactorClaimPresent: boolean;
  localEnrolledFactorCount: number;
}

/**
 * Narrow user snapshot for the probe. Must not include token, email, factor
 * IDs, or a claims object beyond getIdTokenResult's cached result.
 */
export interface IdentityContextProbeUser {
  uid?: unknown;
  tenantId?: unknown;
  multiFactor?: { enrolledFactors?: unknown };
  getIdTokenResult?: (forceRefresh: boolean) => Promise<unknown>;
}

export interface IdentityContextProbeSource {
  configuredProjectId: string;
  currentUid: string;
  authTenantId: string | null;
  localEnrolledFactorCount: number;
  getIdTokenResult: (forceRefresh: boolean) => Promise<unknown>;
}

export function isSafeIdentityContextProbeLine(line: string): boolean {
  return (
    line.startsWith(`${IDENTITY_CONTEXT_PROBE_LOG_PREFIX} `) &&
    line.length <= MAX_PROBE_LINE_LENGTH &&
    !UNSAFE_PROBE_TEXT.test(line)
  );
}

export function allowlistedSignInProvider(value: unknown): IdentityContextSignInProvider | null {
  return typeof value === 'string' && SAFE_SIGN_IN_PROVIDERS.has(value)
    ? (value as IdentityContextSignInProvider)
    : null;
}

export function secondFactorClaimPresent(value: unknown): boolean {
  return typeof value === 'string' && SAFE_SECOND_FACTORS.has(value);
}

export function toIdentityContextProbeSource(
  user: IdentityContextProbeUser | null | undefined,
  authTenantId: string | null | undefined,
  configuredProjectId: string,
): IdentityContextProbeSource | null {
  if (!user) {
    return null;
  }
  return {
    configuredProjectId: typeof configuredProjectId === 'string' ? configuredProjectId : '',
    currentUid: readNonEmptyString(user.uid),
    authTenantId: firstNonEmptyString(authTenantId, user.tenantId),
    localEnrolledFactorCount: readLocalEnrolledFactorCount(user),
    getIdTokenResult: async (forceRefresh: boolean) => {
      if (typeof user.getIdTokenResult !== 'function') {
        return {};
      }
      return user.getIdTokenResult(forceRefresh);
    },
  };
}

export function formatIdentityContextProbeLine(event: IdentityContextProbeEvent): string {
  return `${IDENTITY_CONTEXT_PROBE_LOG_PREFIX} ${JSON.stringify(closedProbePayload(event))}`;
}

export async function collectIdentityContextProbeEvent(
  source: IdentityContextProbeSource,
): Promise<IdentityContextProbeEvent> {
  const tokenScalars = await readSafeTokenScalars(
    source,
    source.currentUid,
    source.configuredProjectId,
  );
  return closedProbePayload({
    event: 'identity-context',
    audMatchesConfiguredProject: tokenScalars.audMatchesConfiguredProject,
    subjectMatchesCurrentUser: tokenScalars.subjectMatchesCurrentUser,
    tokenTenantPresent: tokenScalars.tokenTenantPresent,
    authTenantPresent: readNonEmptyString(source.authTenantId).length > 0,
    signInProvider: tokenScalars.signInProvider,
    secondFactorClaimPresent: tokenScalars.secondFactorClaimPresent,
    localEnrolledFactorCount: source.localEnrolledFactorCount,
  });
}

export async function emitIdentityContextProbe(
  production: boolean,
  source:
    | (() => IdentityContextProbeSource | null | undefined)
    | IdentityContextProbeSource
    | null
    | undefined,
  log?: (line: string) => void,
): Promise<void> {
  if (production) {
    return;
  }
  try {
    const resolved = typeof source === 'function' ? source() : source;
    if (!resolved) {
      return;
    }
    const line = formatIdentityContextProbeLine(await collectIdentityContextProbeEvent(resolved));
    const write = log ?? defaultLog;
    if (!isSafeIdentityContextProbeLine(line)) {
      write(`${IDENTITY_CONTEXT_PROBE_LOG_PREFIX} {"event":"unavailable"}`);
      return;
    }
    write(line);
  } catch {
    // Probe output must not change auth readiness or gating.
  }
}

function closedProbePayload(event: IdentityContextProbeEvent): IdentityContextProbeEvent {
  return {
    event: 'identity-context',
    audMatchesConfiguredProject: event.audMatchesConfiguredProject === true,
    subjectMatchesCurrentUser: event.subjectMatchesCurrentUser === true,
    tokenTenantPresent: event.tokenTenantPresent === true,
    authTenantPresent: event.authTenantPresent === true,
    signInProvider: allowlistedSignInProvider(event.signInProvider),
    secondFactorClaimPresent: event.secondFactorClaimPresent === true,
    localEnrolledFactorCount: safeEnrolledFactorCount(event.localEnrolledFactorCount),
  };
}

async function readSafeTokenScalars(
  source: Pick<IdentityContextProbeSource, 'getIdTokenResult'>,
  currentUid: string,
  projectId: string,
): Promise<
  Pick<
    IdentityContextProbeEvent,
    | 'audMatchesConfiguredProject'
    | 'subjectMatchesCurrentUser'
    | 'tokenTenantPresent'
    | 'signInProvider'
    | 'secondFactorClaimPresent'
  >
> {
  try {
    const result = await source.getIdTokenResult(false);
    const record = isRecord(result) ? result : {};
    const claims = isRecord(record['claims']) ? record['claims'] : {};
    const firebase = isRecord(claims['firebase']) ? claims['firebase'] : {};
    return {
      audMatchesConfiguredProject: audienceMatches(claims['aud'], projectId),
      subjectMatchesCurrentUser: currentUid.length > 0 && claims['sub'] === currentUid,
      tokenTenantPresent: readNonEmptyString(firebase['tenant']).length > 0,
      signInProvider: allowlistedSignInProvider(record['signInProvider']),
      secondFactorClaimPresent: secondFactorClaimPresent(record['signInSecondFactor']),
    };
  } catch {
    return {
      audMatchesConfiguredProject: false,
      subjectMatchesCurrentUser: false,
      tokenTenantPresent: false,
      signInProvider: null,
      secondFactorClaimPresent: false,
    };
  }
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

function readLocalEnrolledFactorCount(user: IdentityContextProbeUser): number {
  try {
    const factors = user.multiFactor?.enrolledFactors;
    return Array.isArray(factors) ? safeEnrolledFactorCount(factors.length) : 0;
  } catch {
    return 0;
  }
}

function safeEnrolledFactorCount(value: unknown): number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 0 ? value : 0;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = readNonEmptyString(value);
    if (text) {
      return text;
    }
  }
  return null;
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultLog(line: string): void {
  console.info(line);
}
