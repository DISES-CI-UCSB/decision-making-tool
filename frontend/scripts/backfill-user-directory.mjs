#!/usr/bin/env node
/**
 * Adds the missing userDirectory row for every active user. The web app writes a person's row when
 * they sign in, so only people who have not signed in since the directory existed lack one.
 * Existing rows are never changed.
 *
 * Usage:
 *   yarn backfill:user-directory              # dry run: lists the uids that lack a row
 *   yarn backfill:user-directory -- --write   # creates those rows
 *
 * Auth options (first match wins):
 * 1. FIREBASE_SERVICE_ACCOUNT_JSON env var (full service account JSON)
 * 2. Application Default Credentials (run: gcloud auth application-default login)
 */

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID?.trim() || 'dises-decision-making-tool';

function resolveCredential() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (serviceAccountJson) {
    return cert(JSON.parse(serviceAccountJson));
  }
  return undefined;
}

function readString(data, key) {
  return typeof data[key] === 'string' ? data[key] : '';
}

async function main() {
  const write = process.argv.slice(2).includes('--write');
  if (!getApps().length) {
    const credential = resolveCredential();
    initializeApp(credential ? { credential, projectId: PROJECT_ID } : { projectId: PROJECT_ID });
  }

  const firestore = getFirestore();
  const [activeUsers, directoryRefs] = await Promise.all([
    firestore.collection('users').where('status', '==', 'active').get(),
    firestore.collection('userDirectory').listDocuments(),
  ]);
  const directoryUids = new Set(directoryRefs.map((directoryRef) => directoryRef.id));
  const missingUsers = activeUsers.docs.filter((userDoc) => !directoryUids.has(userDoc.id));

  if (write) {
    const writer = firestore.bulkWriter();
    for (const userDoc of missingUsers) {
      const data = userDoc.data();
      writer.create(firestore.doc(`userDirectory/${userDoc.id}`), {
        uid: userDoc.id,
        email: readString(data, 'email'),
        displayName: readString(data, 'displayName') || readString(data, 'email'),
        status: 'active',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await writer.close();
  }

  console.log(
    JSON.stringify(
      {
        projectId: PROJECT_ID,
        mode: write ? 'write' : 'dry run',
        activeUsers: activeUsers.size,
        missingDirectoryRows: missingUsers.map((userDoc) => userDoc.id),
        created: write ? missingUsers.length : 0,
      },
      null,
      2,
    ),
  );
  if (!write && missingUsers.length > 0) {
    console.log('Dry run: nothing was written. Pass --write to create these rows.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
