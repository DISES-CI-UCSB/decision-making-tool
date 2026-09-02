import { TestBed } from '@angular/core/testing';
import { UserTier } from '@core/models';
import { FirebaseClientService } from './firebase-client.service';
import { AppStateService } from './app-state.service';
import { AuthService } from './auth.service';

interface FakeFirebaseUser {
  uid: string;
}

interface FakeFirebaseAuth {
  currentUser: FakeFirebaseUser | null;
}

class FirebaseClientServiceStub {
  readonly isEnabled = true;
  readonly auth: FakeFirebaseAuth = { currentUser: null };
  readonly userDocs = new Map<string, Record<string, unknown>>();
  readonly userDocCallbacks = new Map<string, (data: Record<string, unknown> | null) => void>();
  readonly authStateCallbacks: ((user: FakeFirebaseUser | null) => void)[] = [];
  readonly subscribeToAuthState = vi.fn((callback: (user: FakeFirebaseUser | null) => void) => {
    this.authStateCallbacks.push(callback);
    callback(this.currentUser);
    return vi.fn();
  });
  readonly signOut = vi.fn(async () => {
    this.auth.currentUser = null;
    for (const callback of this.authStateCallbacks) {
      callback(null);
    }
  });
  readonly getUserDocument = vi.fn(async (uid: string) => this.userDocs.get(uid) ?? null);
  readonly subscribeToUserDocument = vi.fn(
    (uid: string, callback: (data: Record<string, unknown> | null) => void) => {
      this.userDocCallbacks.set(uid, callback);
      callback(this.userDocs.get(uid) ?? null);
      return vi.fn();
    },
  );

  get currentUser(): FakeFirebaseUser | null {
    return this.auth.currentUser;
  }

  emitUserDocument(uid: string, data: Record<string, unknown>): void {
    this.userDocs.set(uid, data);
    this.userDocCallbacks.get(uid)?.(data);
  }
}

