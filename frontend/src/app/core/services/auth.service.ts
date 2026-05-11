import { Injectable, OnDestroy, inject } from '@angular/core';
import { AppStateService } from '@core/services/app-state.service';
import { FirebaseClientService } from '@core/services/firebase-client.service';
import { UserTier } from '@core/models';
import { type Unsubscribe, type User } from 'firebase/auth';
import { type DocumentData } from 'firebase/firestore';
import { environment } from '../../../environments/environment';

type ApprovedUserRole = 'authorized_viewer' | 'science_publisher' | 'admin';

@Injectable({
  providedIn: 'root',
})
export class AuthService implements OnDestroy {
  private readonly appState = inject(AppStateService);
  private readonly firebase = inject(FirebaseClientService);
  private authStateUnsubscribe: Unsubscribe | null = null;
  private explicitlyLoggedOut = false;

  constructor() {
    this.appState.userTier$.set(this.getFallbackTier());
    this.authStateUnsubscribe = this.firebase.subscribeToAuthState((user) => {
      void this.syncTierFromFirebaseUser(user);
    });
  }

  ngOnDestroy(): void {
    this.authStateUnsubscribe?.();
  }

  async logout(): Promise<void> {
    this.explicitlyLoggedOut = true;
    await this.firebase.signOut();
    this.appState.userTier$.set(UserTier.Public);
  }

  getCurrentTier(): UserTier {
    return this.appState.userTier$();
  }

  isAuthenticated(): boolean {
    return this.getCurrentTier() >= UserTier.DecisionMaker;
  }

  async refreshCurrentUserTier(): Promise<UserTier> {
    const tier = await this.syncTierFromFirebaseUser(this.firebase.currentUser);
    this.appState.userTier$.set(tier);
    return tier;
  }

  private async syncTierFromFirebaseUser(user: User | null): Promise<UserTier> {
    if (!user) {
      const fallbackTier = this.getFallbackTier();
      this.appState.userTier$.set(fallbackTier);
      return fallbackTier;
    }

    this.explicitlyLoggedOut = false;
    const tier = await this.getTierForFirebaseUser(user.uid);
    this.appState.userTier$.set(tier);
    return tier;
  }

  private async getTierForFirebaseUser(uid: string): Promise<UserTier> {
    const userData = await this.firebase.getUserDocument(uid);
    const role = userData ? this.readApprovedRole(userData) : null;
    return role ? this.roleToTier(role) : UserTier.Public;
  }

  private getFallbackTier(): UserTier {
    return environment.bypassLoginForDevelopment && !this.explicitlyLoggedOut
      ? UserTier.DecisionMaker
      : UserTier.Public;
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
    if (role === 'admin') {
      return UserTier.Manager;
    }
    return UserTier.DecisionMaker;
  }
}
