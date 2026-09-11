import { TestBed } from '@angular/core/testing';
import { FactorId, type MultiFactorInfo, type MultiFactorResolver } from 'firebase/auth';
import { QrCodeService } from './qr-code.service';
import {
  AUTH_ERROR_CODE_EXPIRED,
  AUTH_ERROR_INVALID_OTP,
  AUTH_ERROR_MFA_REQUIRED,
  AUTH_ERROR_MISSING_MFA_INFO,
  TOTP_ENROLLMENT_EXPIRED_CODE,
  TOTP_FORMAT_MESSAGE,
  TOTP_INVALID_FORMAT_CODE,
  TOTP_NO_HINT_MESSAGE,
  TOTP_RESTART_MESSAGE,
  TOTP_RETRY_MESSAGE,
  TotpMfaError,
  TotpMfaService,
  classifyTotpErrorCode,
  createTotpChallengeSession,
  hasEnrolledTotpAfterReload,
  hasTotpFactor,
  isMultiFactorAuthRequired,
  isSixDigitTotpCode,
  normalizeTotpCode,
  readEnrollmentDeadlineMs,
  requireOpenEnrollmentDeadline,
  requireSixDigitTotpCode,
  selectTotpHint,
  toTotpMfaError,
} from './totp-mfa.service';

function hint(factorId: string, uid: string, displayName?: string): MultiFactorInfo {
  return { factorId, uid, displayName, enrollmentTime: '' } as MultiFactorInfo;
}

