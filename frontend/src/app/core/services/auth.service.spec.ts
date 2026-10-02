import { TestBed } from '@angular/core/testing';
import { UserTier } from '@core/models';
import { IDENTITY_CONTEXT_PROBE_LOG_PREFIX } from '@features/auth/services/identity-context-probe';
import { TotpMfaService } from '@features/auth/services/totp-mfa.service';
import { SavedSolutionScenariosService } from './saved-solution-scenarios.service';
import { FirebaseClientService } from './firebase-client.service';
import { AppStateService } from './app-state.service';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

interface FakeFirebaseUser {
  uid: string;
  getIdTokenResult?: (forceRefresh?: boolean) => Promise<{ signInSecondFactor: string | null }>;
}

function fakeUser(uid: string, signInSecondFactor: string | null = 'totp'): FakeFirebaseUser {
  return {
    uid,
    getIdTokenResult: vi.fn(async () => ({ signInSecondFactor })),
  };
}

function withTotpClaim(user: FakeFirebaseUser): FakeFirebaseUser {
  if (!user.getIdTokenResult) {
    user.getIdTokenResult = vi.fn(async () => ({ signInSecondFactor: 'totp' }));
  }
  return user;
}

interface FakeFirebaseAuth {
  currentUser: FakeFirebaseUser | null;
  tenantId?: string | null;
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
    return this.auth.currentUser ? withTotpClaim(this.auth.currentUser) : null;
  }

  emitUserDocument(uid: string, data: Record<string, unknown>): void {
    this.userDocs.set(uid, data);
    this.userDocCallbacks.get(uid)?.(data);
  }
}

class TotpMfaServiceStub {
  enrolled = true;
  enrollmentHeld = false;
  readonly hasEnrolledTotp = vi.fn(() => this.enrolled);
  readonly userHasEnrolledTotp = vi.fn(async () => this.enrolled);
  readonly forgetOpenEnrollment = vi.fn();
  readonly isEnrollmentHeld = vi.fn((uid: string) => this.enrollmentHeld && Boolean(uid));
}

