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
import { QrCodeService } from './qr-code.service';

export const AUTH_ERROR_MFA_REQUIRED = 'auth/multi-factor-auth-required';
export const AUTH_ERROR_INVALID_OTP = 'auth/invalid-verification-code';
export const AUTH_ERROR_CODE_EXPIRED = 'auth/code-expired';
export const AUTH_ERROR_MISSING_MFA_INFO = 'auth/missing-multi-factor-info';
export const AUTH_ERROR_SECOND_FACTOR_ALREADY_ENROLLED = 'auth/second-factor-already-in-use';
export const TOTP_ENROLLMENT_EXPIRED_CODE = 'totp/enrollment-expired';

export const TOTP_ISSUER = 'Decision Making Tool';
export const TOTP_DISPLAY_NAME = 'Authenticator app';
export const TOTP_INVALID_FORMAT_CODE = 'totp/invalid-format';

export const TOTP_RETRY_MESSAGE =
  'That code was incorrect or expired. Try the current 6-digit code.';
export const TOTP_FORMAT_MESSAGE = 'Enter the 6-digit code from your authenticator app.';
export const TOTP_NO_HINT_MESSAGE =
  'This account needs an authenticator app. SMS is not supported.';
export const TOTP_RESTART_MESSAGE = 'This sign-in challenge expired. Sign in with Google again.';

export type TotpErrorKind = 'retry' | 'restart';

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

export function selectTotpHint(hints: readonly MultiFactorInfo[]): MultiFactorInfo | null {
  return hints.find((hint) => hint.factorId === FactorId.TOTP) ?? null;
}

export function classifyTotpErrorCode(code: string): TotpErrorKind {
  if (
    code === AUTH_ERROR_INVALID_OTP ||
    code === AUTH_ERROR_CODE_EXPIRED ||
    code === TOTP_INVALID_FORMAT_CODE
  ) {
    return 'retry';
  }
  return 'restart';
}

export function toTotpMfaError(error: unknown): TotpMfaError {
  if (error instanceof TotpMfaError) {
    return error;
  }
  const code = isAuthError(error) ? error.code : 'auth/internal-error';
  const kind = classifyTotpErrorCode(code);
  return new TotpMfaError(kind, code, kind === 'retry' ? TOTP_RETRY_MESSAGE : TOTP_RESTART_MESSAGE);
}

export function readEnrollmentDeadlineMs(deadline: string): number | null {
  const expiresAt = Date.parse(deadline);
  return Number.isFinite(expiresAt) ? expiresAt : null;
}

export function requireOpenEnrollmentDeadline(deadline: string, nowMs = Date.now()): void {
  const expiresAt = readEnrollmentDeadlineMs(deadline);
  if (expiresAt !== null && nowMs >= expiresAt) {
    throw new TotpMfaError('restart', TOTP_ENROLLMENT_EXPIRED_CODE, TOTP_RESTART_MESSAGE);
  }
}

export async function hasEnrolledTotpAfterReload(
  reload: () => Promise<void>,
  hasEnrolledTotp: () => boolean,
): Promise<boolean> {
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

  hasEnrolledTotp(user: User | null): boolean {
    return user !== null && hasTotpFactor(multiFactor(user).enrolledFactors);
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

  async beginEnrollment(user: User, accountName: string): Promise<TotpEnrollmentSession> {
    const secret = await TotpMultiFactorGenerator.generateSecret(
      await multiFactor(user).getSession(),
    );
    const qrCodeUrl = secret.generateQrCodeUrl(accountName, TOTP_ISSUER);
    return {
      secret,
      qrCodeUrl,
      qrCodeDataUrl: this.qrCode.toDataUrl(qrCodeUrl),
      secretKey: secret.secretKey,
      accountName,
      issuer: TOTP_ISSUER,
      enrollmentCompletionDeadline: secret.enrollmentCompletionDeadline,
      codeLength: secret.codeLength,
      codeIntervalSeconds: secret.codeIntervalSeconds,
    };
  }

  async completeEnrollment(user: User, session: TotpEnrollmentSession, otp: string): Promise<void> {
    requireOpenEnrollmentDeadline(session.enrollmentCompletionDeadline);
    const code = requireSixDigitTotpCode(otp);
    try {
      await multiFactor(user).enroll(
        TotpMultiFactorGenerator.assertionForEnrollment(session.secret, code),
        TOTP_DISPLAY_NAME,
      );
    } catch (error) {
      if (isAuthError(error) && error.code === AUTH_ERROR_SECOND_FACTOR_ALREADY_ENROLLED) {
        const enrolled = await hasEnrolledTotpAfterReload(
          () => user.reload(),
          () => this.hasEnrolledTotp(user),
        );
        if (enrolled) {
          return;
        }
      }
      throw toTotpMfaError(error);
    }
  }
}
