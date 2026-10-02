import { TestBed } from '@angular/core/testing';
import * as firebaseAuth from 'firebase/auth';
import { FactorId, type MultiFactorInfo, type MultiFactorResolver, type User } from 'firebase/auth';
import { QrCodeService } from './qr-code.service';
import { TOTP_PROBE_LOG_PREFIX } from './totp-enrollment-probe';
import {
  applyTotpEnrollmentResult,
  AUTH_ERROR_CODE_EXPIRED,
  AUTH_ERROR_INVALID_OTP,
  AUTH_ERROR_INVALID_VERIFICATION_ID,
  AUTH_ERROR_MFA_REQUIRED,
  AUTH_ERROR_MISSING_MFA_INFO,
  AUTH_ERROR_REQUIRES_RECENT_LOGIN,
  AUTH_ERROR_USER_TOKEN_EXPIRED,
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
  TOTP_USER_TOKEN_EXPIRED_MESSAGE,
  TotpMfaError,
  TotpMfaService,
  type TotpEnrollmentSession,
  totpAccountLabel,
  classifyTotpErrorCode,
  buildTotpOtpauthUri,
  canBeginTotpEnrollment,
  createTotpChallengeSession,
  hasEnrolledTotpAfterEnrollment,
  hasEnrolledTotpAfterFactorRefresh,
  hasTotpFactor,
  hasTotpSecondFactorClaim,
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

  it('reads only the cached TOTP second-factor claim', async () => {
    const getIdTokenResult = vi.fn(
      async (forceRefresh?: boolean): Promise<{ signInSecondFactor: string | null }> => {
        expect(forceRefresh).toBe(false);
        return { signInSecondFactor: 'totp' };
      },
    );
    await expect(hasTotpSecondFactorClaim({ getIdTokenResult })).resolves.toBe(true);
    expect(getIdTokenResult).toHaveBeenCalledWith(false);

    getIdTokenResult.mockResolvedValueOnce({ signInSecondFactor: null });
    await expect(hasTotpSecondFactorClaim({ getIdTokenResult })).resolves.toBe(false);

    getIdTokenResult.mockRejectedValueOnce(new Error('token unavailable'));
    await expect(hasTotpSecondFactorClaim({ getIdTokenResult })).resolves.toBe(false);
  });

  it('classifies invalid and expired codes as retryable', () => {
    expect(classifyTotpErrorCode(AUTH_ERROR_INVALID_OTP)).toBe('retry');
    expect(classifyTotpErrorCode(AUTH_ERROR_INVALID_VERIFICATION_ID)).toBe('retry');
    expect(classifyTotpErrorCode(AUTH_ERROR_CODE_EXPIRED)).toBe('retry');
    expect(classifyTotpErrorCode(AUTH_ERROR_REQUIRES_RECENT_LOGIN)).toBe('retry');
    expect(classifyTotpErrorCode(AUTH_ERROR_USER_TOKEN_EXPIRED)).toBe('restart');
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

    const tokenExpired = toTotpMfaError({ code: AUTH_ERROR_USER_TOKEN_EXPIRED });
    expect(tokenExpired.kind).toBe('restart');
    expect(tokenExpired.code).toBe(AUTH_ERROR_USER_TOKEN_EXPIRED);
    expect(tokenExpired.message).toBe(TOTP_USER_TOKEN_EXPIRED_MESSAGE);

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

  it('confirms enrollment from local factors without forcing a token refresh', async () => {
    const order: string[] = [];

    await expect(
      hasEnrolledTotpAfterEnrollment(
        () => {
          order.push('check');
          return true;
        },
        async () => {
          order.push('reload');
        },
      ),
    ).resolves.toBe(true);
    expect(order).toEqual(['check']);

    order.length = 0;
    let visible = false;
    await expect(
      hasEnrolledTotpAfterEnrollment(
        () => {
          order.push('check');
          return visible;
        },
        async () => {
          order.push('reload');
          visible = true;
        },
      ),
    ).resolves.toBe(true);
    expect(order).toEqual(['check', 'reload', 'check']);

    await expect(
      hasEnrolledTotpAfterEnrollment(
        () => false,
        async () => undefined,
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

  it('shares one forced refresh across concurrent factor reads for the same user', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: QrCodeService, useValue: { toDataUrl: vi.fn() } }],
    });
    const service = TestBed.inject(TotpMfaService);
    let resolveToken: (value: string) => void = () => undefined;
    const getIdToken = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveToken = resolve;
        }),
    );
    const reload = vi.fn(async () => undefined);
    const user = {
      uid: 'shared-uid',
      getIdToken,
      reload,
    } as unknown as User;
    const enrolledSpy = vi.spyOn(service, 'hasEnrolledTotp').mockReturnValue(false);

    const first = service.userHasEnrolledTotp(user);
    const second = service.userHasEnrolledTotp(user);
    expect(getIdToken).toHaveBeenCalledTimes(1);
    expect(getIdToken).toHaveBeenCalledWith(true);

    resolveToken('token');
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);

    getIdToken.mockResolvedValue('token');
    await expect(service.userHasEnrolledTotp(user)).resolves.toBe(false);
    expect(getIdToken).toHaveBeenCalledTimes(2);
    enrolledSpy.mockRestore();
  });

  it('holds enrollment for a uid while setup is in progress or a QR is open', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: QrCodeService, useValue: { toDataUrl: vi.fn() } }],
    });
    const service = TestBed.inject(TotpMfaService);
    const user = { uid: 'held-uid' } as User;
    const session = { secretKey: 'KEY' } as TotpEnrollmentSession;

    expect(service.isEnrollmentHeld('held-uid')).toBe(false);
    service.markEnrollmentInProgress('held-uid');
    expect(service.isEnrollmentHeld('held-uid')).toBe(true);
    expect(service.isEnrollmentHeld('other-uid')).toBe(false);
    service.rememberOpenEnrollment(user, session);
    service.clearEnrollmentInProgress('held-uid');
    expect(service.isEnrollmentHeld('held-uid')).toBe(true);
    service.forgetOpenEnrollment('held-uid');
    expect(service.isEnrollmentHeld('held-uid')).toBe(false);
  });

  it('does not force a token refresh when confirming a just-enrolled factor', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: QrCodeService, useValue: { toDataUrl: vi.fn() } }],
    });
    const service = TestBed.inject(TotpMfaService);
    const order: string[] = [];
    const user = {
      getIdToken: vi.fn(async () => {
        order.push('token');
        return 'token';
      }),
      reload: vi.fn(async () => {
        order.push('reload');
      }),
    } as unknown as User;
    const enrolledSpy = vi.spyOn(service, 'hasEnrolledTotp').mockReturnValue(true);

    await expect(service.confirmEnrolledTotp(user)).resolves.toBe(true);
    expect(user.getIdToken).not.toHaveBeenCalled();
    expect(user.reload).not.toHaveBeenCalled();
    expect(order).toEqual([]);
    enrolledSpy.mockRestore();
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

