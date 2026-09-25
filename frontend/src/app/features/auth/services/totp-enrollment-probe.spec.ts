import {
  emitTotpProbeEvent,
  enrollmentConfirmedFromProbe,
  enrollResultFromThrown,
  formatTotpProbeLine,
  isSafeTotpProbeLine,
  persistenceLookupEvent,
  probeEnrollmentPersistence,
  sanitizeTotpProbeErrorCode,
  summarizeLocalFactorCheck,
  TOTP_PROBE_LOG_PREFIX,
} from './totp-enrollment-probe';
import { persistenceLookupFromAccountsBody } from './totp-enrollment-diagnostic';

const currentUid = 'uid-SECRET';
const apiKey = 'public-api-key-SHOULD-NOT-LOG';
const email = 'wthompson@ucsb.edu';
const otp = '654321';
const secretKey = 'MFASECRETKEY';
const qrUri = 'otpauth://totp/Eco%20Plan%20Tool?secret=MFASECRETKEY';
const idToken =
  'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1aWQtU0VDUkVUIiwiZW1haWwiOiJ3dGhvbXBzb25AdWNzYi5lZHUifQ.sig';
const refreshToken = 'refresh-SECRET';
const sessionInfo = 'session-SECRET';
const enrollmentId = 'totp-enroll-SECRET';

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
  'SHOULD_NOT_LEAK',
  'BEGIN PRIVATE',
];

describe('TOTP enrollment probe schema', () => {
  it('keeps a closed, secret-safe line for every event', () => {
    const lines = [
      formatTotpProbeLine({ event: 'enroll-start' }),
      formatTotpProbeLine({ event: 'enroll-result', outcome: 'ok' }),
      formatTotpProbeLine(
        enrollResultFromThrown({
          code: 'auth/invalid-verification-code',
          message: `Firebase: ${email} otp=${otp} secretKey=${secretKey} ${qrUri}`,
        }),
      ),
      formatTotpProbeLine(
        summarizeLocalFactorCheck([
          { factorId: 'totp' },
          { factorId: 'phone' },
          { factorId: enrollmentId },
          { factorId: email },
        ]),
      ),
      formatTotpProbeLine(
        persistenceLookupEvent(
          persistenceLookupFromAccountsBody(
            200,
            {
              users: [
                {
                  localId: currentUid,
                  email,
                  mfaInfo: [
                    {
                      mfaEnrollmentId: enrollmentId,
                      sessionInfo,
                      totpInfo: { secretKey, otp },
                    },
                  ],
                },
              ],
              idToken,
              refreshToken,
            },
            currentUid,
          ),
        ),
      ),
    ];

    expect(lines).toEqual([
      `${TOTP_PROBE_LOG_PREFIX} {"event":"enroll-start"}`,
      `${TOTP_PROBE_LOG_PREFIX} {"event":"enroll-result","outcome":"ok"}`,
      `${TOTP_PROBE_LOG_PREFIX} {"event":"enroll-result","outcome":"error","errorCode":"auth/invalid-verification-code"}`,
      `${TOTP_PROBE_LOG_PREFIX} {"event":"local-factor-check","factorIds":["totp","phone"],"factorCount":2}`,
      `${TOTP_PROBE_LOG_PREFIX} {"event":"persistence-lookup","scope":"id-token","httpStatus":200,"userCount":1,"uidMatches":true,"mfaInfoLength":1,"totpInfoPresent":true}`,
    ]);
    for (const line of lines) {
      expect(isSafeTotpProbeLine(line)).toBe(true);
      absentSecrets(line, secrets);
    }
    expect(TOTP_PROBE_LOG_PREFIX).toBe('[Auth][TOTP probe]');
  });

  it('redacts unsafe error codes and unknown factor ids', () => {
    const leaked = enrollResultFromThrown({
      code: `${email} ${idToken}`,
      message: `secretKey=${secretKey}`,
    });
    const line = formatTotpProbeLine(leaked);

    expect(leaked).toEqual({
      event: 'enroll-result',
      outcome: 'error',
      errorCode: 'unavailable',
    });
    expect(sanitizeTotpProbeErrorCode(email)).toBe('unavailable');
    expect(summarizeLocalFactorCheck([{ factorId: secretKey }])).toEqual({
      event: 'local-factor-check',
      factorIds: [],
      factorCount: 0,
    });
    expect(isSafeTotpProbeLine(line)).toBe(true);
    absentSecrets(line, secrets);
    expect(isSafeTotpProbeLine(`${TOTP_PROBE_LOG_PREFIX} ${email}`)).toBe(false);
  });

  it('writes probe lines only outside production', () => {
    const log = vi.fn();
    emitTotpProbeEvent(true, { event: 'enroll-start' }, log);
    emitTotpProbeEvent(false, { event: 'enroll-start' }, log);

    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(`${TOTP_PROBE_LOG_PREFIX} {"event":"enroll-start"}`);
  });
});

