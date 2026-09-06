import { Injectable, inject, signal } from '@angular/core';
import { FirebaseClientService } from '@core/services/firebase-client.service';
import { readSirapAccessRegionIds, type SirapRegionId, UserTier } from '@core/models';
import { SirapAccessService } from './sirap-access.service';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  type DocumentData,
} from 'firebase/firestore';
import { environment } from '../../../../environments/environment';

/**
 * Mocked backend for the MVP Login / Request Access flow.
 *
 * ALL methods here simulate network calls with `setTimeout(300)` and
 * persist state in `localStorage` so the v5 modal can demo the full
 * pending → approved lifecycle without any server.
 *
 * TODO: wire to backend — see the per-method comments. Each method
 * documents the HTTP call it should become once the auth service exists.
 */

const STORAGE_KEYS = {
  pendingRequest: 'dmt.auth.pendingRequest',
  approvedAccount: 'dmt.auth.approvedAccount',
  lastNudgeAt: 'dmt.auth.lastNudgeAt',
} as const;

const MOCK_LATENCY_MS = 300;
const NUDGE_COOLDOWN_MS = 48 * 60 * 60 * 1000;

export type AuthProviderKind = 'local' | 'google';

export type LoginAttemptResult = 'active' | 'pending' | 'invalid';

export type ApprovedUserRole = 'authorized_viewer' | 'science_publisher' | 'admin';

export interface ApprovedUserRecord {
  uid: string;
  email: string;
  displayName: string;
  role: ApprovedUserRole;
  status: 'active' | 'denied';
}

export interface EmailRequestPayload {
  fullName: string;
  email: string;
  password: string;
  organization?: string;
  reason?: string;
  requestedSirapIds: SirapRegionId[];
}

export interface GoogleRequestPayload {
  uid?: string;
  googleName: string;
  googleEmail: string;
  googleAvatarInitials: string;
  organization?: string;
  reason?: string;
  requestedSirapIds: SirapRegionId[];
}

export interface StoredPendingRequest {
  requestId: string;
  email: string;
  fullName: string;
  provider: AuthProviderKind;
  submittedAt: number;
  organization?: string;
  reason?: string;
  requestedSirapIds: SirapRegionId[];
}

export interface LoginAttemptPayload {
  uid?: string;
  email: string;
  displayName?: string;
  password?: string;
  provider: AuthProviderKind;
}

@Injectable({ providedIn: 'root' })
export class AuthRequestService {
  private readonly firebase = inject(FirebaseClientService);
  private readonly sirapAccess = inject(SirapAccessService);

  /** Reactive mirror of the persisted pending-request state. */
  readonly pendingRequest$ = signal<StoredPendingRequest | null>(this.readPendingRequest());

  constructor() {
    this.exposeDevHelpers();
  }

  // ------------------------------------------------------------------
  // Request Access — email path
  // ------------------------------------------------------------------

  /**
   * TODO: wire to backend.
   *   POST /api/auth/request-access
   *   body: { provider: 'local', fullName, email, passwordHash, organization?, reason? }
   *   response: { requestId, submittedAt }
   *   side effects: creates account with status='pending'; emails admin DL.
   */
  async submitEmailRequest(payload: EmailRequestPayload): Promise<StoredPendingRequest> {
    await this.wait();
    const pending: StoredPendingRequest = {
      requestId: this.generateRequestId(),
      email: payload.email,
      fullName: payload.fullName,
      provider: 'local',
      submittedAt: Date.now(),
      organization: payload.organization,
      reason: payload.reason,
      requestedSirapIds: payload.requestedSirapIds,
    };
    this.writePendingRequest(pending);
    return pending;
  }

  // ------------------------------------------------------------------
  // Request Access — Google path
  // ------------------------------------------------------------------

  /**
   * TODO: wire to backend.
   *   POST /api/auth/request-access
   *   body: { provider: 'google', googleIdToken, organization?, reason? }
   *   response: { requestId, submittedAt }
   *   side effects: backend verifies id_token with Google, creates pending account,
   *                 emails admin DL with approve/deny links.
   */
  async submitGoogleRequest(payload: GoogleRequestPayload): Promise<StoredPendingRequest> {
    if (payload.uid && this.firebase.isEnabled) {
      return this.submitFirebaseGoogleRequest({ ...payload, uid: payload.uid });
    }

    await this.wait();
    const pending: StoredPendingRequest = {
      requestId: this.generateRequestId(),
      email: payload.googleEmail,
      fullName: payload.googleName,
      provider: 'google',
      submittedAt: Date.now(),
      organization: payload.organization,
      reason: payload.reason,
      requestedSirapIds: payload.requestedSirapIds,
    };
    this.writePendingRequest(pending);
    return pending;
  }

  // ------------------------------------------------------------------
  // Login
  // ------------------------------------------------------------------

