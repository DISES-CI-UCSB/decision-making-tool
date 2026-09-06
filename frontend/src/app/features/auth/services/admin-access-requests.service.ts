import { Injectable, inject } from '@angular/core';
import { readSirapAccessRegionIds, type SirapRegionId, UserTier } from '@core/models';
import { FirebaseClientService } from '@core/services/firebase-client.service';
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';

export type AccessRequestStatus = 'pending' | 'approved' | 'denied';

export interface AccessRequestRecord {
  uid: string;
  email: string;
  displayName: string;
  organization: string | null;
  reason: string | null;
  provider: string;
  status: AccessRequestStatus;
  requestedAt: Date | null;
  submittedAt: number | null;
}

export interface UserAccessGrant {
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
  role: string;
  updatedAt: Date | null;
}

export interface PendingSirapGrantRequest {
  id: string;
  sirapId: SirapRegionId;
  status: 'pending' | 'approved' | 'denied';
}

export function parseAdminManagedUserRecord(
  uid: string,
  data: DocumentData,
): AdminManagedUserRecord {
  const tier = readManagedUserTier(data);
  return {
    uid,
    email: readDocumentString(data, 'email'),
    displayName: readDocumentString(data, 'displayName') || readDocumentString(data, 'email'),
    status: 'active',
    role: readDocumentString(data, 'role') || roleForManagedUserTier(tier),
    tier,
    isAdmin: data['role'] === 'admin' || data['isAdmin'] === true || data['isSuperAdmin'] === true,
    administeredSirapIds: readSirapAccessRegionIds(data['administeredSirapIds']),
    allowedSirapIds: readSirapAccessRegionIds(data['allowedSirapIds']),
    updatedAt: readDocumentDate(data, 'updatedAt'),
  };
}

export function hasSirapGrantOverlap(
  allowedSirapIds: readonly SirapRegionId[],
  administeredSirapIds: readonly SirapRegionId[],
): boolean {
  return allowedSirapIds.some((sirapId) => administeredSirapIds.includes(sirapId));
}

@Injectable({ providedIn: 'root' })
export class AdminAccessRequestsService {
  private readonly firebase = inject(FirebaseClientService);

