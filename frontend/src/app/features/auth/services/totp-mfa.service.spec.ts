import { TestBed } from '@angular/core/testing';
import * as firebaseAuth from 'firebase/auth';
import { FactorId, type MultiFactorInfo, type MultiFactorResolver, type User } from 'firebase/auth';
import { QrCodeService } from './qr-code.service';
import { TotpEnrollmentDiagnosticService } from './totp-enrollment-diagnostic.service';
import {
  applyTotpEnrollmentResult,
  AUTH_ERROR_CODE_EXPIRED,
  AUTH_ERROR_INVALID_OTP,
  AUTH_ERROR_INVALID_VERIFICATION_ID,
  AUTH_ERROR_MFA_REQUIRED,
  AUTH_ERROR_MISSING_MFA_INFO,
  AUTH_ERROR_REQUIRES_RECENT_LOGIN,
  TOTP_ENROLLMENT_EXPIRED_CODE,
  TOTP_ENROLLMENT_REPLACE_REQUIRED_MESSAGE,
  TOTP_ENROLLMENT_UNCONFIRMED_CODE,
  TOTP_ENROLLMENT_UNCONFIRMED_MESSAGE,
  TOTP_FORMAT_MESSAGE,
  TOTP_INVALID_FORMAT_CODE,
  TOTP_ISSUER,
  TOTP_NO_HINT_MESSAGE,
  TOTP_RECENT_LOGIN_FAILED_MESSAGE,
  TOTP_RESTART_MESSAGE,
  TOTP_RETRY_MESSAGE,
  TotpMfaError,
  TotpMfaService,
  type TotpEnrollmentSession,
  totpAccountLabel,
  classifyTotpErrorCode,
  buildTotpOtpauthUri,
  canBeginTotpEnrollment,
  createTotpChallengeSession,
  hasEnrolledTotpAfterFactorRefresh,
  hasTotpFactor,
  isMultiFactorAuthRequired,
  isSixDigitTotpCode,
  normalizeTotpCode,
  readEnrollmentDeadlineMs,
  requireOpenEnrollmentDeadline,
  requireSixDigitTotpCode,
  requireVisibleTotpEnrollment,
  reuseOpenEnrollment,
  selectTotpHint,
  toTotpMfaError,
  totpSupportCode,
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

  it('shows only auth or totp support codes', () => {
    expect(totpSupportCode('auth/invalid-verification-code')).toBe(
      'auth/invalid-verification-code',
    );
    expect(totpSupportCode('totp/enrollment-unconfirmed')).toBe('totp/enrollment-unconfirmed');
    expect(totpSupportCode('sessionInfo=abc secretKey=MFASECRETKEY otp=123456')).toBeNull();
    expect(totpSupportCode('auth/invalid-verification-code secret=ABCD')).toBeNull();
    expect(totpSupportCode(null)).toBeNull();
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
    expect(classifyTotpErrorCode(AUTH_ERROR_INVALID_VERIFICATION_ID)).toBe('retry');
    expect(classifyTotpErrorCode(AUTH_ERROR_CODE_EXPIRED)).toBe('retry');
    expect(classifyTotpErrorCode(AUTH_ERROR_REQUIRES_RECENT_LOGIN)).toBe('retry');
    expect(classifyTotpErrorCode(TOTP_ENROLLMENT_UNCONFIRMED_CODE)).toBe('recover');
    expect(classifyTotpErrorCode(TOTP_ENROLLMENT_EXPIRED_CODE)).toBe('recover');
    expect(classifyTotpErrorCode(TOTP_INVALID_FORMAT_CODE)).toBe('retry');
    expect(classifyTotpErrorCode('auth/invalid-multi-factor-session')).toBe('restart');
    expect(classifyTotpErrorCode('auth/too-many-requests')).toBe('restart');
  });

  it('maps SDK errors to visible retry or restart TotpMfaError values', () => {
    const retry = toTotpMfaError({ code: AUTH_ERROR_INVALID_OTP });
    expect(retry.kind).toBe('retry');
    expect(retry.message).toBe(TOTP_RETRY_MESSAGE);
    expect(retry.code).toBe(AUTH_ERROR_INVALID_OTP);

    const invalidId = toTotpMfaError({ code: AUTH_ERROR_INVALID_VERIFICATION_ID });
    expect(invalidId.kind).toBe('retry');
    expect(invalidId.code).toBe(AUTH_ERROR_INVALID_VERIFICATION_ID);
    expect(invalidId.message).toBe(TOTP_RETRY_MESSAGE);

    const recentLogin = toTotpMfaError({ code: AUTH_ERROR_REQUIRES_RECENT_LOGIN });
    expect(recentLogin.kind).toBe('retry');
    expect(recentLogin.code).toBe(AUTH_ERROR_REQUIRES_RECENT_LOGIN);
    expect(recentLogin.message).toBe(TOTP_RECENT_LOGIN_FAILED_MESSAGE);

    const unconfirmed = toTotpMfaError({ code: TOTP_ENROLLMENT_UNCONFIRMED_CODE });
    expect(unconfirmed.kind).toBe('recover');
    expect(unconfirmed.message).toBe(TOTP_ENROLLMENT_UNCONFIRMED_MESSAGE);

    const expired = toTotpMfaError({ code: TOTP_ENROLLMENT_EXPIRED_CODE });
    expect(expired.kind).toBe('recover');
    expect(expired.message).toBe(TOTP_ENROLLMENT_REPLACE_REQUIRED_MESSAGE);

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
        kind: 'recover',
        code: TOTP_ENROLLMENT_EXPIRED_CODE,
        message: TOTP_ENROLLMENT_REPLACE_REQUIRED_MESSAGE,
      });
    }
  });

  it('refreshes the ID token and reloads before trusting an enrolled TOTP factor', async () => {
    const order: string[] = [];

    await expect(
      hasEnrolledTotpAfterFactorRefresh(
        async () => {
          order.push('token');
        },
        async () => {
          order.push('reload');
        },
        () => {
          order.push('check');
          return true;
        },
      ),
    ).resolves.toBe(true);
    expect(order).toEqual(['token', 'reload', 'check']);
    await expect(
      hasEnrolledTotpAfterFactorRefresh(
        async () => undefined,
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
  it('labels authenticator entries as Eco Plan Tool', () => {
    expect(TOTP_ISSUER).toBe('Eco Plan Tool');
    expect(totpAccountLabel('google@example.com')).toBe('Eco Plan Tool (google@example.com)');
    expect(totpAccountLabel('  Eco Plan Tool  ')).toBe('Eco Plan Tool');
    expect(totpAccountLabel('Eco Plan Tool (google@example.com)')).toBe(
      'Eco Plan Tool (google@example.com)',
    );
    expect(totpAccountLabel('')).toBe('Eco Plan Tool');
  });

  it('is provided and uses QrCodeService when constructed', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: QrCodeService, useValue: { toDataUrl: vi.fn() } }],
    });

    expect(TestBed.inject(TotpMfaService)).toBeTruthy();
  });

  it('refreshes and reloads before trusting a local enrolled factor', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: QrCodeService, useValue: { toDataUrl: vi.fn() } }],
    });
    const service = TestBed.inject(TotpMfaService);

    const readAfterRefresh = async (enrolledAfterReload: boolean) => {
      const order: string[] = [];
      let localEnrolled = true;
      const enrolledSpy = vi.spyOn(service, 'hasEnrolledTotp').mockImplementation(() => {
        order.push('check');
        return localEnrolled;
      });
      const user = {
        getIdToken: vi.fn(async (forceRefresh?: boolean) => {
          order.push(forceRefresh ? 'token:force' : 'token');
          return 'token';
        }),
        reload: vi.fn(async () => {
          order.push('reload');
          localEnrolled = enrolledAfterReload;
        }),
      } as unknown as User;

      await expect(service.userHasEnrolledTotp(user)).resolves.toBe(enrolledAfterReload);
      expect(user.getIdToken).toHaveBeenCalledWith(true);
      expect(user.reload).toHaveBeenCalledOnce();
      expect(order).toEqual(['token:force', 'reload', 'check']);
      enrolledSpy.mockRestore();
    };

    await readAfterRefresh(false);
    await readAfterRefresh(true);
  });
});

