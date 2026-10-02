import {
  allowlistedSignInProvider,
  collectIdentityContextProbeEvent,
  emitIdentityContextProbe,
  formatIdentityContextProbeLine,
  IDENTITY_CONTEXT_PROBE_LOG_PREFIX,
  isSafeIdentityContextProbeLine,
  secondFactorClaimPresent,
  toIdentityContextProbeSource,
  type IdentityContextProbeSource,
} from './identity-context-probe';

const email = 'wthompson@ucsb.edu';
const currentUid = 'uid-SECRET';
const projectId = 'project-SHOULD-NOT-LOG';
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
const tenantId = 'tenant-SECRET';

function absentSecrets(text: string, secrets: readonly string[]): void {
  for (const secret of secrets) {
    expect(text).not.toContain(secret);
  }
}

const secrets = [
  email,
  currentUid,
  projectId,
  apiKey,
  otp,
  secretKey,
  qrUri,
  idToken,
  refreshToken,
  sessionInfo,
  enrollmentId,
  factorId,
  tenantId,
  'SHOULD_NOT_LEAK',
  'BEGIN PRIVATE',
];

function guardedIdTokenResult(options?: {
  signInProvider?: string | null;
  signInSecondFactor?: string | null;
  aud?: unknown;
  sub?: unknown;
  tenant?: unknown;
}): unknown {
  return {
    get signInProvider() {
      return options?.signInProvider ?? 'google.com';
    },
    get signInSecondFactor() {
      return options?.signInSecondFactor ?? 'totp';
    },
    get token() {
      throw new Error('token was read');
    },
    get claims() {
      return {
        get aud() {
          return options?.aud ?? projectId;
        },
        get sub() {
          return options?.sub ?? currentUid;
        },
        get email() {
          return email;
        },
        get user_id() {
          return currentUid;
        },
        get firebase() {
          return {
            get tenant() {
              return options && 'tenant' in options ? options.tenant : tenantId;
            },
            get identities() {
              return { 'google.com': [email] };
            },
            get sign_in_provider() {
              return 'google.com';
            },
            get second_factor_identifier() {
              return factorId;
            },
          };
        },
      };
    },
  };
}

function matchingSource(
  overrides?: Partial<IdentityContextProbeSource> & {
    getIdTokenResult?: IdentityContextProbeSource['getIdTokenResult'];
  },
): IdentityContextProbeSource {
  return {
    configuredProjectId: projectId,
    currentUid,
    authTenantId: null,
    localEnrolledFactorCount: 1,
    getIdTokenResult: async (forceRefresh: boolean) => {
      expect(forceRefresh).toBe(false);
      return guardedIdTokenResult();
    },
    ...overrides,
  };
}

describe('Identity context probe schema', () => {
  it('keeps a closed, secret-safe line for the identity-context event', async () => {
    const event = await collectIdentityContextProbeEvent(matchingSource());
    const line = formatIdentityContextProbeLine(event);

    expect(event).toEqual({
      event: 'identity-context',
      audMatchesConfiguredProject: true,
      subjectMatchesCurrentUser: true,
      tokenTenantPresent: true,
      authTenantPresent: false,
      signInProvider: 'google.com',
      secondFactorClaimPresent: true,
      localEnrolledFactorCount: 1,
    });
    expect(line).toBe(
      `${IDENTITY_CONTEXT_PROBE_LOG_PREFIX} {"event":"identity-context","audMatchesConfiguredProject":true,"subjectMatchesCurrentUser":true,"tokenTenantPresent":true,"authTenantPresent":false,"signInProvider":"google.com","secondFactorClaimPresent":true,"localEnrolledFactorCount":1}`,
    );
    expect(Object.keys(event)).toEqual([
      'event',
      'audMatchesConfiguredProject',
      'subjectMatchesCurrentUser',
      'tokenTenantPresent',
      'authTenantPresent',
      'signInProvider',
      'secondFactorClaimPresent',
      'localEnrolledFactorCount',
    ]);
    expect(isSafeIdentityContextProbeLine(line)).toBe(true);
    absentSecrets(line, secrets);
    expect(IDENTITY_CONTEXT_PROBE_LOG_PREFIX).toBe('[Auth][Identity context probe]');
  });

  it('redacts unsafe providers and unknown second-factor values', () => {
    expect(allowlistedSignInProvider('google.com')).toBe('google.com');
    expect(allowlistedSignInProvider('password')).toBe('password');
    expect(allowlistedSignInProvider('custom')).toBe('custom');
    expect(allowlistedSignInProvider('anonymous')).toBe('anonymous');
    expect(allowlistedSignInProvider('phone')).toBe('phone');
    expect(allowlistedSignInProvider('facebook.com')).toBeNull();
    expect(allowlistedSignInProvider(email)).toBeNull();
    expect(allowlistedSignInProvider(currentUid)).toBeNull();
    expect(allowlistedSignInProvider(idToken)).toBeNull();
    expect(secondFactorClaimPresent('totp')).toBe(true);
    expect(secondFactorClaimPresent('phone')).toBe(true);
    expect(secondFactorClaimPresent(email)).toBe(false);
    expect(secondFactorClaimPresent(factorId)).toBe(false);
    expect(secondFactorClaimPresent(null)).toBe(false);
    expect(isSafeIdentityContextProbeLine(`${IDENTITY_CONTEXT_PROBE_LOG_PREFIX} ${email}`)).toBe(
      false,
    );
    expect(isSafeIdentityContextProbeLine(`${IDENTITY_CONTEXT_PROBE_LOG_PREFIX} ${idToken}`)).toBe(
      false,
    );
  });

  it('treats stuffed claim values as absent and never logs them', async () => {
    const event = await collectIdentityContextProbeEvent(
      matchingSource({
        getIdTokenResult: async () =>
          guardedIdTokenResult({
            signInProvider: email,
            signInSecondFactor: factorId,
            aud: email,
            sub: email,
            tenant: email,
          }),
      }),
    );
    const line = formatIdentityContextProbeLine(event);

    expect(event.signInProvider).toBeNull();
    expect(event.secondFactorClaimPresent).toBe(false);
    expect(event.audMatchesConfiguredProject).toBe(false);
    expect(event.subjectMatchesCurrentUser).toBe(false);
    expect(event.tokenTenantPresent).toBe(true);
    expect(isSafeIdentityContextProbeLine(line)).toBe(true);
    absentSecrets(line, secrets);
  });
});

