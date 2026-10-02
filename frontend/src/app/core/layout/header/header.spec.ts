import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
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
    mfaEnrollmentRequired$: signal(false),
    authReady$: signal(true),
  };

  beforeEach(async () => {
    authService.logout.mockClear();
    authService.mfaEnrollmentRequired$.set(false);
    authService.authReady$.set(true);
    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [
        { provide: AuthService, useValue: authService },
        provideRouter([]),
        provideTranslateService({
          lang: 'en',
          fallbackLang: 'en',
          loader: provideTranslateLoader(TranslateNoOpLoader),
        }),
      ],
    }).compileComponents();

    TestBed.inject(TranslateService).setTranslation('en', {
      header: {
        appTitle: 'Prioritizing Nature',
        logout: 'Logout',
        loginRegister: 'Login / Register',
        pendingAccess: 'Signed in · Account is not active',
        tierChip: 'Tier {{tier}}',
      },
    });
  });

  it('shows DevTools in non-production builds', () => {
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('#foundation-header-dev-tools-panel'),
    ).not.toBeNull();
  });

  it('omits DevTools when the production gate is off', () => {
    const fixture = TestBed.createComponent(HeaderComponent);
    (fixture.componentInstance as unknown as { showDevTools: boolean }).showDevTools = false;
    fixture.detectChanges();

    const header = fixture.nativeElement as HTMLElement;
    expect(header.querySelector('#foundation-header-dev-tools-panel')).toBeNull();
    expect(header.querySelector('#dev-tools-toggle-btn')).toBeNull();
  });

  it('shows the translated app title as a home link', () => {
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();

    const title = fixture.nativeElement.querySelector('#foundation-header-app-title');
    expect(title).not.toBeNull();
    expect(title?.textContent?.trim()).toBe('Prioritizing Nature');
    expect(fixture.nativeElement.querySelector('#foundation-header-app-logo')).toBeNull();
    expect(fixture.nativeElement.querySelector('#foundation-header-home-link')).not.toBeNull();
  });

  it('links Guide and About from the header information nav', () => {
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();

    const header = fixture.nativeElement as HTMLElement;
    expect(header.querySelector('#foundation-header-info-nav')).not.toBeNull();
    expect(header.querySelector('#foundation-header-guide-link')?.getAttribute('href')).toBe(
      '/guide',
    );
    expect(header.querySelector('#foundation-header-about-link')?.getAttribute('href')).toBe(
      '/about',
    );
  });

  it('shows login controls only for anonymous users', () => {
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();

    const header = fixture.nativeElement as HTMLElement;
    expect(header.querySelector('#foundation-header-auth-toggle-button')).not.toBeNull();
    expect(header.querySelector('#foundation-header-logout-button')).toBeNull();
  });

  it('waits for auth readiness before showing Login / Register', () => {
    authService.authReady$.set(false);
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();

    const header = fixture.nativeElement as HTMLElement;
    expect(header.querySelector('#foundation-header-auth-toggle-button')).toBeNull();
    expect(header.querySelector('#foundation-header-logout-button')).toBeNull();

    authService.authReady$.set(true);
    fixture.detectChanges();

    expect(header.querySelector('#foundation-header-auth-toggle-button')).not.toBeNull();
    expect(header.querySelector('#foundation-header-auth-toggle-button')?.textContent).toContain(
      'Login / Register',
    );
  });

  it('renders only MinAmbiente and PNNC partner logos in the header', () => {
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();

    const header = fixture.nativeElement as HTMLElement;
    const staticLogoIds = Array.from(
      header.querySelectorAll('[id^="foundation-header-primary-partner-logo-"]'),
    ).map((element) => element.id.replace('foundation-header-primary-partner-logo-', ''));

    expect(staticLogoIds).toEqual(['minambiente', 'pnnc']);
  });

  it('scrolls partner logos with the compact-header carousel controls', () => {
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();

    const header = fixture.nativeElement as HTMLElement;
    const component = fixture.componentInstance as unknown as {
      updatePrimaryPartnerCarouselControls(): void;
    };
    const carouselViewport = header.querySelector(
      '#foundation-header-primary-partners-carousel-viewport',
    ) as HTMLDivElement;
    const previousButton = header.querySelector(
      '#foundation-header-primary-partners-carousel-previous',
    ) as HTMLButtonElement;
    const nextButton = header.querySelector(
      '#foundation-header-primary-partners-carousel-next',
    ) as HTMLButtonElement;
    const scrollBy = vi.fn();
    Object.defineProperties(carouselViewport, {
      clientWidth: { configurable: true, value: 300 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
      scrollWidth: { configurable: true, value: 600 },
    });
    Object.defineProperty(carouselViewport, 'scrollBy', { configurable: true, value: scrollBy });

    component.updatePrimaryPartnerCarouselControls();
    fixture.detectChanges();
    expect(previousButton.disabled).toBe(true);
    expect(nextButton.disabled).toBe(false);

    nextButton.click();

    expect(scrollBy).toHaveBeenCalledWith({ left: 240, behavior: 'smooth' });

    carouselViewport.scrollLeft = 300;
    component.updatePrimaryPartnerCarouselControls();
    fixture.detectChanges();

    expect(previousButton.disabled).toBe(false);
    expect(nextButton.disabled).toBe(true);
  });

  it('shows pending status and logout without approved access controls', () => {
    const appState = TestBed.inject(AppStateService);
    appState.userIsSignedIn$.set(true);
    appState.userTier$.set(UserTier.Public);
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();

    const header = fixture.nativeElement as HTMLElement;
    expect(header.querySelector('#foundation-header-pending-status')?.textContent).toContain(
      'Signed in · Account is not active',
    );
    expect(header.querySelector('#foundation-header-mfa-setup-button')).toBeNull();
    expect(header.querySelector('#foundation-header-logout-button')).not.toBeNull();
    expect(header.querySelector('#foundation-header-auth-toggle-button')).toBeNull();
    expect(header.querySelector('#foundation-header-sirap-access-button')).toBeNull();
    expect(fixture.debugElement.query(By.directive(AuthModalComponent))).toBeNull();
  });

  it('opens the auth modal and shows authenticator setup instead of pending when enrollment is required', () => {
    const appState = TestBed.inject(AppStateService);
    appState.userIsSignedIn$.set(true);
    appState.userTier$.set(UserTier.Public);
    authService.mfaEnrollmentRequired$.set(true);
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();

    const header = fixture.nativeElement as HTMLElement;
    expect(header.querySelector('#foundation-header-pending-status')).toBeNull();
    expect(header.querySelector('#foundation-header-mfa-setup-button')).not.toBeNull();
    expect(header.querySelector('#foundation-header-mfa-setup-label')?.textContent).toContain(
      'Set up authenticator',
    );
    expect(header.querySelector('#foundation-header-logout-button')).not.toBeNull();
    expect(header.querySelector('#foundation-header-sirap-access-button')).toBeNull();
    const openedModal = fixture.debugElement.query(By.directive(AuthModalComponent));
    expect(openedModal).not.toBeNull();

    (openedModal.componentInstance as AuthModalComponent).closeRequested.emit();
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(AuthModalComponent))).toBeNull();

    header.querySelector<HTMLButtonElement>('#foundation-header-mfa-setup-button')?.click();
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(AuthModalComponent))).not.toBeNull();
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

  it('returns focus to the login button after the auth modal closes', () => {
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();
    const loginButton = fixture.nativeElement.querySelector(
      '#foundation-header-auth-toggle-button',
    ) as HTMLButtonElement;

    loginButton.focus();
    loginButton.click();
    fixture.detectChanges();

    expect(document.activeElement?.id).toBe('auth-modal-entry-google-btn');

    const closeButton = fixture.nativeElement.querySelector('#auth-modal-close-button');
    if (!(closeButton instanceof HTMLButtonElement)) {
      throw new Error('Auth modal close button was not rendered.');
    }
    closeButton.click();
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.directive(AuthModalComponent))).toBeNull();
    expect(document.activeElement).toBe(loginButton);
  });
});
