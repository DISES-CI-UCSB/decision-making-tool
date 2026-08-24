import { Injectable, OnDestroy, inject } from '@angular/core';
import { AppStateService } from '@core/services/app-state.service';
import { FirebaseClientService } from '@core/services/firebase-client.service';
import { SavedSolutionScenariosService } from '@core/services/saved-solution-scenarios.service';
import { readSirapRegionIds, type SirapRegionId, UserTier } from '@core/models';
import { type Unsubscribe, type User } from 'firebase/auth';
import { type DocumentData } from 'firebase/firestore';
import { environment } from '../../../environments/environment';

type ApprovedUserRole = 'authorized_viewer' | 'science_publisher' | 'admin';

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
  private authStateUnsubscribe: Unsubscribe | null = null;
  private userAccessUnsubscribe: Unsubscribe | null = null;
  private explicitlyLoggedOut = false;

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
    this.explicitlyLoggedOut = true;
    this.savedSolutionScenarios.stopSync();
    await this.firebase.signOut();
    this.appState.userIsSignedIn$.set(false);
    this.appState.userTier$.set(UserTier.Public);
    this.appState.userIsAdmin$.set(false);
    this.clearSirapAccess();
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
    const tier = await this.syncTierFromFirebaseUser(this.firebase.currentUser);
    this.appState.userTier$.set(tier);
    return tier;
  }

  private async syncTierFromFirebaseUser(user: User | null): Promise<UserTier> {
    this.appState.userIsSignedIn$.set(user !== null);
    if (!user) {
      const fallbackTier = this.getFallbackTier();
      this.appState.userTier$.set(fallbackTier);
      this.appState.userIsAdmin$.set(false);
      this.clearSirapAccess();
      return fallbackTier;
    }

    this.explicitlyLoggedOut = false;
    const access = await this.getAccessForFirebaseUser(user.uid);
    this.applyAccess(access);
    return access.tier;
  }

  private subscribeToFirebaseUserAccess(user: User | null): void {
    this.userAccessUnsubscribe?.();
    this.userAccessUnsubscribe = null;
    this.appState.userIsSignedIn$.set(user !== null);
    if (!user) {
      this.savedSolutionScenarios.stopSync();
      void this.syncTierFromFirebaseUser(null);
      return;
    }

    this.savedSolutionScenarios.startSyncForUser(user.uid);

    this.explicitlyLoggedOut = false;
    this.userAccessUnsubscribe = this.firebase.subscribeToUserDocument(user.uid, (userData) => {
      this.applyAccess(this.readAccess(userData));
    });
    if (!this.userAccessUnsubscribe) {
      void this.syncTierFromFirebaseUser(user);
    }
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

    const isActive = userData['status'] === 'active';
    const isSuperAdmin = isActive && this.readIsSuperAdmin(userData);
    const administeredSirapIds = isActive
      ? readSirapRegionIds(userData['administeredSirapIds'])
      : [];
    return {
      tier: this.readUserTier(userData),
      isAdmin: isSuperAdmin || administeredSirapIds.length > 0,
      isSuperAdmin,
      allowedSirapIds: isActive ? readSirapRegionIds(userData['allowedSirapIds']) : [],
      administeredSirapIds,
    };
  }

  private getFallbackTier(): UserTier {
    return environment.bypassLoginForDevelopment && !this.explicitlyLoggedOut
      ? UserTier.DecisionMaker
      : UserTier.Public;
  }

  private readUserTier(data: DocumentData): UserTier {
    if (data['status'] !== 'active') {
      return UserTier.Public;
    }

    const tier = data['tier'];
    if (tier === UserTier.Public || tier === UserTier.DecisionMaker || tier === UserTier.Manager) {
      return tier;
    }

    const legacyRole = this.readApprovedRole(data);
    return legacyRole ? this.roleToTier(legacyRole) : UserTier.Public;
  }

  private readIsSuperAdmin(data: DocumentData): boolean {
    return data['isSuperAdmin'] === true || data['role'] === 'admin' || data['isAdmin'] === true;
  }

  private readApprovedRole(data: DocumentData): ApprovedUserRole | null {
    if (data['status'] !== 'active') {
      return null;
    }
    const role = data['role'];
    if (role === 'authorized_viewer' || role === 'science_publisher' || role === 'admin') {
      return role;
    }
    return null;
  }

  private roleToTier(role: ApprovedUserRole): UserTier {
    if (role === 'admin' || role === 'science_publisher') {
      return UserTier.Manager;
    }
    return UserTier.DecisionMaker;
  }

  private clearSirapAccess(): void {
    this.appState.userIsSuperAdmin$.set(false);
    this.appState.allowedSirapIds$.set([]);
    this.appState.administeredSirapIds$.set([]);
  }
}
