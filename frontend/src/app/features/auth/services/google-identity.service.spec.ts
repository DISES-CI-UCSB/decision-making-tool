import { TestBed } from '@angular/core/testing';
import {
  FirebaseClientService,
  signInWithGoogleSelectAccountPopup,
} from '@core/services/firebase-client.service';
import * as firebaseAuth from 'firebase/auth';
import {
  GIS_SIGN_IN_CANCELLED_MESSAGE,
  GoogleIdentityService,
  isAbandonedGisPrompt,
  settleOnce,
  toGooglePopupProbeSnapshot,
} from './google-identity.service';
import {
  GOOGLE_POPUP_PROBE_LOG_PREFIX,
  signInSecondFactorFromIdTokenResult,
} from './google-popup-probe';
import { AUTH_ERROR_MFA_REQUIRED, TotpMfaService } from './totp-mfa.service';

describe('GoogleIdentityService', () => {
  it('fails when Google sign-in is not configured instead of returning a fake profile', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: FirebaseClientService,
          useValue: { isEnabled: false, auth: null },
        },
        { provide: TotpMfaService, useValue: { createAssertionSession: vi.fn() } },
      ],
    });

    await expect(TestBed.inject(GoogleIdentityService).signIn()).rejects.toThrow(
      'Google sign-in is not configured.',
    );
  });

  it('fails when Firebase Auth is enabled but not configured', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: FirebaseClientService,
          useValue: { isEnabled: true, auth: null },
        },
        { provide: TotpMfaService, useValue: { createAssertionSession: vi.fn() } },
      ],
    });

    await expect(TestBed.inject(GoogleIdentityService).signIn()).rejects.toThrow(
      'Firebase Auth is not configured.',
    );
  });

  it('returns a completed profile after a Firebase Google popup', async () => {
    const firebase = {
      isEnabled: true,
      auth: {},
      signInWithGooglePopup: vi.fn().mockResolvedValue({
        user: {
          uid: 'user-1',
          email: 'ada@example.com',
          displayName: 'Ada Lovelace',
          getIdToken: vi.fn().mockResolvedValue('id-token'),
        },
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: FirebaseClientService, useValue: firebase },
        { provide: TotpMfaService, useValue: { createAssertionSession: vi.fn() } },
      ],
    });

    const profile = {
      uid: 'user-1',
      idToken: 'id-token',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      avatarInitials: 'AL',
      isStub: false,
    };
    await expect(TestBed.inject(GoogleIdentityService).signIn()).resolves.toEqual({
      kind: 'completed',
      profile,
    });
  });

  it('builds a Google profile from a completed UserCredential', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: FirebaseClientService,
          useValue: { isEnabled: false, auth: null },
        },
        { provide: TotpMfaService, useValue: { createAssertionSession: vi.fn() } },
      ],
    });

    await expect(
      TestBed.inject(GoogleIdentityService).profileFromCredential({
        user: {
          uid: 'user-1',
          email: 'ada@example.com',
          displayName: 'Ada Lovelace',
          getIdToken: vi.fn().mockResolvedValue('id-token'),
        } as never,
      }),
    ).resolves.toEqual({
      uid: 'user-1',
      idToken: 'id-token',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      avatarInitials: 'AL',
      isStub: false,
    });
  });

  it('returns a TOTP challenge and keeps the original MultiFactorError', async () => {
    const auth = { app: 'auth' };
    const mfaError = {
      code: AUTH_ERROR_MFA_REQUIRED,
      customData: { email: 'ada@example.com' },
    };
    const assertion = {
      email: 'ada@example.com',
      hint: { uid: 'totp-1', factorId: 'totp' },
    };
    const createAssertionSession = vi.fn().mockReturnValue(assertion);
    const firebase = {
      isEnabled: true,
      auth,
      signInWithGooglePopup: vi.fn().mockRejectedValue(mfaError),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: FirebaseClientService, useValue: firebase },
        { provide: TotpMfaService, useValue: { createAssertionSession } },
      ],
    });

    await expect(TestBed.inject(GoogleIdentityService).signIn()).resolves.toEqual({
      kind: 'totp-assertion-required',
      assertion,
    });
    expect(createAssertionSession).toHaveBeenCalledWith(auth, mfaError);
  });

  it('rethrows non-MFA popup failures', async () => {
    const popupClosed = new Error('popup-closed-by-user');
    TestBed.configureTestingModule({
      providers: [
        {
          provide: FirebaseClientService,
          useValue: {
            isEnabled: true,
            auth: {},
            signInWithGooglePopup: vi.fn().mockRejectedValue(popupClosed),
          },
        },
        { provide: TotpMfaService, useValue: { createAssertionSession: vi.fn() } },
      ],
    });

    await expect(TestBed.inject(GoogleIdentityService).signIn()).rejects.toBe(popupClosed);
  });

  it('preserves MFA error identity from the Google popup into the resolver', async () => {
    const mfaError = {
      code: AUTH_ERROR_MFA_REQUIRED,
      customData: { email: 'ada@example.com' },
    };
    const assertion = {
      email: 'ada@example.com',
      hint: { uid: 'totp-1', factorId: 'totp' },
    };
    const createAssertionSession = vi.fn().mockReturnValue(assertion);
    const auth = { currentUser: null };
    const signInWithPopup = vi.fn(async () => {
      throw mfaError;
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    TestBed.configureTestingModule({
      providers: [
        {
          provide: FirebaseClientService,
          useValue: {
            isEnabled: true,
            auth,
            signInWithGooglePopup: () =>
              signInWithGoogleSelectAccountPopup(auth as never, {
                signInWithPopup,
                signOut: vi.fn(),
                createProvider: () => ({ setCustomParameters: vi.fn() }) as never,
              }),
          },
        },
        { provide: TotpMfaService, useValue: { createAssertionSession } },
      ],
    });

    try {
      await expect(TestBed.inject(GoogleIdentityService).signIn()).resolves.toEqual({
        kind: 'totp-assertion-required',
        assertion,
      });
      expect(createAssertionSession).toHaveBeenCalledWith(auth, mfaError);
      expect(signInWithPopup).toHaveBeenCalledOnce();
      const consoleText = [
        ...info.mock.calls,
        ...warn.mock.calls,
        ...log.mock.calls,
        ...error.mock.calls,
      ]
        .map((call) => call.map(String).join(' '))
        .join('\n');
      expect(consoleText).not.toContain('ada@example.com');
      expect(consoleText).not.toContain('user-1');
    } finally {
      info.mockRestore();
      warn.mockRestore();
      log.mockRestore();
      error.mockRestore();
    }
  });
});