describe('Identity context probe gating and token restrictions', () => {
  it('writes probe lines only outside production and skips token work', async () => {
    const getIdTokenResult = vi.fn(async () => guardedIdTokenResult());
    const source = vi.fn(() =>
      matchingSource({
        getIdTokenResult,
        authTenantId: tenantId,
      }),
    );
    const log = vi.fn();

    await emitIdentityContextProbe(true, source, log);
    await emitIdentityContextProbe(false, source, log);

    expect(source).toHaveBeenCalledOnce();
    expect(getIdTokenResult).toHaveBeenCalledOnce();
    expect(getIdTokenResult).toHaveBeenCalledWith(false);
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      `${IDENTITY_CONTEXT_PROBE_LOG_PREFIX} {"event":"identity-context","audMatchesConfiguredProject":true,"subjectMatchesCurrentUser":true,"tokenTenantPresent":true,"authTenantPresent":true,"signInProvider":"google.com","secondFactorClaimPresent":true,"localEnrolledFactorCount":1}`,
    );
    absentSecrets(String(log.mock.calls[0]?.[0]), secrets);
  });

  it('calls getIdTokenResult(false) only and never token or claims secrets', async () => {
    const getIdTokenResult = vi.fn(async (forceRefresh: boolean) => {
      expect(forceRefresh).toBe(false);
      return guardedIdTokenResult({ signInSecondFactor: 'phone', tenant: undefined });
    });

    const event = await collectIdentityContextProbeEvent(
      matchingSource({
        getIdTokenResult,
        localEnrolledFactorCount: 2,
      }),
    );
    const line = formatIdentityContextProbeLine(event);

    expect(getIdTokenResult).toHaveBeenCalledOnce();
    expect(getIdTokenResult).toHaveBeenCalledWith(false);
    expect(event).toEqual({
      event: 'identity-context',
      audMatchesConfiguredProject: true,
      subjectMatchesCurrentUser: true,
      tokenTenantPresent: false,
      authTenantPresent: false,
      signInProvider: 'google.com',
      secondFactorClaimPresent: true,
      localEnrolledFactorCount: 2,
    });
    absentSecrets(line, secrets);
  });

  it('counts enrolled factors as a number and never logs factor IDs', () => {
    const source = toIdentityContextProbeSource(
      {
        uid: currentUid,
        tenantId,
        multiFactor: {
          enrolledFactors: [{ uid: factorId, factorId: enrollmentId }, { factorId: 'totp' }],
        },
        getIdTokenResult: async () => guardedIdTokenResult(),
      },
      null,
      projectId,
    );

    expect(source?.localEnrolledFactorCount).toBe(2);
    expect(source?.authTenantId).toBe(tenantId);
    expect(source?.currentUid).toBe(currentUid);
    expect(JSON.stringify(source)).not.toContain(enrollmentId);
    expect(source && 'enrolledFactors' in source).toBe(false);
  });

  it('does not emit for a signed-out user and contains collector failures', async () => {
    const log = vi.fn(() => {
      throw new Error(`idToken=${idToken} email=${email}`);
    });

    await expect(emitIdentityContextProbe(false, null, log)).resolves.toBeUndefined();
    await expect(
      emitIdentityContextProbe(
        false,
        () => {
          throw new Error(`resolver hint ${enrollmentId} ${email}`);
        },
        log,
      ),
    ).resolves.toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it('sets token booleans false when getIdTokenResult throws', async () => {
    const event = await collectIdentityContextProbeEvent(
      matchingSource({
        authTenantId: tenantId,
        getIdTokenResult: async () => {
          throw new Error(`token=${idToken} email=${email}`);
        },
      }),
    );
    const line = formatIdentityContextProbeLine(event);

    expect(event).toEqual({
      event: 'identity-context',
      audMatchesConfiguredProject: false,
      subjectMatchesCurrentUser: false,
      tokenTenantPresent: false,
      authTenantPresent: true,
      signInProvider: null,
      secondFactorClaimPresent: false,
      localEnrolledFactorCount: 1,
    });
    absentSecrets(line, secrets);
  });

  it('matches audience arrays without logging project or token values', async () => {
    const event = await collectIdentityContextProbeEvent(
      matchingSource({
        getIdTokenResult: async () =>
          guardedIdTokenResult({
            aud: ['other-aud-SECRET', projectId],
            sub: currentUid,
            tenant: tenantId,
          }),
      }),
    );
    const line = formatIdentityContextProbeLine(event);

    expect(event.audMatchesConfiguredProject).toBe(true);
    expect(event.subjectMatchesCurrentUser).toBe(true);
    absentSecrets(line, [...secrets, 'other-aud-SECRET']);
  });
});