  async listPendingRequests(): Promise<AccessRequestRecord[]> {
    const firestore = this.requireFirestore();
    const administrator = await this.requireCurrentActiveAdmin();
    if (!administrator.isSuperAdmin) {
      return [];
    }

    const snapshot = await getDocs(
      query(collection(firestore, 'accessRequests'), where('status', '==', 'pending')),
    );

    return snapshot.docs
      .map((requestDoc) => this.parseAccessRequest(requestDoc.id, requestDoc.data()))
      .sort((a, b) => this.requestTimeMs(b) - this.requestTimeMs(a));
  }

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
      await getDocs(query(collection(firestore, 'userDirectory'), where('status', '==', 'active')))
    ).docs
      .map((directoryDoc) => this.parseDirectoryUser(directoryDoc.id, directoryDoc.data()))
      .filter((user) => user !== null)
      .sort((a, b) => this.userDisplayLabel(a).localeCompare(this.userDisplayLabel(b)));
  }

  async updateRegionalUserAccess(
    uid: string,
    previousAllowedSirapIds: readonly SirapRegionId[],
    nextAllowedSirapIds: readonly SirapRegionId[],
  ): Promise<void> {
    const firestore = this.requireFirestore();
    const administrator = await this.requireCurrentActiveAdmin();
    if (administrator.isSuperAdmin) {
      throw new Error('Use the super-admin access update path for global permissions.');
    }

    const previous = new Set(previousAllowedSirapIds);
    const next = new Set(nextAllowedSirapIds);
    const batch = writeBatch(firestore);
    for (const sirapId of administrator.administeredSirapIds) {
      if (previous.has(sirapId) === next.has(sirapId)) {
        continue;
      }
      batch.update(doc(firestore, 'users', uid), {
        allowedSirapIds: next.has(sirapId) ? arrayUnion(sirapId) : arrayRemove(sirapId),
        updatedAt: serverTimestamp(),
        updatedBy: administrator.uid,
      });
    }
    await batch.commit();
  }

  private parseDirectoryUser(uid: string, data: DocumentData): AdminManagedUserRecord | null {
    if (data['status'] !== 'active') {
      return null;
    }
    return {
      uid,
      email: readDocumentString(data, 'email'),
      displayName: readDocumentString(data, 'displayName') || readDocumentString(data, 'email'),
      status: 'active',
      role: 'authorized_viewer',
      tier: UserTier.DecisionMaker,
      isAdmin: false,
      administeredSirapIds: [],
      allowedSirapIds: [],
      updatedAt: readDocumentDate(data, 'updatedAt'),
    };
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

  async approveRequest(
    request: AccessRequestRecord,
    grant: UserAccessGrant,
    sirapRequests: readonly PendingSirapGrantRequest[] = [],
  ): Promise<void> {
    const firestore = this.requireFirestore();
    const administrator = await this.requireCurrentActiveAdmin();
    if (!administrator.isSuperAdmin) {
      throw new Error('Only super admins can approve new accounts.');
    }
    const approvedBy = administrator.uid;
    const batch = writeBatch(firestore);

    batch.set(
      doc(firestore, 'users', request.uid),
      {
        email: request.email,
        displayName: request.displayName,
        status: 'active',
        role: this.roleForTier(grant.tier),
        tier: grant.tier,
        isAdmin: grant.isAdmin,
        isSuperAdmin: grant.isAdmin,
        administeredSirapIds: grant.administeredSirapIds,
        allowedSirapIds: grant.allowedSirapIds,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    batch.set(
      doc(firestore, 'accessRequests', request.uid),
      {
        status: 'approved',
        approvedAt: serverTimestamp(),
        approvedBy,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    for (const sirapRequest of sirapRequests) {
      if (
        sirapRequest.status === 'pending' &&
        grant.allowedSirapIds.includes(sirapRequest.sirapId)
      ) {
        batch.update(doc(firestore, 'sirapAccessRequests', sirapRequest.id), {
          status: 'approved',
          decidedAt: serverTimestamp(),
          decidedBy: approvedBy,
          updatedAt: serverTimestamp(),
        });
      }
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

    await writeBatch(firestore)
      .set(
        doc(firestore, 'users', uid),
        {
          role: this.roleForTier(grant.tier),
          tier: grant.tier,
          isAdmin: grant.isAdmin,
          isSuperAdmin: grant.isAdmin,
          administeredSirapIds: grant.administeredSirapIds,
          allowedSirapIds: grant.allowedSirapIds,
          updatedAt: serverTimestamp(),
          updatedBy,
        },
        { merge: true },
      )
      .commit();
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
    const isSuperAdmin =
      adminData?.['role'] === 'admin' ||
      adminData?.['isAdmin'] === true ||
      adminData?.['isSuperAdmin'] === true;
    const administeredSirapIds = readSirapAccessRegionIds(adminData?.['administeredSirapIds']);
    if (
      adminData?.['status'] !== 'active' ||
      (!isSuperAdmin && administeredSirapIds.length === 0)
    ) {
      throw new Error('Only active admins can review access requests.');
    }

    return { uid, isSuperAdmin, administeredSirapIds };
  }

  private parseAccessRequest(uid: string, data: DocumentData): AccessRequestRecord {
    return {
      uid,
      email: this.readString(data, 'email'),
      displayName: this.readString(data, 'displayName') || this.readString(data, 'email'),
      organization: this.readOptionalString(data, 'organization'),
      reason: this.readOptionalString(data, 'reason'),
      provider: this.readString(data, 'provider') || 'unknown',
      status: this.readStatus(data),
      requestedAt: this.readDate(data, 'requestedAt'),
      submittedAt: this.readNumber(data, 'submittedAt'),
    };
  }

  private readStatus(data: DocumentData): AccessRequestStatus {
    const status = this.readString(data, 'status');
    if (status === 'approved' || status === 'denied') {
      return status;
    }
    return 'pending';
  }

  private readString(data: DocumentData, key: string): string {
    const value = data[key];
    return typeof value === 'string' ? value : '';
  }

  private readOptionalString(data: DocumentData, key: string): string | null {
    const value = this.readString(data, key).trim();
    return value || null;
  }

  private readNumber(data: DocumentData, key: string): number | null {
    const value = data[key];
    return typeof value === 'number' ? value : null;
  }

  private readDate(data: DocumentData, key: string): Date | null {
    const value = data[key] as unknown;
    if (typeof value === 'number') {
      return new Date(value);
    }
    if (value && typeof value === 'object' && 'toDate' in value) {
      const timestamp = value as { toDate: () => Date };
      return timestamp.toDate();
    }
    return null;
  }

  private requestTimeMs(request: AccessRequestRecord): number {
    return request.requestedAt?.getTime() ?? request.submittedAt ?? 0;
  }

  private roleForTier(tier: UserAccessGrant['tier']): 'authorized_viewer' | 'science_publisher' {
    return tier >= UserTier.Manager ? 'science_publisher' : 'authorized_viewer';
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

function readManagedUserTier(data: DocumentData): UserAccessGrant['tier'] {
  if (data['tier'] === UserTier.Manager) {
    return UserTier.Manager;
  }
  if (data['tier'] === UserTier.DecisionMaker) {
    return UserTier.DecisionMaker;
  }
  return data['role'] === 'science_publisher' || data['role'] === 'admin'
    ? UserTier.Manager
    : UserTier.DecisionMaker;
}

function roleForManagedUserTier(
  tier: UserAccessGrant['tier'],
): 'authorized_viewer' | 'science_publisher' {
  return tier >= UserTier.Manager ? 'science_publisher' : 'authorized_viewer';
}
