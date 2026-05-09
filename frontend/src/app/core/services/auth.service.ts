import { Injectable, inject } from '@angular/core';
import { AppStateService } from '@core/services/app-state.service';
import { UserTier } from '@core/models';
import { environment } from '../../../environments/environment';

const AUTH_STORAGE_KEY = 'dmt.auth.session';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export type AuthProvider = 'local' | 'google';

interface StoredAuthSession {
  token: string;
  tier: UserTier;
  provider: AuthProvider;
  expiresAt: number;
}

export interface LoginPayload {
  token: string;
  tier?: UserTier;
  provider?: AuthProvider;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly appState = inject(AppStateService);

  constructor() {
    this.syncTierFromStoredSession();
  }

  login(payload: LoginPayload): void {
    const nextSession: StoredAuthSession = {
      token: payload.token,
      tier: payload.tier ?? UserTier.DecisionMaker,
      provider: payload.provider ?? 'local',
      expiresAt: Date.now() + SEVEN_DAYS_MS,
    };

    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextSession));
    this.appState.userTier$.set(nextSession.tier);
  }

  logout(): void {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    this.appState.userTier$.set(this.getLoggedOutTier());
  }

  getCurrentTier(): UserTier {
    const session = this.readValidSession();
    if (session) {
      return session.tier;
    }

    if (environment.bypassLoginForDevelopment) {
      return UserTier.DecisionMaker;
    }

    this.logout();
    return UserTier.Public;
  }

  isAuthenticated(): boolean {
    if (environment.bypassLoginForDevelopment) {
      return true;
    }

    const session = this.readValidSession();
    if (!session) {
      this.logout();
      return false;
    }
    return true;
  }

  private syncTierFromStoredSession(): void {
    const tier = this.getCurrentTier();
    this.appState.userTier$.set(tier);
  }

  private getLoggedOutTier(): UserTier {
    return environment.bypassLoginForDevelopment ? UserTier.DecisionMaker : UserTier.Public;
  }

  private readValidSession(): StoredAuthSession | null {
    const rawValue = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawValue) as StoredAuthSession;
      const isExpired = parsed.expiresAt <= Date.now();
      if (isExpired || !parsed.token) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
}