describe('TOTP enrollment follow-up', () => {
  it('stops the setup loop when an empty factor cache becomes enrolled only after refresh', async () => {
    let factorsVisible = false;
    let tokenForced = false;
    const steps: string[] = ['setup'];

    const enrolled = await hasEnrolledTotpAfterFactorRefresh(
      async () => {
        tokenForced = true;
      },
      async () => {
        if (tokenForced) {
          factorsVisible = true;
        }
      },
      () => factorsVisible,
    );

    if (canBeginTotpEnrollment(enrolled)) {
      steps.push('setup');
    } else {
      requireVisibleTotpEnrollment(enrolled);
      steps.push('signed-in');
    }

    expect(factorsVisible).toBe(true);
    expect(steps).toEqual(['setup', 'signed-in']);
  });

  it('does not confirm enrollment when refresh still shows no authenticator', () => {
    expect(canBeginTotpEnrollment(false)).toBe(true);
    expect(() => requireVisibleTotpEnrollment(false)).toThrow(TotpMfaError);
    try {
      requireVisibleTotpEnrollment(false);
    } catch (error) {
      expect(error).toMatchObject({
        kind: 'recover',
        code: TOTP_ENROLLMENT_UNCONFIRMED_CODE,
        message: TOTP_ENROLLMENT_UNCONFIRMED_MESSAGE,
      });
    }
  });

  it('encodes a Duo-visible Eco Plan Tool label for wthompson@ucsb.edu', () => {
    const issuer = 'Eco Plan Tool';
    const account = 'wthompson@ucsb.edu';
    const label = totpAccountLabel(account, issuer);

    expect(issuer).toBe('Eco Plan Tool');
    expect(account).toBe('wthompson@ucsb.edu');
    expect(label).toBe('Eco Plan Tool (wthompson@ucsb.edu)');

    const uri = buildTotpOtpauthUri({
      issuer,
      accountName: account,
      secretKey: 'MFASECRETKEY',
      algorithm: 'SHA1',
      digits: 6,
      periodSeconds: 30,
    });
    const path = uri.slice('otpauth://totp/'.length, uri.indexOf('?'));

    expect(uri).toBe(
      'otpauth://totp/Eco%20Plan%20Tool%20(wthompson%40ucsb.edu)?secret=MFASECRETKEY&issuer=Eco%20Plan%20Tool&algorithm=SHA1&digits=6&period=30',
    );
    expect(decodeURIComponent(path)).toBe(label);
    expect(path).not.toContain(':');
    expect(new URL(uri).searchParams.get('issuer')).toBe(issuer);
    expect(uri).not.toContain(' ');
    expect(uri).not.toContain('image=');
  });

  it('reuses a cached enrollment for the same uid even after its deadline', () => {
    const session = {
      enrollmentCompletionDeadline: '2020-01-01T00:00:00.000Z',
      qrCodeUrl: 'otpauth://totp/same',
    };
    const cached = { uid: 'active-uid', session };

    expect(Date.parse(session.enrollmentCompletionDeadline)).toBeLessThan(Date.now());
    expect(reuseOpenEnrollment(cached, 'active-uid')).toBe(session);
    expect(reuseOpenEnrollment(cached, 'other-uid')).toBeNull();
    expect(reuseOpenEnrollment(null, 'active-uid')).toBeNull();
  });
});

