import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  OnInit,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { SIRAP_REGIONS, type SirapAccessRequestStatus, type SirapRegionId } from '@core/models';
import { AuthService } from '@core/services/auth.service';
import { AppStateService } from '@core/services/app-state.service';
import {
  SirapAccessService,
  type SirapAccessRequestRecord,
} from '../services/sirap-access.service';

@Component({
  selector: 'app-sirap-access-panel',
  standalone: true,
  imports: [],
  templateUrl: './sirap-access-panel.html',
})
export class SirapAccessPanelComponent implements OnInit {
  private readonly appState = inject(AppStateService);
  private readonly authService = inject(AuthService);
  private readonly sirapAccess = inject(SirapAccessService);

  @Output() readonly closeRequested = new EventEmitter<void>();
  @ViewChild('panelCard') private readonly panelCardRef?: ElementRef<HTMLElement>;

  protected readonly regions = SIRAP_REGIONS;
  protected readonly requests = signal<SirapAccessRequestRecord[]>([]);
  protected readonly selectedSirapIds = signal<SirapRegionId[]>([]);
  protected readonly reason = signal('');
  protected readonly isLoading = signal(true);
  protected readonly isSubmitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly canSubmit = computed(
    () => this.selectedSirapIds().length > 0 && !this.isSubmitting(),
  );

  async ngOnInit(): Promise<void> {
    await this.loadRequests();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (!this.isSubmitting()) {
      this.closeRequested.emit();
    }
  }

  protected onScrimClick(event: MouseEvent): void {
    const card = this.panelCardRef?.nativeElement;
    if (
      !this.isSubmitting() &&
      card &&
      event.target instanceof Node &&
      !card.contains(event.target)
    ) {
      this.closeRequested.emit();
    }
  }

  protected requestClose(): void {
    if (!this.isSubmitting()) {
      this.closeRequested.emit();
    }
  }

  protected statusFor(sirapId: SirapRegionId): SirapAccessRequestStatus | 'available' {
    if (this.appState.accessibleSirapIds().includes(sirapId)) {
      return 'approved';
    }
    const requestStatus = this.requests().find((request) => request.sirapId === sirapId)?.status;
    return requestStatus === 'approved' ? 'available' : (requestStatus ?? 'available');
  }

  protected canRequest(sirapId: SirapRegionId): boolean {
    const status = this.statusFor(sirapId);
    return status === 'available' || status === 'denied';
  }

  protected toggleSirap(sirapId: SirapRegionId): void {
    if (!this.canRequest(sirapId)) {
      return;
    }
    this.selectedSirapIds.update((ids) =>
      ids.includes(sirapId) ? ids.filter((id) => id !== sirapId) : [...ids, sirapId],
    );
  }

  protected updateReason(event: Event): void {
    this.reason.set((event.target as HTMLTextAreaElement).value);
  }

  protected async submitRequests(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }
    this.isSubmitting.set(true);
    this.error.set(null);
    this.successMessage.set(null);
    try {
      const selectedCount = this.selectedSirapIds().length;
      await this.sirapAccess.submitOwnRequests(this.selectedSirapIds(), this.reason());
      await this.loadRequests();
      await this.authService.refreshCurrentUserTier();
      this.selectedSirapIds.set([]);
      this.reason.set('');
      this.successMessage.set(
        `${selectedCount} SIRAP access ${selectedCount === 1 ? 'request' : 'requests'} submitted.`,
      );
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not submit SIRAP requests.');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  protected statusLabel(status: SirapAccessRequestStatus | 'available'): string {
    if (status === 'approved') return 'Already approved';
    if (status === 'pending') return 'Pending review';
    if (status === 'denied') return 'Denied · you may request again';
    return 'Available to request';
  }

  private async loadRequests(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      this.requests.set(await this.sirapAccess.listOwnRequests());
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not load SIRAP access.');
    } finally {
      this.isLoading.set(false);
    }
  }
}
