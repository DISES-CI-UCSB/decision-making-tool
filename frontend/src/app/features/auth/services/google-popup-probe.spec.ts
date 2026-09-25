import {
  collectGooglePopupProbeEvent,
  emitGooglePopupProbe,
  formatGooglePopupProbeLine,
  GOOGLE_POPUP_PROBE_LOG_PREFIX,
  isSafeGooglePopupProbeLine,
  sanitizeGooglePopupProbeErrorCode,
  secondFactorClaimPresent,
  signInSecondFactorFromIdTokenResult,
} from './google-popup-probe';

const email = 'wthompson@ucsb.edu';
const currentUid = 'uid-SECRET';
const apiKey = 'public-api-key-SHOULD-NOT-LOG';
const otp = '654321';
const secretKey = 'MFASECRETKEY';
const qrUri = 'otpauth://totp/Eco%20Plan%20Tool?secret=MFASECRETKEY';
const idToken =
  'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1aWQtU0VDUkVUIiwiZW1haWwiOiJ3dGhvbXBzb25AdWNzYi5lZHUifQ.sig';
const refreshToken = 'refresh-SECRET';
const sessionInfo = 'session-SECRET';
const enrollmentId = 'totp-enroll-SECRET';
const factorId = 'factor-SECRET';

function absentSecrets(text: string, secrets: readonly string[]): void {
  for (const secret of secrets) {
    expect(text).not.toContain(secret);
  }
}

const secrets = [
  email,
  currentUid,
  apiKey,
  otp,
  secretKey,
  qrUri,
  idToken,
  refreshToken,
  sessionInfo,
  enrollmentId,
  factorId,
  'SHOULD_NOT_LEAK',
  'BEGIN PRIVATE',
];

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

describe('Google popup probe schema', () => {
  it('keeps a closed, secret-safe line for every outcome', async () => {
    const resolved = await collectGooglePopupProbeEvent({
      outcome: 'resolved',
      currentUserPresent: true,
      snapshot: {
        enrolledFactorCount: 0,
        getIdTokenResult: async () => ({ signInSecondFactor: null }),
      },
    });
    const mfaRequired = await collectGooglePopupProbeEvent({
      outcome: 'mfa-required',
      errorCode: 'auth/multi-factor-auth-required',
      currentUserPresent: false,
    });
    const rejected = await collectGooglePopupProbeEvent({
      outcome: 'rejected',
      errorCode: {
        code: 'auth/popup-closed-by-user',
        message: `Firebase: ${email} otp=${otp} secretKey=${secretKey} ${qrUri} ${idToken}`,
        customData: { email, uid: currentUid },
      },
      currentUserPresent: false,
    });

    const lines = [
      formatGooglePopupProbeLine(resolved),
      formatGooglePopupProbeLine(mfaRequired),
      formatGooglePopupProbeLine(rejected),
    ];

    expect(lines).toEqual([
      `${GOOGLE_POPUP_PROBE_LOG_PREFIX} {"event":"popup-result","outcome":"resolved","currentUserPresent":true,"enrolledFactorCount":0,"secondFactorClaimPresent":false}`,
      `${GOOGLE_POPUP_PROBE_LOG_PREFIX} {"event":"popup-result","outcome":"mfa-required","currentUserPresent":false,"enrolledFactorCount":0,"secondFactorClaimPresent":false,"errorCode":"auth/multi-factor-auth-required"}`,
      `${GOOGLE_POPUP_PROBE_LOG_PREFIX} {"event":"popup-result","outcome":"rejected","currentUserPresent":false,"enrolledFactorCount":0,"secondFactorClaimPresent":false,"errorCode":"auth/popup-closed-by-user"}`,
    ]);
    for (const line of lines) {
      expect(isSafeGooglePopupProbeLine(line)).toBe(true);
      absentSecrets(line, secrets);
    }
    expect(GOOGLE_POPUP_PROBE_LOG_PREFIX).toBe('[Auth][Google popup probe]');
  });

  it('redacts unsafe error codes and unknown second-factor values', () => {
    expect(sanitizeGooglePopupProbeErrorCode(`${email} ${idToken}`)).toBe('unavailable');
    expect(sanitizeGooglePopupProbeErrorCode(email)).toBe('unavailable');
    expect(sanitizeGooglePopupProbeErrorCode(secretKey)).toBe('unavailable');
    expect(secondFactorClaimPresent(email)).toBe(false);
    expect(secondFactorClaimPresent(factorId)).toBe(false);
    expect(secondFactorClaimPresent('totp')).toBe(true);
    expect(secondFactorClaimPresent('phone')).toBe(true);
    expect(isSafeGooglePopupProbeLine(`${GOOGLE_POPUP_PROBE_LOG_PREFIX} ${email}`)).toBe(false);
    expect(isSafeGooglePopupProbeLine(`${GOOGLE_POPUP_PROBE_LOG_PREFIX} ${idToken}`)).toBe(false);
  });

  it('omits errorCode on resolved and sanitizes it on other outcomes', async () => {
    const resolved = await collectGooglePopupProbeEvent({
      outcome: 'resolved',
      errorCode: 'auth/popup-closed-by-user',
      currentUserPresent: true,
    });
    const rejected = await collectGooglePopupProbeEvent({
      outcome: 'rejected',
      currentUserPresent: false,
    });

    expect(resolved).toEqual({
      event: 'popup-result',
      outcome: 'resolved',
      currentUserPresent: true,
      enrolledFactorCount: 0,
      secondFactorClaimPresent: false,
    });
    expect('errorCode' in resolved).toBe(false);
    expect(rejected.errorCode).toBe('unavailable');
  });
});

