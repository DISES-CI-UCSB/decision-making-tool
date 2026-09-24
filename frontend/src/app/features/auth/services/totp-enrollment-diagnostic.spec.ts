import {
  TOTP_DIAGNOSTIC_LOG_PREFIX,
  buildTotpDiagnosticSummary,
  formatTotpDiagnosticFailure,
  formatTotpDiagnosticLine,
  isSafeTotpDiagnosticLine,
  reportUnconfirmedTotpLookup,
  sanitizeDiagnosticErrorCode,
  shouldRunTotpEnrollmentDiagnostic,
  summarizeAccountsLookupBody,
  summarizeIdTokenClaims,
  type TotpDiagnosticSummary,
} from './totp-enrollment-diagnostic';

const currentUid = 'uid-SECRET';
const projectId = 'project-SHOULD-NOT-LOG';
const apiKey = 'public-api-key-SHOULD-NOT-LOG';
const email = 'wthompson@ucsb.edu';

function encodeJwtPart(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function unsignedJwt(payload: Record<string, unknown>): string {
  return `${encodeJwtPart({ alg: 'none', typ: 'JWT' })}.${encodeJwtPart(payload)}.signature-SECRET`;
}

function absentSecrets(text: string, secrets: readonly string[]): void {
  for (const secret of secrets) {
    expect(text).not.toContain(secret);
  }
}

describe('TOTP enrollment diagnostic summary', () => {
  const token = unsignedJwt({
    aud: [projectId, 'other-aud-SECRET'],
    sub: currentUid,
    email,
    user_id: currentUid,
    firebase: {
      sign_in_provider: 'google.com',
      sign_in_second_factor: 'totp',
      second_factor_identifier: 'factor-SECRET',
      tenant: 'tenant-SECRET',
      identities: { 'google.com': [email] },
    },
  });

  const secrets = [
    token,
    email,
    currentUid,
    projectId,
    apiKey,
    'other-aud-SECRET',
    'refresh-SECRET',
    'factor-SECRET',
    'tenant-SECRET',
    'DECOYSECRET',
    'leak-SECONDS',
    'session-SECRET',
    'MFASECRETKEY',
    '654321',
    '+15551212',
    'Authenticator app',
    'enroll-SECRET',
    'totp-enroll-SECRET',
    'totp-secret-VALUE',
    'photo-SECRET',
    'passwordHash-SECRET',
    'raw-SECRET',
    'BEGIN PRIVATE',
    'private_key',
    'Will Overby',
    'other-user',
    'signature-SECRET',
    'identitytoolkit#GetAccountInfoResponse',
    'secretKey',
    'sessionInfo',
    'idToken',
    'refreshToken',
    'localId',
  ];

  const body = {
    kind: 'identitytoolkit#GetAccountInfoResponse',
    idToken: token,
    refreshToken: 'refresh-SECRET',
    users: [
      {
        localId: 'other-user',
        email,
        mfaInfo: [{ totpInfo: { secretKey: 'DECOYSECRET' } }],
      },
      {
        localId: currentUid,
        email,
        displayName: 'Will Overby',
        phoneNumber: '+15551212',
        photoUrl: 'https://photo-SECRET.example/a',
        passwordHash: 'passwordHash-SECRET',
        tenantId: 'tenant-SECRET',
        providerUserInfo: [{ email, rawId: 'raw-SECRET' }],
        mfaInfo: [
          null,
          {
            phoneInfo: '+15551212',
            displayName: 'Authenticator app',
            mfaEnrollmentId: 'enroll-SECRET',
            enrolledAt: { seconds: 'leak-SECONDS' },
            sessionInfo: 'session-SECRET',
          },
          { totpInfo: null },
          { totpInfo: 'totp-secret-VALUE' },
          { totpInfo: ['a', 'b'] },
          {
            mfaEnrollmentId: 'totp-enroll-SECRET',
            displayName: 'Authenticator app',
            enrolledAt: '2026-09-24T00:00:00Z',
            totpInfo: {
              secretKey: 'MFASECRETKEY',
              otp: '654321',
              sessionInfo: 'session-SECRET',
            },
            credential: { private_key: '-----BEGIN PRIVATE KEY-----\nSECRET' },
          },
        ],
      },
    ],
  };

  const summary: TotpDiagnosticSummary = {
    httpStatus: 200,
    usersLength: 2,
    uidMatchesCurrentUser: true,
    tenantIdPresent: true,
    mfaInfoLength: 6,
    mfaEntries: [
      {
        hasEnrollmentId: false,
        hasEnrolledAt: false,
        hasDisplayName: false,
        hasPhoneInfo: false,
        totpInfoPresent: false,
        totpInfoType: 'invalid',
        totpInfoKeyCount: 0,
      },
      {
        hasEnrollmentId: true,
        hasEnrolledAt: true,
        hasDisplayName: true,
        hasPhoneInfo: true,
        totpInfoPresent: false,
        totpInfoType: 'missing',
        totpInfoKeyCount: 0,
      },
      {
        hasEnrollmentId: false,
        hasEnrolledAt: false,
        hasDisplayName: false,
        hasPhoneInfo: false,
        totpInfoPresent: false,
        totpInfoType: 'null',
        totpInfoKeyCount: 0,
      },
      {
        hasEnrollmentId: false,
        hasEnrolledAt: false,
        hasDisplayName: false,
        hasPhoneInfo: false,
        totpInfoPresent: true,
        totpInfoType: 'string',
        totpInfoKeyCount: 0,
      },
      {
        hasEnrollmentId: false,
        hasEnrolledAt: false,
        hasDisplayName: false,
        hasPhoneInfo: false,
        totpInfoPresent: true,
        totpInfoType: 'array',
        totpInfoKeyCount: 2,
      },
      {
        hasEnrollmentId: true,
        hasEnrolledAt: true,
        hasDisplayName: true,
        hasPhoneInfo: false,
        totpInfoPresent: true,
        totpInfoType: 'object',
        totpInfoKeyCount: 3,
      },
    ],
    audMatchesConfiguredProject: true,
    signInProvider: 'google.com',
    tenantPresent: true,
    secondFactor: 'totp',
    subjectMatchesCurrentUser: true,
  };

  it('drops sensitive fields that are present on the lookup and the ID token', () => {
    const built = buildTotpDiagnosticSummary({
      httpStatus: 200,
      body,
      idToken: token,
      currentUid,
      projectId,
    });
    const line = formatTotpDiagnosticLine(built);

    expect(built).toEqual(summary);
    expect(Object.keys(built)).toEqual([
      'httpStatus',
      'usersLength',
      'uidMatchesCurrentUser',
      'tenantIdPresent',
      'mfaInfoLength',
      'mfaEntries',
      'audMatchesConfiguredProject',
      'signInProvider',
      'tenantPresent',
      'secondFactor',
      'subjectMatchesCurrentUser',
    ]);
    for (const entry of built.mfaEntries) {
      expect(Object.keys(entry)).toEqual([
        'hasEnrollmentId',
        'hasEnrolledAt',
        'hasDisplayName',
        'hasPhoneInfo',
        'totpInfoPresent',
        'totpInfoType',
        'totpInfoKeyCount',
      ]);
    }
    expect(isSafeTotpDiagnosticLine(line)).toBe(true);
    absentSecrets(line, secrets);
    expect(line.startsWith(`${TOTP_DIAGNOSTIC_LOG_PREFIX} `)).toBe(true);
    expect(TOTP_DIAGNOSTIC_LOG_PREFIX).toBe('[Auth][TOTP diagnostic]');
  });

  it('prints that summary once through console.info', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const getIdToken = vi.fn(async () => token);
    const fetchImpl = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify(body), { status: 200 }),
    );

    try {
      await reportUnconfirmedTotpLookup({
        production: false,
        apiKey,
        projectId,
        currentUid,
        getIdToken,
        fetchImpl,
      });

      expect(getIdToken).toHaveBeenCalledWith(true);
      expect(fetchImpl).toHaveBeenCalledOnce();
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      );
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
      expect(JSON.parse(String(init?.body))).toEqual({ idToken: token });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(info).toHaveBeenCalledOnce();
      expect(info.mock.calls[0]).toEqual([formatTotpDiagnosticLine(summary)]);
      expect(warn).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      absentSecrets(String(info.mock.calls[0][0]), secrets);
    } finally {
      info.mockRestore();
      warn.mockRestore();
      log.mockRestore();
      error.mockRestore();
    }
  });

  it('ignores an email stuffed into the provider claim', () => {
    const claims = summarizeIdTokenClaims(
      unsignedJwt({
        aud: projectId,
        sub: currentUid,
        email,
        firebase: {
          sign_in_provider: email,
          sign_in_second_factor: 'factor-SECRET',
          tenant: '',
        },
      }),
      currentUid,
      projectId,
    );

    expect(claims).toEqual({
      audMatchesConfiguredProject: true,
      signInProvider: null,
      tenantPresent: false,
      secondFactor: null,
      subjectMatchesCurrentUser: true,
    });
    absentSecrets(JSON.stringify(claims), [email, 'factor-SECRET', currentUid, projectId]);
  });

  it('reports the matching user when an earlier user has factors', () => {
    const shape = summarizeAccountsLookupBody(
      {
        users: [
          { localId: 'other-SECRET', mfaInfo: [{ totpInfo: { secretKey: 'DECOYSECRET' } }] },
          { localId: currentUid, tenantId: 'tenant-SECRET', mfaInfo: [] },
        ],
      },
      currentUid,
    );

    expect(shape).toEqual({
      usersLength: 2,
      uidMatchesCurrentUser: true,
      tenantIdPresent: true,
      mfaInfoLength: 0,
      mfaEntries: [],
    });
    absentSecrets(JSON.stringify(shape), [
      'other-SECRET',
      'DECOYSECRET',
      'tenant-SECRET',
      currentUid,
    ]);
  });

  it('handles malformed lookup bodies and tokens', () => {
    const empty = {
      usersLength: 0,
      uidMatchesCurrentUser: false,
      tenantIdPresent: false,
      mfaInfoLength: 0,
      mfaEntries: [],
    };
    const emptyClaims = {
      audMatchesConfiguredProject: false,
      signInProvider: null,
      tenantPresent: false,
      secondFactor: null,
      subjectMatchesCurrentUser: false,
    };

    for (const malformed of [null, undefined, [], 'users', { users: null }, { users: {} }]) {
      expect(summarizeAccountsLookupBody(malformed, currentUid)).toEqual(empty);
    }
    expect(
      summarizeAccountsLookupBody({ users: [{ mfaInfo: 'secretKey=MFASECRETKEY' }] }, currentUid),
    ).toEqual({
      ...empty,
      usersLength: 1,
    });
    for (const malformedToken of ['', 'not-a-jwt', 'a.%%%.c', token.slice(0, 8)]) {
      expect(summarizeIdTokenClaims(malformedToken, currentUid, projectId)).toEqual(emptyClaims);
    }
    expect(() =>
      buildTotpDiagnosticSummary({
        httpStatus: 200,
        body: { users: 'nope', email, idToken: token },
        idToken: 'not-a-jwt',
        currentUid,
        projectId,
      }),
    ).not.toThrow();
    absentSecrets(
      JSON.stringify(
        buildTotpDiagnosticSummary({
          httpStatus: 200,
          body: { users: 'nope', email, idToken: token, refreshToken: 'refresh-SECRET' },
          idToken: 'not-a-jwt',
          currentUid,
          projectId,
        }),
      ),
      [email, token, 'refresh-SECRET', 'not-a-jwt'],
    );
  });

  it('keeps only safe error codes', () => {
    expect(sanitizeDiagnosticErrorCode('INVALID_ID_TOKEN')).toBe('INVALID_ID_TOKEN');
    expect(sanitizeDiagnosticErrorCode('auth/network-request-failed')).toBe(
      'auth/network-request-failed',
    );
    expect(sanitizeDiagnosticErrorCode('MFASECRETKEY')).toBe('unavailable');
    expect(sanitizeDiagnosticErrorCode(email)).toBe('unavailable');
    expect(sanitizeDiagnosticErrorCode(token)).toBe('unavailable');
    expect(sanitizeDiagnosticErrorCode('INVALID_ID_TOKEN eyJabc')).toBe('unavailable');
    expect(sanitizeDiagnosticErrorCode(400)).toBe('unavailable');
    expect(isSafeTotpDiagnosticLine(formatTotpDiagnosticFailure(400, 'INVALID_ID_TOKEN'))).toBe(
      true,
    );
    expect(isSafeTotpDiagnosticLine(`${TOTP_DIAGNOSTIC_LOG_PREFIX} ${email}`)).toBe(false);
    expect(formatTotpDiagnosticFailure(700, 'MFASECRETKEY')).toBe(
      `${TOTP_DIAGNOSTIC_LOG_PREFIX} {"httpStatus":0,"errorCode":"unavailable"}`,
    );
  });
});

