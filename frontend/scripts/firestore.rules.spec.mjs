import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertFails as assertFailsForAnyReason,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  arrayRemove,
  arrayUnion,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-dises';
const RULES_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../firestore.rules',
);

const ACTORS = {
  pending: { uid: 'pending-user', email: 'pending@example.com', name: 'Pending User' },
  active: { uid: 'active-user', email: 'active@example.com', name: 'Active User' },
  superAdmin: { uid: 'super-admin', email: 'super@example.com', name: 'Super Admin' },
  sirapAdmin: { uid: 'sirap-admin', email: 'sirap@example.com', name: 'SIRAP Admin' },
  publisher: { uid: 'publisher-user', email: 'publisher@example.com', name: 'Publisher' },
  target: { uid: 'grant-target', email: 'target@example.com', name: 'Grant Target' },
  foreign: { uid: 'foreign-user', email: 'foreign@example.com', name: 'Foreign User' },
};

/**
 * Denial texts the emulator returns when a request runs out of per-request evaluation budget:
 * 1,000 evaluated expressions, or 10 (20 in a batch) document reads, which surfaces as a failed
 * get() or exists() service call. Such a denial happens whatever the rules intend.
 */
const EVALUATION_LIMIT_DENIALS = [
  'maximum of 1000 expressions to evaluate has been reached',
  'Service call error',
];

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
let testEnv;

/** Like the library's assertFails, but a denial caused by an evaluation limit fails the test. */
async function assertFails(pendingOperation) {
  const error = await assertFailsForAnyReason(pendingOperation);
  const message = String(error?.message ?? '');
  const limitDenial = EVALUATION_LIMIT_DENIALS.find((text) => message.includes(text));
  assert.equal(
    limitDenial,
    undefined,
    `Refused by an evaluation limit, not by a rule:\n${message}`,
  );
  return error;
}

function firestoreFor(actor, tokenClaims) {
  return testEnv
    .authenticatedContext(actor.uid, {
      email: actor.email,
      email_verified: true,
      firebase: tokenClaims,
    })
    .firestore();
}

function firstFactorDb(actor) {
  return firestoreFor(actor, { sign_in_provider: 'google.com' });
}

function totpDb(actor, identifier = 'totp-1') {
  return firestoreFor(actor, {
    sign_in_provider: 'google.com',
    sign_in_second_factor: 'totp',
    second_factor_identifier: identifier,
  });
}

function passwordDb(actor) {
  return firestoreFor(actor, { sign_in_provider: 'password' });
}

function passwordTotpDb(actor) {
  return firestoreFor(actor, {
    sign_in_provider: 'password',
    sign_in_second_factor: 'totp',
    second_factor_identifier: 'totp-1',
  });
}

function phoneFactorDb(actor) {
  return firestoreFor(actor, {
    sign_in_provider: 'google.com',
    sign_in_second_factor: 'phone',
    second_factor_identifier: 'phone-1',
  });
}

function totpMissingIdentifierDb(actor) {
  return firestoreFor(actor, {
    sign_in_provider: 'google.com',
    sign_in_second_factor: 'totp',
  });
}

