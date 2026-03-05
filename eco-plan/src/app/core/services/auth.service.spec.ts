import { TestBed } from '@angular/core/testing';
import { UserTier } from '@core/models';
import { AppStateService } from './app-state.service';
import { AuthService } from './auth.service';

const AUTH_STORAGE_KEY = 'dmt.auth.session';

describe('AuthService', () => {
  beforeEach(() => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    TestBed.configureTestingModule({});
  });

  it('defaults to public tier when unauthenticated', () => {
    const authService = TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);

    expect(authService.isAuthenticated()).toBe(false);
    expect(authService.getCurrentTier()).toBe(UserTier.Public);
    expect(appState.userTier$()).toBe(UserTier.Public);
  });

  it('stores session with TTL and updates app-state tier on login/logout', () => {
    const authService = TestBed.inject(AuthService);
    const appState = TestBed.inject(AppStateService);

    authService.login({
      token: 'mock-token',
      tier: UserTier.Manager,
      provider: 'google',
    });

    expect(authService.isAuthenticated()).toBe(true);
    expect(authService.getCurrentTier()).toBe(UserTier.Manager);
    expect(appState.userTier$()).toBe(UserTier.Manager);

    authService.logout();

    expect(authService.isAuthenticated()).toBe(false);
    expect(authService.getCurrentTier()).toBe(UserTier.Public);
    expect(appState.userTier$()).toBe(UserTier.Public);
  });

  it('expires stale sessions and falls back to public tier', () => {
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        token: 'expired-token',
        tier: UserTier.DecisionMaker,
        provider: 'local',
        expiresAt: Date.now() - 1000,
      }),
    );

    const authService = TestBed.inject(AuthService);

    expect(authService.isAuthenticated()).toBe(false);
    expect(authService.getCurrentTier()).toBe(UserTier.Public);
  });
});