describe('enrollmentConfirmedFromProbe', () => {
  it('confirms from the local reload only and ignores token-scoped lookup', () => {
    expect(enrollmentConfirmedFromProbe(false, true, { totpInfoPresent: false })).toBe(true);
    expect(
      enrollmentConfirmedFromProbe(false, true, {
        totpInfoPresent: false,
        errorCode: 'network',
      }),
    ).toBe(true);
    expect(enrollmentConfirmedFromProbe(false, false, { totpInfoPresent: true })).toBe(false);
    expect(enrollmentConfirmedFromProbe(true, true, { totpInfoPresent: false })).toBe(true);
    expect(
      enrollmentConfirmedFromProbe(true, true, {
        totpInfoPresent: false,
        errorCode: 'network',
      }),
    ).toBe(true);
    expect(enrollmentConfirmedFromProbe(true, false, { totpInfoPresent: true })).toBe(false);
  });
});

describe('probeEnrollmentPersistence', () => {
  it('looks up accounts with getIdToken(false) and never force-refreshes', async () => {
    const getIdToken = vi.fn(async (forceRefresh: boolean) => {
      expect(forceRefresh).toBe(false);
      return idToken;
    });
    const fetchImpl = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            users: [{ localId: currentUid, email, mfaInfo: [] }],
            idToken,
            refreshToken,
          }),
          { status: 200 },
        ),
    );

    const lookup = await probeEnrollmentPersistence({
      apiKey,
      currentUid,
      getIdToken,
      fetchImpl,
    });

    expect(getIdToken).toHaveBeenCalledOnce();
    expect(getIdToken).toHaveBeenCalledWith(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('accounts:lookup');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(JSON.parse(String(init?.body))).toEqual({ idToken });
    expect(lookup).toEqual({
      httpStatus: 200,
      userCount: 1,
      uidMatches: true,
      mfaInfoLength: 0,
      totpInfoPresent: false,
    });
    absentSecrets(JSON.stringify(lookup), [email, secretKey, otp, qrUri, sessionInfo]);
  });

  it('reports persisted TOTP without copying secrets from totpInfo', async () => {
    const getIdToken = vi.fn(async (forceRefresh: boolean) => {
      expect(forceRefresh).toBe(false);
      return idToken;
    });
    const lookup = await probeEnrollmentPersistence({
      apiKey,
      currentUid,
      getIdToken,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            users: [
              {
                localId: currentUid,
                email,
                mfaInfo: [
                  {
                    mfaEnrollmentId: enrollmentId,
                    sessionInfo,
                    totpInfo: { secretKey, otp },
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
    });

    expect(getIdToken).toHaveBeenCalledWith(false);
    expect(lookup).toEqual({
      httpStatus: 200,
      userCount: 1,
      uidMatches: true,
      mfaInfoLength: 1,
      totpInfoPresent: true,
    });
    const line = formatTotpProbeLine(persistenceLookupEvent(lookup));
    expect(line).toBe(
      `${TOTP_PROBE_LOG_PREFIX} {"event":"persistence-lookup","scope":"id-token","httpStatus":200,"userCount":1,"uidMatches":true,"mfaInfoLength":1,"totpInfoPresent":true}`,
    );
    absentSecrets(line, secrets);
  });
});
