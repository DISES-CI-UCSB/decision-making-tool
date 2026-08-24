import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { UserTier } from '@core/models';
import { AppStateService } from '@core/services/app-state.service';
import { AuthService } from '@core/services/auth.service';
import { AuthModalComponent } from '@features/auth/auth-modal/auth-modal';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
  TranslateService,
} from '@ngx-translate/core';
import { HeaderComponent } from './header';

describe('HeaderComponent auth state', () => {
  const authService = {
    logout: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    authService.logout.mockClear();
    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [
        { provide: AuthService, useValue: authService },
        provideTranslateService({
          lang: 'en',
          fallbackLang: 'en',
          loader: provideTranslateLoader(TranslateNoOpLoader),
        }),
      ],
    }).compileComponents();

    TestBed.inject(TranslateService).setTranslation('en', {
      header: {
        appTitle: 'Decision Making Tool',
        logout: 'Logout',
        loginRegister: 'Login / Register',
        pendingAccess: 'Signed in · Access pending',
        tierChip: 'Tier {{tier}}',
      },
    });
  });

  it('shows login controls only for anonymous users', () => {
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();

    const header = fixture.nativeElement as HTMLElement;
    expect(header.querySelector('#foundation-header-auth-toggle-button')).not.toBeNull();
    expect(header.querySelector('#foundation-header-logout-button')).toBeNull();
  });

  it('shows pending status and logout without approved access controls', () => {
    const appState = TestBed.inject(AppStateService);
    appState.userIsSignedIn$.set(true);
    appState.userTier$.set(UserTier.Public);
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();

    const header = fixture.nativeElement as HTMLElement;
    expect(header.querySelector('#foundation-header-pending-status')?.textContent).toContain(
      'Signed in · Access pending',
    );
    expect(header.querySelector('#foundation-header-logout-button')).not.toBeNull();
    expect(header.querySelector('#foundation-header-auth-toggle-button')).toBeNull();
    expect(header.querySelector('#foundation-header-sirap-access-button')).toBeNull();
  });

  it('logs out a pending signed-in user', () => {
    const appState = TestBed.inject(AppStateService);
    appState.userIsSignedIn$.set(true);
    appState.userTier$.set(UserTier.Public);
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();

    const logoutButton = fixture.nativeElement.querySelector(
      '#foundation-header-logout-button',
    ) as HTMLButtonElement;
    logoutButton.click();

    expect(authService.logout).toHaveBeenCalledOnce();
  });

  it('keeps an explicitly opened request modal mounted through a pending identity transition', () => {
    const appState = TestBed.inject(AppStateService);
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();

    const loginButton = fixture.nativeElement.querySelector(
      '#foundation-header-auth-toggle-button',
    ) as HTMLButtonElement;
    loginButton.click();
    fixture.detectChanges();
    const modalBeforeSignIn = fixture.debugElement.query(By.directive(AuthModalComponent));

    appState.userIsSignedIn$.set(true);
    appState.userTier$.set(UserTier.Public);
    fixture.detectChanges();
    const modalAfterSignIn = fixture.debugElement.query(By.directive(AuthModalComponent));

    expect(modalAfterSignIn).not.toBeNull();
    expect(modalAfterSignIn.componentInstance).toBe(modalBeforeSignIn.componentInstance);

    (modalAfterSignIn.componentInstance as AuthModalComponent).closeRequested.emit();
    fixture.detectChanges();

    const header = fixture.nativeElement as HTMLElement;
    expect(fixture.debugElement.query(By.directive(AuthModalComponent))).toBeNull();
    expect(header.querySelector('#foundation-header-pending-status')).not.toBeNull();
    expect(header.querySelector('#foundation-header-logout-button')).not.toBeNull();
  });

  it('keeps approved admin controls unchanged', () => {
    const appState = TestBed.inject(AppStateService);
    appState.userIsSignedIn$.set(true);
    appState.userTier$.set(UserTier.DecisionMaker);
    appState.userIsAdmin$.set(true);
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();

    const header = fixture.nativeElement as HTMLElement;
    expect(header.querySelector('#foundation-header-auth-tier-chip')).not.toBeNull();
    expect(header.querySelector('#foundation-header-sirap-access-button')).not.toBeNull();
    expect(header.querySelector('#foundation-header-admin-access-button')).not.toBeNull();
    expect(header.querySelector('#foundation-header-logout-button')).not.toBeNull();
    expect(header.querySelector('#foundation-header-pending-status')).toBeNull();
  });
});