describe('TotpMfaService enrollment persistence probe', () => {
  const session = {
    secret: { secretKey: 'SHOULD_NOT_LEAK' },
    qrCodeUrl: 'otpauth://totp/test?secret=SHOULD_NOT_LEAK',
    qrCodeDataUrl: 'data:image/png;base64,abc',
    secretKey: 'SHOULD_NOT_LEAK',
    accountName: 'wthompson@ucsb.edu',
    issuer: 'Eco Plan Tool',
    enrollmentCompletionDeadline: '2099-01-01T00:00:00.000Z',
    codeLength: 6,
    codeIntervalSeconds: 30,
  } as TotpEnrollmentSession;

  async function finishEnrollment(options: {
    enrolledAfterEnroll: boolean;
    lookupUsers?: unknown;
    enrollError?: { code: string; message: string };
  }) {
    TestBed.configureTestingModule({
      providers: [{ provide: QrCodeService, useValue: { toDataUrl: vi.fn() } }],
    });
    const service = TestBed.inject(TotpMfaService);
    const factors: { factorId: string }[] = [];
    const multiFactorSpy = vi.spyOn(firebaseAuth, 'multiFactor').mockReturnValue({
      enroll: vi.fn(async () => {
        if (options.enrollError) {
          throw options.enrollError;
        }
        if (options.enrolledAfterEnroll) {
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
      getIdToken: vi.fn(async (forceRefresh?: boolean) => {
        if (forceRefresh === true) {
          throw new Error('forced refresh is forbidden on the probe path');
        }
        return 'token';
      }),
      reload: vi.fn(async () => undefined),
    } as unknown as User;
    const lookupBody = {
      users: options.lookupUsers ?? [{ localId: 'uid-1', mfaInfo: [] }],
      idToken: 'eyJshould-not-log',
      refreshToken: 'refresh-SECRET',
    };
    const fetchImpl = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(lookupBody), { status: 200 }));
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    service.rememberOpenEnrollment(user, session);

    let thrown: unknown;
    try {
      await service.completeEnrollment(user, session, '123456');
    } catch (caught) {
      thrown = caught;
    } finally {
      multiFactorSpy.mockRestore();
      assertionSpy.mockRestore();
    }
    const probeLines = info.mock.calls.map((call) => String(call[0]));
    const restore = () => {
      fetchImpl.mockRestore();
      info.mockRestore();
      warn.mockRestore();
      log.mockRestore();
      error.mockRestore();
    };
    return { service, user, thrown, fetchImpl, probeLines, warn, log, error, restore };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs enroll-result error and does not look up when enroll throws', async () => {
    const finished = await finishEnrollment({
      enrolledAfterEnroll: false,
      enrollError: {
        code: AUTH_ERROR_INVALID_OTP,
        message: 'Firebase: otp=123456 email=wthompson@ucsb.edu secretKey=SHOULD_NOT_LEAK',
      },
    });

    try {
      expect(finished.thrown).toMatchObject({
        kind: 'retry',
        code: AUTH_ERROR_INVALID_OTP,
      });
      expect(finished.user.getIdToken).not.toHaveBeenCalled();
      expect(finished.fetchImpl).not.toHaveBeenCalled();
      expect(finished.service.openEnrollmentFor(finished.user)).toBe(session);
      expect(finished.probeLines).toEqual([
        `${TOTP_PROBE_LOG_PREFIX} {"event":"enroll-start"}`,
        `${TOTP_PROBE_LOG_PREFIX} {"event":"enroll-result","outcome":"error","errorCode":"auth/invalid-verification-code"}`,
      ]);
      expect(finished.warn).not.toHaveBeenCalled();
      expect(finished.log).not.toHaveBeenCalled();
      expect(finished.error).not.toHaveBeenCalled();
      expect(finished.probeLines.join('\n')).not.toContain('SHOULD_NOT_LEAK');
      expect(finished.probeLines.join('\n')).not.toContain('wthompson@ucsb.edu');
      expect(String(finished.thrown)).not.toContain('SHOULD_NOT_LEAK');
    } finally {
      finished.restore();
    }
  });

  it('confirms enrollment from the local reload even when token lookup has no TOTP', async () => {
    const finished = await finishEnrollment({
      enrolledAfterEnroll: true,
      lookupUsers: [{ localId: 'uid-1', mfaInfo: [] }],
    });

    try {
      expect(finished.thrown).toBeUndefined();
      expect(finished.user.getIdToken).toHaveBeenCalledOnce();
      expect(finished.user.getIdToken).toHaveBeenCalledWith(false);
      expect(finished.fetchImpl).toHaveBeenCalledOnce();
      expect(finished.service.openEnrollmentFor(finished.user)).toBeNull();
      expect(finished.probeLines).toEqual([
        `${TOTP_PROBE_LOG_PREFIX} {"event":"enroll-start"}`,
        `${TOTP_PROBE_LOG_PREFIX} {"event":"enroll-result","outcome":"ok"}`,
        `${TOTP_PROBE_LOG_PREFIX} {"event":"local-factor-check","factorIds":["totp"],"factorCount":1}`,
        `${TOTP_PROBE_LOG_PREFIX} {"event":"persistence-lookup","scope":"id-token","httpStatus":200,"userCount":1,"uidMatches":true,"mfaInfoLength":0,"totpInfoPresent":false}`,
      ]);
      expect(finished.probeLines.join('\n')).not.toContain('eyJshould-not-log');
      expect(finished.probeLines.join('\n')).not.toContain('refresh-SECRET');
    } finally {
      finished.restore();
    }
  });

  it('reports token-scoped lookup TOTP without treating it as durable proof', async () => {
    const finished = await finishEnrollment({
      enrolledAfterEnroll: true,
      lookupUsers: [
        {
          localId: 'uid-1',
          email: 'wthompson@ucsb.edu',
          mfaInfo: [{ totpInfo: { secretKey: 'SHOULD_NOT_LEAK', otp: '123456' } }],
        },
      ],
    });

    try {
      expect(finished.thrown).toBeUndefined();
      expect(finished.user.getIdToken).toHaveBeenCalledOnce();
      expect(finished.user.getIdToken).toHaveBeenCalledWith(false);
      expect(finished.fetchImpl).toHaveBeenCalledOnce();
      expect(finished.service.openEnrollmentFor(finished.user)).toBeNull();
      expect(finished.probeLines).toEqual([
        `${TOTP_PROBE_LOG_PREFIX} {"event":"enroll-start"}`,
        `${TOTP_PROBE_LOG_PREFIX} {"event":"enroll-result","outcome":"ok"}`,
        `${TOTP_PROBE_LOG_PREFIX} {"event":"local-factor-check","factorIds":["totp"],"factorCount":1}`,
        `${TOTP_PROBE_LOG_PREFIX} {"event":"persistence-lookup","scope":"id-token","httpStatus":200,"userCount":1,"uidMatches":true,"mfaInfoLength":1,"totpInfoPresent":true}`,
      ]);
      expect(finished.probeLines.join('\n')).not.toContain('SHOULD_NOT_LEAK');
      expect(finished.probeLines.join('\n')).not.toContain('wthompson@ucsb.edu');
    } finally {
      finished.restore();
    }
  });

  it('forgets a remembered enrollment for the current uid or globally', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: QrCodeService, useValue: { toDataUrl: vi.fn() } }],
    });
    const service = TestBed.inject(TotpMfaService);
    const user = { uid: 'uid-1' } as User;
    const other = { uid: 'uid-2' } as User;
    service.rememberOpenEnrollment(user, session);

    service.forgetOpenEnrollment(other.uid);
    expect(service.openEnrollmentFor(user)).toBe(session);

    service.forgetOpenEnrollment(user.uid);
    expect(service.openEnrollmentFor(user)).toBeNull();

    service.rememberOpenEnrollment(user, session);
    service.forgetOpenEnrollment();
    expect(service.openEnrollmentFor(user)).toBeNull();
  });
});
