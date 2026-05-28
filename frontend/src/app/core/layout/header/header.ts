import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { type LayerLocale, UserTier } from '@core/models';
import { AuthService } from '@core/services/auth.service';
import { AppLocaleService } from '@core/services/app-locale.service';
import { AppStateService } from '@core/services/app-state.service';
import { DevToolsPanelComponent } from '@features/map/components/dev-tools-panel/dev-tools-panel';
import { AuthModalComponent } from '@features/auth/auth-modal/auth-modal';
import { AdminAccessRequestsPanelComponent } from '@features/auth/admin-access-requests-panel/admin-access-requests-panel';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    TranslatePipe,
    DevToolsPanelComponent,
    AuthModalComponent,
    AdminAccessRequestsPanelComponent,
  ],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class HeaderComponent {
  private readonly translate = inject(TranslateService);
  private readonly appLocaleService = inject(AppLocaleService);
  private readonly authService = inject(AuthService);
  private readonly appState = inject(AppStateService);

  protected readonly authModalOpen = signal(false);
  protected readonly adminPanelOpen = signal(false);
  protected readonly isAuthenticated = computed(
    () => this.appState.userTier$() >= UserTier.DecisionMaker,
  );
  protected readonly isAdmin = computed(() => this.appState.userIsAdmin$());
  protected readonly currentTier = this.appState.userTier$;

  @Input() coordinateToolEnabled = false;
  @Output() readonly coordinateToolEnabledChange = new EventEmitter<boolean>();

  constructor() {
    this.syncAppLocaleToTranslate();
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

  private syncAppLocaleToTranslate(): void {
    const currentLang = this.translate.getCurrentLang() || this.translate.getDefaultLang() || 'es';
    this.appLocaleService.setLocale(currentLang === 'es' ? 'es' : 'en');
  }

  protected openAuthModal(): void {
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

  protected logout(): void {
    this.authModalOpen.set(false);
    this.adminPanelOpen.set(false);
    void this.authService.logout();
  }
}