describe('TOTP enrollment result', () => {
  const secretLeak = 'idToken=eyJsecret email=wthompson@ucsb.edu';

  it('keeps an unconfirmed enrollment locked after the diagnostic runs', async () => {
    const order: string[] = [];
    const diagnose = vi.fn(async () => {
      order.push('diagnose');
    });
    const forget = vi.fn(() => {
      order.push('forget');
    });

    await expect(
      applyTotpEnrollmentResult({
        production: false,
        enrolledAfterRefresh: false,
        diagnoseUnconfirmed: diagnose,
        forgetEnrollment: forget,
      }),
    ).rejects.toMatchObject({
      kind: 'recover',
      code: TOTP_ENROLLMENT_UNCONFIRMED_CODE,
      message: TOTP_ENROLLMENT_UNCONFIRMED_MESSAGE,
    });
    expect(order).toEqual(['diagnose']);
    expect(forget).not.toHaveBeenCalled();
  });

  it('stays locked when the diagnostic throws, without repeating that error', async () => {
    const forget = vi.fn();
    let thrown: unknown;

    try {
      await applyTotpEnrollmentResult({
        production: false,
        enrolledAfterRefresh: false,
        diagnoseUnconfirmed: async () => {
          throw new Error(secretLeak);
        },
        forgetEnrollment: forget,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TotpMfaError);
    expect(thrown).toMatchObject({
      code: TOTP_ENROLLMENT_UNCONFIRMED_CODE,
      message: TOTP_ENROLLMENT_UNCONFIRMED_MESSAGE,
    });
    expect(String(thrown)).not.toContain('eyJsecret');
    expect(String(thrown)).not.toContain('wthompson@ucsb.edu');
    expect(forget).not.toHaveBeenCalled();
  });

  it('does not run a diagnostic in production and still stays locked', async () => {
    const diagnose = vi.fn(async () => undefined);
    const forget = vi.fn();

    await expect(
      applyTotpEnrollmentResult({
        production: true,
        enrolledAfterRefresh: false,
        diagnoseUnconfirmed: diagnose,
        forgetEnrollment: forget,
      }),
    ).rejects.toMatchObject({ code: TOTP_ENROLLMENT_UNCONFIRMED_CODE });
    expect(diagnose).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
  });

  it('clears a confirmed enrollment without a diagnostic', async () => {
    const diagnose = vi.fn(async () => undefined);
    const forget = vi.fn();

    await applyTotpEnrollmentResult({
      production: false,
      enrolledAfterRefresh: true,
      diagnoseUnconfirmed: diagnose,
      forgetEnrollment: forget,
    });
    expect(diagnose).not.toHaveBeenCalled();
    expect(forget).toHaveBeenCalledOnce();
  });
});

describe('TotpMfaService unconfirmed enrollment', () => {
  const session = {
    secret: { secretKey: 'SHOULD_NOT_LEAK' },
    qrCodeUrl: 'otpauth://totp/test',
    qrCodeDataUrl: 'data:image/png;base64,abc',
    secretKey: 'SHOULD_NOT_LEAK',
    accountName: 'wthompson@ucsb.edu',
    issuer: 'Eco Plan Tool',
    enrollmentCompletionDeadline: '2099-01-01T00:00:00.000Z',
    codeLength: 6,
    codeIntervalSeconds: 30,
  } as TotpEnrollmentSession;

  async function finishEnrollment(enrolledAfterEnroll: boolean, diagnose: () => Promise<void>) {
    const diagnostic = { reportUnconfirmed: vi.fn(diagnose) };
    TestBed.configureTestingModule({
      providers: [
        { provide: QrCodeService, useValue: { toDataUrl: vi.fn() } },
        { provide: TotpEnrollmentDiagnosticService, useValue: diagnostic },
      ],
    });
    const service = TestBed.inject(TotpMfaService);
    const factors: { factorId: string }[] = [];
    const multiFactorSpy = vi.spyOn(firebaseAuth, 'multiFactor').mockReturnValue({
      enroll: vi.fn(async () => {
        if (enrolledAfterEnroll) {
          factors.push({ factorId: FactorId.TOTP });
        }
      }),
      enrolledFactors: factors,
    } as never);
    const assertionSpy = vi
      .spyOn(firebaseAuth.TotpMultiFactorGenerator, 'assertionForEnrollment')
      .mockReturnValue({} as never);
    const user = {
      uid: 'uid-1',
      getIdToken: vi.fn(async () => 'token'),
      reload: vi.fn(async () => undefined),
    } as unknown as User;
    service.rememberOpenEnrollment(user, session);

    let thrown: unknown;
    try {
      await service.completeEnrollment(user, session, '123456');
    } catch (error) {
      thrown = error;
    } finally {
      multiFactorSpy.mockRestore();
      assertionSpy.mockRestore();
    }
    return { service, user, diagnostic, thrown };
  }

  it('keeps the open session locked when the refreshed user has no TOTP factor', async () => {
    const finished = await finishEnrollment(false, async () => undefined);

    expect(finished.thrown).toMatchObject({
      code: TOTP_ENROLLMENT_UNCONFIRMED_CODE,
      message: TOTP_ENROLLMENT_UNCONFIRMED_MESSAGE,
    });
    expect(finished.diagnostic.reportUnconfirmed).toHaveBeenCalledWith(finished.user);
    expect(finished.service.openEnrollmentFor(finished.user)).toBe(session);
    expect(String(finished.thrown)).not.toContain('SHOULD_NOT_LEAK');
    expect(String(finished.thrown)).not.toContain('wthompson@ucsb.edu');
  });

  it('stays locked when the diagnostic rejects with sensitive text', async () => {
    const finished = await finishEnrollment(false, async () => {
      throw new Error('idToken=eyJsecret email=wthompson@ucsb.edu');
    });

    expect(finished.thrown).toBeInstanceOf(TotpMfaError);
    expect(finished.thrown).toMatchObject({
      code: TOTP_ENROLLMENT_UNCONFIRMED_CODE,
      message: TOTP_ENROLLMENT_UNCONFIRMED_MESSAGE,
    });
    expect(finished.service.openEnrollmentFor(finished.user)).toBe(session);
    expect(String(finished.thrown)).not.toContain('eyJsecret');
  });

  it('clears the session after a confirmed factor and does not diagnose', async () => {
    const finished = await finishEnrollment(true, async () => undefined);

    expect(finished.thrown).toBeUndefined();
    expect(finished.diagnostic.reportUnconfirmed).not.toHaveBeenCalled();
    expect(finished.service.openEnrollmentFor(finished.user)).toBeNull();
  });
});
