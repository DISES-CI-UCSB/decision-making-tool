import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { AppStateService } from '@core/services/app-state.service';
import { FirebaseClientService } from '@core/services/firebase-client.service';
import { SavedSolutionScenariosService } from '@core/services/saved-solution-scenarios.service';
import { TotpMfaService } from '@features/auth/services/totp-mfa.service';
import {
  readAppRole,
  readSirapAccessRegionIds,
  roleToUserTier,
  type SirapRegionId,
  UserTier,
} from '@core/models';
import { type Unsubscribe, type User } from 'firebase/auth';
import { type DocumentData } from 'firebase/firestore';
import { environment } from '../../../environments/environment';

type FactorGate = 'enrolled' | 'needs-enrollment' | 'unknown';

interface UserAccess {
  tier: UserTier;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  allowedSirapIds: SirapRegionId[];
  administeredSirapIds: SirapRegionId[];
}

@Injectable({
  providedIn: 'root',
})
export class AuthService implements OnDestroy {
  private readonly appState = inject(AppStateService);
  private readonly firebase = inject(FirebaseClientService);
  private readonly savedSolutionScenarios = inject(SavedSolutionScenariosService);
  private readonly totpMfa = inject(TotpMfaService);
  readonly mfaEnrollmentRequired$ = signal(false);
  private authStateUnsubscribe: Unsubscribe | null = null;
  private userAccessUnsubscribe: Unsubscribe | null = null;
  private explicitlyLoggedOut = false;
  private accessEpoch = 0;
  private boundUid: string | null = null;
  private factorGeneration = 0;
  private factorRefresh: Promise<boolean> | null = null;
  private totpEnrollmentCache: { uid: string; enrolled: boolean } | null = null;

  constructor() {
    this.appState.userTier$.set(this.getFallbackTier());
    this.authStateUnsubscribe = this.firebase.subscribeToAuthState((user) => {
      this.subscribeToFirebaseUserAccess(user);
    });
  }

  ngOnDestroy(): void {
    this.authStateUnsubscribe?.();
    this.userAccessUnsubscribe?.();
    this.savedSolutionScenarios.stopSync();
  }

  async logout(): Promise<void> {
    this.invalidateFactorRead();
    this.accessEpoch += 1;
    this.explicitlyLoggedOut = true;
    this.mfaEnrollmentRequired$.set(false);
    this.savedSolutionScenarios.stopSync();
    await this.firebase.signOut();
    this.applySignedOutTier();
  }

  getCurrentTier(): UserTier {
    return this.appState.userTier$();
  }

  isAuthenticated(): boolean {
    return this.getCurrentTier() >= UserTier.DecisionMaker;
  }

  hasFirebaseIdentity(): boolean {
    return this.appState.userIsSignedIn$();
  }

  async refreshCurrentUserTier(): Promise<UserTier> {
    this.invalidateFactorRead();
    const epoch = this.accessEpoch;
    const user = this.firebase.currentUser;
    this.appState.userIsSignedIn$.set(user !== null);
    if (!user) {
      return this.applySignedOutTier();
    }

    this.explicitlyLoggedOut = false;
    const access = await this.getAccessForFirebaseUser(user.uid);
    const tier = await Promise.resolve(this.applyAccessForEpoch(access, user, epoch));
    this.appState.userTier$.set(tier);
    return tier;
  }

  private applySignedOutTier(): UserTier {
    this.mfaEnrollmentRequired$.set(false);
    const fallbackTier = this.getFallbackTier();
    this.appState.userIsSignedIn$.set(false);
    this.appState.userTier$.set(fallbackTier);
    this.appState.userIsAdmin$.set(false);
    this.clearSirapAccess();
    return fallbackTier;
  }

  private subscribeToFirebaseUserAccess(user: User | null): void {
    const nextUid = user?.uid ?? null;
    // Token refresh and reload notify auth state for the same user. Restarting
    // the factor read there calls getIdToken(true) again and loops setup.
    if (nextUid === this.boundUid) {
      return;
    }
    this.invalidateFactorRead();
    this.accessEpoch += 1;
    const epoch = this.accessEpoch;
    this.boundUid = nextUid;
    this.userAccessUnsubscribe?.();
    this.userAccessUnsubscribe = null;
    this.appState.userIsSignedIn$.set(user !== null);
    if (!user) {
      this.savedSolutionScenarios.stopSync();
      this.applySignedOutTier();
      return;
    }

    this.explicitlyLoggedOut = false;
    this.userAccessUnsubscribe = this.firebase.subscribeToUserDocument(user.uid, (userData) => {
      void this.applyAccessForEpoch(this.readAccess(userData), user, epoch);
    });
    if (!this.userAccessUnsubscribe) {
      void this.getAccessForFirebaseUser(user.uid).then((access) =>
        this.applyAccessForEpoch(access, user, epoch),
      );
    }
  }