function defaultSelfUser(actor) {
  return {
    uid: actor.uid,
    email: actor.email,
    displayName: actor.name,
    status: 'active',
    role: 'user',
    tier: 2,
    allowedSirapIds: [],
    administeredSirapIds: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function defaultSelfDirectory(actor) {
  return {
    uid: actor.uid,
    email: actor.email,
    displayName: actor.name,
    status: 'active',
    updatedAt: serverTimestamp(),
  };
}

function gticSelfProvisionedUser(actor) {
  return {
    uid: actor.uid,
    email: actor.email,
    displayName: actor.name,
    status: 'active',
    role: 'authorized_viewer',
    tier: 2,
    isAdmin: false,
    isSuperAdmin: false,
    allowedSirapIds: [],
    administeredSirapIds: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function pendingAccessRequestData(actor, extras = {}) {
  return {
    uid: actor.uid,
    email: actor.email,
    displayName: actor.name,
    avatarInitials: null,
    provider: 'google',
    status: 'pending',
    organization: null,
    reason: extras.reason ?? 'Need access',
    submittedAt: extras.submittedAt ?? 1_700_000_000_000,
    requestedAt: extras.requestedAt ?? serverTimestamp(),
    updatedAt: extras.updatedAt ?? serverTimestamp(),
  };
}

function userRecord(actor, extras = {}) {
  return {
    email: actor.email,
    displayName: actor.name,
    status: 'active',
    role: extras.role ?? 'authorized_viewer',
    tier: extras.tier ?? 2,
    isAdmin: extras.isAdmin ?? false,
    isSuperAdmin: extras.isSuperAdmin ?? false,
    allowedSirapIds: extras.allowedSirapIds ?? [],
    administeredSirapIds: extras.administeredSirapIds ?? [],
    updatedAt: extras.updatedAt ?? new Date('2026-01-01T00:00:00.000Z'),
  };
}

function sirapRequestId(uid, sirapId) {
  return `${uid}_${sirapId}`;
}

function pendingSirapRequest(actor, sirapId, extras = {}) {
  return {
    uid: actor.uid,
    email: actor.email,
    displayName: actor.name,
    sirapId,
    status: extras.status ?? 'pending',
    reason: extras.reason ?? 'Please grant this SIRAP',
    requestedAt: extras.requestedAt ?? new Date('2026-01-02T00:00:00.000Z'),
    updatedAt: extras.updatedAt ?? new Date('2026-01-02T00:00:00.000Z'),
    ...(extras.includeDecision
      ? {
          decidedAt: extras.decidedAt ?? new Date('2026-01-03T00:00:00.000Z'),
          decidedBy: extras.decidedBy ?? ACTORS.superAdmin.uid,
        }
      : {}),
  };
}

function activeUsersHolding(db, sirapId) {
  return query(
    collection(db, 'users'),
    where('status', '==', 'active'),
    where('allowedSirapIds', 'array-contains', sirapId),
  );
}

function scenarioPayload(scenarioId, extras = {}) {
  return {
    id: scenarioId,
    solutionId: extras.solutionId ?? 'solution-one',
    label: extras.label ?? 'Coastal plan',
    solutionName: extras.solutionName ?? 'Coastal solution',
    updatedAt: extras.updatedAt ?? '2026-09-11T12:00:00.000Z',
  };
}

function manifestRequestPayload(actor) {
  return {
    editorName: actor.name,
    sourceManifestUrl: 'https://example.com/manifest.json',
    baseManifestVersion: '1.0.0',
    baseManifestGeneratedAt: '2026-09-01T00:00:00.000Z',
    diffSummary: { changedLayerCount: 1 },
    styleChanges: { layerStyles: [] },
    status: 'pending',
    createdByUid: actor.uid,
    createdByEmail: actor.email,
    createdByDisplayName: actor.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

async function seedFirestore() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users', ACTORS.superAdmin.uid), {
      ...userRecord(ACTORS.superAdmin, {
        role: 'admin',
        tier: 3,
        isAdmin: true,
        isSuperAdmin: true,
      }),
    });
    await setDoc(doc(db, 'users', ACTORS.sirapAdmin.uid), {
      ...userRecord(ACTORS.sirapAdmin, {
        allowedSirapIds: ['orinoquia'],
        administeredSirapIds: ['orinoquia'],
      }),
    });
    await setDoc(doc(db, 'users', ACTORS.publisher.uid), {
      ...userRecord(ACTORS.publisher, { role: 'science_publisher', tier: 3 }),
    });
    await setDoc(doc(db, 'users', ACTORS.active.uid), userRecord(ACTORS.active));
    await setDoc(doc(db, 'users', ACTORS.target.uid), userRecord(ACTORS.target));
    await setDoc(
      doc(db, 'users', ACTORS.foreign.uid),
      userRecord(ACTORS.foreign, { allowedSirapIds: ['eje-cafetero'] }),
    );

    await setDoc(
      doc(db, 'accessRequests', ACTORS.pending.uid),
      pendingAccessRequestData(ACTORS.pending, {
        requestedAt: new Date('2026-01-04T00:00:00.000Z'),
        updatedAt: new Date('2026-01-04T00:00:00.000Z'),
      }),
    );

    await setDoc(
      doc(db, 'sirapAccessRequests', sirapRequestId(ACTORS.pending.uid, 'orinoquia')),
      pendingSirapRequest(ACTORS.pending, 'orinoquia'),
    );
    await setDoc(
      doc(db, 'sirapAccessRequests', sirapRequestId(ACTORS.target.uid, 'orinoquia')),
      pendingSirapRequest(ACTORS.target, 'orinoquia'),
    );
    await setDoc(
      doc(db, 'sirapAccessRequests', sirapRequestId(ACTORS.target.uid, 'eje-cafetero')),
      pendingSirapRequest(ACTORS.target, 'eje-cafetero'),
    );
    await setDoc(
      doc(db, 'sirapAccessRequests', sirapRequestId(ACTORS.active.uid, 'orinoquia')),
      pendingSirapRequest(ACTORS.active, 'orinoquia', {
        status: 'denied',
        includeDecision: true,
      }),
    );

    await setDoc(doc(db, 'userDirectory', ACTORS.active.uid), {
      uid: ACTORS.active.uid,
      email: ACTORS.active.email,
      displayName: ACTORS.active.name,
      status: 'active',
      updatedAt: new Date('2026-01-05T00:00:00.000Z'),
    });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedFirestore();
});

after(async () => {
  await testEnv?.cleanup();
});

describe('legacy account access requests', () => {
  it('denies signed-in users and super admins from reading, creating, or approving them', async () => {
    const requester = { uid: 'fresh-pending', email: 'fresh@example.com', name: 'Fresh Pending' };
    const ownDb = firstFactorDb(requester);
    const ownRef = doc(ownDb, 'accessRequests', requester.uid);
    await assertFails(setDoc(ownRef, pendingAccessRequestData(requester)));
    await assertFails(getDoc(ownRef));

    const storedRef = doc(firstFactorDb(ACTORS.pending), 'accessRequests', ACTORS.pending.uid);
    await assertFails(getDoc(storedRef));
    await assertFails(
      setDoc(
        storedRef,
        pendingAccessRequestData(ACTORS.pending, {
          reason: 'Updated reason',
          submittedAt: 1_700_000_000_111,
        }),
        { merge: true },
      ),
    );

    const adminDb = totpDb(ACTORS.superAdmin);
    await assertFails(getDoc(doc(adminDb, 'accessRequests', ACTORS.pending.uid)));
    await assertFails(
      getDocs(query(collection(adminDb, 'accessRequests'), where('status', '==', 'pending'))),
    );
    await assertFails(
      setDoc(
        doc(adminDb, 'accessRequests', ACTORS.pending.uid),
        {
          status: 'approved',
          approvedAt: serverTimestamp(),
          approvedBy: ACTORS.superAdmin.uid,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
    );
  });

  it('cannot create or rerequest a SIRAP access request before authenticator setup', async () => {
    const db = firstFactorDb(ACTORS.active);
    const requestRef = doc(
      db,
      'sirapAccessRequests',
      sirapRequestId(ACTORS.active.uid, 'orinoquia'),
    );

    await assertSucceeds(getDoc(requestRef));
    await assertFails(
      setDoc(
        requestRef,
        {
          uid: ACTORS.active.uid,
          email: ACTORS.active.email,
          displayName: ACTORS.active.name,
          sirapId: 'orinoquia',
          status: 'pending',
          reason: 'Trying again',
          requestedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          decidedAt: deleteField(),
          decidedBy: deleteField(),
        },
        { merge: true },
      ),
    );

    const fresh = {
      uid: 'sirap-requester',
      email: 'sirap-req@example.com',
      name: 'SIRAP Requester',
    };
    const freshDb = firstFactorDb(fresh);
    await assertFails(
      setDoc(doc(freshDb, 'sirapAccessRequests', sirapRequestId(fresh.uid, 'eje-cafetero')), {
        uid: fresh.uid,
        email: fresh.email,
        displayName: fresh.name,
        sirapId: 'eje-cafetero',
        status: 'pending',
        reason: 'Need eje',
        requestedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe('first-factor active user', () => {
  it('can get their own user profile', async () => {
    await assertSucceeds(getDoc(doc(firstFactorDb(ACTORS.active), 'users', ACTORS.active.uid)));
  });

  it('cannot read or write their saved solution scenarios', async () => {
    const db = firstFactorDb(ACTORS.active);
    const scenarioRef = doc(
      db,
      'users',
      ACTORS.active.uid,
      'savedSolutionScenarios',
      'saved-scenario-one',
    );
    await assertFails(setDoc(scenarioRef, scenarioPayload('saved-scenario-one')));
    await assertFails(getDoc(scenarioRef));
    await assertFails(deleteDoc(scenarioRef));
  });
});

describe('first-factor privileged actors', () => {
  it('blocks a first-factor super admin from listing, creating, or approving users', async () => {
    const db = firstFactorDb(ACTORS.superAdmin);
    await assertFails(
      getDocs(query(collection(db, 'accessRequests'), where('status', '==', 'pending'))),
    );
    await assertFails(
      setDoc(doc(db, 'users', 'brand-new-user'), {
        ...userRecord({ uid: 'brand-new-user', email: 'new@example.com', name: 'New User' }),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(
        doc(db, 'accessRequests', ACTORS.pending.uid),
        {
          status: 'approved',
          approvedAt: serverTimestamp(),
          approvedBy: ACTORS.superAdmin.uid,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
    );
  });

  it('blocks a first-factor SIRAP admin from listing, deciding, or granting', async () => {
    const db = firstFactorDb(ACTORS.sirapAdmin);
    await assertFails(
      getDocs(query(collection(db, 'userDirectory'), where('status', '==', 'active'))),
    );
    await assertFails(
      getDocs(query(collection(db, 'sirapAccessRequests'), where('sirapId', '==', 'orinoquia'))),
    );
    await assertFails(
      updateDoc(doc(db, 'sirapAccessRequests', sirapRequestId(ACTORS.target.uid, 'orinoquia')), {
        status: 'approved',
        decidedAt: serverTimestamp(),
        decidedBy: ACTORS.sirapAdmin.uid,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(db, 'users', ACTORS.target.uid), {
        allowedSirapIds: ['orinoquia'],
        updatedAt: serverTimestamp(),
        updatedBy: ACTORS.sirapAdmin.uid,
      }),
    );
  });

  it('blocks a first-factor publisher from creating a manifest style request', async () => {
    await assertFails(
      setDoc(doc(firstFactorDb(ACTORS.publisher), 'manifestStyleRequests', 'style-ff'), {
        ...manifestRequestPayload(ACTORS.publisher),
      }),
    );
  });
});

describe('TOTP claim shape', () => {
  it('fails closed when second_factor_identifier is missing or the factor is phone', async () => {
    await assertFails(
      getDocs(
        query(
          collection(totpMissingIdentifierDb(ACTORS.superAdmin), 'accessRequests'),
          where('status', '==', 'pending'),
        ),
      ),
    );
    await assertFails(
      getDocs(
        query(
          collection(phoneFactorDb(ACTORS.superAdmin), 'accessRequests'),
          where('status', '==', 'pending'),
        ),
      ),
    );
  });
});

describe('TOTP super admin', () => {
  it("can run the approval batch and list the user directory, but not write someone else's directory row", async () => {
    const db = totpDb(ACTORS.superAdmin);
    const approvedUser = {
      uid: ACTORS.pending.uid,
      email: ACTORS.pending.email,
      name: ACTORS.pending.name,
    };
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', approvedUser.uid), {
      email: approvedUser.email,
      displayName: approvedUser.name,
      status: 'active',
      role: 'sirap-user',
      tier: 2,
      allowedSirapIds: ['orinoquia'],
      administeredSirapIds: [],
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'sirapAccessRequests', sirapRequestId(approvedUser.uid, 'orinoquia')), {
      status: 'approved',
      decidedAt: serverTimestamp(),
      decidedBy: ACTORS.superAdmin.uid,
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());

    await assertFails(
      setDoc(doc(db, 'userDirectory', approvedUser.uid), {
        uid: approvedUser.uid,
        email: approvedUser.email,
        displayName: approvedUser.name,
        status: 'active',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      getDocs(query(collection(db, 'userDirectory'), where('status', '==', 'active'))),
    );
    await assertFails(
      getDocs(query(collection(db, 'accessRequests'), where('status', '==', 'pending'))),
    );
  });
});

describe('TOTP SIRAP admin', () => {
  it('can decide and grant only administered SIRAPs', async () => {
    const db = totpDb(ACTORS.sirapAdmin);
    const ownedRequest = doc(
      db,
      'sirapAccessRequests',
      sirapRequestId(ACTORS.target.uid, 'orinoquia'),
    );
    const foreignRequest = doc(
      db,
      'sirapAccessRequests',
      sirapRequestId(ACTORS.target.uid, 'eje-cafetero'),
    );

    await assertSucceeds(getDoc(doc(db, 'users', ACTORS.target.uid)));
    await assertSucceeds(getDocs(activeUsersHolding(db, 'orinoquia')));
    await assertSucceeds(
      getDocs(query(collection(db, 'sirapAccessRequests'), where('sirapId', '==', 'orinoquia'))),
    );
    await assertSucceeds(
      updateDoc(doc(db, 'users', ACTORS.target.uid), {
        allowedSirapIds: ['orinoquia'],
        role: 'sirap-user',
        tier: 2,
        updatedAt: serverTimestamp(),
        updatedBy: ACTORS.sirapAdmin.uid,
      }),
    );
    await assertSucceeds(
      updateDoc(ownedRequest, {
        status: 'approved',
        decidedAt: serverTimestamp(),
        decidedBy: ACTORS.sirapAdmin.uid,
        updatedAt: serverTimestamp(),
      }),
    );

    await assertFails(
      getDocs(query(collection(db, 'sirapAccessRequests'), where('sirapId', '==', 'eje-cafetero'))),
    );
    await assertFails(
      updateDoc(foreignRequest, {
        status: 'approved',
        decidedAt: serverTimestamp(),
        decidedBy: ACTORS.sirapAdmin.uid,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(db, 'users', ACTORS.target.uid), {
        allowedSirapIds: ['orinoquia', 'eje-cafetero'],
        updatedAt: serverTimestamp(),
        updatedBy: ACTORS.sirapAdmin.uid,
      }),
    );
  });

  it('preserves another SIRAP when granting the first administered one', async () => {
    const holder = { uid: 'split-access', email: 'split@example.com', name: 'Split Access' };
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'users', holder.uid),
        userRecord(holder, {
          role: 'sirap-user',
          allowedSirapIds: ['eje-cafetero'],
        }),
      );
      await setDoc(
        doc(context.firestore(), 'sirapAccessRequests', sirapRequestId(holder.uid, 'orinoquia')),
        pendingSirapRequest(holder, 'orinoquia'),
      );
    });
    const db = totpDb(ACTORS.sirapAdmin);
    await assertSucceeds(
      updateDoc(doc(db, 'users', holder.uid), {
        allowedSirapIds: ['eje-cafetero', 'orinoquia'],
        role: 'sirap-user',
        tier: 2,
        updatedAt: serverTimestamp(),
        updatedBy: ACTORS.sirapAdmin.uid,
      }),
    );
    await assertFails(
      updateDoc(doc(db, 'users', holder.uid), {
        allowedSirapIds: ['orinoquia'],
        role: 'sirap-user',
        tier: 2,
        updatedAt: serverTimestamp(),
        updatedBy: ACTORS.sirapAdmin.uid,
      }),
    );
  });
});

describe('users a regional admin can see', () => {
  const member = { uid: 'region-member', email: 'member@example.com', name: 'Region Member' };
  const otherRegionRequester = {
    uid: 'eje-requester',
    email: 'eje-requester@example.com',
    name: 'Eje Requester',
  };

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(
        doc(db, 'users', member.uid),
        userRecord(member, {
          role: 'sirap-user',
          allowedSirapIds: ['orinoquia', 'eje-cafetero'],
        }),
      );
      await setDoc(doc(db, 'users', otherRegionRequester.uid), userRecord(otherRegionRequester));
      await setDoc(
        doc(db, 'sirapAccessRequests', sirapRequestId(otherRegionRequester.uid, 'eje-cafetero')),
        pendingSirapRequest(otherRegionRequester, 'eje-cafetero'),
      );
    });
  });

  it('lists and reads people who hold an administered region, and reads a person asking for it', async () => {
    const db = totpDb(ACTORS.sirapAdmin);

    const listed = await assertSucceeds(getDocs(activeUsersHolding(db, 'orinoquia')));
    assert.deepEqual(
      listed.docs.map((userDoc) => userDoc.id).sort(),
      [member.uid, ACTORS.sirapAdmin.uid].sort(),
    );
    await assertSucceeds(getDoc(doc(db, 'users', member.uid)));
    await assertSucceeds(getDoc(doc(db, 'users', ACTORS.target.uid)));
  });

  it("approves a pending request in a transaction that first reads the requester's record", async () => {
    const db = totpDb(ACTORS.sirapAdmin);
    const userRef = doc(db, 'users', ACTORS.target.uid);
    const requestRef = doc(
      db,
      'sirapAccessRequests',
      sirapRequestId(ACTORS.target.uid, 'orinoquia'),
    );

    await assertSucceeds(
      runTransaction(db, async (transaction) => {
        const requester = await transaction.get(userRef);
        assert.equal(requester.data().status, 'active');
        transaction.update(requestRef, {
          status: 'approved',
          decidedAt: serverTimestamp(),
          decidedBy: ACTORS.sirapAdmin.uid,
          updatedAt: serverTimestamp(),
        });
        transaction.update(userRef, {
          allowedSirapIds: ['orinoquia'],
          role: 'sirap-user',
          tier: 2,
          updatedAt: serverTimestamp(),
          updatedBy: ACTORS.sirapAdmin.uid,
        });
      }),
    );
    await assertSucceeds(getDoc(userRef));
  });

  it('cannot list or read people who neither hold nor are asking for an administered region', async () => {
    const db = totpDb(ACTORS.sirapAdmin);

    await assertFails(getDocs(query(collection(db, 'users'), where('status', '==', 'active'))));
    await assertFails(getDocs(activeUsersHolding(db, 'eje-cafetero')));
    await assertFails(getDoc(doc(db, 'users', ACTORS.foreign.uid)));
    await assertFails(getDoc(doc(db, 'users', otherRegionRequester.uid)));
    // The active user's only Orinoquía request was denied.
    await assertFails(getDoc(doc(db, 'users', ACTORS.active.uid)));
    await assertFails(getDocs(collection(db, 'userDirectory')));
    await assertFails(getDoc(doc(db, 'userDirectory', ACTORS.active.uid)));
  });

  it('still lets a super admin list and read every active user', async () => {
    const db = totpDb(ACTORS.superAdmin);

    const listed = await assertSucceeds(
      getDocs(query(collection(db, 'users'), where('status', '==', 'active'))),
    );
    assert.equal(listed.docs.some((userDoc) => userDoc.id === ACTORS.foreign.uid), true);
    await assertSucceeds(getDoc(doc(db, 'users', otherRegionRequester.uid)));
    await assertSucceeds(getDoc(doc(db, 'userDirectory', ACTORS.active.uid)));
  });
});

describe('people a regional admin can grant a region to', () => {
  const bothRegionsAdmin = {
    uid: 'both-regions-admin',
    email: 'both-admin@example.com',
    name: 'Both Regions Admin',
  };
  const orinoquiaHolder = {
    uid: 'orinoquia-holder',
    email: 'orinoquia-holder@example.com',
    name: 'Orinoquia Holder',
  };
  const ejeRequester = {
    uid: 'eje-only-requester',
    email: 'eje-only@example.com',
    name: 'Eje Only Requester',
  };
  const denialRequester = {
    uid: 'denial-requester',
    email: 'denial@example.com',
    name: 'Denial Requester',
  };

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(
        doc(db, 'users', bothRegionsAdmin.uid),
        userRecord(bothRegionsAdmin, {
          role: 'sirap-admin',
          allowedSirapIds: ['orinoquia', 'eje-cafetero'],
          administeredSirapIds: ['orinoquia', 'eje-cafetero'],
        }),
      );
      await setDoc(
        doc(db, 'users', orinoquiaHolder.uid),
        userRecord(orinoquiaHolder, { role: 'sirap-user', allowedSirapIds: ['orinoquia'] }),
      );
      await setDoc(doc(db, 'users', ejeRequester.uid), userRecord(ejeRequester));
      await setDoc(
        doc(db, 'sirapAccessRequests', sirapRequestId(ejeRequester.uid, 'eje-cafetero')),
        pendingSirapRequest(ejeRequester, 'eje-cafetero'),
      );
      await setDoc(doc(db, 'users', denialRequester.uid), userRecord(denialRequester));
      await setDoc(
        doc(db, 'sirapAccessRequests', sirapRequestId(denialRequester.uid, 'orinoquia')),
        pendingSirapRequest(denialRequester, 'orinoquia'),
      );
    });
  });

  function writeRegions(db, admin, person, allowedSirapIds) {
    return updateDoc(doc(db, 'users', person.uid), {
      allowedSirapIds,
      role: allowedSirapIds.length > 0 ? 'sirap-user' : 'user',
      tier: 2,
      updatedAt: serverTimestamp(),
      updatedBy: admin.uid,
    });
  }

  async function storedUsers(people) {
    const stored = {};
    await testEnv.withSecurityRulesDisabled(async (context) => {
      for (const person of people) {
        stored[person.uid] = (await getDoc(doc(context.firestore(), 'users', person.uid))).data();
      }
    });
    return stored;
  }

  it('cannot grant a region to someone who holds none of their regions and has no pending request for it', async () => {
    const untouched = [ACTORS.active, ACTORS.foreign, ejeRequester];
    const before = await storedUsers(untouched);
    const db = totpDb(ACTORS.sirapAdmin);

    // The active user's only Orinoquía request was denied.
    await assertFails(writeRegions(db, ACTORS.sirapAdmin, ACTORS.active, ['orinoquia']));
    await assertFails(writeRegions(db, ACTORS.sirapAdmin, ACTORS.active, []));
    await assertFails(
      writeRegions(db, ACTORS.sirapAdmin, ACTORS.foreign, ['eje-cafetero', 'orinoquia']),
    );
    await assertFails(writeRegions(db, ACTORS.sirapAdmin, ejeRequester, ['orinoquia']));
    await assertFails(
      writeRegions(totpDb(bothRegionsAdmin), bothRegionsAdmin, ejeRequester, ['orinoquia']),
    );

    assert.deepEqual(await storedUsers(untouched), before);
  });

  it('grants or denies a region for someone whose request for that region is pending', async () => {
    await assertSucceeds(
      writeRegions(totpDb(ACTORS.sirapAdmin), ACTORS.sirapAdmin, ACTORS.target, ['orinoquia']),
    );
    await assertSucceeds(
      writeRegions(totpDb(bothRegionsAdmin), bothRegionsAdmin, ejeRequester, ['eje-cafetero']),
    );

    const db = totpDb(ACTORS.sirapAdmin);
    const userRef = doc(db, 'users', denialRequester.uid);
    const requestRef = doc(
      db,
      'sirapAccessRequests',
      sirapRequestId(denialRequester.uid, 'orinoquia'),
    );
    await assertSucceeds(
      runTransaction(db, async (transaction) => {
        await transaction.get(userRef);
        transaction.update(requestRef, {
          status: 'denied',
          decidedAt: serverTimestamp(),
          decidedBy: ACTORS.sirapAdmin.uid,
          updatedAt: serverTimestamp(),
        });
        transaction.update(userRef, {
          allowedSirapIds: [],
          role: 'user',
          tier: 2,
          updatedAt: serverTimestamp(),
          updatedBy: ACTORS.sirapAdmin.uid,
        });
      }),
    );

    const stored = await storedUsers([ACTORS.target, ejeRequester, denialRequester]);
    assert.deepEqual(stored[ACTORS.target.uid].allowedSirapIds, ['orinoquia']);
    assert.deepEqual(stored[ejeRequester.uid].allowedSirapIds, ['eje-cafetero']);
    assert.deepEqual(stored[denialRequester.uid].allowedSirapIds, []);
  });

  it('changes access for someone who already holds one of their regions, without a request', async () => {
    await assertSucceeds(
      writeRegions(totpDb(bothRegionsAdmin), bothRegionsAdmin, orinoquiaHolder, [
        'orinoquia',
        'eje-cafetero',
      ]),
    );
    await assertSucceeds(
      writeRegions(totpDb(ACTORS.sirapAdmin), ACTORS.sirapAdmin, orinoquiaHolder, [
        'eje-cafetero',
      ]),
    );

    const stored = await storedUsers([orinoquiaHolder]);
    assert.deepEqual(stored[orinoquiaHolder.uid].allowedSirapIds, ['eje-cafetero']);
  });
});

describe('legacy allowedSirapIds', () => {
  const dispatch = {
    uid: 'legacy-dispatch',
    email: 'dispatch@example.com',
    name: 'Dispatch',
  };

  async function seedDispatch(allowedSirapIds) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(
        doc(db, 'users', dispatch.uid),
        userRecord(dispatch, {
          allowedSirapIds,
          administeredSirapIds: ['caribe', 'pacifico'],
        }),
      );
      await setDoc(
        doc(db, 'sirapAccessRequests', sirapRequestId(dispatch.uid, 'eje-cafetero')),
        pendingSirapRequest(dispatch, 'eje-cafetero'),
      );
      await setDoc(
        doc(db, 'sirapAccessRequests', sirapRequestId(dispatch.uid, 'orinoquia')),
        pendingSirapRequest(dispatch, 'orinoquia'),
      );
    });
  }

  function decideLegacyRequest(db, actor, sirapId, decision, allowedSirapIds) {
    const batch = writeBatch(db);
    batch.update(doc(db, 'sirapAccessRequests', sirapRequestId(dispatch.uid, sirapId)), {
      status: decision,
      decidedAt: serverTimestamp(),
      decidedBy: actor.uid,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'users', dispatch.uid), {
      allowedSirapIds,
      role: allowedSirapIds.length > 0 ? 'sirap-user' : 'user',
      tier: 2,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid,
    });
    return batch.commit();
  }

  it('lets a super admin approve a current SIRAP and repair retired ids', async () => {
    await seedDispatch(['caribe', 'pacifico', 'orinoquia']);
    const db = totpDb(ACTORS.superAdmin);

    await assertSucceeds(
      decideLegacyRequest(db, ACTORS.superAdmin, 'eje-cafetero', 'approved', [
        'orinoquia',
        'eje-cafetero',
      ]),
    );

    const savedUser = await getDoc(doc(db, 'users', dispatch.uid));
    const savedRequest = await getDoc(
      doc(db, 'sirapAccessRequests', sirapRequestId(dispatch.uid, 'eje-cafetero')),
    );
    assert.deepEqual(savedUser.data().allowedSirapIds, ['orinoquia', 'eje-cafetero']);
    assert.equal(savedRequest.data().status, 'approved');
    assert.equal(savedRequest.data().decidedBy, ACTORS.superAdmin.uid);
  });

  it('lets a super admin deny a current SIRAP and repair retired ids', async () => {
    await seedDispatch(['caribe', 'pacifico', 'orinoquia', 'eje-cafetero']);
    const db = totpDb(ACTORS.superAdmin);

    await assertSucceeds(
      decideLegacyRequest(db, ACTORS.superAdmin, 'orinoquia', 'denied', ['eje-cafetero']),
    );

    const savedUser = await getDoc(doc(db, 'users', dispatch.uid));
    const savedRequest = await getDoc(
      doc(db, 'sirapAccessRequests', sirapRequestId(dispatch.uid, 'orinoquia')),
    );
    assert.deepEqual(savedUser.data().allowedSirapIds, ['eje-cafetero']);
    assert.equal(savedRequest.data().status, 'denied');
  });

  it('rejects a super admin decision that keeps or adds retired ids', async () => {
    await seedDispatch(['caribe', 'pacifico', 'orinoquia']);
    const db = totpDb(ACTORS.superAdmin);
    const userRef = doc(db, 'users', dispatch.uid);

    await assertFails(
      updateDoc(userRef, {
        allowedSirapIds: arrayUnion('eje-cafetero'),
        updatedAt: serverTimestamp(),
        updatedBy: ACTORS.superAdmin.uid,
      }),
    );
    await assertFails(
      updateDoc(userRef, {
        allowedSirapIds: arrayRemove('orinoquia'),
        updatedAt: serverTimestamp(),
        updatedBy: ACTORS.superAdmin.uid,
      }),
    );
    await assertFails(
      updateDoc(userRef, {
        allowedSirapIds: ['caribe', 'eje-cafetero'],
        updatedAt: serverTimestamp(),
        updatedBy: ACTORS.superAdmin.uid,
      }),
    );
    await assertFails(
      updateDoc(userRef, {
        allowedSirapIds: ['eje-cafetero'],
        organization: 'not-a-user-field',
        updatedAt: serverTimestamp(),
        updatedBy: ACTORS.superAdmin.uid,
      }),
    );
  });

  it('rejects a first-factor super admin repair', async () => {
    await seedDispatch(['caribe', 'pacifico']);
    await assertFails(
      decideLegacyRequest(
        firstFactorDb(ACTORS.superAdmin),
        ACTORS.superAdmin,
        'eje-cafetero',
        'approved',
        ['eje-cafetero'],
      ),
    );
  });

  it('stops a regional admin from repairing legacy ids or granting another SIRAP', async () => {
    await seedDispatch(['caribe', 'pacifico']);
    const db = totpDb(ACTORS.sirapAdmin);

    await assertFails(
      decideLegacyRequest(db, ACTORS.sirapAdmin, 'orinoquia', 'approved', ['orinoquia']),
    );
    await assertFails(
      decideLegacyRequest(db, ACTORS.sirapAdmin, 'eje-cafetero', 'approved', [
        'orinoquia',
        'eje-cafetero',
      ]),
    );
    await assertFails(
      updateDoc(doc(db, 'users', dispatch.uid), {
        allowedSirapIds: arrayUnion('orinoquia'),
        updatedAt: serverTimestamp(),
        updatedBy: ACTORS.sirapAdmin.uid,
      }),
    );
    await assertFails(
      updateDoc(doc(db, 'users', dispatch.uid), {
        allowedSirapIds: ['orinoquia'],
        role: 'admin',
        isAdmin: true,
        isSuperAdmin: true,
        updatedAt: serverTimestamp(),
        updatedBy: ACTORS.sirapAdmin.uid,
      }),
    );
  });
});

describe('manifest style requests', () => {
  it('allows a TOTP super admin and blocks a legacy publisher', async () => {
    await assertFails(
      setDoc(
        doc(totpDb(ACTORS.publisher), 'manifestStyleRequests', 'style-publisher'),
        manifestRequestPayload(ACTORS.publisher),
      ),
    );
    await assertSucceeds(
      setDoc(
        doc(totpDb(ACTORS.superAdmin), 'manifestStyleRequests', 'style-super'),
        manifestRequestPayload(ACTORS.superAdmin),
      ),
    );
  });
});

describe('TOTP active user scenarios', () => {
  it('can create and rerequest their own SIRAP access request', async () => {
    const db = totpDb(ACTORS.active);
    const requestRef = doc(
      db,
      'sirapAccessRequests',
      sirapRequestId(ACTORS.active.uid, 'orinoquia'),
    );

    await assertSucceeds(
      setDoc(
        requestRef,
        {
          uid: ACTORS.active.uid,
          email: ACTORS.active.email,
          displayName: ACTORS.active.name,
          sirapId: 'orinoquia',
          status: 'pending',
          reason: 'Trying again',
          requestedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          decidedAt: deleteField(),
          decidedBy: deleteField(),
        },
        { merge: true },
      ),
    );
  });

  it('can create, read, update, and delete their own saved scenario', async () => {
    const db = totpDb(ACTORS.active);
    const scenarioRef = doc(
      db,
      'users',
      ACTORS.active.uid,
      'savedSolutionScenarios',
      'saved-scenario-one',
    );

    await assertSucceeds(setDoc(scenarioRef, scenarioPayload('saved-scenario-one')));
    await assertSucceeds(getDoc(scenarioRef));
    await assertSucceeds(
      setDoc(scenarioRef, scenarioPayload('saved-scenario-one', { label: 'Updated coastal plan' })),
    );
    await assertSucceeds(deleteDoc(scenarioRef));
  });
});

describe('self-registration of users/{uid}', () => {
  it('allows the default Google account create and rejects privileged self-provision', async () => {
    const rules = readFileSync(RULES_PATH, 'utf8');
    assert.equal(rules.includes('validSelfUserCreate'), true);
    assert.equal(rules.includes('validSelfProvisionedUser'), false);

    const fresh = { uid: 'fresh-google', email: 'fresh@example.com', name: 'Fresh Google' };
    const db = firstFactorDb(fresh);
    await assertSucceeds(setDoc(doc(db, 'users', fresh.uid), defaultSelfUser(fresh)));
    await assertSucceeds(setDoc(doc(db, 'userDirectory', fresh.uid), defaultSelfDirectory(fresh)));
    await assertFails(setDoc(doc(db, 'users', fresh.uid), defaultSelfUser(fresh)));
    await assertFails(setDoc(doc(firstFactorDb(ACTORS.pending), 'users', ACTORS.pending.uid), gticSelfProvisionedUser(ACTORS.pending)));
  });

  it('rejects a users record self-created by a password, custom-token, or providerless sign-in', async () => {
    const stranger = { uid: 'password-signup', email: 'victim@example.com', name: 'Password Signup' };
    const nonGoogleDbs = [
      passwordDb(stranger),
      passwordTotpDb(stranger),
      firestoreFor(stranger, { sign_in_provider: 'custom' }),
      firestoreFor(stranger, {}),
    ];

    for (const db of nonGoogleDbs) {
      await assertFails(setDoc(doc(db, 'users', stranger.uid), defaultSelfUser(stranger)));
    }
    await assertFails(
      setDoc(doc(passwordDb(stranger), 'userDirectory', stranger.uid), defaultSelfDirectory(stranger)),
    );
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const stored = await getDoc(doc(context.firestore(), 'users', stranger.uid));
      assert.equal(stored.exists(), false);
    });
  });

  it('allows the Google account create the web app sends, before and after TOTP sign-in', async () => {
    const firstFactor = { uid: 'google-first', email: 'google-first@example.com', name: 'Google First' };
    const afterTotp = { uid: 'google-totp', email: 'google-totp@example.com', name: 'Google TOTP' };

    await assertSucceeds(
      setDoc(doc(firstFactorDb(firstFactor), 'users', firstFactor.uid), defaultSelfUser(firstFactor)),
    );
    await assertSucceeds(
      setDoc(doc(totpDb(afterTotp), 'users', afterTotp.uid), defaultSelfUser(afterTotp)),
    );
  });

  it('rejects an active directory row for a denied account', async () => {
    const denied = { uid: 'denied-user', email: 'denied@example.com', name: 'Denied User' };
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', denied.uid), {
        ...userRecord(denied),
        status: 'denied',
      });
    });
    await assertFails(
      setDoc(doc(firstFactorDb(denied), 'userDirectory', denied.uid), defaultSelfDirectory(denied)),
    );
    const db = totpDb(ACTORS.sirapAdmin);
    await assertFails(getDoc(doc(db, 'users', denied.uid)));
    await assertFails(
      updateDoc(doc(db, 'users', denied.uid), {
        allowedSirapIds: ['orinoquia'],
        role: 'sirap-user',
        tier: 2,
        updatedAt: serverTimestamp(),
        updatedBy: ACTORS.sirapAdmin.uid,
      }),
    );
  });

  it('denies creating another user, unauthenticated create, and role escalation', async () => {
    const fresh = { uid: 'fresh-totp', email: 'fresh-totp@example.com', name: 'Fresh TOTP' };
    await assertFails(
      setDoc(doc(totpDb(fresh), 'users', 'self-made-colleague'), {
        ...defaultSelfUser({
          uid: 'self-made-colleague',
          email: 'colleague@example.com',
          name: 'Colleague',
        }),
      }),
    );
    await assertFails(
      setDoc(doc(totpDb(ACTORS.sirapAdmin), 'users', 'sirap-minted-user'), {
        ...gticSelfProvisionedUser({
          uid: 'sirap-minted-user',
          email: 'minted@example.com',
          name: 'Minted User',
        }),
      }),
    );

    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(
        doc(anonDb, 'users', 'anon-user'),
        defaultSelfUser({ uid: 'anon-user', email: 'anon@example.com', name: 'Anon' }),
      ),
    );
    await assertFails(
      updateDoc(doc(firstFactorDb(ACTORS.active), 'users', ACTORS.active.uid), {
        role: 'super-admin',
        tier: 3,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(totpDb(ACTORS.active), 'users', ACTORS.active.uid), {
        role: 'super-admin',
        tier: 3,
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe('deciding your own SIRAP access request', () => {
  async function seedOwnRequest(actor, sirapId, status) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'sirapAccessRequests', sirapRequestId(actor.uid, sirapId)),
        pendingSirapRequest(actor, sirapId, {
          status,
          includeDecision: status !== 'pending',
        }),
      );
    });
  }

  function decideOwnRequest(actor, sirapId, status) {
    const db = totpDb(actor);
    return updateDoc(doc(db, 'sirapAccessRequests', sirapRequestId(actor.uid, sirapId)), {
      status,
      decidedAt: serverTimestamp(),
      decidedBy: actor.uid,
      updatedAt: serverTimestamp(),
    });
  }

  async function storedStatus(actor, sirapId) {
    let status;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const stored = await getDoc(
        doc(context.firestore(), 'sirapAccessRequests', sirapRequestId(actor.uid, sirapId)),
      );
      status = stored.data().status;
    });
    return status;
  }

  for (const { label, actor, sirapId } of [
    { label: 'regional admin', actor: ACTORS.sirapAdmin, sirapId: 'orinoquia' },
    { label: 'super admin', actor: ACTORS.superAdmin, sirapId: 'eje-cafetero' },
  ]) {
    it(`stops a ${label} approving their own request but lets them deny or revoke it`, async () => {
      await seedOwnRequest(actor, sirapId, 'pending');
      await assertFails(decideOwnRequest(actor, sirapId, 'approved'));
      assert.equal(await storedStatus(actor, sirapId), 'pending');
      await assertSucceeds(decideOwnRequest(actor, sirapId, 'denied'));
      assert.equal(await storedStatus(actor, sirapId), 'denied');

      await seedOwnRequest(actor, sirapId, 'approved');
      await assertSucceeds(decideOwnRequest(actor, sirapId, 'denied'));
      assert.equal(await storedStatus(actor, sirapId), 'denied');
    });
  }
});

