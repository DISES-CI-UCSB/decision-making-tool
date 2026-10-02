import { Injectable, inject } from '@angular/core';
import {
  FactorId,
  TotpMultiFactorGenerator,
  getMultiFactorResolver,
  multiFactor,
  type Auth,
  type AuthError,
  type MultiFactorError,
  type MultiFactorInfo,
  type MultiFactorResolver,
  type TotpSecret,
  type User,
  type UserCredential,
} from 'firebase/auth';
import { environment } from '../../../../environments/environment';
import { shouldRunTotpEnrollmentDiagnostic } from './totp-enrollment-diagnostic';
import {
  emitTotpProbeEvent,
  enrollmentConfirmedFromProbe,
  enrollResultFromThrown,
  persistenceLookupEvent,
  probeEnrollmentPersistence,
  summarizeLocalFactorCheck,
} from './totp-enrollment-probe';
import { QrCodeService } from './qr-code.service';

export const AUTH_ERROR_MFA_REQUIRED = 'auth/multi-factor-auth-required';
export const AUTH_ERROR_INVALID_OTP = 'auth/invalid-verification-code';
export const AUTH_ERROR_INVALID_VERIFICATION_ID = 'auth/invalid-verification-id';
export const AUTH_ERROR_CODE_EXPIRED = 'auth/code-expired';
export const AUTH_ERROR_REQUIRES_RECENT_LOGIN = 'auth/requires-recent-login';
export const AUTH_ERROR_USER_TOKEN_EXPIRED = 'auth/user-token-expired';
export const AUTH_ERROR_MISSING_MFA_INFO = 'auth/missing-multi-factor-info';
export const AUTH_ERROR_SECOND_FACTOR_ALREADY_ENROLLED = 'auth/second-factor-already-in-use';
export const TOTP_ENROLLMENT_EXPIRED_CODE = 'totp/enrollment-expired';

export const TOTP_ISSUER = 'Eco Plan Tool';
export const TOTP_DISPLAY_NAME = 'Authenticator app';
export const TOTP_INVALID_FORMAT_CODE = 'totp/invalid-format';

export function totpAccountLabel(accountName: string, issuer = TOTP_ISSUER): string {
  const trimmed = accountName.trim();
  if (!trimmed || trimmed === issuer || trimmed.startsWith(`${issuer} (`)) {
    return trimmed || issuer;
  }
  return `${issuer} (${trimmed})`;
}

export interface TotpOtpauthInput {
  issuer: string;
  accountName: string;
  secretKey: string;
  algorithm: string;
  digits: number;
  periodSeconds: number;
}

export function buildTotpOtpauthUri(input: TotpOtpauthInput): string {
  const issuer = input.issuer.trim() || TOTP_ISSUER;
  const accountName = input.accountName.trim() || 'unknownuser';
  // Duo Mobile splits a path on ":" and then drops a percent-encoded issuer
  // prefix, so "Issuer:email" shows only the email. The visible label is
  // "Eco Plan Tool (email)" with no colon. The issuer query still names the
  // product for other authenticator apps. otpauth has no logo Duo will use.
  const label = totpAccountLabel(accountName, issuer);
  const query = [
    ['secret', input.secretKey],
    ['issuer', issuer],
    ['algorithm', (input.algorithm || 'SHA1').toUpperCase()],
    ['digits', String(input.digits || 6)],
    ['period', String(input.periodSeconds || 30)],
  ]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return `otpauth://totp/${encodeURIComponent(label)}?${query}`;
}

/**
 * Reuse the in-memory enrollment for this uid, including after
 * `enrollmentCompletionDeadline`. Submit still rejects an expired secret and
 * moves the modal into recovery; only `forgetOpenEnrollment` drops the cache
 * so a replacement QR can be minted. A different uid never receives another
 * user's session. A full page reload drops this cache. The secret is not persisted.
 */
export function reuseOpenEnrollment<T>(
  cached: { uid: string; session: T } | null,
  uid: string,
): T | null {
  if (!cached || cached.uid !== uid) {
    return null;
  }
  return cached.session;
}

export const TOTP_RETRY_MESSAGE =
  'That code was incorrect or expired. Try the current 6-digit code.';
