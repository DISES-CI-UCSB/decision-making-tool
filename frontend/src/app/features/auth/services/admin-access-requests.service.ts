import { Injectable, inject } from '@angular/core';
import { FirebaseClientService } from '@core/services/firebase-client.service';
import {
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

@Injectable({ providedIn: 'root' })
export class AdminAccessRequestsService {
  private readonly firebase = inject(FirebaseClientService);

  async listPendingRequests(): Promise<AccessRequestRecord[]> {
    const firestore = this.requireFirestore();
    await this.requireCurrentActiveAdmin();

    const snapshot = await getDocs(
      query(collection(firestore, 'accessRequests'), where('status', '==', 'pending')),
    );

    return snapshot.docs
      .map((requestDoc) => this.parseAccessRequest(requestDoc.id, requestDoc.data()))
      .sort((a, b) => this.requestTimeMs(b) - this.requestTimeMs(a));
  }

  async approveRequest(request: AccessRequestRecord): Promise<void> {
    const firestore = this.requireFirestore();
    const approvedBy = await this.requireCurrentActiveAdmin();
    const batch = writeBatch(firestore);

    batch.set(
      doc(firestore, 'users', request.uid),
      {
        email: request.email,
        displayName: request.displayName,
        status: 'active',
        role: 'authorized_viewer',
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

    await batch.commit();
  }

  private requireFirestore() {
    const firestore = this.firebase.firestore;
    if (!firestore) {
      throw new Error('Firestore is not configured for this environment.');
    }
    return firestore;
  }

  private async requireCurrentActiveAdmin(): Promise<string> {
    const firestore = this.requireFirestore();
    const uid = this.firebase.auth?.currentUser?.uid;
    if (!uid) {
      throw new Error('Sign in with the bootstrap admin account before reviewing access requests.');
    }

    const adminSnapshot = await getDoc(doc(firestore, 'users', uid));
    const adminData = adminSnapshot.exists() ? adminSnapshot.data() : null;
    if (adminData?.['status'] !== 'active' || adminData?.['role'] !== 'admin') {
      throw new Error('Only active admins can review access requests.');
    }

    return uid;
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
}