describe('GoogleIdentityService popup probe', () => {
  const email = 'ada@example.com';
  const uid = 'user-1';
  const idToken = 'eyJhbGciOiJub25lIn0.eyJlbWFpbCI6ImFkYUBleGFtcGxlLmNvbSJ9.sig';

  function guardedIdTokenResult(signInSecondFactor: string | null): unknown {
    return {
      get signInSecondFactor() {
        return signInSecondFactor;
      },
      get token() {
        throw new Error('token was read');
      },
      get claims() {
        throw new Error('claims were read');
      },
    };
  }

  function completedUser(options?: { secondFactor?: string | null }) {
    const getIdTokenResult = vi.fn(async (forceRefresh?: boolean) => {
      expect(forceRefresh).toBe(false);
      return guardedIdTokenResult(options?.secondFactor ?? null);
    });
    return {
      uid,
      email,
      displayName: 'Ada Lovelace',
      getIdToken: vi.fn().mockResolvedValue(idToken),
      getIdTokenResult,
    };
  }

  async function signInWith(
    firebase: object,
    totpMfa: object = { createAssertionSession: vi.fn() },
  ) {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: FirebaseClientService, useValue: firebase },
        { provide: TotpMfaService, useValue: totpMfa },
      ],
    });
    let result: unknown;
    let thrown: unknown;
    try {
      result = await TestBed.inject(GoogleIdentityService).signIn();
    } catch (caught) {
      thrown = caught;
    }
    return {
      result,
      thrown,
      probeLines: info.mock.calls.map((call) => String(call[0])),
      restore() {
        info.mockRestore();
        warn.mockRestore();
        log.mockRestore();
        error.mockRestore();
      },
    };
  }

  it('probes a resolved popup without changing the completed profile', async () => {
    const user = completedUser();
    const multiFactorSpy = vi.spyOn(firebaseAuth, 'multiFactor').mockReturnValue({
      enrolledFactors: [{ factorId: 'totp', uid: 'totp-enroll-SECRET' }],
    } as never);
    const finished = await signInWith({
      isEnabled: true,
      auth: { currentUser: user },
      signInWithGooglePopup: vi.fn().mockResolvedValue({ user }),
    });

    try {
      expect(finished.thrown).toBeUndefined();
      expect(finished.result).toEqual({
        kind: 'completed',
        profile: {
          uid,
          idToken,
          name: 'Ada Lovelace',
          email,
          avatarInitials: 'AL',
          isStub: false,
        },
      });
      expect(user.getIdTokenResult).toHaveBeenCalledOnce();
      expect(user.getIdTokenResult).toHaveBeenCalledWith(false);
      expect(finished.probeLines).toEqual([
        `${GOOGLE_POPUP_PROBE_LOG_PREFIX} {"event":"popup-result","outcome":"resolved","currentUserPresent":true,"enrolledFactorCount":1,"secondFactorClaimPresent":false}`,
      ]);
      expect(finished.probeLines.join('\n')).not.toContain(email);
      expect(finished.probeLines.join('\n')).not.toContain(uid);
      expect(finished.probeLines.join('\n')).not.toContain(idToken);
      expect(finished.probeLines.join('\n')).not.toContain('totp-enroll-SECRET');
    } finally {
      multiFactorSpy.mockRestore();
      finished.restore();
    }
  });

  it('probes MFA-required without reading a token result', async () => {
    const auth = { app: 'auth', currentUser: null };
    const mfaError = {
      code: AUTH_ERROR_MFA_REQUIRED,
      customData: { email },
    };
    const assertion = {
      email,
      hint: { uid: 'totp-1', factorId: 'totp' },
    };
    const createAssertionSession = vi.fn().mockReturnValue(assertion);
    const finished = await signInWith(
      {
        isEnabled: true,
        auth,
        signInWithGooglePopup: vi.fn().mockRejectedValue(mfaError),
      },
      { createAssertionSession },
    );

    try {
      expect(finished.thrown).toBeUndefined();
      expect(finished.result).toEqual({
        kind: 'totp-assertion-required',
        assertion,
      });
      expect(createAssertionSession).toHaveBeenCalledWith(auth, mfaError);
      expect(finished.probeLines).toEqual([
        `${GOOGLE_POPUP_PROBE_LOG_PREFIX} {"event":"popup-result","outcome":"mfa-required","currentUserPresent":false,"enrolledFactorCount":0,"secondFactorClaimPresent":false,"errorCode":"auth/multi-factor-auth-required"}`,
      ]);
      expect(finished.probeLines.join('\n')).not.toContain(email);
      expect(finished.probeLines.join('\n')).not.toContain('totp-1');
    } finally {
      finished.restore();
    }
  });

  it('probes a rejected popup and still throws', async () => {
    const currentUser = completedUser();
    const popupError = new Error('popup-closed-by-user');
    (popupError as Error & { code: string }).code = 'auth/popup-closed-by-user';
    const finished = await signInWith({
      isEnabled: true,
      auth: { currentUser },
      signInWithGooglePopup: vi.fn().mockRejectedValue(popupError),
    });

    try {
      expect(finished.result).toBeUndefined();
      expect(finished.thrown).toBe(popupError);
      expect(currentUser.getIdTokenResult).not.toHaveBeenCalled();
      expect(finished.probeLines).toEqual([
        `${GOOGLE_POPUP_PROBE_LOG_PREFIX} {"event":"popup-result","outcome":"rejected","currentUserPresent":true,"enrolledFactorCount":0,"secondFactorClaimPresent":false,"errorCode":"auth/popup-closed-by-user"}`,
      ]);
    } finally {
      finished.restore();
    }
  });

  it('maps only signInSecondFactor from getIdTokenResult(false)', async () => {
    const getIdTokenResult = vi.fn(async (forceRefresh?: boolean) => {
      expect(forceRefresh).toBe(false);
      return guardedIdTokenResult('totp');
    });
    const snapshot = toGooglePopupProbeSnapshot({
      getIdTokenResult,
    } as never);

    expect(snapshot).not.toBeNull();
    await expect(snapshot?.getIdTokenResult(true)).resolves.toEqual({ signInSecondFactor: null });
    expect(getIdTokenResult).not.toHaveBeenCalled();
    await expect(snapshot?.getIdTokenResult(false)).resolves.toEqual({
      signInSecondFactor: 'totp',
    });
    expect(getIdTokenResult).toHaveBeenCalledOnce();
    expect(getIdTokenResult).toHaveBeenCalledWith(false);
    expect(signInSecondFactorFromIdTokenResult(await getIdTokenResult.mock.results[0].value)).toBe(
      'totp',
    );
  });
});