describe('reportUnconfirmedTotpLookup', () => {
  it('performs no token refresh, lookup, or log in production', async () => {
    const getIdToken = vi.fn(async () => {
      throw new Error('idToken=eyJshould-not-run');
    });
    const fetchImpl = vi.fn();
    const log = vi.fn();

    await reportUnconfirmedTotpLookup({
      production: true,
      apiKey,
      projectId,
      currentUid,
      getIdToken,
      fetchImpl,
      log,
    });

    expect(getIdToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('logs only status and a safe code when lookup fails', async () => {
    const log = vi.fn();
    const token = unsignedJwt({ sub: currentUid, email });
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: 'INVALID_ID_TOKEN',
              status: 'INVALID_ARGUMENT',
              errors: [{ message: `raw body leak-SECRET ${email} ${token}` }],
            },
          }),
          { status: 400 },
        ),
    );

    await reportUnconfirmedTotpLookup({
      production: false,
      apiKey,
      projectId,
      currentUid,
      getIdToken: vi.fn(async (forceRefresh: boolean) => {
        expect(forceRefresh).toBe(true);
        return token;
      }),
      fetchImpl,
      log,
    });

    expect(log).toHaveBeenCalledOnce();
    const line = String(log.mock.calls[0][0]);
    expect(line).toBe(
      `${TOTP_DIAGNOSTIC_LOG_PREFIX} {"httpStatus":400,"errorCode":"INVALID_ID_TOKEN"}`,
    );
    expect(Object.keys(JSON.parse(line.slice(TOTP_DIAGNOSTIC_LOG_PREFIX.length + 1)))).toEqual([
      'httpStatus',
      'errorCode',
    ]);
    absentSecrets(line, [token, email, apiKey, 'leak-SECRET']);
  });

  it('prefers a safe status when the error message itself is sensitive', async () => {
    const log = vi.fn();
    await reportUnconfirmedTotpLookup({
      production: false,
      apiKey,
      projectId,
      currentUid,
      getIdToken: async () => unsignedJwt({ sub: currentUid }),
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: { message: 'MFASECRETKEY', status: 'INVALID_ARGUMENT' },
          }),
          { status: 400 },
        ),
      log,
    });

    expect(log.mock.calls[0][0]).toBe(
      `${TOTP_DIAGNOSTIC_LOG_PREFIX} {"httpStatus":400,"errorCode":"INVALID_ARGUMENT"}`,
    );
    expect(String(log.mock.calls[0][0])).not.toContain('MFASECRETKEY');
  });

  it('does not fetch or repeat a token error message', async () => {
    const log = vi.fn();
    const fetchImpl = vi.fn();
    const failure = new Error(`Firebase: token eyJsecret for ${email}`);
    (failure as Error & { code: string }).code = 'auth/network-request-failed';

    await reportUnconfirmedTotpLookup({
      production: false,
      apiKey,
      projectId,
      currentUid,
      getIdToken: async () => {
        throw failure;
      },
      fetchImpl,
      log,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toBe(
      `${TOTP_DIAGNOSTIC_LOG_PREFIX} {"httpStatus":0,"errorCode":"auth/network-request-failed"}`,
    );
    absentSecrets(String(log.mock.calls[0][0]), ['eyJsecret', email, apiKey]);
  });

  it('logs a network failure without the thrown message', async () => {
    const log = vi.fn();
    const token = unsignedJwt({ sub: currentUid });
    await reportUnconfirmedTotpLookup({
      production: false,
      apiKey,
      projectId,
      currentUid,
      getIdToken: async () => token,
      fetchImpl: async () => {
        throw new TypeError(`Failed to fetch key=${apiKey} idToken=${token}`);
      },
      log,
    });

    expect(log.mock.calls[0][0]).toBe(
      `${TOTP_DIAGNOSTIC_LOG_PREFIX} {"httpStatus":0,"errorCode":"network"}`,
    );
    absentSecrets(String(log.mock.calls[0][0]), [token, apiKey]);
  });

  it('logs timeout without the abort message', async () => {
    const log = vi.fn();
    const token = unsignedJwt({ sub: currentUid, email });
    const abort = new Error(`aborted key=${apiKey} idToken=${token}`);
    abort.name = 'AbortError';

    await reportUnconfirmedTotpLookup({
      production: false,
      apiKey,
      projectId,
      currentUid,
      getIdToken: async () => token,
      fetchImpl: async () => {
        throw abort;
      },
      log,
    });

    expect(String(log.mock.calls[0][0])).toContain('"errorCode":"timeout"');
    absentSecrets(String(log.mock.calls[0][0]), [token, apiKey, email]);
  });

  it('logs an unreadable body without echoing it', async () => {
    const log = vi.fn();
    const raw = `{"idToken":"eyJleak","email":"${email}"`;
    await expect(
      reportUnconfirmedTotpLookup({
        production: false,
        apiKey,
        projectId,
        currentUid,
        getIdToken: async () => unsignedJwt({ sub: currentUid }),
        fetchImpl: async () => new Response(raw, { status: 200 }),
        log,
      }),
    ).resolves.toBeUndefined();

    expect(log.mock.calls[0][0]).toBe(
      `${TOTP_DIAGNOSTIC_LOG_PREFIX} {"httpStatus":200,"errorCode":"unreadable"}`,
    );
    absentSecrets(String(log.mock.calls[0][0]), ['eyJleak', email]);
  });

  it('does not request a token when the API key is missing', async () => {
    const getIdToken = vi.fn();
    const fetchImpl = vi.fn();
    const log = vi.fn();

    await reportUnconfirmedTotpLookup({
      production: false,
      apiKey: '',
      projectId,
      currentUid,
      getIdToken,
      fetchImpl,
      log,
    });

    expect(getIdToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toContain('"errorCode":"unavailable"');
  });
});

describe('shouldRunTotpEnrollmentDiagnostic', () => {
  it('runs only outside production when enrollment is unconfirmed', () => {
    expect(shouldRunTotpEnrollmentDiagnostic(true, false)).toBe(false);
    expect(shouldRunTotpEnrollmentDiagnostic(false, true)).toBe(false);
    expect(shouldRunTotpEnrollmentDiagnostic(false, false)).toBe(true);
  });
});
