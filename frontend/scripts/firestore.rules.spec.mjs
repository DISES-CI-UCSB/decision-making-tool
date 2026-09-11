import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
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
  serverTimestamp,
  setDoc,
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

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
let testEnv;

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

describe('first-factor pending requester', () => {
  it('can create, read, and pending-update their own access request', async () => {
    const requester = { uid: 'fresh-pending', email: 'fresh@example.com', name: 'Fresh Pending' };
    const db = firstFactorDb(requester);
    const requestRef = doc(db, 'accessRequests', requester.uid);

    await assertSucceeds(setDoc(requestRef, pendingAccessRequestData(requester)));
    await assertSucceeds(getDoc(requestRef));
    await assertSucceeds(
      setDoc(
        requestRef,
        pendingAccessRequestData(requester, {
          reason: 'Updated reason',
          submittedAt: 1_700_000_000_111,
        }),
        { merge: true },
      ),
    );
  });

  it('can create and rerequest their own SIRAP access request', async () => {
    const db = firstFactorDb(ACTORS.active);
    const requestRef = doc(
      db,
      'sirapAccessRequests',
      sirapRequestId(ACTORS.active.uid, 'orinoquia'),
    );

    await assertSucceeds(getDoc(requestRef));
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

    const fresh = {
      uid: 'sirap-requester',
      email: 'sirap-req@example.com',
      name: 'SIRAP Requester',
    };
    const freshDb = firstFactorDb(fresh);
    await assertSucceeds(
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
  it('can run the approval batch and create or list the user directory', async () => {
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
      role: 'authorized_viewer',
      tier: 2,
      isAdmin: false,
      isSuperAdmin: false,
      allowedSirapIds: ['orinoquia'],
      administeredSirapIds: [],
      updatedAt: serverTimestamp(),
    });
    batch.set(
      doc(db, 'accessRequests', approvedUser.uid),
      {
        status: 'approved',
        approvedAt: serverTimestamp(),
        approvedBy: ACTORS.superAdmin.uid,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    batch.update(doc(db, 'sirapAccessRequests', sirapRequestId(approvedUser.uid, 'orinoquia')), {
      status: 'approved',
      decidedAt: serverTimestamp(),
      decidedBy: ACTORS.superAdmin.uid,
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());

    await assertSucceeds(
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
    await assertSucceeds(
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

    await assertSucceeds(
      getDocs(query(collection(db, 'sirapAccessRequests'), where('sirapId', '==', 'orinoquia'))),
    );
    await assertSucceeds(
      updateDoc(ownedRequest, {
        status: 'approved',
        decidedAt: serverTimestamp(),
        decidedBy: ACTORS.sirapAdmin.uid,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(db, 'users', ACTORS.target.uid), {
        allowedSirapIds: ['orinoquia'],
        updatedAt: serverTimestamp(),
        updatedBy: ACTORS.sirapAdmin.uid,
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
    await assertFails(getDoc(doc(db, 'users', ACTORS.foreign.uid)));
  });
});

describe('TOTP publisher', () => {
  it('can create a valid manifest style request', async () => {
    await assertSucceeds(
      setDoc(
        doc(totpDb(ACTORS.publisher), 'manifestStyleRequests', 'style-totp'),
        manifestRequestPayload(ACTORS.publisher),
      ),
    );
  });
});

describe('TOTP active user scenarios', () => {
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

describe('A: no self-provision', () => {
  it('denies first-factor self-create of an active user or directory row', async () => {
    const db = firstFactorDb(ACTORS.pending);
    await assertFails(
      setDoc(doc(db, 'users', ACTORS.pending.uid), {
        uid: ACTORS.pending.uid,
        email: ACTORS.pending.email,
        displayName: ACTORS.pending.name,
        status: 'active',
        role: 'authorized_viewer',
        tier: 2,
        isAdmin: false,
        isSuperAdmin: false,
        allowedSirapIds: [],
        administeredSirapIds: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(db, 'userDirectory', ACTORS.pending.uid), {
        uid: ACTORS.pending.uid,
        email: ACTORS.pending.email,
        displayName: ACTORS.pending.name,
        status: 'active',
        updatedAt: serverTimestamp(),
      }),
    );
  });
});
