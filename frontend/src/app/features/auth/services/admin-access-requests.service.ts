import { Injectable, inject } from '@angular/core';
import {
  currentSirapIds,
  normalizeGrantScopes,
  readAppRole,
  readSirapAccessRegionIds,
  roleAfterAccessChange,
  roleToUserTier,
  scopesMatchRole,
  type AppRole,
  type SirapRegionId,
  UserTier,
} from '@core/models';
import { FirebaseClientService } from '@core/services/firebase-client.service';
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';

export interface UserAccessGrant {
  role: AppRole;
  tier: UserTier.DecisionMaker | UserTier.Manager;
  isAdmin: boolean;
  administeredSirapIds: SirapRegionId[];
  allowedSirapIds: SirapRegionId[];
}

export interface AdminManagedUserRecord extends UserAccessGrant {
  uid: string;
  email: string;
  displayName: string;
  status: 'active';
  updatedAt: Date | null;
}

export function parseAdminManagedUserRecord(
  uid: string,
  data: DocumentData,
): AdminManagedUserRecord {
  const allowedSirapIds = readSirapAccessRegionIds(data['allowedSirapIds']);
  const administeredSirapIds = readSirapAccessRegionIds(data['administeredSirapIds']);
  const role = readAppRole(
    data['role'],
    allowedSirapIds,
    administeredSirapIds,
    data['isAdmin'] === true || data['isSuperAdmin'] === true,
  );
  return {
    uid,
    email: readDocumentString(data, 'email'),
    displayName: readDocumentString(data, 'displayName') || readDocumentString(data, 'email'),
    status: 'active',
    role,
    tier: roleToUserTier(role),
    isAdmin: role === 'super-admin',
    administeredSirapIds,
    allowedSirapIds,
    updatedAt: readDocumentDate(data, 'updatedAt'),
  };
}

export function hasSirapGrantOverlap(
  allowedSirapIds: readonly SirapRegionId[],
  administeredSirapIds: readonly SirapRegionId[],
): boolean {
  return allowedSirapIds.some((sirapId) => administeredSirapIds.includes(sirapId));
}

/**
 * Regional read updates keep every SIRAP outside the acting admin's scope.
 * Requested ids are applied only when that admin administers them.
 */
export function nextRegionalReadGrant(
  canonicalAllowedSirapIds: readonly string[],
  requestedAllowedSirapIds: readonly string[],
  actorAdministeredSirapIds: readonly string[],
  currentRole: AppRole,
  targetAdministeredSirapIds: readonly string[],
): { allowedSirapIds: SirapRegionId[]; role: AppRole } {
  const actorScope = new Set(currentSirapIds(actorAdministeredSirapIds));
  const canonical = currentSirapIds(canonicalAllowedSirapIds);
  const requested = currentSirapIds(requestedAllowedSirapIds);
  const allowedSirapIds = [
    ...canonical.filter((sirapId) => !actorScope.has(sirapId)),
    ...requested.filter((sirapId) => actorScope.has(sirapId)),
  ];
  const uniqueAllowed = [...new Set(allowedSirapIds)];
  return {
    allowedSirapIds: uniqueAllowed,
    role: roleAfterAccessChange(currentRole, uniqueAllowed, targetAdministeredSirapIds),
  };
}

@Injectable({ providedIn: 'root' })
export class AdminAccessRequestsService {
  private readonly firebase = inject(FirebaseClientService);

  async listActiveUsers(): Promise<AdminManagedUserRecord[]> {
    const firestore = this.requireFirestore();
    const administrator = await this.requireCurrentActiveAdmin();
    if (administrator.isSuperAdmin) {
      const usersSnapshot = await getDocs(
        query(collection(firestore, 'users'), where('status', '==', 'active')),
      );
      await this.backfillUserDirectory(usersSnapshot.docs);
      return usersSnapshot.docs
        .map((userDoc) => parseAdminManagedUserRecord(userDoc.id, userDoc.data()))
        .sort((a, b) => this.userDisplayLabel(a).localeCompare(this.userDisplayLabel(b)));
    }

    return (
      await getDocs(query(collection(firestore, 'users'), where('status', '==', 'active')))
    ).docs
      .map((userDoc) => parseAdminManagedUserRecord(userDoc.id, userDoc.data()))
      .filter((user) => user.role !== 'super-admin')
      .sort((a, b) => this.userDisplayLabel(a).localeCompare(this.userDisplayLabel(b)));
  }

  async updateRegionalUserAccess(
    uid: string,
    nextAllowedSirapIds: readonly SirapRegionId[],
  ): Promise<void> {
    const firestore = this.requireFirestore();
    const administrator = await this.requireCurrentActiveAdmin();
    if (administrator.isSuperAdmin) {
      throw new Error('Use the super-admin access update path for global permissions.');
    }

    const userSnapshot = await getDoc(doc(firestore, 'users', uid));
    const userData = userSnapshot.exists() ? userSnapshot.data() : null;
    if (userData?.['status'] !== 'active') {
      throw new Error('That user does not have an active account.');
    }
    const administeredSirapIds = readSirapAccessRegionIds(userData['administeredSirapIds']);
    const currentRole = readAppRole(
      userData['role'],
      readSirapAccessRegionIds(userData['allowedSirapIds']),
      administeredSirapIds,
      userData['isAdmin'] === true || userData['isSuperAdmin'] === true,
    );
    if (currentRole === 'super-admin') {
      throw new Error('Only a super admin can change that account.');
    }

    const allowedSirapIds = readSirapAccessRegionIds(userData['allowedSirapIds']);
    const nextGrant = nextRegionalReadGrant(
      allowedSirapIds,
      nextAllowedSirapIds,
      administrator.administeredSirapIds,
      currentRole,
      administeredSirapIds,
    );
    if (!scopesMatchRole(nextGrant.role, nextGrant.allowedSirapIds, administeredSirapIds)) {
      throw new Error('SIRAP administrators keep read access to every SIRAP they administer.');
    }

    await updateDoc(doc(firestore, 'users', uid), {
      allowedSirapIds: nextGrant.allowedSirapIds,
      role: nextGrant.role,
      tier: roleToUserTier(nextGrant.role),
      updatedAt: serverTimestamp(),
      updatedBy: administrator.uid,
    });
  }