export const TOTP_FORMAT_MESSAGE = 'Enter the 6-digit code from your authenticator app.';
export const TOTP_NO_HINT_MESSAGE =
  'This account needs an authenticator app. SMS is not supported.';
export const TOTP_RESTART_MESSAGE = 'This sign-in challenge expired. Sign in with Google again.';
export const TOTP_USER_TOKEN_EXPIRED_MESSAGE =
  'This sign-in expired. Sign in with Google again to continue authenticator setup.';
export const TOTP_ENROLLMENT_UNCONFIRMED_CODE = 'totp/enrollment-unconfirmed';
export const TOTP_ENROLLMENT_UNCONFIRMED_MESSAGE =
  'The authenticator code was not confirmed yet. Keep this QR code and enter the current 6-digit code again.';
export const TOTP_ENROLLMENT_REPLACE_WARNING =
  'Creating a new QR code stops the Eco Plan Tool entry already in Duo Mobile from working.';
export const TOTP_ENROLLMENT_REPLACE_REQUIRED_MESSAGE =
  'This authenticator setup can no longer be confirmed. Create a new QR code to replace it.';
export const TOTP_RECENT_LOGIN_MESSAGE =
  'Google confirmed this sign-in. The same QR code is still valid. Enter the current 6-digit code.';
export const TOTP_RECENT_LOGIN_FAILED_MESSAGE =
  'Google needs a fresh sign-in before this authenticator can be saved. The same QR code is still valid. Try again, then enter the current code.';
export const TOTP_ALREADY_ENROLLED_CODE = 'totp/already-enrolled';
export const TOTP_ALREADY_ENROLLED_MESSAGE =
  'This account already has an authenticator app. Continue signing in.';

export type TotpErrorKind = 'retry' | 'restart' | 'recover';

export class TotpMfaError extends Error {
  readonly kind: TotpErrorKind;
  readonly code: string;

  constructor(kind: TotpErrorKind, code: string, message: string) {
    super(message);
    this.name = 'TotpMfaError';
    this.kind = kind;
    this.code = code;
  }
}

export interface TotpEnrollmentSession {
  readonly secret: TotpSecret;
  readonly qrCodeUrl: string;
  readonly qrCodeDataUrl: string;
  readonly secretKey: string;
  readonly accountName: string;
  readonly issuer: string;
  readonly enrollmentCompletionDeadline: string;
  readonly codeLength: number;
  readonly codeIntervalSeconds: number;
}

export interface TotpChallengeSession {
  readonly resolver: MultiFactorResolver;
  readonly hint: MultiFactorInfo;
  readonly email?: string;
  readonly hintDisplayName?: string | null;
}

export function isAuthError(error: unknown): error is AuthError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  );
}

export function isMultiFactorAuthRequired(error: unknown): error is MultiFactorError {
  return isAuthError(error) && error.code === AUTH_ERROR_MFA_REQUIRED;
}

export function isTotpMfaError(error: unknown): error is TotpMfaError {
  return error instanceof TotpMfaError;
}

const TOTP_SUPPORT_CODE_PATTERN = /^(auth|totp)\/[a-z0-9-]+$/;

/** Firebase or app error code safe to show in the enrollment banner. */
export function totpSupportCode(code: string | null | undefined): string | null {
  if (!code || !TOTP_SUPPORT_CODE_PATTERN.test(code)) {
    return null;
  }
  return code;
}

export function normalizeTotpCode(otp: string): string {
  return otp.replace(/\s+/g, '');
}

export function isSixDigitTotpCode(otp: string): boolean {
  return /^\d{6}$/.test(normalizeTotpCode(otp));
}

export function requireSixDigitTotpCode(otp: string): string {
  const code = normalizeTotpCode(otp);
  if (!isSixDigitTotpCode(code)) {
    throw new TotpMfaError('retry', TOTP_INVALID_FORMAT_CODE, TOTP_FORMAT_MESSAGE);
  }
  return code;
}

export function hasTotpFactor(factors: readonly MultiFactorInfo[]): boolean {
  return factors.some((factor) => factor.factorId === FactorId.TOTP);
}

/** Cached ID token only. Never force-refresh. */
export async function hasTotpSecondFactorClaim(user: {
  getIdTokenResult: (forceRefresh?: boolean) => Promise<{ signInSecondFactor?: string | null }>;
}): Promise<boolean> {
  try {
    const result = await user.getIdTokenResult(false);
    return result.signInSecondFactor === 'totp';
  } catch {
    return false;
  }
}