describe('Google popup probe gating and token restrictions', () => {
  it('writes probe lines only outside production and skips snapshot work', async () => {
    const getIdTokenResult = vi.fn(async () => ({ signInSecondFactor: 'totp' as const }));
    const snapshot = vi.fn(() => ({
      enrolledFactorCount: 1,
      getIdTokenResult,
    }));
    const log = vi.fn();

    await emitGooglePopupProbe(
      true,
      {
        outcome: 'resolved',
        currentUserPresent: true,
        snapshot,
      },
      log,
    );
    await emitGooglePopupProbe(
      false,
      {
        outcome: 'resolved',
        currentUserPresent: true,
        snapshot,
      },
      log,
    );

    expect(snapshot).toHaveBeenCalledOnce();
    expect(getIdTokenResult).toHaveBeenCalledOnce();
    expect(getIdTokenResult).toHaveBeenCalledWith(false);
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      `${GOOGLE_POPUP_PROBE_LOG_PREFIX} {"event":"popup-result","outcome":"resolved","currentUserPresent":true,"enrolledFactorCount":1,"secondFactorClaimPresent":true}`,
    );
  });

  it('calls getIdTokenResult(false) only on a resolved popup', async () => {
    const getIdTokenResult = vi.fn(async (forceRefresh: boolean) => {
      expect(forceRefresh).toBe(false);
      return { signInSecondFactor: 'totp' as const };
    });
    const snapshot = { enrolledFactorCount: 1, getIdTokenResult };

    const resolved = await collectGooglePopupProbeEvent({
      outcome: 'resolved',
      currentUserPresent: true,
      snapshot,
    });
    expect(getIdTokenResult).toHaveBeenCalledOnce();
    expect(getIdTokenResult).toHaveBeenCalledWith(false);
    expect(resolved.secondFactorClaimPresent).toBe(true);

    getIdTokenResult.mockClear();
    const mfaRequired = await collectGooglePopupProbeEvent({
      outcome: 'mfa-required',
      errorCode: 'auth/multi-factor-auth-required',
      currentUserPresent: false,
      snapshot,
    });
    const rejected = await collectGooglePopupProbeEvent({
      outcome: 'rejected',
      errorCode: 'auth/popup-closed-by-user',
      currentUserPresent: true,
      snapshot,
    });

    expect(getIdTokenResult).not.toHaveBeenCalled();
    expect(mfaRequired.secondFactorClaimPresent).toBe(false);
    expect(rejected.secondFactorClaimPresent).toBe(false);
  });

  it('reads only signInSecondFactor and never token or claims', async () => {
    const getIdTokenResult = vi.fn(async (forceRefresh: boolean) => {
      expect(forceRefresh).toBe(false);
      return guardedIdTokenResult('phone');
    });

    expect(signInSecondFactorFromIdTokenResult(await getIdTokenResult(false))).toBe('phone');
    expect(
      await collectGooglePopupProbeEvent({
        outcome: 'resolved',
        currentUserPresent: true,
        snapshot: {
          enrolledFactorCount: 2,
          getIdTokenResult: async (forceRefresh) => {
            expect(forceRefresh).toBe(false);
            return {
              signInSecondFactor: signInSecondFactorFromIdTokenResult(
                await getIdTokenResult(forceRefresh),
              ),
            };
          },
        },
      }),
    ).toEqual({
      event: 'popup-result',
      outcome: 'resolved',
      currentUserPresent: true,
      enrolledFactorCount: 2,
      secondFactorClaimPresent: true,
    });
    expect(getIdTokenResult).toHaveBeenCalledWith(false);
  });

  it('treats totp and phone as present and redacts stuffed claim values', async () => {
    expect(secondFactorClaimPresent(null)).toBe(false);
    expect(secondFactorClaimPresent('')).toBe(false);
    expect(secondFactorClaimPresent(email)).toBe(false);
    expect(secondFactorClaimPresent(factorId)).toBe(false);
    expect(
      (
        await collectGooglePopupProbeEvent({
          outcome: 'resolved',
          currentUserPresent: true,
          snapshot: {
            enrolledFactorCount: 1,
            getIdTokenResult: async () => ({ signInSecondFactor: email }),
          },
        })
      ).secondFactorClaimPresent,
    ).toBe(false);
  });

  it('counts enrolled factors as a number and never logs factor IDs', async () => {
    const line = formatGooglePopupProbeLine(
      await collectGooglePopupProbeEvent({
        outcome: 'resolved',
        currentUserPresent: true,
        snapshot: {
          enrolledFactorCount: 3,
          getIdTokenResult: async () => ({ signInSecondFactor: null }),
        },
      }),
    );

    expect(line).toContain('"enrolledFactorCount":3');
    expect(line).not.toContain(enrollmentId);
    expect(line).not.toContain(factorId);
    expect(line).not.toContain('totp');
  });

  it('does not propagate collector or emit failures', async () => {
    const log = vi.fn(() => {
      throw new Error(`idToken=${idToken} email=${email}`);
    });

    await expect(
      emitGooglePopupProbe(
        false,
        {
          outcome: 'resolved',
          currentUserPresent: true,
          snapshot: () => {
            throw new Error(`resolver hint ${enrollmentId} ${email}`);
          },
        },
        log,
      ),
    ).resolves.toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it('sets the second-factor boolean false when getIdTokenResult throws', async () => {
    const event = await collectGooglePopupProbeEvent({
      outcome: 'resolved',
      currentUserPresent: true,
      snapshot: {
        enrolledFactorCount: 0,
        getIdTokenResult: async () => {
          throw new Error(`token=${idToken} email=${email}`);
        },
      },
    });

    expect(event.secondFactorClaimPresent).toBe(false);
    absentSecrets(formatGooglePopupProbeLine(event), secrets);
  });
});
