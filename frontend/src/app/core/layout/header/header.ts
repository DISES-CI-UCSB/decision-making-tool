import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { UserTier } from '@core/models';
import { AuthService } from '@core/services/auth.service';
import { AppStateService } from '@core/services/app-state.service';
import { DevToolsPanelComponent } from '@features/map/components/dev-tools-panel/dev-tools-panel';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [TranslatePipe, DevToolsPanelComponent],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class HeaderComponent {
  private readonly translate = inject(TranslateService);
  private readonly authService = inject(AuthService);
  private readonly appState = inject(AppStateService);
  protected readonly authPanelOpen = signal(false);
  protected readonly authMode = signal<'login' | 'register'>('login');
  protected readonly authName = signal('');
  protected readonly authEmail = signal('');
  protected readonly authPassword = signal('');
  protected readonly isAuthenticated = computed(
    () => this.appState.userTier$() >= UserTier.DecisionMaker,
  );
  protected readonly currentTier = this.appState.userTier$;

  @Input() coordinateToolEnabled = false;
  @Output() readonly coordinateToolEnabledChange = new EventEmitter<boolean>();

  protected get activeLanguage(): string {
    return this.translate.getCurrentLang();
  }

  protected toggleLanguage(): void {
    const nextLanguage = this.activeLanguage === 'es' ? 'en' : 'es';
    this.translate.use(nextLanguage).subscribe();
  }

  protected toggleAuthPanel(): void {
    this.authPanelOpen.update((isOpen) => !isOpen);
  }

  protected switchAuthMode(mode: 'login' | 'register'): void {
    this.authMode.set(mode);
  }

  protected updateAuthName(value: string): void {
    this.authName.set(value.trim());
  }

  protected updateAuthEmail(value: string): void {
    this.authEmail.set(value.trim());
  }

  protected updateAuthPassword(value: string): void {
    this.authPassword.set(value);
  }

  protected submitAuth(): void {
    const email = this.authEmail().trim();
    const password = this.authPassword().trim();
    if (!email || !password) {
      return;
    }

    const tokenSeed = `${this.authMode()}-${email}-${Date.now()}`;
    this.authService.login({
      token: tokenSeed,
      tier: UserTier.DecisionMaker,
      provider: 'local',
    });
    this.authPanelOpen.set(false);
    this.authPassword.set('');
    if (this.authMode() === 'register') {
      this.authName.set('');
    }
  }

  protected logout(): void {
    this.authService.logout();
    this.authPanelOpen.set(false);
  }
}