export function selectTotpHint(hints: readonly MultiFactorInfo[]): MultiFactorInfo | null {
  return hints.find((hint) => hint.factorId === FactorId.TOTP) ?? null;
}

export function classifyTotpErrorCode(code: string): TotpErrorKind {
  if (code === TOTP_ENROLLMENT_UNCONFIRMED_CODE || code === TOTP_ENROLLMENT_EXPIRED_CODE) {
    return 'recover';
  }
  if (
    code === AUTH_ERROR_INVALID_OTP ||
    code === AUTH_ERROR_INVALID_VERIFICATION_ID ||
    code === AUTH_ERROR_CODE_EXPIRED ||
    code === AUTH_ERROR_REQUIRES_RECENT_LOGIN ||
    code === TOTP_INVALID_FORMAT_CODE
  ) {
    return 'retry';
  }
  if (code === AUTH_ERROR_USER_TOKEN_EXPIRED) {
    return 'restart';
  }
  return 'restart';
}

export function totpErrorMessage(code: string, kind: TotpErrorKind): string {
  if (code === AUTH_ERROR_REQUIRES_RECENT_LOGIN) {
    return TOTP_RECENT_LOGIN_FAILED_MESSAGE;
  }
  if (code === AUTH_ERROR_USER_TOKEN_EXPIRED) {
    return TOTP_USER_TOKEN_EXPIRED_MESSAGE;
  }
  if (code === TOTP_ENROLLMENT_UNCONFIRMED_CODE) {
    return TOTP_ENROLLMENT_UNCONFIRMED_MESSAGE;
  }
  if (code === TOTP_ENROLLMENT_EXPIRED_CODE) {
    return TOTP_ENROLLMENT_REPLACE_REQUIRED_MESSAGE;
  }
  if (code === TOTP_INVALID_FORMAT_CODE) {
    return TOTP_FORMAT_MESSAGE;
  }
  return kind === 'retry' ? TOTP_RETRY_MESSAGE : TOTP_RESTART_MESSAGE;
}

export function toTotpMfaError(error: unknown): TotpMfaError {
  if (error instanceof TotpMfaError) {
    return error;
  }
  const code = isAuthError(error) ? error.code : 'auth/internal-error';
  const kind = classifyTotpErrorCode(code);
  return new TotpMfaError(kind, code, totpErrorMessage(code, kind));
}

export function readEnrollmentDeadlineMs(deadline: string): number | null {
  const expiresAt = Date.parse(deadline);
  return Number.isFinite(expiresAt) ? expiresAt : null;
}

export function requireOpenEnrollmentDeadline(deadline: string, nowMs = Date.now()): void {
  const expiresAt = readEnrollmentDeadlineMs(deadline);
  if (expiresAt !== null && nowMs >= expiresAt) {
    throw new TotpMfaError(
      'recover',
      TOTP_ENROLLMENT_EXPIRED_CODE,
      TOTP_ENROLLMENT_REPLACE_REQUIRED_MESSAGE,
    );
  }
}

export function canBeginTotpEnrollment(enrolledAfterRefresh: boolean): boolean {
  return !enrolledAfterRefresh;
}

export function requireVisibleTotpEnrollment(enrolledAfterRefresh: boolean): void {
  if (!enrolledAfterRefresh) {
    throw new TotpMfaError(
      'recover',
      TOTP_ENROLLMENT_UNCONFIRMED_CODE,
      TOTP_ENROLLMENT_UNCONFIRMED_MESSAGE,
    );
  }
}

/**
 * Confirmed enrollment clears the open session. Unconfirmed enrollment stays
 * locked. A development diagnostic cannot change either result.
 */
export async function applyTotpEnrollmentResult(input: {
  production: boolean;
  enrolledAfterRefresh: boolean;
  diagnoseUnconfirmed: () => Promise<void>;
  forgetEnrollment: () => void;
}): Promise<void> {
  if (shouldRunTotpEnrollmentDiagnostic(input.production, input.enrolledAfterRefresh)) {
    try {
      await input.diagnoseUnconfirmed();
    } catch {
      // A diagnostic failure must not change the locked enrollment result.
    }
  }
  requireVisibleTotpEnrollment(input.enrolledAfterRefresh);
  input.forgetEnrollment();
}

