#!/usr/bin/env node
/**
 * Opt-in live TOTP enrollment check.
 *
 * Creates two disposable users, enrolls with codes computed in memory, then
 * deletes only those users. Firebase Auth emulator cannot enroll TOTP, so this
 * stays out of `yarn test`.
 *
 *   RUN_LIVE_TOTP_ENROLL=1 LIVE_TOTP_PROJECT_ID=<project> \
 *     yarn test:auth:totp:live
 *
 * Admin credentials (FIREBASE_SERVICE_ACCOUNT_JSON or Application Default
 * Credentials) are used only to create, read, and delete those users. Sign-in,
 * secret generation, enrollment, and the next sign-in challenge use the client
 * SDK. The script accepts no email argument.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DISPOSABLE_EMAIL = /^totp-disposable-[0-9a-f]{16}@totp-test\.invalid$/;
export const DISPOSABLE_DISPLAY_NAME = 'DISPOSABLE TOTP TEST';
export const TOTP_ISSUER = 'Eco Plan Tool';
export const TOTP_DISPLAY_NAME = 'Authenticator app';
export const REJECTED_CODE_NEIGHBOR_STEPS = 5;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const SUPPORT_CODE_PATTERN = /^(auth|totp)\/[a-z0-9-]+$/;
const SENSITIVE_TEXT =
  /private_key|id_token|idToken|password|secretKey|secret=|otp|BEGIN |eyJ[A-Za-z0-9_-]{20,}/i;
const WEB_CONFIG_KEYS = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
];
const SAFE_LOG_KEYS = new Set([
  'algorithm',
  'digits',
  'periodSeconds',
  'deadline',
  'secretKeyIsBase32',
  'uriNotes',
  'errorCode',
  'adminFactorCount',
  'adminTotpCount',
  'clientFactorCountBeforeRefresh',
  'clientFactorCountAfterRefresh',
  'clientTotpCountAfterRefresh',
  'signInSecondFactor',
  'secondFactorIdentifierPresent',
  'localTime',
  'finalizeDateHeader',
  'skewSeconds',
  'failure',
  'uid',
  'deleted',
  'credentialSource',
  'projectId',
  'waitMs',
  'ok',
]);

export function assertNoTargetArguments(argv) {
  const extras = argv.slice(2).filter((arg) => arg !== '--');
  if (extras.length > 0) {
    throw new Error(
      'Refusing live TOTP enroll: this script generates its own users and accepts no email argument.',
    );
  }
}

export function assertLivePreconditions(env, options = {}) {
  if (env.RUN_LIVE_TOTP_ENROLL !== '1') {
    throw new Error('Refusing live TOTP enroll: set RUN_LIVE_TOTP_ENROLL=1.');
  }
  if (emulatorHostIsSet(env)) {
    throw new Error('Refusing live TOTP enroll: unset FIREBASE_AUTH_EMULATOR_HOST.');
  }
  const projectId = typeof env.LIVE_TOTP_PROJECT_ID === 'string' ? env.LIVE_TOTP_PROJECT_ID.trim() : '';
  if (!projectId) {
    throw new Error('Refusing live TOTP enroll: set LIVE_TOTP_PROJECT_ID to the Firebase project.');
  }

  const serviceAccountJson =
    typeof env.FIREBASE_SERVICE_ACCOUNT_JSON === 'string' ? env.FIREBASE_SERVICE_ACCOUNT_JSON.trim() : '';
  if (serviceAccountJson) {
    const serviceAccount = parseServiceAccount(serviceAccountJson);
    if (serviceAccount.project_id !== projectId) {
      throw new Error(
        'Refusing live TOTP enroll: LIVE_TOTP_PROJECT_ID does not match the service account project.',
      );
    }
    return { projectId, credentialSource: 'service-account-json', serviceAccount };
  }

  const adcPath =
    typeof env.GOOGLE_APPLICATION_CREDENTIALS === 'string' && env.GOOGLE_APPLICATION_CREDENTIALS.trim();
  if (!adcPath && options.adcFileExists !== true) {
    throw new Error(
      'Refusing live TOTP enroll: set FIREBASE_SERVICE_ACCOUNT_JSON or Application Default Credentials.',
    );
  }
  return { projectId, credentialSource: 'application-default', serviceAccount: null };
}

export function emulatorHostIsSet(env) {
  return typeof env.FIREBASE_AUTH_EMULATOR_HOST === 'string' && env.FIREBASE_AUTH_EMULATOR_HOST.trim() !== '';
}

export function assertInitializedProject(initializedProjectId, expectedProjectId) {
  if (!initializedProjectId || initializedProjectId !== expectedProjectId) {
    throw new Error('Refusing live TOTP enroll: Admin project does not match LIVE_TOTP_PROJECT_ID.');
  }
}

export function clientAuthUsesEmulator(auth) {
  if (!auth || typeof auth !== 'object') {
    return false;
  }
  if (auth.emulatorConfig) {
    return true;
  }
  return Boolean(auth.config && auth.config.emulator);
}

export function defaultAdcPath(env, home = homedir()) {
  const configDir = env.CLOUDSDK_CONFIG?.trim() || path.join(home, '.config', 'gcloud');
  return path.join(configDir, 'application_default_credentials.json');
}

export function assertDisposableEmail(email) {
  if (typeof email !== 'string' || !DISPOSABLE_EMAIL.test(email)) {
    throw new Error('Refusing an email outside the disposable prefix and domain.');
  }
}

export function createDisposableEmail(randomHex) {
  if (typeof randomHex !== 'string' || !/^[0-9a-f]{16}$/.test(randomHex)) {
    throw new Error('Disposable email entropy is invalid.');
  }
  const email = `totp-disposable-${randomHex}@totp-test.invalid`;
  assertDisposableEmail(email);
  return email;
}

export function createDisposableIdentity(bytes = randomBytes) {
  return {
    email: createDisposableEmail(bytes(8).toString('hex')),
    password: bytes(24).toString('base64url'),
    displayName: DISPOSABLE_DISPLAY_NAME,
  };
}

function disposableEmail(email) {
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  return DISPOSABLE_EMAIL.test(normalized) ? normalized : null;
}

export function assertCleanupTarget(expected, loaded) {
  const uid = expected && typeof expected.uid === 'string' ? expected.uid : 'unknown';
  if (!expected || !loaded || expected.uid !== loaded.uid) {
    throw new Error(`Refusing cleanup for uid ${uid}: uid guard failed.`);
  }
  const expectedEmail = disposableEmail(expected.email);
  const loadedEmail = disposableEmail(loaded.email);
  if (!expectedEmail || expectedEmail !== loadedEmail) {
    throw new Error(`Refusing cleanup for uid ${expected.uid}: email guard failed.`);
  }
}

export function publicErrorCode(error) {
  const code = error && typeof error === 'object' ? error.code : undefined;
  return typeof code === 'string' && SUPPORT_CODE_PATTERN.test(code) ? code : null;
}

export function assertUserGone(error) {
  const code = publicErrorCode(error);
  if (code !== 'auth/user-not-found') {
    throw new Error(`Post-delete verification failed (${code ?? 'unrecognized-error'}).`);
  }
}

export function safeErrorText(error) {
  const code = publicErrorCode(error);
  const message = error instanceof Error ? error.message : '';
  if (!message || SENSITIVE_TEXT.test(message)) {
    return code ? `Live TOTP enroll failed (${code}).` : 'Live TOTP enroll failed.';
  }
  return code && !message.includes(code) ? `${message} (${code})` : message;
}

export function safeLogRecord(event, fields = {}) {
  const record = { event };
  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_LOG_KEYS.has(key)) {
      continue;
    }
    if (typeof value === 'string' && SENSITIVE_TEXT.test(value)) {
      continue;
    }
    record[key] = value;
  }
  return record;
}

export function hmacAlgorithmName(algorithm) {
  const normalized = String(algorithm ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '');
  if (normalized === 'sha1' || normalized === 'sha256' || normalized === 'sha512') {
    return normalized;
  }
  throw new Error('Unsupported TOTP algorithm.');
}

export function isBase32Secret(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }
  const normalized = value.replace(/\s+/g, '').replace(/=+$/g, '').toUpperCase();
  return /^[A-Z2-7]+$/.test(normalized);
}

export function decodeBase32(value) {
  if (typeof value !== 'string') {
    throw new Error('Secret key is not base32.');
  }
  const normalized = value.replace(/\s+/g, '').replace(/=+$/g, '').toUpperCase();
  if (!/^[A-Z2-7]+$/.test(normalized)) {
    throw new Error('Secret key is not base32.');
  }
  let bits = 0;
  let bitCount = 0;
  const bytes = [];
  for (const char of normalized) {
    bits = (bits << 5) | BASE32_ALPHABET.indexOf(char);
    bitCount += 5;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((bits >> bitCount) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

export function hotp(key, counter, options) {
  const digits = options.digits;
  const algorithm = hmacAlgorithmName(options.algorithm);
  if (!Number.isInteger(digits) || digits < 6 || digits > 10) {
    throw new Error('TOTP digit count is invalid.');
  }
  if (!Number.isInteger(counter) || counter < 0) {
    throw new Error('TOTP counter is invalid.');
  }
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, key).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totpCounter(timestampMs, periodSeconds) {
  if (!Number.isInteger(periodSeconds) || periodSeconds <= 0) {
    throw new Error('TOTP period is invalid.');
  }
  if (!Number.isInteger(timestampMs) || timestampMs < 0) {
    throw new Error('TOTP timestamp is invalid.');
  }
  return Math.floor(timestampMs / 1000 / periodSeconds);
}

export function totpCode(secretKey, options) {
  return hotp(decodeBase32(secretKey), totpCounter(options.timestampMs, options.periodSeconds), options);
}

export function totpCodesAround(secretKey, options, steps = REJECTED_CODE_NEIGHBOR_STEPS) {
  const codes = [];
  for (let offset = -steps; offset <= steps; offset += 1) {
    codes.push(
      totpCode(secretKey, {
        ...options,
        timestampMs: options.timestampMs + offset * options.periodSeconds * 1000,
      }),
    );
  }
  return codes;
}

export function selectRejectedCode(bannedCodes, digits) {
  if (!Number.isInteger(digits) || digits < 6 || digits > 10) {
    throw new Error('TOTP digit count is invalid.');
  }
  const banned = new Set(bannedCodes);
  for (let value = 0; value < 10 ** digits; value += 1) {
    const code = String(value).padStart(digits, '0');
    if (!banned.has(code)) {
      return code;
    }
  }
  throw new Error('No rejected authenticator code is available.');
}

export function requireTotpParameters(secret) {
  const algorithm = hmacAlgorithmName(secret?.hashingAlgorithm);
  const digits = secret?.codeLength;
  const periodSeconds = secret?.codeIntervalSeconds;
  if (!Number.isInteger(digits) || digits < 6 || digits > 10) {
    throw new Error('TOTP secret is missing a usable digit count.');
  }
  if (!Number.isInteger(periodSeconds) || periodSeconds <= 0) {
    throw new Error('TOTP secret is missing a usable period.');
  }
  return {
    algorithm,
    digits,
    periodSeconds,
    deadline:
      typeof secret.enrollmentCompletionDeadline === 'string' ? secret.enrollmentCompletionDeadline : null,
    secretKeyIsBase32: isBase32Secret(secret.secretKey),
  };
}

export function totpAccountLabel(accountName, issuer = TOTP_ISSUER) {
  const trimmed = accountName.trim();
  if (!trimmed || trimmed === issuer || trimmed.startsWith(`${issuer} (`)) {
    return trimmed || issuer;
  }
  return `${issuer} (${trimmed})`;
}

// Keep this aligned with buildTotpOtpauthUri in totp-mfa.service.ts, including the Duo label.
export function buildTotpOtpauthUri(input) {
  const issuer = input.issuer.trim() || TOTP_ISSUER;
  const accountName = input.accountName.trim() || 'unknownuser';
  const label = totpAccountLabel(accountName, issuer);
  const query = [
    ['secret', input.secretKey],
    ['issuer', issuer],
    ['algorithm', (input.algorithm || 'SHA1').toUpperCase()],
    ['digits', String(input.digits || 6)],
    ['period', String(input.periodSeconds || 30)],
  ]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return `otpauth://totp/${encodeURIComponent(label)}?${query}`;
}

export function compareOtpauthSecrets(secretKey, uris) {
  const failures = [];
  const notes = [];
  for (const entry of uris) {
    if (!entry.uri) {
      if (entry.source === 'app') {
        failures.push('app:missing');
      } else {
        notes.push(`${entry.source}:unavailable`);
      }
      continue;
    }
    let parsed;
    try {
      parsed = new URL(entry.uri);
    } catch {
      failures.push(`${entry.source}:unparseable`);
      continue;
    }
    if (parsed.searchParams.get('secret') !== secretKey) {
      failures.push(`${entry.source}:secret-mismatch`);
    }
    if (entry.source === 'sdk') {
      if (!parsed.searchParams.has('period')) {
        notes.push('sdk-omits-period');
      }
      const rawSecret = rawQueryValue(entry.uri, 'secret');
      if (rawSecret && leavesCharactersUnencoded(rawSecret)) {
        notes.push('sdk-leaves-characters-unencoded');
      }
    }
  }
  return { ok: failures.length === 0, failures, notes };
}

export function clockSkewSeconds(localMs, dateHeader) {
  if (!dateHeader) {
    return null;
  }
  const serverMs = Date.parse(dateHeader);
  if (!Number.isFinite(serverMs)) {
    return null;
  }
  return Math.round((localMs - serverMs) / 1000);
}

export function millisUntilFreshCode(nowMs, usedAtMs, periodSeconds) {
  const usedCounter = totpCounter(usedAtMs, periodSeconds);
  const nowCounter = totpCounter(nowMs, periodSeconds);
  if (nowCounter > usedCounter) {
    return 0;
  }
  const nextBoundaryMs = (usedCounter + 1) * periodSeconds * 1000;
  return nextBoundaryMs - nowMs + 250;
}

export function readIdTokenSecondFactor(idToken) {
  if (typeof idToken !== 'string' || idToken.split('.').length < 2) {
    throw new Error('ID token could not be read.');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('ID token could not be read.');
  }
  const firebaseClaims = payload && typeof payload.firebase === 'object' ? payload.firebase : {};
  return {
    signInSecondFactor:
      typeof firebaseClaims.sign_in_second_factor === 'string'
        ? firebaseClaims.sign_in_second_factor
        : null,
    secondFactorIdentifierPresent:
      typeof firebaseClaims.second_factor_identifier === 'string' &&
      firebaseClaims.second_factor_identifier.length > 0,
  };
}

export function wrongCodeOutcome({ errorCode, adminFactorCount }) {
  const safeCode = typeof errorCode === 'string' && SUPPORT_CODE_PATTERN.test(errorCode) ? errorCode : null;
  if (errorCode !== 'auth/invalid-verification-code') {
    return { ok: false, failure: 'unexpected-error-code', errorCode: safeCode };
  }
  if (adminFactorCount !== 0) {
    return { ok: false, failure: 'factor-persisted-after-rejection', errorCode: safeCode };
  }
  return { ok: true, failure: null, errorCode: safeCode };
}

export function enrollmentOutcome({
  adminFactorIds,
  clientFactorIdsBeforeRefresh,
  clientFactorIdsAfterRefresh,
  signInSecondFactor,
}) {
  const adminTotpCount = adminFactorIds.filter((factorId) => factorId === 'totp').length;
  const clientTotpCountAfterRefresh = clientFactorIdsAfterRefresh.filter(
    (factorId) => factorId === 'totp',
  ).length;
  const base = {
    adminFactorCount: adminFactorIds.length,
    adminTotpCount,
    clientFactorCountBeforeRefresh: clientFactorIdsBeforeRefresh.length,
    clientFactorCountAfterRefresh: clientFactorIdsAfterRefresh.length,
    clientTotpCountAfterRefresh,
    signInSecondFactor: signInSecondFactor ?? null,
  };
  if (adminTotpCount !== 1) {
    return { ...base, ok: false, failure: 'admin-totp-not-persisted' };
  }
  if (clientTotpCountAfterRefresh < 1) {
    return { ...base, ok: false, failure: 'hypothesis-4-client-factors-empty' };
  }
  return { ...base, ok: true, failure: null };
}

export function challengeOutcome({ errorCode, signInSecondFactor }) {
  if (errorCode === 'accepted-without-mfa') {
    return { ok: false, failure: 'sign-in-skipped-mfa', errorCode: null };
  }
  if (errorCode) {
    const safeCode = SUPPORT_CODE_PATTERN.test(errorCode) ? errorCode : null;
    return { ok: false, failure: 'mfa-challenge-failed', errorCode: safeCode };
  }
  if (signInSecondFactor !== 'totp') {
    return { ok: false, failure: 'id-token-missing-totp-claim', errorCode: null };
  }
  return { ok: true, failure: null, errorCode: null };
}

export function readWebConfigFromSource(source, projectId) {
  const config = {};
  for (const key of WEB_CONFIG_KEYS) {
    const match = source.match(new RegExp(`${key}:\\s*'([^']*)'`));
    if (!match?.[1]) {
      throw new Error('Refusing live TOTP enroll: client Firebase config is incomplete.');
    }
    config[key] = match[1];
  }
  if (config.projectId !== projectId) {
    throw new Error(
      'Refusing live TOTP enroll: client config project does not match LIVE_TOTP_PROJECT_ID.',
    );
  }
  return config;
}

export function readWebConfigFromJson(jsonText, projectId) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('Refusing live TOTP enroll: LIVE_TOTP_WEB_CONFIG_JSON is not valid JSON.');
  }
  const config = {};
  for (const key of WEB_CONFIG_KEYS) {
    if (typeof parsed?.[key] !== 'string' || !parsed[key]) {
      throw new Error('Refusing live TOTP enroll: client Firebase config is incomplete.');
    }
    config[key] = parsed[key];
  }
  if (config.projectId !== projectId) {
    throw new Error(
      'Refusing live TOTP enroll: client config project does not match LIVE_TOTP_PROJECT_ID.',
    );
  }
  return config;
}

export function createFinalizeDateCapture(fetchImpl) {
  let dateHeader = null;
  return {
    fetch: async (input, init) => {
      const response = await fetchImpl(input, init);
      if (requestUrl(input).includes('mfaEnrollment:finalize')) {
        dateHeader = response.headers?.get?.('date') ?? null;
      }
      return response;
    },
    read: () => dateHeader,
  };
}

function rawQueryValue(uri, key) {
  const query = uri.includes('?') ? uri.slice(uri.indexOf('?') + 1) : '';
  const part = query.split('&').find((item) => item.startsWith(`${key}=`));
  return part ? part.slice(key.length + 1) : null;
}

function leavesCharactersUnencoded(rawValue) {
  const withoutEncoding = rawValue.replace(/%[0-9A-Fa-f]{2}/g, '');
  return /[^A-Za-z0-9\-_.~]/.test(withoutEncoding);
}

function requestUrl(input) {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  if (input && typeof input.url === 'string') {
    return input.url;
  }
  return '';
}

function parseServiceAccount(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('Refusing live TOTP enroll: FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Refusing live TOTP enroll: FIREBASE_SERVICE_ACCOUNT_JSON must be an object.');
  }
  if (typeof parsed.project_id !== 'string' || !parsed.project_id.trim()) {
    throw new Error('Refusing live TOTP enroll: service account JSON must include project_id.');
  }
  if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
    throw new Error('Refusing live TOTP enroll: service account JSON is missing credential fields.');
  }
  return parsed;
}

function logEvent(event, fields) {
  console.log(JSON.stringify(safeLogRecord(event, fields)));
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function factorIds(user, multiFactor) {
  return multiFactor(user).enrolledFactors.map((factor) => factor.factorId);
}

function loadWebConfig(env, projectId, readText) {
  const inline =
    typeof env.LIVE_TOTP_WEB_CONFIG_JSON === 'string' ? env.LIVE_TOTP_WEB_CONFIG_JSON.trim() : '';
  if (inline) {
    return readWebConfigFromJson(inline, projectId);
  }
  return readWebConfigFromSource(readText(), projectId);
}

async function createExactUser(adminAuth, identity, created) {
  assertDisposableEmail(identity.email);
  let record;
  try {
    record = await adminAuth.createUser({
      email: identity.email,
      password: identity.password,
      emailVerified: true,
      displayName: DISPOSABLE_DISPLAY_NAME,
    });
  } catch (error) {
    if (publicErrorCode(error) === 'auth/email-already-exists') {
      throw new Error('Disposable email already exists. Stopping without deleting any user.');
    }
    throw new Error(
      `Could not create disposable user (${publicErrorCode(error) ?? 'unrecognized-error'}).`,
    );
  }
  const createdUser = { uid: record.uid, email: record.email ?? '' };
  created.push(createdUser);
  assertCleanupTarget({ uid: record.uid, email: identity.email }, createdUser);
  return createdUser;
}

async function deleteExactUser(adminAuth, record) {
  assertDisposableEmail(record.email);
  const loaded = await adminAuth.getUser(record.uid);
  assertCleanupTarget(record, { uid: loaded.uid, email: loaded.email ?? '' });
  await adminAuth.deleteUser(record.uid);
  try {
    await adminAuth.getUser(record.uid);
  } catch (error) {
    assertUserGone(error);
    return;
  }
  throw new Error(`Cleanup failed for uid ${record.uid}: user still exists after delete.`);
}

async function cleanupCreatedUsers(adminAuth, created) {
  const failedUids = [];
  for (const record of created) {
    try {
      await deleteExactUser(adminAuth, record);
      logEvent('deleted-disposable-user', { uid: record.uid, deleted: true });
    } catch (error) {
      console.error(safeErrorText(error));
      failedUids.push(record.uid);
    }
  }
  if (failedUids.length > 0) {
    throw new Error(
      `Cleanup failed for uid ${failedUids.join(', ')}. Delete only those disposable users.`,
    );
  }
}

async function openSecret(clientAuth, auth, user, email) {
  const session = await clientAuth.multiFactor(user).getSession();
  const secret = await clientAuth.TotpMultiFactorGenerator.generateSecret(session);
  const params = requireTotpParameters(secret);
  logEvent('secret-metadata', {
    algorithm: params.algorithm,
    digits: params.digits,
    periodSeconds: params.periodSeconds,
    deadline: params.deadline,
    secretKeyIsBase32: params.secretKeyIsBase32,
  });
  const appUri = buildTotpOtpauthUri({
    issuer: TOTP_ISSUER,
    accountName: email,
    secretKey: secret.secretKey,
    algorithm: secret.hashingAlgorithm,
    digits: secret.codeLength,
    periodSeconds: secret.codeIntervalSeconds,
  });
  const sdkUri =
    typeof secret.generateQrCodeUrl === 'function'
      ? secret.generateQrCodeUrl(email, TOTP_ISSUER)
      : null;
  const uriCheck = compareOtpauthSecrets(secret.secretKey, [
    { source: 'app', uri: appUri },
    { source: 'sdk', uri: sdkUri },
  ]);
  logEvent('uri-check', { uriNotes: uriCheck.notes, failure: uriCheck.ok ? null : uriCheck.failures.join(',') });
  if (!uriCheck.ok) {
    throw new Error(`Enrollment URI check failed (${uriCheck.failures.join(', ')}).`);
  }
  return { secret, params };
}

async function assertAdminUser(adminAuth, record) {
  const loaded = await adminAuth.getUser(record.uid);
  assertCleanupTarget(record, { uid: loaded.uid, email: loaded.email ?? '' });
  return loaded;
}

async function runWrongCodeUser(adminAuth, clientAuth, auth, identity, created, dateCapture) {
  const record = await createExactUser(adminAuth, identity, created);
  const credential = await clientAuth.signInWithEmailAndPassword(auth, identity.email, identity.password);
  const { secret, params } = await openSecret(clientAuth, auth, credential.user, identity.email);
  const timestampMs = Date.now();
  const codeOptions = {
    algorithm: params.algorithm,
    digits: params.digits,
    periodSeconds: params.periodSeconds,
    timestampMs,
  };
  const rejected = selectRejectedCode(totpCodesAround(secret.secretKey, codeOptions), params.digits);
  let errorCode = 'accepted';
  try {
    await clientAuth.multiFactor(credential.user).enroll(
      clientAuth.TotpMultiFactorGenerator.assertionForEnrollment(secret, rejected),
      TOTP_DISPLAY_NAME,
    );
  } catch (error) {
    errorCode = publicErrorCode(error) ?? 'unrecognized-error';
  }
  const loaded = await assertAdminUser(adminAuth, record);
  const outcome = wrongCodeOutcome({
    errorCode,
    adminFactorCount: loaded.multiFactor?.enrolledFactors?.length ?? 0,
  });
  logEvent('wrong-code', {
    ...outcome,
    localTime: new Date(timestampMs).toISOString(),
    finalizeDateHeader: dateCapture.read(),
    skewSeconds: clockSkewSeconds(timestampMs, dateCapture.read()),
    uid: record.uid,
  });
  if (!outcome.ok) {
    throw new Error(`Wrong-code check failed (${outcome.failure}).`);
  }
  await clientAuth.signOut(auth);
}

async function runSuccessfulUser(adminAuth, clientAuth, auth, identity, created, dateCapture) {
  const record = await createExactUser(adminAuth, identity, created);
  const credential = await clientAuth.signInWithEmailAndPassword(auth, identity.email, identity.password);
  const user = credential.user;
  const { secret, params } = await openSecret(clientAuth, auth, user, identity.email);
  const enrolledAt = Date.now();
  const codeOptions = {
    algorithm: params.algorithm,
    digits: params.digits,
    periodSeconds: params.periodSeconds,
  };
  const currentCode = totpCode(secret.secretKey, { ...codeOptions, timestampMs: enrolledAt });
  try {
    await clientAuth.multiFactor(user).enroll(
      clientAuth.TotpMultiFactorGenerator.assertionForEnrollment(secret, currentCode),
      TOTP_DISPLAY_NAME,
    );
  } catch (error) {
    throw new Error(`Enrollment failed (${publicErrorCode(error) ?? 'unrecognized-error'}).`);
  }
  const clientBefore = factorIds(user, clientAuth.multiFactor);
  await user.getIdToken(true);
  await user.reload();
  const clientAfter = factorIds(user, clientAuth.multiFactor);
  const enrollmentClaim = readIdTokenSecondFactor(await user.getIdToken());
  const loaded = await assertAdminUser(adminAuth, record);
  const adminFactorIds = (loaded.multiFactor?.enrolledFactors ?? []).map((factor) => factor.factorId);
  const outcome = enrollmentOutcome({
    adminFactorIds,
    clientFactorIdsBeforeRefresh: clientBefore,
    clientFactorIdsAfterRefresh: clientAfter,
    signInSecondFactor: enrollmentClaim.signInSecondFactor,
  });
  logEvent('enrollment', {
    ...outcome,
    secondFactorIdentifierPresent: enrollmentClaim.secondFactorIdentifierPresent,
    localTime: new Date(enrolledAt).toISOString(),
    finalizeDateHeader: dateCapture.read(),
    skewSeconds: clockSkewSeconds(enrolledAt, dateCapture.read()),
    uid: record.uid,
  });
  if (!outcome.ok) {
    const detail =
      outcome.failure === 'hypothesis-4-client-factors-empty'
        ? 'Hypothesis 4: enroll resolved but the client factor list stayed empty after refresh.'
        : 'Enrollment did not persist an authenticator factor.';
    throw new Error(detail);
  }

  await clientAuth.signOut(auth);
  const waitMs = millisUntilFreshCode(Date.now(), enrolledAt, params.periodSeconds);
  logEvent('wait-for-fresh-code', { waitMs, uid: record.uid });
  if (waitMs > 0) {
    await delay(waitMs);
  }
  const challengeCode = totpCode(secret.secretKey, { ...codeOptions, timestampMs: Date.now() });
  let challengeError = null;
  let signedInFactor = null;
  try {
    await clientAuth.signInWithEmailAndPassword(auth, identity.email, identity.password);
    challengeError = 'accepted-without-mfa';
  } catch (error) {
    if (publicErrorCode(error) !== 'auth/multi-factor-auth-required') {
      challengeError = publicErrorCode(error) ?? 'unrecognized-error';
    } else {
      const resolver = clientAuth.getMultiFactorResolver(auth, error);
      const hint = resolver.hints.find((candidate) => candidate.factorId === 'totp');
      if (!hint) {
        challengeError = 'auth/missing-multi-factor-info';
      } else {
        const signedIn = await resolver.resolveSignIn(
          clientAuth.TotpMultiFactorGenerator.assertionForSignIn(hint.uid, challengeCode),
        );
        signedInFactor = readIdTokenSecondFactor(await signedIn.user.getIdToken()).signInSecondFactor;
      }
    }
  }
  const challenge = challengeOutcome({ errorCode: challengeError, signInSecondFactor: signedInFactor });
  logEvent('mfa-challenge', { ...challenge, uid: record.uid });
  if (!challenge.ok) {
    throw new Error(`Next sign-in MFA check failed (${challenge.failure}).`);
  }
  await clientAuth.signOut(auth);
}

export async function main(env = process.env, io = {}) {
  assertNoTargetArguments(io.argv ?? process.argv);
  const adcFileExists =
    typeof io.adcFileExists === 'boolean' ? io.adcFileExists : existsSync(defaultAdcPath(env, io.homedir));
  const plan = assertLivePreconditions(env, { adcFileExists });
  logEvent('preconditions', { projectId: plan.projectId, credentialSource: plan.credentialSource });

  const [{ applicationDefault, cert, initializeApp: initializeAdmin }, adminAuthModule, clientAppModule, clientAuth] =
    await Promise.all([
      import('firebase-admin/app'),
      import('firebase-admin/auth'),
      import('firebase/app'),
      import('firebase/auth'),
    ]);
  const nonce = randomBytes(4).toString('hex');
  const credential = plan.serviceAccount ? cert(plan.serviceAccount) : applicationDefault();
  const adminApp = initializeAdmin(
    { credential, projectId: plan.projectId },
    `live-totp-admin-${nonce}`,
  );
  assertInitializedProject(adminApp.options.projectId, plan.projectId);
  const adminAuth = adminAuthModule.getAuth(adminApp);

  const readText =
    io.readEnvironmentText ??
    (() => readFileSync(new URL('../src/environments/environment.ts', import.meta.url), 'utf8'));
  const webConfig = loadWebConfig(env, plan.projectId, readText);
  const clientApp = clientAppModule.initializeApp(webConfig, `live-totp-client-${nonce}`);
  const auth = clientAuth.initializeAuth(clientApp, {
    persistence: clientAuth.inMemoryPersistence,
    popupRedirectResolver: undefined,
  });
  if (clientAuthUsesEmulator(auth) || emulatorHostIsSet(env)) {
    throw new Error('Refusing live TOTP enroll: client Auth is configured for the emulator.');
  }

  const originalFetch = globalThis.fetch;
  const dateCapture = createFinalizeDateCapture(originalFetch.bind(globalThis));
  globalThis.fetch = dateCapture.fetch;
  const created = [];
  let failure = null;
  try {
    await runWrongCodeUser(
      adminAuth,
      clientAuth,
      auth,
      createDisposableIdentity(io.randomBytes ?? randomBytes),
      created,
      dateCapture,
    );
    await runSuccessfulUser(
      adminAuth,
      clientAuth,
      auth,
      createDisposableIdentity(io.randomBytes ?? randomBytes),
      created,
      dateCapture,
    );
    logEvent('passed', { projectId: plan.projectId });
  } catch (error) {
    failure = error;
  } finally {
    globalThis.fetch = originalFetch;
    let cleanupError = null;
    try {
      await cleanupCreatedUsers(adminAuth, created);
    } catch (error) {
      cleanupError = error;
    }
    if (failure && cleanupError) {
      throw new Error(`${safeErrorText(failure)} ${safeErrorText(cleanupError)}`);
    }
    if (cleanupError) {
      throw cleanupError;
    }
    if (failure) {
      throw failure;
    }
  }
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
  main().catch((error) => {
    console.error(safeErrorText(error));
    process.exitCode = 1;
  });
}