describe('AuthService', () => {
  let firebase: FirebaseClientServiceStub;
  let totpMfa: TotpMfaServiceStub;
  let scenarios: { startSyncForUser: ReturnType<typeof vi.fn>; stopSync: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    localStorage.removeItem('dmt.auth.session');
    firebase = new FirebaseClientServiceStub();
    totpMfa = new TotpMfaServiceStub();
    totpMfa.enrollmentHeld = false;
    scenarios = {
      startSyncForUser: vi.fn(),
      stopSync: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: FirebaseClientService, useValue: firebase },
        { provide: TotpMfaService, useValue: totpMfa },
        { provide: SavedSolutionScenariosService, useValue: scenarios },
      ],
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

  it('derives DecisionMaker access from a legacy publisher role', async () => {
    firebase.auth.currentUser = { uid: 'scientist-uid' };
    firebase.userDocs.set('scientist-uid', {
      status: 'active',
      role: 'science_publisher',
      tier: UserTier.Manager,
    });
    const authService = TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);

    await expect(authService.refreshCurrentUserTier()).resolves.toBe(UserTier.DecisionMaker);
    expect(authService.isAuthenticated()).toBe(true);
    expect(appState.userIsAdmin$()).toBe(false);
  });

  it('loads independent SIRAP data and administrator permissions', async () => {
    firebase.auth.currentUser = { uid: 'regional-admin-uid' };
    firebase.userDocs.set('regional-admin-uid', {
      status: 'active',
      role: 'authorized_viewer',
      tier: UserTier.DecisionMaker,
      allowedSirapIds: ['orinoquia'],
      administeredSirapIds: ['orinoquia', 'eje-cafetero'],
    });
    const authService = TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);

    await authService.refreshCurrentUserTier();

    expect(appState.userIsAdmin$()).toBe(true);
    expect(appState.userIsSuperAdmin$()).toBe(false);
    expect(appState.allowedSirapIds$()).toEqual(['orinoquia']);
    expect(appState.administeredSirapIds$()).toEqual(['orinoquia', 'eje-cafetero']);
    expect(appState.accessibleSirapIds()).toEqual(['orinoquia']);
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
    expect(appState.accessibleSirapIds()).toHaveLength(2);
    expect(appState.accessibleSirapIds()).toEqual(['orinoquia', 'eje-cafetero']);
  });

  it('reacts to SIRAP grants without requiring another login', async () => {
    firebase.auth.currentUser = fakeUser('viewer-uid');
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
      allowedSirapIds: ['eje-cafetero'],
    });
    for (let step = 0; step < 16; step += 1) {
      await Promise.resolve();
    }

    expect(appState.allowedSirapIds$()).toEqual(['eje-cafetero']);
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
    expect(authService.mfaEnrollmentRequired$()).toBe(false);
    expect(appState.userIsSignedIn$()).toBe(true);
    expect(appState.canAccessTier2()).toBe(false);
    expect(appState.canAccessSirapScope()).toBe(false);
  });

  it('does not mark missing users as needing TOTP enrollment', async () => {
    totpMfa.enrolled = false;
    firebase.auth.currentUser = { uid: 'unknown-uid' };
    const authService = TestBed.inject(AuthService);

    await expect(authService.refreshCurrentUserTier()).resolves.toBe(UserTier.Public);
    expect(authService.mfaEnrollmentRequired$()).toBe(false);
    expect(authService.hasFirebaseIdentity()).toBe(true);
    expect(scenarios.startSyncForUser).toHaveBeenCalledWith('unknown-uid');
  });

  it('withholds approved access until an active user enrolls TOTP', async () => {
    totpMfa.enrolled = false;
    firebase.auth.currentUser = { uid: 'active-uid' };
    firebase.userDocs.set('active-uid', {
      status: 'active',
      role: 'admin',
      allowedSirapIds: ['orinoquia'],
    });
    const authService = TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);

    await expect(authService.refreshCurrentUserTier()).resolves.toBe(UserTier.Public);
    expect(authService.mfaEnrollmentRequired$()).toBe(true);
    expect(authService.isAuthenticated()).toBe(false);
    expect(authService.hasFirebaseIdentity()).toBe(true);
    expect(appState.userIsAdmin$()).toBe(false);
    expect(appState.allowedSirapIds$()).toEqual([]);
    expect(appState.administeredSirapIds$()).toEqual([]);
    expect(scenarios.startSyncForUser).not.toHaveBeenCalled();
    expect(scenarios.stopSync).toHaveBeenCalled();

    totpMfa.enrolled = true;
    await expect(authService.refreshCurrentUserTier()).resolves.toBe(UserTier.Manager);
    expect(authService.mfaEnrollmentRequired$()).toBe(false);
    expect(authService.isAuthenticated()).toBe(true);
    expect(appState.userIsAdmin$()).toBe(true);
    expect(appState.allowedSirapIds$()).toEqual(['orinoquia']);
    expect(scenarios.startSyncForUser).toHaveBeenCalledWith('active-uid');
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
    expect(authService.mfaEnrollmentRequired$()).toBe(false);
  });

  it('forgets the open TOTP enrollment before Firebase sign-out', async () => {
    firebase.auth.currentUser = { uid: 'enrolling-uid' };
    const authService = TestBed.inject(AuthService);

    await authService.logout();

    expect(totpMfa.forgetOpenEnrollment).toHaveBeenCalledWith('enrolling-uid');
    expect(totpMfa.forgetOpenEnrollment.mock.invocationCallOrder[0]).toBeLessThan(
      firebase.signOut.mock.invocationCallOrder[0],
    );
  });

  it('forgets any open TOTP enrollment globally when logout has no current user', async () => {
    firebase.auth.currentUser = null;
    const authService = TestBed.inject(AuthService);

    await authService.logout();

    expect(totpMfa.forgetOpenEnrollment).toHaveBeenCalledWith(undefined);
    expect(firebase.signOut).toHaveBeenCalled();
  });

  it('withholds access when a stale local TOTP factor is gone after refresh', async () => {
    totpMfa.hasEnrolledTotp.mockReturnValue(true);
    totpMfa.userHasEnrolledTotp.mockResolvedValue(false);
    firebase.auth.currentUser = { uid: 'stale-factor-uid' };
    firebase.userDocs.set('stale-factor-uid', {
      status: 'active',
      role: 'admin',
      tier: UserTier.Manager,
      allowedSirapIds: ['orinoquia'],
      administeredSirapIds: ['orinoquia'],
    });
    const authService = TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);

    await expect(authService.refreshCurrentUserTier()).resolves.toBe(UserTier.Public);
    expect(totpMfa.userHasEnrolledTotp).toHaveBeenCalled();
    expect(authService.mfaEnrollmentRequired$()).toBe(true);
    expect(authService.isAuthenticated()).toBe(false);
    expect(appState.userIsAdmin$()).toBe(false);
    expect(appState.userIsSuperAdmin$()).toBe(false);
    expect(appState.allowedSirapIds$()).toEqual([]);
    expect(appState.administeredSirapIds$()).toEqual([]);
    expect(appState.canAccessSirapScope()).toBe(false);
    expect(scenarios.startSyncForUser).not.toHaveBeenCalled();
    expect(scenarios.stopSync).toHaveBeenCalled();

    const refreshCalls = totpMfa.userHasEnrolledTotp.mock.calls.length;
    await expect(authService.refreshCurrentUserTier()).resolves.toBe(UserTier.Public);
    expect(totpMfa.userHasEnrolledTotp.mock.calls.length).toBeGreaterThan(refreshCalls);
    expect(authService.mfaEnrollmentRequired$()).toBe(true);
    expect(authService.isAuthenticated()).toBe(false);
    expect(appState.userIsAdmin$()).toBe(false);
    expect(appState.userIsSuperAdmin$()).toBe(false);
    expect(appState.allowedSirapIds$()).toEqual([]);
    expect(appState.administeredSirapIds$()).toEqual([]);
    expect(scenarios.startSyncForUser).not.toHaveBeenCalled();
  });

  it('grants access after enrollment without forcing another factor refresh', async () => {
    totpMfa.enrolled = false;
    totpMfa.userHasEnrolledTotp.mockResolvedValue(false);
    firebase.userDocs.set('just-enrolled-uid', {
      status: 'active',
      role: 'admin',
      allowedSirapIds: ['orinoquia'],
    });
    const authService = TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);
    firebase.auth.currentUser = { uid: 'just-enrolled-uid' };

    await expect(
      authService.refreshCurrentUserTier({ totpEnrollmentConfirmed: true }),
    ).resolves.toBe(UserTier.Manager);
    await expect(authService.refreshCurrentUserTier()).resolves.toBe(UserTier.Manager);
    expect(totpMfa.userHasEnrolledTotp).not.toHaveBeenCalled();
    expect(authService.mfaEnrollmentRequired$()).toBe(false);
    expect(authService.isAuthenticated()).toBe(true);
    expect(appState.userIsAdmin$()).toBe(true);
    expect(appState.allowedSirapIds$()).toEqual(['orinoquia']);
  });

  it('keeps explicit logout semantics after a confirmed authenticator enrollment', async () => {
    totpMfa.enrolled = false;
    totpMfa.userHasEnrolledTotp.mockResolvedValue(false);
    firebase.userDocs.set('just-enrolled-uid', {
      status: 'active',
      role: 'admin',
    });
    const authService = TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);
    firebase.auth.currentUser = { uid: 'just-enrolled-uid' };

    await authService.refreshCurrentUserTier({ totpEnrollmentConfirmed: true });
    await authService.logout();

    expect(firebase.signOut).toHaveBeenCalled();
    expect(firebase.auth.currentUser).toBeNull();
    expect(totpMfa.forgetOpenEnrollment).toHaveBeenCalledWith('just-enrolled-uid');
    expect(authService.hasFirebaseIdentity()).toBe(false);
    expect(authService.isAuthenticated()).toBe(false);
    expect(authService.getCurrentTier()).toBe(UserTier.Public);
    expect(appState.userIsSignedIn$()).toBe(false);
    expect(authService.mfaEnrollmentRequired$()).toBe(false);
  });

  it('force-refreshes authenticator factors on the next sign-in after logout', async () => {
    totpMfa.enrolled = false;
    totpMfa.userHasEnrolledTotp.mockResolvedValue(false);
    firebase.userDocs.set('just-enrolled-uid', {
      status: 'active',
      role: 'admin',
    });
    const authService = TestBed.inject(AuthService);
    firebase.auth.currentUser = { uid: 'just-enrolled-uid' };

    await authService.refreshCurrentUserTier({ totpEnrollmentConfirmed: true });
    expect(totpMfa.userHasEnrolledTotp).not.toHaveBeenCalled();

    await authService.logout();
    totpMfa.userHasEnrolledTotp.mockClear();
    totpMfa.enrolled = true;
    totpMfa.userHasEnrolledTotp.mockResolvedValue(true);
    firebase.auth.currentUser = fakeUser('just-enrolled-uid');
    firebase.authStateCallbacks[0]?.(fakeUser('just-enrolled-uid'));
    await expect(authService.refreshCurrentUserTier()).resolves.toBe(UserTier.Manager);
    expect(totpMfa.userHasEnrolledTotp).toHaveBeenCalled();
  });

  it('grants access from the refreshed factor list when the cached list is still empty', async () => {
    totpMfa.hasEnrolledTotp.mockReturnValue(false);
    totpMfa.userHasEnrolledTotp.mockResolvedValue(true);
    firebase.auth.currentUser = { uid: 'active-uid' };
    firebase.userDocs.set('active-uid', {
      status: 'active',
      role: 'admin',
      allowedSirapIds: ['orinoquia'],
    });
    const authService = TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);

    await expect(authService.refreshCurrentUserTier()).resolves.toBe(UserTier.Manager);
    expect(totpMfa.userHasEnrolledTotp).toHaveBeenCalled();
    expect(authService.mfaEnrollmentRequired$()).toBe(false);
    expect(authService.isAuthenticated()).toBe(true);
    expect(appState.userIsAdmin$()).toBe(true);
    expect(appState.allowedSirapIds$()).toEqual(['orinoquia']);
  });

  it('withholds access without opening setup when the factor refresh fails', async () => {
    totpMfa.enrolled = false;
    totpMfa.userHasEnrolledTotp.mockRejectedValue(new Error('reload failed'));
    firebase.auth.currentUser = { uid: 'active-uid' };
    firebase.userDocs.set('active-uid', {
      status: 'active',
      role: 'admin',
    });
    const authService = TestBed.inject(AuthService);

    await expect(authService.refreshCurrentUserTier()).resolves.toBe(UserTier.Public);
    expect(authService.mfaEnrollmentRequired$()).toBe(false);
    expect(authService.isAuthenticated()).toBe(false);
    expect(scenarios.startSyncForUser).not.toHaveBeenCalled();
    expect(scenarios.stopSync).toHaveBeenCalled();
  });

  it('does not reopen authenticator setup when a factor refresh finishes after logout', async () => {
    totpMfa.enrolled = false;
    let resolveEnrolled: (value: boolean) => void = () => undefined;
    totpMfa.userHasEnrolledTotp.mockReturnValue(
      new Promise((resolve) => {
        resolveEnrolled = resolve;
      }),
    );
    firebase.auth.currentUser = { uid: 'active-uid' };
    firebase.userDocs.set('active-uid', {
      status: 'active',
      role: 'admin',
    });
    const authService = TestBed.inject(AuthService);

    const logoutDone = authService.logout();
    resolveEnrolled(false);
    await logoutDone;
    for (let step = 0; step < 6; step += 1) {
      await Promise.resolve();
    }

    expect(authService.mfaEnrollmentRequired$()).toBe(false);
    expect(authService.hasFirebaseIdentity()).toBe(false);
    expect(authService.isAuthenticated()).toBe(false);
  });

  it('checks authenticator enrollment once when auth state repeats for the same user', async () => {
    totpMfa.enrolled = false;
    let resolveEnrolled: (value: boolean) => void = () => undefined;
    totpMfa.userHasEnrolledTotp.mockReturnValue(
      new Promise((resolve) => {
        resolveEnrolled = resolve;
      }),
    );
    firebase.auth.currentUser = fakeUser('active-uid');
    firebase.userDocs.set('active-uid', {
      status: 'active',
      role: 'admin',
    });
    const authService = TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);

    firebase.authStateCallbacks[0]?.(firebase.currentUser);

    expect(totpMfa.userHasEnrolledTotp).toHaveBeenCalledTimes(1);
    resolveEnrolled(true);
    for (let step = 0; step < 16; step += 1) {
      await Promise.resolve();
    }

    expect(authService.mfaEnrollmentRequired$()).toBe(false);
    expect(authService.isAuthenticated()).toBe(true);
    expect(appState.userIsAdmin$()).toBe(true);
    expect(totpMfa.userHasEnrolledTotp).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale empty factor read reopen setup after confirmation', async () => {
    totpMfa.enrolled = false;
    totpMfa.hasEnrolledTotp.mockReturnValue(false);
    let resolveStale: (value: boolean) => void = () => undefined;
    let factorReads = 0;
    totpMfa.userHasEnrolledTotp.mockImplementation(() => {
      factorReads += 1;
      if (factorReads === 1) {
        return new Promise((resolve) => {
          resolveStale = resolve;
        });
      }
      return Promise.resolve(true);
    });
    firebase.auth.currentUser = { uid: 'active-uid' };
    firebase.userDocs.set('active-uid', {
      status: 'active',
      role: 'admin',
      allowedSirapIds: ['orinoquia'],
    });
    const authService = TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);

    await expect(authService.refreshCurrentUserTier()).resolves.toBe(UserTier.Manager);
    expect(authService.mfaEnrollmentRequired$()).toBe(false);
    expect(authService.isAuthenticated()).toBe(true);
    expect(appState.userIsAdmin$()).toBe(true);

    resolveStale(false);
    for (let step = 0; step < 8; step += 1) {
      await Promise.resolve();
    }
    firebase.emitUserDocument('active-uid', {
      status: 'active',
      role: 'admin',
      allowedSirapIds: ['orinoquia'],
    });
    for (let step = 0; step < 4; step += 1) {
      await Promise.resolve();
    }

    expect(authService.mfaEnrollmentRequired$()).toBe(false);
    expect(authService.isAuthenticated()).toBe(true);
    expect(appState.userIsAdmin$()).toBe(true);
    expect(appState.allowedSirapIds$()).toEqual(['orinoquia']);
    expect(scenarios.startSyncForUser).toHaveBeenCalledWith('active-uid');
    expect(factorReads).toBe(2);
  });

  it('marks auth ready after the first auth-state result', () => {
    const authService = TestBed.inject(AuthService);
    expect(authService.authReady$()).toBe(true);
  });

  it('does not start a competing forced refresh while enrollment is held', async () => {
    totpMfa.enrolled = false;
    totpMfa.enrollmentHeld = true;
    totpMfa.userHasEnrolledTotp.mockClear();
    firebase.auth.currentUser = { uid: 'enrolling-uid' };
    firebase.userDocs.set('enrolling-uid', {
      status: 'active',
      role: 'admin',
      allowedSirapIds: ['orinoquia'],
    });
    const authService = TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);

    await expect(authService.refreshCurrentUserTier()).resolves.toBe(UserTier.Public);
    expect(totpMfa.userHasEnrolledTotp).not.toHaveBeenCalled();
    expect(authService.mfaEnrollmentRequired$()).toBe(true);
    expect(authService.hasFirebaseIdentity()).toBe(true);
    expect(authService.isAuthenticated()).toBe(false);
    expect(appState.userIsSignedIn$()).toBe(true);
    expect(appState.userIsAdmin$()).toBe(false);
    expect(scenarios.startSyncForUser).not.toHaveBeenCalled();
  });

  it('withholds access without re-enrollment when TOTP is enrolled but the second-factor claim is missing', async () => {
    totpMfa.enrolled = true;
    totpMfa.userHasEnrolledTotp.mockResolvedValue(true);
    const user = fakeUser('enrolled-uid', null);
    firebase.auth.currentUser = user;
    firebase.userDocs.set('enrolled-uid', {
      status: 'active',
      role: 'admin',
      allowedSirapIds: ['orinoquia'],
    });
    const authService = TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);

    await expect(authService.refreshCurrentUserTier()).resolves.toBe(UserTier.Public);
    expect(user.getIdTokenResult).toHaveBeenCalledWith(false);
    expect(authService.mfaEnrollmentRequired$()).toBe(false);
    expect(authService.isAuthenticated()).toBe(false);
    expect(authService.hasFirebaseIdentity()).toBe(true);
    expect(appState.userIsAdmin$()).toBe(false);
    expect(appState.allowedSirapIds$()).toEqual([]);
    expect(scenarios.startSyncForUser).not.toHaveBeenCalled();
  });

  it('grants a confirmed TOTP challenge without reading the second-factor claim again', async () => {
    totpMfa.enrolled = false;
    totpMfa.userHasEnrolledTotp.mockResolvedValue(false);
    const user = fakeUser('just-enrolled-uid', null);
    firebase.userDocs.set('just-enrolled-uid', {
      status: 'active',
      role: 'admin',
    });
    const authService = TestBed.inject(AuthService);
    firebase.auth.currentUser = user;

    await expect(
      authService.refreshCurrentUserTier({ totpEnrollmentConfirmed: true }),
    ).resolves.toBe(UserTier.Manager);
    expect(user.getIdTokenResult).not.toHaveBeenCalled();
    expect(totpMfa.userHasEnrolledTotp).not.toHaveBeenCalled();
    expect(authService.mfaEnrollmentRequired$()).toBe(false);
    expect(authService.isAuthenticated()).toBe(true);
  });

  it('marks auth ready without waiting for the identity-context probe', () => {
    firebase.auth.currentUser = {
      uid: 'probe-uid',
      getIdTokenResult: () => new Promise(() => undefined),
    };
    firebase.userDocs.set('probe-uid', {
      status: 'active',
      role: 'admin',
    });
    const authService = TestBed.inject(AuthService);

    expect(authService.authReady$()).toBe(true);
  });

  it('keeps auth gating when the identity-context probe throws', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const user = fakeUser('probe-throw-uid');
    let tokenReads = 0;
    user.getIdTokenResult = vi.fn(async () => {
      tokenReads += 1;
      if (tokenReads === 1) {
        throw new Error(`token=eyJhbGciOiJub25lIn0.probe email=wthompson@ucsb.edu`);
      }
      return { signInSecondFactor: 'totp' };
    });
    firebase.auth.currentUser = user;
    firebase.userDocs.set('probe-throw-uid', {
      status: 'active',
      role: 'admin',
    });
    const authService = TestBed.inject(AuthService);
    for (let step = 0; step < 8; step += 1) {
      await Promise.resolve();
    }

    expect(authService.authReady$()).toBe(true);
    await expect(authService.refreshCurrentUserTier()).resolves.toBe(UserTier.Manager);
    expect(authService.isAuthenticated()).toBe(true);
    expect(authService.mfaEnrollmentRequired$()).toBe(false);
    info.mockRestore();
  });

  it('does not emit an identity-context probe line while signed out', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const authService = TestBed.inject(AuthService);

    expect(authService.authReady$()).toBe(true);
    expect(authService.hasFirebaseIdentity()).toBe(false);
    expect(
      info.mock.calls.some((call) => String(call[0]).startsWith(IDENTITY_CONTEXT_PROBE_LOG_PREFIX)),
    ).toBe(false);
    info.mockRestore();
  });

  it('emits a closed identity-context line for a restored signed-in user', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    firebase.auth.currentUser = fakeUser('probe-uid');
    firebase.userDocs.set('probe-uid', {
      status: 'active',
      role: 'admin',
    });
    const authService = TestBed.inject(AuthService);
    for (let step = 0; step < 8; step += 1) {
      await Promise.resolve();
    }

    const line = info.mock.calls
      .map((call) => String(call[0]))
      .find((entry) => entry.startsWith(`${IDENTITY_CONTEXT_PROBE_LOG_PREFIX} `));
    expect(authService.authReady$()).toBe(true);
    expect(line).toBe(
      `${IDENTITY_CONTEXT_PROBE_LOG_PREFIX} {"event":"identity-context","audMatchesConfiguredProject":false,"subjectMatchesCurrentUser":false,"tokenTenantPresent":false,"authTenantPresent":false,"signInProvider":null,"secondFactorClaimPresent":true,"localEnrolledFactorCount":0}`,
    );
    expect(line).not.toContain('probe-uid');
    expect(line).not.toContain(environment.firebase.config.projectId);
    expect(line).not.toContain(environment.firebase.config.apiKey);
    info.mockRestore();
  });
});