  private async backfillUserDirectory(
    users: readonly { id: string; data: () => DocumentData }[],
  ): Promise<void> {
    const firestore = this.requireFirestore();
    const directorySnapshot = await getDocs(collection(firestore, 'userDirectory'));
    const directoryUids = new Set(directorySnapshot.docs.map((directoryDoc) => directoryDoc.id));
    const missingUsers = users.filter((user) => !directoryUids.has(user.id));
    if (missingUsers.length === 0) {
      return;
    }

    const batch = writeBatch(firestore);
    for (const user of missingUsers) {
      const data = user.data();
      batch.set(doc(firestore, 'userDirectory', user.id), {
        uid: user.id,
        email: readDocumentString(data, 'email'),
        displayName: readDocumentString(data, 'displayName') || readDocumentString(data, 'email'),
        status: 'active',
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }

  async updateUserAccess(uid: string, grant: UserAccessGrant): Promise<void> {
    const firestore = this.requireFirestore();
    const administrator = await this.requireCurrentActiveAdmin();
    if (!administrator.isSuperAdmin) {
      throw new Error('Only super admins can assign roles.');
    }
    const updatedBy = administrator.uid;
    const normalized = this.normalizedGrant(grant);

    await writeBatch(firestore)
      .set(
        doc(firestore, 'users', uid),
        {
          role: normalized.role,
          tier: roleToUserTier(normalized.role),
          isAdmin: deleteField(),
          isSuperAdmin: deleteField(),
          administeredSirapIds: normalized.administeredSirapIds,
          allowedSirapIds: normalized.allowedSirapIds,
          updatedAt: serverTimestamp(),
          updatedBy,
        },
        { merge: true },
      )
      .commit();
  }

  private normalizedGrant(grant: UserAccessGrant): {
    role: AppRole;
    allowedSirapIds: SirapRegionId[];
    administeredSirapIds: SirapRegionId[];
  } {
    const normalized = normalizeGrantScopes(
      grant.role,
      grant.allowedSirapIds,
      grant.administeredSirapIds,
    );
    if (normalized.role === 'sirap-user' && normalized.allowedSirapIds.length === 0) {
      throw new Error('A SIRAP user needs at least one SIRAP.');
    }
    if (normalized.role === 'sirap-admin' && normalized.administeredSirapIds.length === 0) {
      throw new Error('A SIRAP administrator needs at least one administered SIRAP.');
    }
    if (!scopesMatchRole(normalized.role, normalized.allowedSirapIds, normalized.administeredSirapIds)) {
      throw new Error('That role does not match the selected SIRAP access.');
    }
    return normalized;
  }

  private requireFirestore() {
    const firestore = this.firebase.firestore;
    if (!firestore) {
      throw new Error('Firestore is not configured for this environment.');
    }
    return firestore;
  }

  private async requireCurrentActiveAdmin(): Promise<{
    uid: string;
    isSuperAdmin: boolean;
    administeredSirapIds: SirapRegionId[];
  }> {
    const firestore = this.requireFirestore();
    const uid = this.firebase.auth?.currentUser?.uid;
    if (!uid) {
      throw new Error('Sign in with the bootstrap admin account before reviewing access requests.');
    }

    const adminSnapshot = await getDoc(doc(firestore, 'users', uid));
    const adminData = adminSnapshot.exists() ? adminSnapshot.data() : null;
    const administeredSirapIds = readSirapAccessRegionIds(adminData?.['administeredSirapIds']);
    const role = readAppRole(
      adminData?.['role'],
      readSirapAccessRegionIds(adminData?.['allowedSirapIds']),
      administeredSirapIds,
      adminData?.['isAdmin'] === true || adminData?.['isSuperAdmin'] === true,
    );
    const isSuperAdmin = role === 'super-admin';
    if (adminData?.['status'] !== 'active' || (!isSuperAdmin && administeredSirapIds.length === 0)) {
      throw new Error('Only active admins can review access requests.');
    }

    return { uid, isSuperAdmin, administeredSirapIds };
  }

  private userDisplayLabel(user: AdminManagedUserRecord): string {
    return user.displayName || user.email || user.uid;
  }
}

function readDocumentString(data: DocumentData, key: string): string {
  return typeof data[key] === 'string' ? data[key] : '';
}

function readDocumentDate(data: DocumentData, key: string): Date | null {
  const value = data[key] as unknown;
  if (typeof value === 'number') {
    return new Date(value);
  }
  return value && typeof value === 'object' && 'toDate' in value
    ? (value as { toDate: () => Date }).toDate()
    : null;
}