describe('authenticator setup time on users/{uid}', () => {
  async function storedUser(uid) {
    let data;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      data = (await getDoc(doc(context.firestore(), 'users', uid))).data();
    });
    return data;
  }

  it('lets a person save their own setup time after authenticator sign-in, and save it again later', async () => {
    const before = await storedUser(ACTORS.active.uid);
    const ownRef = doc(totpDb(ACTORS.active), 'users', ACTORS.active.uid);
    await assertSucceeds(updateDoc(ownRef, { mfaEnrolledAt: serverTimestamp() }));
    const first = (await storedUser(ACTORS.active.uid)).mfaEnrolledAt;
    assert.equal(first instanceof Timestamp, true);

    await assertSucceeds(updateDoc(ownRef, { mfaEnrolledAt: serverTimestamp() }));
    const { mfaEnrolledAt, ...rest } = await storedUser(ACTORS.active.uid);
    assert.equal(mfaEnrolledAt.toMillis() >= first.toMillis(), true);
    assert.deepEqual(rest, before);
  });

  it('refuses the setup time when any other field rides along, the time is chosen, or no authenticator was used', async () => {
    const before = await storedUser(ACTORS.active.uid);
    const ownRef = doc(totpDb(ACTORS.active), 'users', ACTORS.active.uid);
    await assertFails(
      updateDoc(ownRef, { mfaEnrolledAt: serverTimestamp(), role: 'super-admin', tier: 3 }),
    );
    await assertFails(
      updateDoc(ownRef, {
        mfaEnrolledAt: serverTimestamp(),
        role: 'sirap-user',
        allowedSirapIds: ['orinoquia'],
      }),
    );
    await assertFails(updateDoc(ownRef, { mfaEnrolledAt: serverTimestamp(), status: 'denied' }));
    await assertFails(updateDoc(ownRef, { mfaEnrolledAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ownRef, { mfaEnrolledAt: new Date('2026-01-01T00:00:00.000Z') }));
    await assertFails(updateDoc(ownRef, { mfaEnrolledAt: 'yesterday' }));

    const firstFactorRef = doc(firstFactorDb(ACTORS.active), 'users', ACTORS.active.uid);
    await assertFails(updateDoc(firstFactorRef, { mfaEnrolledAt: serverTimestamp() }));
    await assertFails(
      updateDoc(doc(totpMissingIdentifierDb(ACTORS.active), 'users', ACTORS.active.uid), {
        mfaEnrolledAt: serverTimestamp(),
      }),
    );

    assert.deepEqual(await storedUser(ACTORS.active.uid), before);
  });

  it("refuses saving a setup time on someone else's record, including by a regional admin or a signed-out visitor", async () => {
    await assertFails(
      updateDoc(doc(totpDb(ACTORS.foreign), 'users', ACTORS.active.uid), { mfaEnrolledAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(doc(totpDb(ACTORS.sirapAdmin), 'users', ACTORS.target.uid), { mfaEnrolledAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(doc(testEnv.unauthenticatedContext().firestore(), 'users', ACTORS.active.uid), {
        mfaEnrolledAt: serverTimestamp(),
      }),
    );
    assert.equal('mfaEnrolledAt' in (await storedUser(ACTORS.active.uid)), false);
    assert.equal('mfaEnrolledAt' in (await storedUser(ACTORS.target.uid)), false);
  });

  it('keeps a super admin role assignment working on a record that holds a setup time', async () => {
    await assertSucceeds(
      updateDoc(doc(totpDb(ACTORS.active), 'users', ACTORS.active.uid), { mfaEnrolledAt: serverTimestamp() }),
    );
    const adminDb = totpDb(ACTORS.superAdmin);
    await assertSucceeds(
      writeBatch(adminDb)
        .set(
          doc(adminDb, 'users', ACTORS.active.uid),
          {
            role: 'sirap-user',
            tier: 2,
            isAdmin: deleteField(),
            isSuperAdmin: deleteField(),
            administeredSirapIds: [],
            allowedSirapIds: ['orinoquia'],
            updatedAt: serverTimestamp(),
            updatedBy: ACTORS.superAdmin.uid,
          },
          { merge: true },
        )
        .commit(),
    );
    const stored = await storedUser(ACTORS.active.uid);
    assert.equal(stored.role, 'sirap-user');
    assert.equal(stored.mfaEnrolledAt instanceof Timestamp, true);
  });
});
