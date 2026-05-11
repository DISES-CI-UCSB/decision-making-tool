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

  get currentUser(): FakeFirebaseUser | null {
    return this.auth.currentUser;
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
    expect(authService.getCurrentTier()).toBe(UserTier.Public);
    expect(appState.userTier$()).toBe(UserTier.Public);
  });

  it('derives manager tier from an active admin Firestore user', async () => {
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
    expect(localStorage.getItem('dmt.auth.session')).toBeNull();
  });

  it('derives decision-maker tier from an active viewer Firestore user', async () => {
    firebase.auth.currentUser = { uid: 'viewer-uid' };
    firebase.userDocs.set('viewer-uid', {
      status: 'active',
      role: 'authorized_viewer',
    });
    const authService = TestBed.inject(AuthService);

    await expect(authService.refreshCurrentUserTier()).resolves.toBe(UserTier.DecisionMaker);
    expect(authService.isAuthenticated()).toBe(true);
  });

  it('keeps unapproved Firebase users public', async () => {
    firebase.auth.currentUser = { uid: 'pending-uid' };
    firebase.userDocs.set('pending-uid', {
      status: 'pending',
      role: 'authorized_viewer',
    });
    const authService = TestBed.inject(AuthService);

    await expect(authService.refreshCurrentUserTier()).resolves.toBe(UserTier.Public);
    expect(authService.isAuthenticated()).toBe(false);
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
    expect(authService.isAuthenticated()).toBe(false);
    expect(authService.getCurrentTier()).toBe(UserTier.Public);
    expect(appState.userTier$()).toBe(UserTier.Public);
  });
});