describe('TOTP MFA guards', () => {
  it('normalizes spaced six-digit codes and rejects other input', () => {
    expect(normalizeTotpCode(' 12 34 56 ')).toBe('123456');
    expect(isSixDigitTotpCode('12 34 56')).toBe(true);
    expect(isSixDigitTotpCode('12345')).toBe(false);
    expect(isSixDigitTotpCode('1234567')).toBe(false);
    expect(requireSixDigitTotpCode('98 7654')).toBe('987654');
    expect(() => requireSixDigitTotpCode('abc')).toThrow(TotpMfaError);
    try {
      requireSixDigitTotpCode('12');
    } catch (error) {
      expect(error).toBeInstanceOf(TotpMfaError);
      expect(error).toMatchObject({
        kind: 'retry',
        code: TOTP_INVALID_FORMAT_CODE,
        message: TOTP_FORMAT_MESSAGE,
      });
    }
  });

  it('detects TOTP factors and selects only a TOTP hint', () => {
    const totp = hint(FactorId.TOTP, 'totp-1', 'Authenticator');
    const phone = hint(FactorId.PHONE, 'phone-1');

    expect(hasTotpFactor([])).toBe(false);
    expect(hasTotpFactor([phone])).toBe(false);
    expect(hasTotpFactor([phone, totp])).toBe(true);
    expect(selectTotpHint([phone, totp])).toEqual(totp);
    expect(selectTotpHint([phone])).toBeNull();
  });

  it('classifies invalid and expired codes as retryable', () => {
    expect(classifyTotpErrorCode(AUTH_ERROR_INVALID_OTP)).toBe('retry');
    expect(classifyTotpErrorCode(AUTH_ERROR_CODE_EXPIRED)).toBe('retry');
    expect(classifyTotpErrorCode(TOTP_INVALID_FORMAT_CODE)).toBe('retry');
    expect(classifyTotpErrorCode('auth/invalid-multi-factor-session')).toBe('restart');
    expect(classifyTotpErrorCode('auth/too-many-requests')).toBe('restart');
  });

  it('maps SDK errors to visible retry or restart TotpMfaError values', () => {
    const retry = toTotpMfaError({ code: AUTH_ERROR_INVALID_OTP });
    expect(retry.kind).toBe('retry');
    expect(retry.message).toBe(TOTP_RETRY_MESSAGE);
    expect(retry.code).toBe(AUTH_ERROR_INVALID_OTP);

    const expired = toTotpMfaError({ code: AUTH_ERROR_CODE_EXPIRED });
    expect(expired.kind).toBe('retry');
    expect(expired.message).toBe(TOTP_RETRY_MESSAGE);

    const restart = toTotpMfaError({ code: 'auth/invalid-multi-factor-session' });
    expect(restart.kind).toBe('restart');
    expect(restart.message).toBe(TOTP_RESTART_MESSAGE);

    const original = new TotpMfaError('retry', AUTH_ERROR_INVALID_OTP, TOTP_RETRY_MESSAGE);
    expect(toTotpMfaError(original)).toBe(original);
  });

  it('treats only auth/multi-factor-auth-required as an MFA challenge', () => {
    expect(isMultiFactorAuthRequired({ code: AUTH_ERROR_MFA_REQUIRED })).toBe(true);
    expect(isMultiFactorAuthRequired({ code: 'auth/popup-closed-by-user' })).toBe(false);
    expect(isMultiFactorAuthRequired(new Error('nope'))).toBe(false);
  });

  it('builds a challenge session from the first TOTP hint', () => {
    const totp = hint(FactorId.TOTP, 'totp-1', 'Work phone');
    const resolver = {
      hints: [hint(FactorId.PHONE, 'phone-1'), totp],
      session: {},
      resolveSignIn: vi.fn(),
    } as unknown as MultiFactorResolver;

    expect(createTotpChallengeSession(resolver, 'user@example.com')).toEqual({
      resolver,
      hint: totp,
      email: 'user@example.com',
      hintDisplayName: 'Work phone',
    });
  });

  it('enforces a parseable enrollment deadline and ignores invalid ones', () => {
    const now = Date.parse('2026-09-11T00:00:00.000Z');

    expect(readEnrollmentDeadlineMs('')).toBeNull();
    expect(readEnrollmentDeadlineMs('not-a-date')).toBeNull();
    expect(readEnrollmentDeadlineMs('2026-09-11T00:00:00.000Z')).toBe(now);
    expect(() => requireOpenEnrollmentDeadline('', now)).not.toThrow();
    expect(() => requireOpenEnrollmentDeadline('not-a-date', now)).not.toThrow();
    expect(() => requireOpenEnrollmentDeadline('2026-09-12T00:00:00.000Z', now)).not.toThrow();
    try {
      requireOpenEnrollmentDeadline('2026-09-11T00:00:00.000Z', now);
      throw new Error('expected expired deadline to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(TotpMfaError);
      expect(error).toMatchObject({
        kind: 'restart',
        code: TOTP_ENROLLMENT_EXPIRED_CODE,
        message: TOTP_RESTART_MESSAGE,
      });
    }
  });

  it('reloads the user before accepting an already-enrolled TOTP factor', async () => {
    const order: string[] = [];

    await expect(
      hasEnrolledTotpAfterReload(
        async () => {
          order.push('reload');
        },
        () => {
          order.push('check');
          return true;
        },
      ),
    ).resolves.toBe(true);
    expect(order).toEqual(['reload', 'check']);
    await expect(
      hasEnrolledTotpAfterReload(
        async () => undefined,
        () => false,
      ),
    ).resolves.toBe(false);
  });

  it('fails closed when the resolver has no TOTP hint', () => {
    const resolver = {
      hints: [hint(FactorId.PHONE, 'phone-1')],
      session: {},
      resolveSignIn: vi.fn(),
    } as unknown as MultiFactorResolver;

    expect(() => createTotpChallengeSession(resolver)).toThrow(
      new TotpMfaError('restart', AUTH_ERROR_MISSING_MFA_INFO, TOTP_NO_HINT_MESSAGE),
    );
  });
});

describe('TotpMfaService', () => {
  it('is provided and uses QrCodeService when constructed', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: QrCodeService, useValue: { toDataUrl: vi.fn() } }],
    });

    expect(TestBed.inject(TotpMfaService)).toBeTruthy();
  });
});
