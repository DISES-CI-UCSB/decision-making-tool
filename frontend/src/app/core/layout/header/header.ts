import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { UserTier } from '@core/models';
import { AuthService } from '@core/services/auth.service';
import { AppStateService } from '@core/services/app-state.service';
import { DevToolsPanelComponent } from '@features/map/components/dev-tools-panel/dev-tools-panel';
import { AuthModalComponent } from '@features/auth/auth-modal/auth-modal';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [TranslatePipe, DevToolsPanelComponent, AuthModalComponent],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class HeaderComponent {
  private readonly translate = inject(TranslateService);
  private readonly authService = inject(AuthService);
  private readonly appState = inject(AppStateService);

  protected readonly authModalOpen = signal(false);
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

  protected openAuthModal(): void {
    this.authModalOpen.set(true);
  }

  protected closeAuthModal(): void {
    this.authModalOpen.set(false);
  }

  protected logout(): void {
    this.authService.logout();
  }
}