export async function hasEnrolledTotpAfterFactorRefresh(
  forceRefreshIdToken: () => Promise<void>,
  reload: () => Promise<void>,
  hasEnrolledTotp: () => boolean,
): Promise<boolean> {
  await forceRefreshIdToken();
  await reload();
  return hasEnrolledTotp();
}

/**
 * Successful `enroll()` updates user tokens and revokes existing refresh
 * tokens. Confirm from the SDK factor list first, then `reload()` with that
 * new ID token. Do not call `getIdToken(true)` here.
 */
export async function hasEnrolledTotpAfterEnrollment(
  hasEnrolledTotp: () => boolean,
  reload: () => Promise<void>,
): Promise<boolean> {
  if (hasEnrolledTotp()) {
    return true;
  }
  await reload();
  return hasEnrolledTotp();
}

export function createTotpChallengeSession(
  resolver: MultiFactorResolver,
  email?: string,
): TotpChallengeSession {
  const hint = selectTotpHint(resolver.hints);
  if (!hint) {
    throw new TotpMfaError('restart', AUTH_ERROR_MISSING_MFA_INFO, TOTP_NO_HINT_MESSAGE);
  }
  return {
    resolver,
    hint,
    email,
    hintDisplayName: hint.displayName,
  };
}

@Injectable({ providedIn: 'root' })
export class TotpMfaService {
  private readonly qrCode = inject(QrCodeService);
  /**
   * In-memory open enrollment for this app session. Deadline expiry does not
   * clear it. A full page reload does, and the secret is never persisted.
   */
  private openEnrollment: { uid: string; session: TotpEnrollmentSession } | null = null;
  private unconfirmedEnrollmentUid: string | null = null;
  private enrollmentInProgressUid: string | null = null;
  private factorReadFlights = new Map<string, Promise<boolean>>();

  hasEnrolledTotp(user: User | null): boolean {
    return user !== null && hasTotpFactor(multiFactor(user).enrolledFactors);
  }

  markEnrollmentInProgress(uid: string): void {
    this.enrollmentInProgressUid = uid;
  }

  clearEnrollmentInProgress(uid?: string): void {
    if (!uid || this.enrollmentInProgressUid === uid) {
      this.enrollmentInProgressUid = null;
    }
  }

  isEnrollmentHeld(uid: string): boolean {
    return this.enrollmentInProgressUid === uid || this.openEnrollment?.uid === uid;
  }

  async userHasEnrolledTotp(user: User): Promise<boolean> {
    // Returning-user and admin-removed-factor reads cannot trust the cached
    // list. Force a token refresh, reload, then read. Concurrent callers for
    // the same uid share one in-flight refresh.
    const existing = this.factorReadFlights.get(user.uid);
    if (existing) {
      return existing;
    }
    const flight = hasEnrolledTotpAfterFactorRefresh(
      async () => {
        await user.getIdToken(true);
      },
      () => user.reload(),
      () => this.hasEnrolledTotp(user),
    );
    const tracked = flight.finally(() => {
      if (this.factorReadFlights.get(user.uid) === tracked) {
        this.factorReadFlights.delete(user.uid);
      }
    });
    this.factorReadFlights.set(user.uid, tracked);
    return tracked;
  }

  async confirmEnrolledTotp(user: User): Promise<boolean> {
    return hasEnrolledTotpAfterEnrollment(
      () => this.hasEnrolledTotp(user),
      () => user.reload(),
    );
  }

  createAssertionSession(auth: Auth, error: MultiFactorError): TotpChallengeSession {
    return createTotpChallengeSession(getMultiFactorResolver(auth, error), error.customData.email);
  }

  async completeChallenge(session: TotpChallengeSession, otp: string): Promise<UserCredential> {
    const code = requireSixDigitTotpCode(otp);
    try {
      return await session.resolver.resolveSignIn(
        TotpMultiFactorGenerator.assertionForSignIn(session.hint.uid, code),
      );
    } catch (error) {
      throw toTotpMfaError(error);
    }
  }

  openEnrollmentFor(user: User): TotpEnrollmentSession | null {
    return reuseOpenEnrollment(this.openEnrollment, user.uid);
  }