describe('AuthService', () => {
  let firebase: FirebaseClientServiceStub;

  beforeEach(() => {
    localStorage.removeItem('dmt.auth.session');
    firebase = new FirebaseClientServiceStub();
    TestBed.configureTestingModule({
      providers: [{ provide: FirebaseClientService, useValue: firebase }],
    });
  });

  it('defaults to public tier when unauthenticated', () => {
    const authService = TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);

    expect(authService.isAuthenticated()).toBe(false);
    expect(authService.hasFirebaseIdentity()).toBe(false);
    expect(authService.getCurrentTier()).toBe(UserTier.Public);
    expect(appState.userTier$()).toBe(UserTier.Public);
    expect(appState.userIsAdmin$()).toBe(false);
  });

  it('derives admin flag and manager tier from a legacy active admin role', async () => {
    firebase.auth.currentUser = { uid: 'admin-uid' };
    firebase.userDocs.set('admin-uid', {
      status: 'active',
      role: 'admin',
    });
    const authService = TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);

    const tier = await authService.refreshCurrentUserTier();

    expect(tier).toBe(UserTier.Manager);
    expect(authService.isAuthenticated()).toBe(true);
    expect(authService.getCurrentTier()).toBe(UserTier.Manager);
    expect(appState.userTier$()).toBe(UserTier.Manager);
    expect(appState.userIsAdmin$()).toBe(true);
    expect(localStorage.getItem('dmt.auth.session')).toBeNull();
  });

  it('derives tier from an active Firestore tier field', async () => {
    firebase.auth.currentUser = { uid: 'scientist-uid' };
    firebase.userDocs.set('scientist-uid', {
      status: 'active',
      role: 'science_publisher',
      tier: UserTier.Manager,
    });
    const authService = TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);

    await expect(authService.refreshCurrentUserTier()).resolves.toBe(UserTier.Manager);
    expect(authService.isAuthenticated()).toBe(true);
    expect(appState.userIsAdmin$()).toBe(false);
  });

  it('loads independent SIRAP data and administrator permissions', async () => {
    firebase.auth.currentUser = { uid: 'regional-admin-uid' };
    firebase.userDocs.set('regional-admin-uid', {
      status: 'active',
      role: 'authorized_viewer',
      tier: UserTier.DecisionMaker,
      allowedSirapIds: ['caribe'],
      administeredSirapIds: ['caribe', 'pacifico'],
    });
    const authService = TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);

    await authService.refreshCurrentUserTier();

    expect(appState.userIsAdmin$()).toBe(true);
    expect(appState.userIsSuperAdmin$()).toBe(false);
    expect(appState.allowedSirapIds$()).toEqual(['caribe']);
    expect(appState.administeredSirapIds$()).toEqual(['caribe', 'pacifico']);
    expect(appState.accessibleSirapIds()).toEqual(['caribe']);
  });

  it('gives legacy super admins access to every available SIRAP', async () => {
    firebase.auth.currentUser = { uid: 'legacy-admin-uid' };
    firebase.userDocs.set('legacy-admin-uid', {
      status: 'active',
      role: 'admin',
    });
    const authService = TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);

    await authService.refreshCurrentUserTier();

    expect(appState.userIsSuperAdmin$()).toBe(true);
    expect(appState.accessibleSirapIds()).toEqual(['eje-cafetero', 'orinoquia']);
  });

  it('reacts to SIRAP grants without requiring another login', () => {
    firebase.auth.currentUser = { uid: 'viewer-uid' };
    firebase.userDocs.set('viewer-uid', {
      status: 'active',
      role: 'authorized_viewer',
      tier: UserTier.DecisionMaker,
      allowedSirapIds: [],
    });
    TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);

    firebase.emitUserDocument('viewer-uid', {
      status: 'active',
      role: 'authorized_viewer',
      tier: UserTier.DecisionMaker,
      allowedSirapIds: ['amazonia'],
    });

    expect(appState.allowedSirapIds$()).toEqual(['amazonia']);
    expect(appState.canAccessSirapScope()).toBe(true);
  });

  it('falls back to role-derived tier for active users without a tier field', async () => {
    firebase.auth.currentUser = { uid: 'viewer-uid' };
    firebase.userDocs.set('viewer-uid', {
      status: 'active',
      role: 'authorized_viewer',
    });
    const authService = TestBed.inject(AuthService);

    await expect(authService.refreshCurrentUserTier()).resolves.toBe(UserTier.DecisionMaker);
    expect(authService.isAuthenticated()).toBe(true);
  });

  it('restores pending Firebase identity without granting approved access', async () => {
    firebase.auth.currentUser = { uid: 'pending-uid' };
    firebase.userDocs.set('pending-uid', {
      status: 'pending',
      role: 'authorized_viewer',
    });
    const authService = TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);

    await expect(authService.refreshCurrentUserTier()).resolves.toBe(UserTier.Public);
    expect(authService.hasFirebaseIdentity()).toBe(true);
    expect(authService.isAuthenticated()).toBe(false);
    expect(appState.userIsSignedIn$()).toBe(true);
    expect(appState.canAccessTier2()).toBe(false);
    expect(appState.canAccessSirapScope()).toBe(false);
  });

  it('signs out of Firebase and clears app-state tier on logout', async () => {
    firebase.auth.currentUser = { uid: 'admin-uid' };
    firebase.userDocs.set('admin-uid', {
      status: 'active',
      role: 'admin',
    });
    const authService = TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);

    await authService.refreshCurrentUserTier();
    await authService.logout();

    expect(firebase.signOut).toHaveBeenCalled();
    expect(firebase.auth.currentUser).toBeNull();
    expect(authService.hasFirebaseIdentity()).toBe(false);
    expect(authService.isAuthenticated()).toBe(false);
    expect(authService.getCurrentTier()).toBe(UserTier.Public);
    expect(appState.userTier$()).toBe(UserTier.Public);
    expect(appState.userIsSignedIn$()).toBe(false);
    expect(appState.userIsAdmin$()).toBe(false);
    expect(appState.allowedSirapIds$()).toEqual([]);
    expect(appState.administeredSirapIds$()).toEqual([]);
  });
});