  /**
   * TODO: wire to backend.
   *   POST /api/auth/login
   *   body: { provider, email, password? | googleIdToken }
   *   response 200: { token, tier }                         -> 'active'
   *   response 202: { requestId, submittedAt }              -> 'pending'
   *   response 401: { error: 'invalid_credentials' }        -> 'invalid'
   *
   * Per team decision (mock): in the absence of an approved account flag,
   * any login attempt resolves as 'pending' so v5-E can be demoed. Flip
   * the flag via `window.__dmtApproveAccount()` to demo the 'active' branch.
   */
  async attemptLogin(payload: LoginAttemptPayload): Promise<LoginAttemptResult> {
    if (payload.provider === 'google' && payload.uid && this.firebase.isEnabled) {
      await this.ensureFirebaseBaseAccount(
        payload.uid,
        payload.email,
        payload.displayName ?? payload.email,
      );
      return 'active';
    }

    await this.wait();
    if (!payload.email.trim()) {
      return 'invalid';
    }
    if (this.readApprovedFlag()) {
      return 'active';
    }
    const pending = this.readPendingRequest();
    if (pending) {
      return 'pending';
    }
    return 'pending';
  }

  // ------------------------------------------------------------------
  // Admin nudge (48h rate-limited)
  // ------------------------------------------------------------------

  /**
   * TODO: wire to backend.
   *   POST /api/auth/nudge
   *   body: { requestId }
   *   response 202: { lastNudgeAt }  (admin DL receives reminder email)
   *   response 429: { nextEligibleAt } if within cooldown
   */
  async sendAdminNudge(): Promise<{ lastNudgeAt: number }> {
    await this.wait();
    const now = Date.now();
    localStorage.setItem(STORAGE_KEYS.lastNudgeAt, String(now));
    return { lastNudgeAt: now };
  }

  /** Returns remaining cooldown in ms, or 0 if the user can nudge now. */
  getNudgeCooldownRemainingMs(): number {
    const raw = localStorage.getItem(STORAGE_KEYS.lastNudgeAt);
    if (!raw) {
      return 0;
    }
    const lastNudge = Number(raw);
    if (!Number.isFinite(lastNudge)) {
      return 0;
    }
    const remaining = lastNudge + NUDGE_COOLDOWN_MS - Date.now();
    return Math.max(0, remaining);
  }

  canNudgeAdmins(): boolean {
    return this.getNudgeCooldownRemainingMs() === 0;
  }

  async getApprovedUser(uid: string): Promise<ApprovedUserRecord | null> {
    const firestore = this.firebase.firestore;
    if (!firestore) {
      return null;
    }

    const snapshot = await getDoc(doc(firestore, 'users', uid));
    if (!snapshot.exists()) {
      return null;
    }

    return this.parseApprovedUser(uid, snapshot.data());
  }

  roleToTier(role: ApprovedUserRole | undefined): UserTier {
    if (role === 'admin' || role === 'science_publisher') {
      return UserTier.Manager;
    }
    return UserTier.DecisionMaker;
  }

  // ------------------------------------------------------------------
  // Pending-request read helpers
  // ------------------------------------------------------------------

  hasPendingRequest(): boolean {
    return this.readPendingRequest() !== null;
  }

  getPendingRequest(): StoredPendingRequest | null {
    return this.readPendingRequest();
  }

