#!/usr/bin/env node
/**
 * Enable TOTP MFA on a Firebase project (Identity Platform required).
 *
 * Auth options (first match wins):
 * 1. FIREBASE_SERVICE_ACCOUNT_JSON env var (full service account JSON)
 * 2. Application Default Credentials (run: gcloud auth application-default login)
 */

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID?.trim() || 'dises-decision-making-tool';
const ADJACENT_INTERVALS = Number(process.env.TOTP_ADJACENT_INTERVALS ?? 5);

function resolveCredential() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (serviceAccountJson) {
    return cert(JSON.parse(serviceAccountJson));
  }
  return undefined;
}

async function main() {
  if (!getApps().length) {
    initializeApp({
      credential: resolveCredential(),
      projectId: PROJECT_ID,
    });
  }

  const updated = await getAuth().projectConfigManager().updateProjectConfig({
    multiFactorConfig: {
      providerConfigs: [
        {
          state: 'ENABLED',
          totpProviderConfig: {
            adjacentIntervals: ADJACENT_INTERVALS,
          },
        },
      ],
    },
  });

  const totp = updated.multiFactorConfig?.providerConfigs?.find(
    (provider) => provider.totpProviderConfig,
  );

  if (totp?.state !== 'ENABLED') {
    throw new Error('TOTP provider was not enabled in the project config response.');
  }

  console.log(
    JSON.stringify(
      {
        projectId: PROJECT_ID,
        totpState: totp.state,
        adjacentIntervals: totp.totpProviderConfig?.adjacentIntervals ?? ADJACENT_INTERVALS,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
