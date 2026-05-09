import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  OnInit,
  Output,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import {
  AdminAccessRequestsService,
  type AccessRequestRecord,
} from '../services/admin-access-requests.service';

@Component({
  selector: 'app-admin-access-requests-panel',
  standalone: true,
  imports: [],
  templateUrl: './admin-access-requests-panel.html',
  styleUrl: './admin-access-requests-panel.scss',
})
export class AdminAccessRequestsPanelComponent implements OnInit {
  private readonly adminRequests = inject(AdminAccessRequestsService);

  @Output() readonly closeRequested = new EventEmitter<void>();

  @ViewChild('panelCard', { static: false })
  private readonly panelCardRef?: ElementRef<HTMLElement>;

  protected readonly pendingRequests = signal<AccessRequestRecord[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly loadingError = signal<string | null>(null);
  protected readonly approvingUid = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.loadRequests();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (!this.approvingUid()) {
      this.closeRequested.emit();
    }
  }

  protected onScrimClick(event: MouseEvent): void {
    const card = this.panelCardRef?.nativeElement;
    if (card && event.target instanceof Node && card.contains(event.target)) {
      return;
    }
    if (!this.approvingUid()) {
      this.closeRequested.emit();
    }
  }

  protected requestClose(): void {
    if (!this.approvingUid()) {
      this.closeRequested.emit();
    }
  }

  protected async refreshRequests(): Promise<void> {
    await this.loadRequests();
  }

  protected async approveRequest(request: AccessRequestRecord): Promise<void> {
    if (this.approvingUid()) {
      return;
    }

    this.loadingError.set(null);
    this.approvingUid.set(request.uid);
    try {
      await this.adminRequests.approveRequest(request);
      this.pendingRequests.update((requests) =>
        requests.filter((candidate) => candidate.uid !== request.uid),
      );
    } catch (error) {
      this.loadingError.set(this.toErrorMessage(error));
    } finally {
      this.approvingUid.set(null);
    }
  }

  protected formatRequestedAt(request: AccessRequestRecord): string {
    const date =
      request.requestedAt ?? (request.submittedAt ? new Date(request.submittedAt) : null);
    if (!date) {
      return 'Not recorded';
    }
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  protected formatOptional(value: string | null): string {
    return value || 'Not provided';
  }

  private async loadRequests(): Promise<void> {
    this.isLoading.set(true);
    this.loadingError.set(null);
    try {
      this.pendingRequests.set(await this.adminRequests.listPendingRequests());
    } catch (error) {
      this.loadingError.set(this.toErrorMessage(error));
      this.pendingRequests.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Access request review failed.';
  }
}
