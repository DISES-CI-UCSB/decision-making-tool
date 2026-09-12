import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { type LayerLocale, UserTier } from '@core/models';
import { AuthService } from '@core/services/auth.service';
import { AppLocaleService } from '@core/services/app-locale.service';
import { AppStateService } from '@core/services/app-state.service';
import { primaryPartnerLogos } from '@core/config/partner-logos';
import { DevToolsPanelComponent } from '@features/map/components/dev-tools-panel/dev-tools-panel';
import { AuthModalComponent } from '@features/auth/auth-modal/auth-modal';
import { AdminAccessRequestsPanelComponent } from '@features/auth/admin-access-requests-panel/admin-access-requests-panel';
import { SirapAccessPanelComponent } from '@features/auth/sirap-access-panel/sirap-access-panel';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    TranslatePipe,
    DevToolsPanelComponent,
    AuthModalComponent,
    AdminAccessRequestsPanelComponent,
    SirapAccessPanelComponent,
    RouterLink,
  ],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class HeaderComponent implements AfterViewInit {
  private readonly translate = inject(TranslateService);
  private readonly appLocaleService = inject(AppLocaleService);
  private readonly authService = inject(AuthService);
  private readonly appState = inject(AppStateService);

  protected readonly authModalOpen = signal(false);
  protected readonly adminPanelOpen = signal(false);
  protected readonly sirapAccessPanelOpen = signal(false);
  protected readonly primaryPartnerLogos = primaryPartnerLogos;
  protected readonly partnerCarouselCanMovePrevious = signal(false);
  protected readonly partnerCarouselCanMoveNext = signal(true);
  protected readonly isSignedIn = computed(() => this.appState.userIsSignedIn$());
  protected readonly needsMfaEnrollment = computed(() => this.authService.mfaEnrollmentRequired$());
  protected readonly isApproved = computed(
    () => this.appState.userTier$() >= UserTier.DecisionMaker,
  );
  protected readonly isAdmin = computed(() => this.appState.userIsAdmin$());
  protected readonly currentTier = this.appState.userTier$;
  protected readonly showDevTools = !environment.production;

  @Input() coordinateToolEnabled = false;
  @Output() readonly coordinateToolEnabledChange = new EventEmitter<boolean>();
  @ViewChild('primaryPartnerCarouselViewport')
  private primaryPartnerCarouselViewport?: ElementRef<HTMLElement>;

  constructor() {
    this.syncAppLocaleToTranslate();
    effect(() => {
      if (!this.authService.mfaEnrollmentRequired$()) {
        return;
      }
      untracked(() => this.authModalOpen.set(true));
    });
  }

  ngAfterViewInit(): void {
    requestAnimationFrame(() => this.updatePrimaryPartnerCarouselControls());
  }

  @HostListener('window:resize')
  protected onWindowResize(): void {
    this.updatePrimaryPartnerCarouselControls();
  }

  protected get activeLanguage(): string {
    return this.translate.getCurrentLang();
  }

  protected toggleLanguage(): void {
    const nextLanguage = this.activeLanguage === 'es' ? 'en' : 'es';
    this.translate.use(nextLanguage).subscribe(() => {
      this.appLocaleService.setLocale(nextLanguage as LayerLocale);
    });
  }

  protected scrollPrimaryPartnerLogos(direction: 'previous' | 'next'): void {
    const viewport = this.primaryPartnerCarouselViewport?.nativeElement;
    if (!viewport) {
      return;
    }

    viewport.scrollBy({
      left: (direction === 'next' ? 1 : -1) * viewport.clientWidth * 0.8,
      behavior: 'smooth',
    });
  }

  protected updatePrimaryPartnerCarouselControls(): void {
    const viewport = this.primaryPartnerCarouselViewport?.nativeElement;
    if (!viewport) {
      return;
    }

    this.partnerCarouselCanMovePrevious.set(viewport.scrollLeft > 1);
    this.partnerCarouselCanMoveNext.set(
      viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1,
    );
  }

  private syncAppLocaleToTranslate(): void {
    const currentLang = this.translate.getCurrentLang() || this.translate.getDefaultLang() || 'es';
    this.appLocaleService.setLocale(currentLang === 'es' ? 'es' : 'en');
  }

  openAuthModal(): void {
    this.authModalOpen.set(true);
  }

  protected closeAuthModal(): void {
    this.authModalOpen.set(false);
  }

  protected openAdminPanel(): void {
    this.adminPanelOpen.set(true);
  }

  protected closeAdminPanel(): void {
    this.adminPanelOpen.set(false);
  }

  protected openSirapAccessPanel(): void {
    this.sirapAccessPanelOpen.set(true);
  }

  protected closeSirapAccessPanel(): void {
    this.sirapAccessPanelOpen.set(false);
  }

  protected logout(): void {
    this.authModalOpen.set(false);
    this.adminPanelOpen.set(false);
    this.sirapAccessPanelOpen.set(false);
    void this.authService.logout();
  }
}