  /** Dev-only: clear the stored pending request (simulates admin denial). */
  clearPendingRequest(): void {
    localStorage.removeItem(STORAGE_KEYS.pendingRequest);
    this.pendingRequest$.set(null);
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private wait(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));
  }

  private async submitFirebaseGoogleRequest(
    payload: GoogleRequestPayload & { uid: string },
  ): Promise<StoredPendingRequest> {
    const firestore = this.firebase.firestore;
    if (!firestore) {
      throw new Error('Firestore is not configured.');
    }

    const submittedAt = Date.now();
    const pending: StoredPendingRequest = {
      requestId: payload.uid,
      email: payload.googleEmail,
      fullName: payload.googleName,
      provider: 'google',
      submittedAt,
      organization: payload.organization,
      reason: payload.reason,
      requestedSirapIds: payload.requestedSirapIds,
    };

    await this.ensureFirebaseBaseAccount(payload.uid, payload.googleEmail, payload.googleName);
    await this.sirapAccess.submitRequestsForIdentity(
      payload.uid,
      payload.googleEmail,
      payload.googleName,
      payload.requestedSirapIds,
      payload.reason,
    );
    await this.createAdminNotification(pending);
    this.writePendingRequest(pending);
    return pending;
  }

  private async ensureFirebaseBaseAccount(
    uid: string,
    email: string,
    displayName: string,
  ): Promise<void> {
    const firestore = this.firebase.firestore;
    if (!firestore) {
      throw new Error('Firestore is not configured.');
    }
    const userRef = doc(firestore, 'users', uid);
    if (!(await getDoc(userRef)).exists()) {
      await setDoc(userRef, {
        uid,
        email,
        displayName,
        status: 'active',
        role: 'authorized_viewer',
        tier: UserTier.DecisionMaker,
        isAdmin: false,
        isSuperAdmin: false,
        allowedSirapIds: [],
        administeredSirapIds: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    const directoryRef = doc(firestore, 'userDirectory', uid);
    if (!(await getDoc(directoryRef)).exists()) {
      await setDoc(directoryRef, {
        uid,
        email,
        displayName,
        status: 'active',
        updatedAt: serverTimestamp(),
      });
    }
  }

  private async getFirebasePendingRequest(uid: string): Promise<StoredPendingRequest | null> {
    const firestore = this.firebase.firestore;
    if (!firestore) {
      return null;
    }
    const snapshot = await getDoc(doc(firestore, 'accessRequests', uid));
    if (!snapshot.exists()) {
      return null;
    }
    const data = snapshot.data();
    const pending: StoredPendingRequest = {
      requestId: uid,
      email: this.readString(data, 'email'),
      fullName: this.readString(data, 'displayName') || this.readString(data, 'email'),
      provider: 'google',
      submittedAt: this.readNumber(data, 'submittedAt') ?? Date.now(),
      organization: this.readOptionalString(data, 'organization'),
      reason: this.readOptionalString(data, 'reason'),
      requestedSirapIds: [],
    };
    this.writePendingRequest(pending);
    return pending;
  }

  private async createAdminNotification(request: StoredPendingRequest): Promise<void> {
    const firestore = this.firebase.firestore;
    const recipient = environment.firebase.accessRequestNotificationEmail.trim();
    if (!firestore || !recipient) {
      return;
    }

    try {
      await addDoc(collection(firestore, 'mail'), {
        to: [recipient],
        message: {
          subject: `Decision Making Tool SIRAP access request: ${request.fullName}`,
          text: [
            `${request.fullName} (${request.email}) requested SIRAP access in the Decision Making Tool.`,
            request.organization ? `Organization: ${request.organization}` : null,
            request.reason ? `Reason: ${request.reason}` : null,
            `Review the request in the Admin console.`,
          ]
            .filter(Boolean)
            .join('\n'),
        },
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      console.warn(
        'Access request was saved, but the admin notification could not be created.',
        error,
      );
    }
  }

  private parseApprovedUser(uid: string, data: DocumentData): ApprovedUserRecord | null {
    const status = this.readString(data, 'status');
    const role = this.readString(data, 'role');
    if (status !== 'active' && status !== 'denied') {
      return null;
    }
    if (role !== 'authorized_viewer' && role !== 'science_publisher' && role !== 'admin') {
      return null;
    }
    return {
      uid,
      email: this.readString(data, 'email'),
      displayName: this.readString(data, 'displayName'),
      status,
      role,
    };
  }

  private readString(data: DocumentData, key: string): string {
    const value = data[key];
    return typeof value === 'string' ? value : '';
  }

  private readOptionalString(data: DocumentData, key: string): string | undefined {
    const value = this.readString(data, key);
    return value || undefined;
  }

  private readNumber(data: DocumentData, key: string): number | undefined {
    const value = data[key];
    return typeof value === 'number' ? value : undefined;
  }

  private readPendingRequest(): StoredPendingRequest | null {
    const raw = localStorage.getItem(STORAGE_KEYS.pendingRequest);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as StoredPendingRequest;
      return {
        ...parsed,
        requestedSirapIds: readSirapAccessRegionIds(parsed.requestedSirapIds),
      };
    } catch {
      return null;
    }
  }

  private writePendingRequest(next: StoredPendingRequest): void {
    localStorage.setItem(STORAGE_KEYS.pendingRequest, JSON.stringify(next));
    this.pendingRequest$.set(next);
  }

  private readApprovedFlag(): boolean {
    return localStorage.getItem(STORAGE_KEYS.approvedAccount) === 'true';
  }

  private generateRequestId(): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const suffix = Math.random().toString(16).slice(2, 6).toUpperCase();
    return `REQ-${yyyy}-${mm}${dd}-${suffix}`;
  }

  /**
   * Dev-only console helpers so the full pending → approved lifecycle is
   * demoable without a backend. Safe to keep in prod (they only touch
   * localStorage and never expose server secrets).
   */
  private exposeDevHelpers(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const globalWindow = window as unknown as Record<string, unknown>;
    globalWindow['__dmtApproveAccount'] = () => {
      localStorage.setItem(STORAGE_KEYS.approvedAccount, 'true');
      console.info(
        '[dmt-auth-mock] approvedAccount flag set; next login attempt grants a session.',
      );
    };
    globalWindow['__dmtResetAuthMock'] = () => {
      localStorage.removeItem(STORAGE_KEYS.pendingRequest);
      localStorage.removeItem(STORAGE_KEYS.approvedAccount);
      localStorage.removeItem(STORAGE_KEYS.lastNudgeAt);
      this.pendingRequest$.set(null);
      console.info('[dmt-auth-mock] all auth mock flags cleared.');
    };
  }
}