describe('isAbandonedGisPrompt', () => {
  it('treats a not-displayed prompt as abandoned', () => {
    expect(
      isAbandonedGisPrompt({
        isNotDisplayed: () => true,
        isSkippedMoment: () => false,
        isDismissedMoment: () => false,
      }),
    ).toBe(true);
  });

  it('treats a skipped prompt as abandoned', () => {
    expect(
      isAbandonedGisPrompt({
        isNotDisplayed: () => false,
        isSkippedMoment: () => true,
        isDismissedMoment: () => false,
      }),
    ).toBe(true);
  });

  it('treats a dismissed prompt as abandoned unless a credential was returned', () => {
    expect(
      isAbandonedGisPrompt({
        isNotDisplayed: () => false,
        isSkippedMoment: () => false,
        isDismissedMoment: () => true,
        getDismissedReason: () => 'cancel_called',
      }),
    ).toBe(true);
    expect(
      isAbandonedGisPrompt({
        isNotDisplayed: () => false,
        isSkippedMoment: () => false,
        isDismissedMoment: () => true,
        getDismissedReason: () => 'credential_returned',
      }),
    ).toBe(false);
  });

  it('ignores unrelated prompt notifications', () => {
    expect(isAbandonedGisPrompt(null)).toBe(false);
    expect(isAbandonedGisPrompt({ isDisplayed: () => true })).toBe(false);
  });
});

describe('settleOnce', () => {
  it('resolves only once and ignores a later reject', () => {
    let resolved: string | undefined;
    let rejected: unknown;
    const finish = settleOnce<string>(
      (value) => {
        resolved = value;
      },
      (reason) => {
        rejected = reason;
      },
    );

    finish.resolve('ok');
    finish.reject(new Error(GIS_SIGN_IN_CANCELLED_MESSAGE));

    expect(resolved).toBe('ok');
    expect(rejected).toBeUndefined();
  });

  it('rejects only once and ignores a later resolve', () => {
    let resolved: string | undefined;
    let rejected: unknown;
    const finish = settleOnce<string>(
      (value) => {
        resolved = value;
      },
      (reason) => {
        rejected = reason;
      },
    );

    finish.reject(new Error(GIS_SIGN_IN_CANCELLED_MESSAGE));
    finish.resolve('ok');

    expect(resolved).toBeUndefined();
    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).toBe(GIS_SIGN_IN_CANCELLED_MESSAGE);
  });
});
