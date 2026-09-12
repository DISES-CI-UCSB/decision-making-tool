#!/usr/bin/env node
/**
 * Remove TOTP MFA from a Firebase user so they can scan a new Eco Plan Tool QR.
 *
 * Usage:
 *   yarn reset:totp -- you@example.com
 *
 * Auth options (first match wins):
 * 1. FIREBASE_SERVICE_ACCOUNT_JSON env var (full service account JSON)
 * 2. Application Default Credentials (run: gcloud auth application-default login)
 */

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID?.trim() || 'dises-decision-making-tool';

function resolveCredential() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (serviceAccountJson) {
    return cert(JSON.parse(serviceAccountJson));
  }
  return undefined;
}

function readEmail(argv) {
  const email = argv.find((value) => value.includes('@'))?.trim().toLowerCase();
  if (!email) {
    throw new Error('Pass the user email: yarn reset:totp -- you@example.com');
  }
  return email;
}

async function main() {
  if (!getApps().length) {
    const credential = resolveCredential();
    initializeApp(credential ? { credential, projectId: PROJECT_ID } : { projectId: PROJECT_ID });
  }

  const email = readEmail(process.argv.slice(2));
  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  await auth.updateUser(user.uid, {
    multiFactor: {
      enrolledFactors: null,
    },
  });
  const updated = await auth.getUser(user.uid);
  const remaining = updated.multiFactor?.enrolledFactors?.length ?? 0;
  console.log(
    JSON.stringify(
      {
        email,
        uid: user.uid,
        remainingFactors: remaining,
      },
      null,
      2,
    ),
  );
  if (remaining > 0) {
    throw new Error('Firebase still reports an enrolled factor. Reset the user in Firebase Console.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