  private applyAccessForEpoch(
    access: UserAccess,
    user: User,
    epoch: number,
  ): UserTier | Promise<UserTier> {
    const factorGeneration = this.factorGeneration;
    const gate = this.readFactorGate(access, user);
    if (gate instanceof Promise) {
      return gate.then((resolved) =>
        this.finishAccess(access, user, epoch, factorGeneration, resolved),
      );
    }
    return this.finishAccess(access, user, epoch, factorGeneration, gate);
  }

  private finishAccess(
    access: UserAccess,
    user: User,
    epoch: number,
    factorGeneration: number,
    gate: FactorGate,
  ): UserTier {
    // refreshCurrentUserTier bumps factorGeneration without rebinding the
    // user-document listener. A read started earlier must not reopen setup.
    if (epoch !== this.accessEpoch || factorGeneration !== this.factorGeneration) {
      return this.appState.userTier$();
    }
    const granted = this.holdUnenrolledActiveAccess(access, gate);
    this.applyAccess(granted);
    if (gate === 'enrolled') {
      this.savedSolutionScenarios.startSyncForUser(user.uid);
    } else {
      this.savedSolutionScenarios.stopSync();
    }
    return granted.tier;
  }

  private readFactorGate(access: UserAccess, user: User): FactorGate | Promise<FactorGate> {
    if (access.tier < UserTier.DecisionMaker) {
      return 'enrolled';
    }
    // A local enrolledFactors hit can outlive the factors Admin already removed.
    // Approved users wait for refreshFactorGate. The cache below is written only
    // from that refreshed result, so a later read can reuse it without another
    // token refresh.
    const cached = this.totpEnrollmentCache;
    if (cached?.uid === user.uid) {
      return cached.enrolled ? 'enrolled' : 'needs-enrollment';
    }
    return this.refreshFactorGate(user);
  }

  private refreshFactorGate(user: User): Promise<FactorGate> {
    if (!this.factorRefresh) {
      const generation = this.factorGeneration;
      const pending = this.totpMfa.userHasEnrolledTotp(user).then((enrolled) => {
        if (generation === this.factorGeneration && this.firebase.currentUser?.uid === user.uid) {
          this.totpEnrollmentCache = { uid: user.uid, enrolled };
        }
        return enrolled;
      });
      const tracked = pending.finally(() => {
        if (this.factorRefresh === tracked) {
          this.factorRefresh = null;
        }
      });
      this.factorRefresh = tracked;
    }
    return this.factorRefresh.then(
      (enrolled) => (enrolled ? 'enrolled' : 'needs-enrollment'),
      () => 'unknown',
    );
  }

  private invalidateFactorRead(): void {
    this.factorGeneration += 1;
    this.totpEnrollmentCache = null;
    this.factorRefresh = null;
  }

  private holdUnenrolledActiveAccess(access: UserAccess, gate: FactorGate): UserAccess {
    this.mfaEnrollmentRequired$.set(gate === 'needs-enrollment');
    if (gate === 'enrolled') {
      return access;
    }
    return {
      tier: UserTier.Public,
      isAdmin: false,
      isSuperAdmin: false,
      allowedSirapIds: [],
      administeredSirapIds: [],
    };
  }

  private applyAccess(access: UserAccess): void {
    this.appState.userTier$.set(access.tier);
    this.appState.userIsAdmin$.set(access.isAdmin);
    this.appState.userIsSuperAdmin$.set(access.isSuperAdmin);
    this.appState.allowedSirapIds$.set(access.allowedSirapIds);
    this.appState.administeredSirapIds$.set(access.administeredSirapIds);
  }

  private async getAccessForFirebaseUser(uid: string): Promise<UserAccess> {
    const userData = await this.firebase.getUserDocument(uid);
    return this.readAccess(userData);
  }

  private readAccess(userData: DocumentData | null): UserAccess {
    if (!userData) {
      return {
        tier: UserTier.Public,
        isAdmin: false,
        isSuperAdmin: false,
        allowedSirapIds: [],
        administeredSirapIds: [],
      };
    }

    if (userData['status'] !== 'active') {
      return {
        tier: UserTier.Public,
        isAdmin: false,
        isSuperAdmin: false,
        allowedSirapIds: [],
        administeredSirapIds: [],
      };
    }

    const allowedSirapIds = readSirapAccessRegionIds(userData['allowedSirapIds']);
    const administeredSirapIds = readSirapAccessRegionIds(userData['administeredSirapIds']);
    const role = readAppRole(
      userData['role'],
      allowedSirapIds,
      administeredSirapIds,
      userData['isAdmin'] === true || userData['isSuperAdmin'] === true,
    );
    const isSuperAdmin = role === 'super-admin';
    return {
      tier: roleToUserTier(role),
      isAdmin: isSuperAdmin || role === 'sirap-admin',
      isSuperAdmin,
      allowedSirapIds,
      administeredSirapIds,
    };
  }

  private getFallbackTier(): UserTier {
    return environment.bypassLoginForDevelopment && !this.explicitlyLoggedOut
      ? UserTier.DecisionMaker
      : UserTier.Public;
  }

  private clearSirapAccess(): void {
    this.appState.userIsSuperAdmin$.set(false);
    this.appState.allowedSirapIds$.set([]);
    this.appState.administeredSirapIds$.set([]);
  }
}