  forgetOpenEnrollment(uid?: string): void {
    if (!uid || this.openEnrollment?.uid === uid) {
      this.openEnrollment = null;
    }
    if (!uid || this.unconfirmedEnrollmentUid === uid) {
      this.unconfirmedEnrollmentUid = null;
    }
    this.clearEnrollmentInProgress(uid);
  }

  rememberOpenEnrollment(user: User, session: TotpEnrollmentSession): void {
    this.openEnrollment = { uid: user.uid, session };
  }

  markEnrollmentUnconfirmed(uid: string): void {
    this.unconfirmedEnrollmentUid = uid;
  }

  enrollmentNeedsRecovery(uid: string): boolean {
    return this.unconfirmedEnrollmentUid === uid;
  }

  async beginEnrollment(
    user: User,
    accountName: string,
    options?: { skipEnrolledCheck?: boolean },
  ): Promise<TotpEnrollmentSession> {
    this.markEnrollmentInProgress(user.uid);
    if (
      !options?.skipEnrolledCheck &&
      !canBeginTotpEnrollment(await this.userHasEnrolledTotp(user))
    ) {
      this.forgetOpenEnrollment(user.uid);
      throw new TotpMfaError('restart', TOTP_ALREADY_ENROLLED_CODE, TOTP_ALREADY_ENROLLED_MESSAGE);
    }
    const existing = this.openEnrollmentFor(user);
    if (existing) {
      return existing;
    }
    const rawAccount = accountName.trim();
    const secret = await TotpMultiFactorGenerator.generateSecret(
      await multiFactor(user).getSession(),
    );
    const qrCodeUrl = buildTotpOtpauthUri({
      issuer: TOTP_ISSUER,
      accountName: rawAccount,
      secretKey: secret.secretKey,
      algorithm: secret.hashingAlgorithm,
      digits: secret.codeLength,
      periodSeconds: secret.codeIntervalSeconds,
    });
    const session: TotpEnrollmentSession = {
      secret,
      qrCodeUrl,
      qrCodeDataUrl: this.qrCode.toDataUrl(qrCodeUrl),
      secretKey: secret.secretKey,
      accountName: rawAccount,
      issuer: TOTP_ISSUER,
      enrollmentCompletionDeadline: secret.enrollmentCompletionDeadline,
      codeLength: secret.codeLength,
      codeIntervalSeconds: secret.codeIntervalSeconds,
    };
    this.openEnrollment = { uid: user.uid, session };
    return session;
  }

  async completeEnrollment(user: User, session: TotpEnrollmentSession, otp: string): Promise<void> {
    requireOpenEnrollmentDeadline(session.enrollmentCompletionDeadline);
    const code = requireSixDigitTotpCode(otp);
    const production = environment.production;
    emitTotpProbeEvent(production, { event: 'enroll-start' });
    try {
      await multiFactor(user).enroll(
        TotpMultiFactorGenerator.assertionForEnrollment(session.secret, code),
        TOTP_DISPLAY_NAME,
      );
    } catch (error) {
      emitTotpProbeEvent(production, enrollResultFromThrown(error));
      if (isAuthError(error) && error.code === AUTH_ERROR_SECOND_FACTOR_ALREADY_ENROLLED) {
        if (await this.userHasEnrolledTotp(user)) {
          this.forgetOpenEnrollment(user.uid);
          return;
        }
      }
      throw toTotpMfaError(error);
    }
    emitTotpProbeEvent(production, { event: 'enroll-result', outcome: 'ok' });
    const localEnrolled = await this.confirmEnrolledTotp(user);
    emitTotpProbeEvent(production, summarizeLocalFactorCheck(multiFactor(user).enrolledFactors));
    const lookup = await probeEnrollmentPersistence({
      apiKey: environment.firebase.config.apiKey,
      currentUid: user.uid,
      getIdToken: (forceRefresh) => user.getIdToken(forceRefresh),
    });
    emitTotpProbeEvent(production, persistenceLookupEvent(lookup));
    await applyTotpEnrollmentResult({
      production,
      enrolledAfterRefresh: enrollmentConfirmedFromProbe(production, localEnrolled, lookup),
      diagnoseUnconfirmed: async () => undefined,
      forgetEnrollment: () => this.forgetOpenEnrollment(user.uid),
    });
  }
}
