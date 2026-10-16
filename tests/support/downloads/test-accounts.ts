import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cert, deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { deleteApp, initializeApp } from 'firebase/app';
import {
  getAuth,
  getMultiFactorResolver,
  multiFactor,
  signInWithEmailAndPassword,
  signOut,
  TotpMultiFactorGenerator,
} from 'firebase/auth';
import { serviceConfig } from './service-config.ts';
import { millisUntilFreshCode, totpCode } from './totp.ts';

/** Addresses end in `.invalid`, a reserved suffix, so no email can ever reach a real inbox. */
const DISPOSABLE_EMAIL = /^dmt-test-[0-9a-f]{16}@dmt-test\.invalid$/;
const DISPLAY_NAME = 'DMT TEST ACCOUNT';

export interface TestAccountOptions {
  /** Firestore `users/{uid}.status`. The service only issues links for `active`. */
  status: 'active' | 'pending';
  /** Firestore `users/{uid}.role`. */
  role: 'user' | 'sirap-user' | 'super-admin';
  /** Firestore `users/{uid}.allowedSirapIds`. */
  allowedSirapIds: string[];
  /** When true, enroll an authenticator and sign in with a code, so the ID token is marked second-factor TOTP. */
  authenticator: boolean;
}

export interface TestAccount {
  uid: string;
  /** A real Firebase ID token for this account. Treat it as a secret and never log it. */
  idToken: string;
}

export interface TestAccountFactory {
  create(options: TestAccountOptions): Promise<TestAccount>;
  /** Deletes every account this factory created, in Firebase Auth and Firestore. */
  cleanUp(): Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates throwaway Firebase users for one test file. The Admin SDK creates each user with a verified email
 * (so no verification email is sent) and writes its Firestore record. Sign-in, authenticator enrollment,
 * and the second-factor sign-in then use the real client SDK, so Firebase itself issues every ID token.
 */
export function createTestAccountFactory(): TestAccountFactory {
  const suffix = randomBytes(4).toString('hex');
  const adminApp = initializeAdminApp(
    { credential: cert(JSON.parse(readFileSync(serviceConfig.adminKeyFile, 'utf8'))) },
    `dmt-test-admin-${suffix}`,
  );
  const adminAuth = getAdminAuth(adminApp);
  const firestore = getFirestore(adminApp);
  const created: Array<{ uid: string; email: string }> = [];
  const clientApps: Array<ReturnType<typeof initializeApp>> = [];

  async function create(options: TestAccountOptions): Promise<TestAccount> {
    const email = `dmt-test-${randomBytes(8).toString('hex')}@dmt-test.invalid`;
    const password = randomBytes(24).toString('base64url');
    const record = await adminAuth.createUser({
      email,
      password,
      emailVerified: true,
      displayName: DISPLAY_NAME,
    });
    created.push({ uid: record.uid, email });
    await firestore.doc(`users/${record.uid}`).set({
      email,
      displayName: DISPLAY_NAME,
      status: options.status,
      role: options.role,
      allowedSirapIds: options.allowedSirapIds,
      administeredSirapIds: [],
    });

    const clientApp = initializeApp(serviceConfig.firebaseWebConfig, `dmt-test-client-${randomBytes(4).toString('hex')}`);
    clientApps.push(clientApp);
    const auth = getAuth(clientApp);
    const credential = await signInWithEmailAndPassword(auth, email, password);
    if (!options.authenticator) {
      return { uid: record.uid, idToken: await credential.user.getIdToken() };
    }

    const session = await multiFactor(credential.user).getSession();
    const secret = await TotpMultiFactorGenerator.generateSecret(session);
    const parameters = {
      algorithm: secret.hashingAlgorithm,
      digits: secret.codeLength,
      periodSeconds: secret.codeIntervalSeconds,
    };
    const enrolledAt = Date.now();
    await multiFactor(credential.user).enroll(
      TotpMultiFactorGenerator.assertionForEnrollment(secret, totpCode(secret.secretKey, parameters, enrolledAt)),
      'Authenticator app',
    );
    await signOut(auth);

    // Firebase rejects a code it has already accepted, so wait for the next code window.
    await delay(millisUntilFreshCode(Date.now(), enrolledAt, parameters.periodSeconds));
    try {
      await signInWithEmailAndPassword(auth, email, password);
      throw new Error('Sign-in succeeded without the authenticator challenge.');
    } catch (error) {
      if ((error as { code?: string }).code !== 'auth/multi-factor-auth-required') {
        throw error;
      }
      const resolver = getMultiFactorResolver(auth, error as never);
      const hint = resolver.hints.find((candidate) => candidate.factorId === 'totp');
      if (!hint) {
        throw new Error('The sign-in challenge offered no authenticator factor.');
      }
      const signedIn = await resolver.resolveSignIn(
        TotpMultiFactorGenerator.assertionForSignIn(hint.uid, totpCode(secret.secretKey, parameters, Date.now())),
      );
      return { uid: record.uid, idToken: await signedIn.user.getIdToken() };
    }
  }

  async function cleanUp(): Promise<void> {
    for (const app of clientApps) {
      await deleteApp(app).catch(() => undefined);
    }
    for (const account of created) {
      // Delete only addresses this code generated, never anything else in the project.
      if (!DISPOSABLE_EMAIL.test(account.email)) {
        continue;
      }
      await firestore.doc(`users/${account.uid}`).delete().catch(() => undefined);
      await adminAuth.deleteUser(account.uid).catch(() => undefined);
    }
    await deleteAdminApp(adminApp).catch(() => undefined);
  }

  return { create, cleanUp };
}
