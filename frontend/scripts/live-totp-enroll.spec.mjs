import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  DISPOSABLE_EMAIL,
  assertCleanupTarget,
  assertDisposableEmail,
  assertInitializedProject,
  assertLivePreconditions,
  assertNoTargetArguments,
  assertUserGone,
  buildTotpOtpauthUri,
  challengeOutcome,
  clientAuthUsesEmulator,
  clockSkewSeconds,
  compareOtpauthSecrets,
  createDisposableEmail,
  createDisposableIdentity,
  createFinalizeDateCapture,
  decodeBase32,
  enrollmentOutcome,
  hotp,
  main,
  millisUntilFreshCode,
  publicErrorCode,
  readIdTokenSecondFactor,
  readWebConfigFromJson,
  readWebConfigFromSource,
  requireTotpParameters,
  safeErrorText,
  safeLogRecord,
  selectRejectedCode,
  totpAccountLabel,
  totpCode,
  totpCodesAround,
  wrongCodeOutcome,
} from './live-totp-enroll.mjs';

const SHA1_SEED = '12345678901234567890';
const SHA1_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const SHA256_SEED = '12345678901234567890123456789012';
const SHA512_SEED = '1234567890123456789012345678901234567890123456789012345678901234';
const PRIVATE_KEY = 'not-a-real-key-material';

function passingEnv(overrides = {}) {
  return {
    RUN_LIVE_TOTP_ENROLL: '1',
    LIVE_TOTP_PROJECT_ID: 'test-project',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: 'test-project',
      client_email: 'totp-test@test-project.iam.gserviceaccount.com',
      private_key: `-----BEGIN PRIVATE KEY-----\n${PRIVATE_KEY}\n-----END PRIVATE KEY-----\n`,
    }),
    ...overrides,
  };
}

function fakeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('live TOTP safety guards', () => {
  it('refuses unless every opt-in flag is present and the project matches', () => {
    assert.throws(() => assertLivePreconditions({}), /RUN_LIVE_TOTP_ENROLL=1/);
    assert.throws(
      () => assertLivePreconditions(passingEnv({ RUN_LIVE_TOTP_ENROLL: 'true' })),
      /RUN_LIVE_TOTP_ENROLL=1/,
    );
    assert.throws(
      () => assertLivePreconditions(passingEnv({ FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })),
      /FIREBASE_AUTH_EMULATOR_HOST/,
    );
    assert.throws(
      () => assertLivePreconditions(passingEnv({ LIVE_TOTP_PROJECT_ID: '' })),
      /LIVE_TOTP_PROJECT_ID/,
    );
    assert.throws(
      () => assertLivePreconditions(passingEnv({ LIVE_TOTP_PROJECT_ID: 'other-project' })),
      (error) => {
        assert.match(error.message, /does not match the service account project/);
        assert.equal(error.message.includes(PRIVATE_KEY), false);
        assert.equal(error.message.includes('BEGIN PRIVATE KEY'), false);
        return true;
      },
    );
    assert.throws(
      () => assertLivePreconditions(passingEnv({ FIREBASE_SERVICE_ACCOUNT_JSON: '{not json' })),
      (error) => {
        assert.match(error.message, /not valid JSON/);
        assert.equal(error.message.includes('not json'), false);
        return true;
      },
    );

    const serviceAccount = assertLivePreconditions(passingEnv());
    assert.equal(serviceAccount.projectId, 'test-project');
    assert.equal(serviceAccount.credentialSource, 'service-account-json');

    const adc = assertLivePreconditions(
      {
        RUN_LIVE_TOTP_ENROLL: '1',
        LIVE_TOTP_PROJECT_ID: 'test-project',
        FIREBASE_AUTH_EMULATOR_HOST: '   ',
      },
      { adcFileExists: true },
    );
    assert.equal(adc.credentialSource, 'application-default');
    assert.equal(adc.serviceAccount, null);
    assert.throws(
      () =>
        assertLivePreconditions({
          RUN_LIVE_TOTP_ENROLL: '1',
          LIVE_TOTP_PROJECT_ID: 'test-project',
        }),
      /Application Default Credentials/,
    );
  });

  it('refuses an email argument and any non-disposable address', () => {
    assert.throws(
      () => assertNoTargetArguments(['node', 'live-totp-enroll.mjs', 'wthompson@ucsb.edu']),
      /no email argument/,
    );
    assert.doesNotThrow(() => assertNoTargetArguments(['node', 'live-totp-enroll.mjs']));
    assert.throws(() => assertDisposableEmail('wthompson@ucsb.edu'), /disposable prefix/);
    const email = createDisposableEmail('ab'.repeat(8));
    assert.match(email, DISPOSABLE_EMAIL);
    assert.equal(email, 'totp-disposable-abababababababab@totp-test.invalid');
    const identity = createDisposableIdentity((size) => Buffer.alloc(size, 0xab));
    assert.match(identity.email, DISPOSABLE_EMAIL);
    assert.equal(identity.displayName, 'DISPOSABLE TOTP TEST');
    assert.ok(identity.password.length >= 6);
    assert.equal(identity.password.includes(identity.email), false);
  });

  it('cleans up only the uid and email this process created', () => {
    const email = 'totp-disposable-0123456789abcdef@totp-test.invalid';
    const expected = { uid: 'uid-created', email };
    assert.doesNotThrow(() => assertCleanupTarget(expected, { uid: 'uid-created', email }));
    assert.doesNotThrow(() =>
      assertCleanupTarget(expected, {
        uid: 'uid-created',
        email: 'TOTP-DISPOSABLE-0123456789ABCDEF@TOTP-TEST.INVALID',
      }),
    );
    assert.throws(
      () => assertCleanupTarget(expected, { uid: 'someone-else', email }),
      /uid uid-created: uid guard failed/,
    );
    assert.throws(
      () => assertCleanupTarget(expected, { uid: 'uid-created', email: 'wthompson@ucsb.edu' }),
      /uid uid-created: email guard failed/,
    );
    assert.throws(() => assertUserGone({ code: 'auth/internal-error' }), /Post-delete verification failed/);
    assert.doesNotThrow(() => assertUserGone({ code: 'auth/user-not-found' }));
    assert.throws(() => assertInitializedProject('other-project', 'test-project'), /Admin project/);
    assert.equal(clientAuthUsesEmulator({ emulatorConfig: { host: '127.0.0.1' } }), true);
    assert.equal(clientAuthUsesEmulator({ config: { emulator: { url: 'http://127.0.0.1' } } }), true);
    assert.equal(clientAuthUsesEmulator({}), false);
  });

  it('refuses to start before any network call', async () => {
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = (...args) => {
      calls.push(args);
      throw new Error('network was contacted');
    };
    try {
      await assert.rejects(
        () => main({}, { argv: ['node', 'live-totp-enroll.mjs'], adcFileExists: false }),
        /RUN_LIVE_TOTP_ENROLL=1/,
      );
      assert.equal(calls.length, 0);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('does not log passwords, secrets, OTPs, ID tokens, or credential JSON', () => {
    const token = fakeJwt({ firebase: { sign_in_second_factor: 'totp' } });
    const record = safeLogRecord('debug', {
      password: 'hunter2',
      secretKey: SHA1_SECRET,
      otp: '94287082',
      idToken: token,
      private_key: PRIVATE_KEY,
      algorithm: 'sha1',
      digits: 8,
    });
    const text = JSON.stringify(record);
    assert.equal(text.includes('hunter2'), false);
    assert.equal(text.includes(SHA1_SECRET), false);
    assert.equal(text.includes('94287082'), false);
    assert.equal(text.includes(token), false);
    assert.equal(text.includes(PRIVATE_KEY), false);
    assert.equal(record.algorithm, 'sha1');
    assert.match(safeErrorText(new Error(`token ${token}`)), /^Live TOTP enroll failed\.$/);
    assert.match(safeErrorText(new Error(`key ${PRIVATE_KEY} BEGIN PRIVATE KEY`)), /^Live TOTP enroll failed\.$/);
    assert.equal(publicErrorCode({ code: 'auth/invalid-verification-code' }), 'auth/invalid-verification-code');
    assert.equal(publicErrorCode({ code: 'sessionInfo=abc otp=123456' }), null);
  });

  it('keeps client config errors free of config values', () => {
    const source = `
      firebase: { config: {
        apiKey: 'super-secret-api-key',
        authDomain: 'example.firebaseapp.com',
        projectId: 'test-project',
        storageBucket: 'example.appspot.com',
        messagingSenderId: '123',
        appId: '1:123:web:abc',
      } }
    `;
    assert.equal(readWebConfigFromSource(source, 'test-project').projectId, 'test-project');
    assert.throws(() => readWebConfigFromSource(source, 'other-project'), (error) => {
      assert.match(error.message, /client config project/);
      assert.equal(error.message.includes('super-secret-api-key'), false);
      return true;
    });
    assert.throws(() => readWebConfigFromJson('{', 'test-project'), /not valid JSON/);
  });

  it('does not search or delete users by a broad query', () => {
    const source = readFileSync(new URL('./live-totp-enroll.mjs', import.meta.url), 'utf8');
    assert.equal(source.includes('listUsers'), false);
    assert.equal(source.includes('getUserByEmail'), false);
    assert.equal(source.includes('wthompson@ucsb.edu'), false);
    assert.match(source, /deleteUser\(record\.uid\)/);
  });
});

describe('base32 and RFC 6238', () => {
  it('decodes RFC 4648 base32 and the SHA1 authenticator seed', () => {
    assert.equal(decodeBase32('MZXW6===').toString('utf8'), 'foo');
    assert.equal(decodeBase32('MZXW6YQ=').toString('utf8'), 'foob');
    assert.equal(decodeBase32('MZXW6YTB').toString('utf8'), 'fooba');
    assert.equal(decodeBase32('MZXW6YTBOI======').toString('utf8'), 'foobar');
    assert.equal(decodeBase32(SHA1_SECRET).toString('utf8'), SHA1_SEED);
    assert.throws(() => decodeBase32('not-base32'), /not base32/);
  });

  it('matches the RFC 4226 and RFC 6238 test vectors', () => {
    const sha1 = Buffer.from(SHA1_SEED);
    assert.equal(hotp(sha1, 0, { algorithm: 'SHA1', digits: 6 }), '755224');
    assert.equal(hotp(sha1, 1, { algorithm: 'SHA1', digits: 6 }), '287082');
    assert.equal(totpCode(SHA1_SECRET, { algorithm: 'sha1', digits: 8, periodSeconds: 30, timestampMs: 59_000 }), '94287082');
    assert.equal(
      totpCode(SHA1_SECRET, {
        algorithm: 'SHA1',
        digits: 8,
        periodSeconds: 30,
        timestampMs: 1_111_111_109_000,
      }),
      '07081804',
    );
    assert.equal(
      totpCode(SHA1_SECRET, {
        algorithm: 'SHA1',
        digits: 8,
        periodSeconds: 30,
        timestampMs: 20_000_000_000_000,
      }),
      '65353130',
    );
    assert.equal(hotp(Buffer.from(SHA256_SEED), 1, { algorithm: 'SHA256', digits: 8 }), '46119246');
    assert.equal(hotp(Buffer.from(SHA512_SEED), 1, { algorithm: 'SHA512', digits: 8 }), '90693936');
  });

  it('picks a wrong code outside the acceptance window', () => {
    const options = { algorithm: 'SHA1', digits: 6, periodSeconds: 30, timestampMs: 1_111_111_109_000 };
    const banned = totpCodesAround(SHA1_SECRET, options);
    const rejected = selectRejectedCode(banned, 6);
    assert.equal(banned.includes(rejected), false);
    assert.match(rejected, /^\d{6}$/);
    const params = requireTotpParameters({
      hashingAlgorithm: 'SHA1',
      codeLength: 6,
      codeIntervalSeconds: 30,
      enrollmentCompletionDeadline: '2099-01-01T00:00:00.000Z',
      secretKey: SHA1_SECRET,
    });
    assert.deepEqual(
      { algorithm: params.algorithm, digits: params.digits, periodSeconds: params.periodSeconds, secretKeyIsBase32: params.secretKeyIsBase32 },
      { algorithm: 'sha1', digits: 6, periodSeconds: 30, secretKeyIsBase32: true },
    );
    assert.throws(() => requireTotpParameters({ hashingAlgorithm: '', codeLength: 6, codeIntervalSeconds: 30 }), /Unsupported TOTP algorithm/);
  });
});

describe('enrollment checks', () => {
  it('keeps the Duo label and compares secrets without printing them', () => {
    const uri = buildTotpOtpauthUri({
      issuer: 'Eco Plan Tool',
      accountName: 'wthompson@ucsb.edu',
      secretKey: 'MFASECRETKEY',
      algorithm: 'SHA1',
      digits: 6,
      periodSeconds: 30,
    });
    assert.equal(totpAccountLabel('wthompson@ucsb.edu'), 'Eco Plan Tool (wthompson@ucsb.edu)');
    assert.match(uri, /^otpauth:\/\/totp\/Eco%20Plan%20Tool%20\(wthompson%40ucsb\.edu\)\?/);
    assert.equal(uri.includes('%3A'), false);
    const padded = buildTotpOtpauthUri({
      issuer: 'Eco Plan Tool',
      accountName: 'totp-disposable-0123456789abcdef@totp-test.invalid',
      secretKey: 'ABCD====',
      algorithm: 'SHA1',
      digits: 6,
      periodSeconds: 30,
    });
    const compared = compareOtpauthSecrets('ABCD====', [
      { source: 'app', uri: padded },
      { source: 'sdk', uri: 'otpauth://totp/Example:user?secret=ABCD====&issuer=Example' },
    ]);
    assert.equal(compared.ok, true);
    assert.deepEqual(compared.notes, ['sdk-omits-period', 'sdk-leaves-characters-unencoded']);
    const mismatch = compareOtpauthSecrets('ABCD====', [
      { source: 'app', uri: padded },
      { source: 'sdk', uri: 'otpauth://totp/Example:user?secret=OTHER&period=30' },
    ]);
    assert.equal(mismatch.ok, false);
    assert.deepEqual(mismatch.failures, ['sdk:secret-mismatch']);
    assert.equal(JSON.stringify(mismatch).includes('ABCD'), false);
  });

  it('separates a rejected code, a persisted factor, and an empty client list', () => {
    assert.deepEqual(wrongCodeOutcome({ errorCode: 'auth/invalid-verification-code', adminFactorCount: 0 }), {
      ok: true,
      failure: null,
      errorCode: 'auth/invalid-verification-code',
    });
    assert.equal(
      wrongCodeOutcome({ errorCode: 'auth/invalid-multi-factor-session', adminFactorCount: 0 }).failure,
      'unexpected-error-code',
    );
    assert.equal(
      wrongCodeOutcome({ errorCode: 'auth/invalid-verification-code', adminFactorCount: 1 }).failure,
      'factor-persisted-after-rejection',
    );
    const hypothesis4 = enrollmentOutcome({
      adminFactorIds: ['totp'],
      clientFactorIdsBeforeRefresh: [],
      clientFactorIdsAfterRefresh: [],
      signInSecondFactor: null,
    });
    assert.equal(hypothesis4.ok, false);
    assert.equal(hypothesis4.failure, 'hypothesis-4-client-factors-empty');
    assert.equal(hypothesis4.adminTotpCount, 1);
    assert.equal(hypothesis4.clientFactorCountAfterRefresh, 0);
    const persisted = enrollmentOutcome({
      adminFactorIds: ['totp'],
      clientFactorIdsBeforeRefresh: [],
      clientFactorIdsAfterRefresh: ['totp'],
      signInSecondFactor: null,
    });
    assert.equal(persisted.ok, true);
    assert.equal(persisted.signInSecondFactor, null);
    assert.equal(
      enrollmentOutcome({
        adminFactorIds: [],
        clientFactorIdsBeforeRefresh: [],
        clientFactorIdsAfterRefresh: [],
        signInSecondFactor: null,
      }).failure,
      'admin-totp-not-persisted',
    );
    assert.equal(
      challengeOutcome({ errorCode: 'auth/multi-factor-auth-required', signInSecondFactor: null }).failure,
      'mfa-challenge-failed',
    );
    assert.equal(challengeOutcome({ errorCode: null, signInSecondFactor: 'totp' }).ok, true);
    assert.equal(challengeOutcome({ errorCode: null, signInSecondFactor: null }).failure, 'id-token-missing-totp-claim');
  });

  it('reads the second-factor claim and clock skew without keeping the token', async () => {
    const claims = readIdTokenSecondFactor(
      fakeJwt({
        firebase: { sign_in_second_factor: 'totp', second_factor_identifier: 'factor-1' },
      }),
    );
    assert.deepEqual(claims, { signInSecondFactor: 'totp', secondFactorIdentifierPresent: true });
    assert.equal(clockSkewSeconds(1_000, 'Thu, 01 Jan 1970 00:00:00 GMT'), 1);
    assert.equal(clockSkewSeconds(1_000, null), null);
    assert.equal(millisUntilFreshCode(59_000, 59_000, 30), 1_250);
    assert.equal(millisUntilFreshCode(60_000, 59_000, 30), 0);
    const capture = createFinalizeDateCapture(async () => ({
      headers: { get: (name) => (name === 'date' ? 'Thu, 01 Jan 1970 00:00:02 GMT' : null) },
    }));
    await capture.fetch('https://identitytoolkit.googleapis.com/v1/accounts/mfaEnrollment:finalize');
    assert.equal(capture.read(), 'Thu, 01 Jan 1970 00:00:02 GMT');
  });
});
