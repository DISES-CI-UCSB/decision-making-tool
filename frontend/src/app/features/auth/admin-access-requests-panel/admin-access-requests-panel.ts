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
import { SIRAP_REGIONS, sirapRegionLabel, type SirapRegionId, UserTier } from '@core/models';
import {
  AdminAccessRequestsService,
  type AccessRequestRecord,
  type AdminManagedUserRecord,
  type UserAccessGrant,
} from '../services/admin-access-requests.service';
import {
  SirapAccessService,
  type CurrentSirapAdministrator,
  type SirapAccessRequestRecord,
} from '../services/sirap-access.service';
import { environment } from '../../../../environments/environment';
import {
  appendDevelopmentFakeDemoData,
  isFakeActiveUser,
  isFakePendingAccount,
  isFakeSirapRequest,
  isFakeSirapRequester,
  shouldAppendFakeDemoData,
} from './admin-access-requests-panel.fake-demo-data';

interface SirapRequestGroup {
  uid: string;
  displayName: string;
  email: string;
  requests: SirapAccessRequestRecord[];
}

interface CurrentSirapAccessGroup {
  user: AdminManagedUserRecord;
  allowedSirapIds: SirapRegionId[];
  administeredSirapIds: SirapRegionId[];
}

@Component({
  selector: 'app-admin-access-requests-panel',
  standalone: true,
  imports: [],
  templateUrl: './admin-access-requests-panel.html',
  styleUrl: './admin-access-requests-panel.scss',
})
export class AdminAccessRequestsPanelComponent implements OnInit {
  private readonly groupPageSize = 5;
  private readonly naturalNameCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  private readonly adminRequests = inject(AdminAccessRequestsService);
  private readonly sirapAccess = inject(SirapAccessService);
  protected readonly UserTier = UserTier;
  protected readonly sirapRegions = SIRAP_REGIONS;

  @Output() readonly closeRequested = new EventEmitter<void>();

  @ViewChild('panelCard', { static: false })
  private readonly panelCardRef?: ElementRef<HTMLElement>;

  protected readonly pendingRequests = signal<AccessRequestRecord[]>([]);
  protected readonly activeUsers = signal<AdminManagedUserRecord[]>([]);
  protected readonly sirapRequests = signal<SirapAccessRequestRecord[]>([]);
  protected readonly administrator = signal<CurrentSirapAdministrator | null>(null);
  protected readonly requestGrants = signal<Record<string, UserAccessGrant>>({});
  private readonly requestGrantBaselines = signal<Record<string, UserAccessGrant>>({});
  protected readonly userGrants = signal<Record<string, UserAccessGrant>>({});
  protected readonly pendingSearchQuery = signal('');
  protected readonly sirapSearchQuery = signal('');
  protected readonly currentSirapSearchQuery = signal('');
  protected readonly userSearchQuery = signal('');
  protected readonly expandedRequestUid = signal<string | null>(null);
  protected readonly expandedSirapGroupUid = signal<string | null>(null);
  protected readonly expandedCurrentSirapUid = signal<string | null>(null);
  protected readonly expandedActiveUserUid = signal<string | null>(null);
  protected readonly pendingSectionExpanded = signal(true);
  protected readonly sirapRequestsSectionExpanded = signal(true);
  protected readonly currentSirapSectionExpanded = signal(false);
  protected readonly activeUsersSectionExpanded = signal(false);
  protected readonly pendingPage = signal(1);
  protected readonly sirapPage = signal(1);
  protected readonly currentSirapPage = signal(1);
  protected readonly activeUsersPage = signal(1);
  protected readonly pendingStatusMessage = signal('');
  protected readonly sirapStatusMessage = signal('');
  protected readonly currentSirapStatusMessage = signal('');
  protected readonly activeUsersStatusMessage = signal('');
  protected readonly isLoading = signal(true);
  protected readonly loadingError = signal<string | null>(null);
  protected readonly approvingUid = signal<string | null>(null);
  protected readonly updatingUserUid = signal<string | null>(null);
  protected readonly decidingSirapRequestId = signal<string | null>(null);
  protected readonly filteredPendingRequests = computed(() => {
    const query = this.pendingSearchQuery().trim().toLowerCase();
    const requests = this.pendingRequests();
    if (!query) {
      return requests;
    }
    return requests.filter((request) =>
      this.matchesNameOrEmail(query, request.displayName, request.email),
    );
  });
  protected readonly pendingPageCount = computed(() =>
    Math.max(1, Math.ceil(this.filteredPendingRequests().length / this.groupPageSize)),
  );
  protected readonly pagedPendingRequests = computed(() => {
    const start = (this.pendingPage() - 1) * this.groupPageSize;
    return this.filteredPendingRequests().slice(start, start + this.groupPageSize);
  });
  protected readonly pendingRangeStart = computed(() =>
    this.filteredPendingRequests().length === 0
      ? 0
      : (this.pendingPage() - 1) * this.groupPageSize + 1,
  );
  protected readonly pendingRangeEnd = computed(() =>
    Math.min(this.pendingPage() * this.groupPageSize, this.filteredPendingRequests().length),
  );
  protected readonly pendingDraftCount = computed(
    () => this.pendingRequests().filter((request) => this.hasRequestChanges(request)).length,
  );
  protected readonly filteredSirapRequestGroups = computed(() => {
    const query = this.sirapSearchQuery().trim().toLowerCase();
    const groups = this.sirapRequestGroups();
    if (!query) {
      return groups;
    }
    return groups.filter((group) => this.matchesNameOrEmail(query, group.displayName, group.email));
  });
  protected readonly sirapPageCount = computed(() =>
    Math.max(1, Math.ceil(this.filteredSirapRequestGroups().length / this.groupPageSize)),
  );
  protected readonly pagedSirapRequestGroups = computed(() => {
    const start = (this.sirapPage() - 1) * this.groupPageSize;
    return this.filteredSirapRequestGroups().slice(start, start + this.groupPageSize);
  });
  protected readonly sirapRangeStart = computed(() =>
    this.filteredSirapRequestGroups().length === 0
      ? 0
      : (this.sirapPage() - 1) * this.groupPageSize + 1,
  );
  protected readonly sirapRangeEnd = computed(() =>
    Math.min(this.sirapPage() * this.groupPageSize, this.filteredSirapRequestGroups().length),
  );
  protected readonly filteredCurrentSirapAccessGroups = computed(() => {
    const query = this.currentSirapSearchQuery().trim().toLowerCase();
    const groups = this.currentSirapAccessGroups();
    if (!query) {
      return groups;
    }
    return groups.filter((group) =>
      this.matchesNameOrEmail(query, group.user.displayName, group.user.email),
    );
  });
  protected readonly currentSirapPageCount = computed(() =>
    Math.max(1, Math.ceil(this.filteredCurrentSirapAccessGroups().length / this.groupPageSize)),
  );
  protected readonly pagedCurrentSirapAccessGroups = computed(() => {
    const start = (this.currentSirapPage() - 1) * this.groupPageSize;
    return this.filteredCurrentSirapAccessGroups().slice(start, start + this.groupPageSize);
  });
  protected readonly currentSirapRangeStart = computed(() =>
    this.filteredCurrentSirapAccessGroups().length === 0
      ? 0
      : (this.currentSirapPage() - 1) * this.groupPageSize + 1,
  );
  protected readonly currentSirapRangeEnd = computed(() =>
    Math.min(
      this.currentSirapPage() * this.groupPageSize,
      this.filteredCurrentSirapAccessGroups().length,
    ),
  );
  protected readonly activeUsersPageCount = computed(() =>
    Math.max(1, Math.ceil(this.filteredUsers().length / this.groupPageSize)),
  );
  protected readonly pagedFilteredUsers = computed(() => {
    const start = (this.activeUsersPage() - 1) * this.groupPageSize;
    return this.filteredUsers().slice(start, start + this.groupPageSize);
  });
  protected readonly activeUsersRangeStart = computed(() =>
    this.filteredUsers().length === 0 ? 0 : (this.activeUsersPage() - 1) * this.groupPageSize + 1,
  );
  protected readonly activeUsersRangeEnd = computed(() =>
    Math.min(this.activeUsersPage() * this.groupPageSize, this.filteredUsers().length),
  );
  protected readonly activeUsersDraftCount = computed(
    () => this.activeUsers().filter((user) => this.hasUserChanges(user)).length,
  );
  protected readonly sirapRequestGroups = computed<SirapRequestGroup[]>(() =>
    this.groupSirapRequests(
      'pending',
      new Set(this.pendingRequests().map((request) => request.uid)),
    ),
  );
  protected readonly currentSirapAccessGroups = computed<CurrentSirapAccessGroup[]>(() =>
    this.activeUsers()
      .map((user) => ({
        user,
        allowedSirapIds: this.visibleSirapIds(user.allowedSirapIds),
        administeredSirapIds: this.visibleSirapIds(user.administeredSirapIds),
      }))
      .filter((group) => group.allowedSirapIds.length > 0),
  );
  protected readonly isSuperAdmin = computed(() => this.administrator()?.isSuperAdmin === true);
  protected readonly filteredUsers = computed(() => {
    const query = this.userSearchQuery().trim().toLowerCase();
    const users = this.activeUsers();
    if (!query) {
      return users;
    }
    return users.filter(
      (user) =>
        this.matchesNameOrEmail(query, user.displayName, user.email) ||
        [user.role, `${user.tier}`, user.uid].join(' ').toLowerCase().includes(query),
    );
  });

  async ngOnInit(): Promise<void> {
    await this.loadRequests();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (!this.hasPendingWrite() && this.confirmDraftDiscard('close this panel')) {
      this.closeRequested.emit();
    }
  }

  protected onScrimClick(event: MouseEvent): void {
    const card = this.panelCardRef?.nativeElement;
    if (card && event.target instanceof Node && card.contains(event.target)) {
      return;
    }
    if (!this.hasPendingWrite() && this.confirmDraftDiscard('close this panel')) {
      this.closeRequested.emit();
    }
  }

  protected requestClose(): void {
    if (!this.hasPendingWrite() && this.confirmDraftDiscard('close this panel')) {
      this.closeRequested.emit();
    }
  }

  protected async refreshRequests(): Promise<void> {
    if (
      this.hasPendingWrite() ||
      !this.confirmDraftDiscard('refresh and discard your pending-account changes')
    ) {
      return;
    }
    await this.loadRequests();
  }

  protected togglePendingSection(): void {
    this.pendingSectionExpanded.update((expanded) => !expanded);
  }

  protected toggleSirapRequestsSection(): void {
    this.sirapRequestsSectionExpanded.update((expanded) => !expanded);
  }

  protected toggleCurrentSirapSection(): void {
    this.currentSirapSectionExpanded.update((expanded) => !expanded);
  }

  protected toggleActiveUsersSection(): void {
    this.activeUsersSectionExpanded.update((expanded) => !expanded);
  }

  protected toggleRequest(request: AccessRequestRecord): void {
    this.expandedRequestUid.update((uid) => (uid === request.uid ? null : request.uid));
  }

  protected toggleSirapGroup(group: SirapRequestGroup): void {
    this.expandedSirapGroupUid.update((uid) => (uid === group.uid ? null : group.uid));
  }

  protected toggleCurrentSirapGroup(group: CurrentSirapAccessGroup): void {
    this.expandedCurrentSirapUid.update((uid) => (uid === group.user.uid ? null : group.user.uid));
  }

  protected toggleActiveUser(user: AdminManagedUserRecord): void {
    this.expandedActiveUserUid.update((uid) => (uid === user.uid ? null : user.uid));
  }

  protected onRequestHeaderKeydown(event: KeyboardEvent, request: AccessRequestRecord): void {
    this.onAccordionHeaderKeydown(
      event,
      this.pagedPendingRequests(),
      request.uid,
      (item) => item.uid,
      (uid) => this.focusRequestHeader(uid),
    );
  }

  protected onSirapGroupHeaderKeydown(event: KeyboardEvent, group: SirapRequestGroup): void {
    this.onAccordionHeaderKeydown(
      event,
      this.pagedSirapRequestGroups(),
      group.uid,
      (item) => item.uid,
      (uid) => this.focusSirapGroupHeader(uid),
    );
  }

  protected onCurrentSirapHeaderKeydown(
    event: KeyboardEvent,
    group: CurrentSirapAccessGroup,
  ): void {
    this.onAccordionHeaderKeydown(
      event,
      this.pagedCurrentSirapAccessGroups(),
      group.user.uid,
      (item) => item.user.uid,
      (uid) => this.focusCurrentSirapHeader(uid),
    );
  }

  protected onActiveUserHeaderKeydown(event: KeyboardEvent, user: AdminManagedUserRecord): void {
    this.onAccordionHeaderKeydown(
      event,
      this.pagedFilteredUsers(),
      user.uid,
      (item) => item.uid,
      (uid) => this.focusActiveUserHeader(uid),
    );
  }

  protected goToPendingPage(page: number): void {
    const nextPage = Math.min(Math.max(page, 1), this.pendingPageCount());
    if (nextPage === this.pendingPage()) {
      return;
    }
    this.pendingPage.set(nextPage);
    this.expandedRequestUid.set(null);
    this.pendingStatusMessage.set(
      `Showing pending account page ${nextPage} of ${this.pendingPageCount()}.`,
    );
  }

  protected goToSirapPage(page: number): void {
    const nextPage = Math.min(Math.max(page, 1), this.sirapPageCount());
    if (nextPage === this.sirapPage()) {
      return;
    }
    this.sirapPage.set(nextPage);
    this.expandedSirapGroupUid.set(null);
    this.sirapStatusMessage.set(
      `Showing pending SIRAP request page ${nextPage} of ${this.sirapPageCount()}.`,
    );
  }

  protected goToCurrentSirapPage(page: number): void {
    const nextPage = Math.min(Math.max(page, 1), this.currentSirapPageCount());
    if (nextPage === this.currentSirapPage()) {
      return;
    }
    this.currentSirapPage.set(nextPage);
    this.expandedCurrentSirapUid.set(null);
    this.currentSirapStatusMessage.set(
      `Showing current SIRAP access page ${nextPage} of ${this.currentSirapPageCount()}.`,
    );
  }

  protected goToActiveUsersPage(page: number): void {
    const nextPage = Math.min(Math.max(page, 1), this.activeUsersPageCount());
    if (nextPage === this.activeUsersPage()) {
      return;
    }
    this.activeUsersPage.set(nextPage);
    this.expandedActiveUserUid.set(null);
    this.activeUsersStatusMessage.set(
      `Showing active users page ${nextPage} of ${this.activeUsersPageCount()}.`,
    );
  }

  protected onRequestTierChange(request: AccessRequestRecord, event: Event): void {
    this.updateRequestGrant(request.uid, {
      tier: this.readTierFromSelect(event),
    });
  }

  protected onRequestAdminChange(request: AccessRequestRecord, event: Event): void {
    this.updateRequestGrant(request.uid, {
      isAdmin: this.readChecked(event),
    });
  }

  protected toggleRequestAdministeredSirap(
    request: AccessRequestRecord,
    sirapId: SirapRegionId,
  ): void {
    const grant = this.requestGrantFor(request);
    this.updateRequestGrant(request.uid, {
      administeredSirapIds: this.toggleSirapId(grant.administeredSirapIds, sirapId),
    });
  }

  protected toggleRequestAllowedSirap(request: AccessRequestRecord, sirapId: SirapRegionId): void {
    const grant = this.requestGrantFor(request);
    this.updateRequestGrant(request.uid, {
      allowedSirapIds: this.toggleSirapId(grant.allowedSirapIds, sirapId),
    });
  }

  protected async approveRequest(request: AccessRequestRecord): Promise<void> {
    if (this.approvingUid()) {
      return;
    }

    this.loadingError.set(null);
    this.approvingUid.set(request.uid);
    try {
      if (isFakePendingAccount(request.uid)) {
        this.removeApprovedPendingAccount(request);
        return;
      }

      const accountSirapRequests = this.pendingSirapRequestsFor(request.uid);
      await this.adminRequests.approveRequest(
        request,
        this.requestGrantFor(request),
        accountSirapRequests,
      );
      this.removeApprovedPendingAccount(request);
      await this.loadUsers();
    } catch (error) {
      this.loadingError.set(this.toErrorMessage(error));
    } finally {
      this.approvingUid.set(null);
    }
  }

  protected onPendingSearchChange(event: Event): void {
    this.pendingSearchQuery.set((event.target as HTMLInputElement).value);
    this.pendingPage.set(1);
    this.expandedRequestUid.set(null);
    this.pendingStatusMessage.set('Pending account search updated. Showing page 1.');
  }

  protected onSirapSearchChange(event: Event): void {
    this.sirapSearchQuery.set((event.target as HTMLInputElement).value);
    this.sirapPage.set(1);
    this.expandedSirapGroupUid.set(null);
    this.sirapStatusMessage.set('Pending SIRAP search updated. Showing page 1.');
  }

  protected onCurrentSirapSearchChange(event: Event): void {
    this.currentSirapSearchQuery.set((event.target as HTMLInputElement).value);
    this.currentSirapPage.set(1);
    this.expandedCurrentSirapUid.set(null);
    this.currentSirapStatusMessage.set('Current SIRAP access search updated. Showing page 1.');
  }

  protected onUserSearchChange(event: Event): void {
    this.userSearchQuery.set((event.target as HTMLInputElement).value);
    this.activeUsersPage.set(1);
    this.expandedActiveUserUid.set(null);
    this.activeUsersStatusMessage.set('Active user search updated. Showing page 1.');
  }

  protected onUserTierChange(user: AdminManagedUserRecord, event: Event): void {
    this.updateUserGrant(user.uid, {
      tier: this.readTierFromSelect(event),
    });
  }

  protected onUserAdminChange(user: AdminManagedUserRecord, event: Event): void {
    this.updateUserGrant(user.uid, {
      isAdmin: this.readChecked(event),
    });
  }

  protected toggleUserAdministeredSirap(
    user: AdminManagedUserRecord,
    sirapId: SirapRegionId,
  ): void {
    const grant = this.userGrantFor(user);
    this.updateUserGrant(user.uid, {
      administeredSirapIds: this.toggleSirapId(grant.administeredSirapIds, sirapId),
    });
  }

  protected toggleUserAllowedSirap(user: AdminManagedUserRecord, sirapId: SirapRegionId): void {
    const grant = this.userGrantFor(user);
    this.updateUserGrant(user.uid, {
      allowedSirapIds: this.toggleSirapId(grant.allowedSirapIds, sirapId),
    });
  }

  protected async decideSirapRequest(
    request: SirapAccessRequestRecord,
    decision: 'approved' | 'denied',
  ): Promise<void> {
    if (this.decidingSirapRequestId()) {
      return;
    }
    this.loadingError.set(null);
    this.decidingSirapRequestId.set(request.id);
    try {
      if (isFakeSirapRequest(request)) {
        this.applyLocalSirapDecision(request, decision);
        return;
      }

      await this.sirapAccess.decideRequest(request, decision);
      this.applyLocalSirapDecision(request, decision);
      if (this.isSuperAdmin()) {
        await this.loadUsers();
      }
    } catch (error) {
      this.loadingError.set(this.toErrorMessage(error));
    } finally {
      this.decidingSirapRequestId.set(null);
    }
  }

  protected async revokeCurrentAccess(
    user: AdminManagedUserRecord,
    sirapId: SirapRegionId,
  ): Promise<void> {
    const writeId = `${user.uid}:${sirapId}`;
    if (this.decidingSirapRequestId()) {
      return;
    }
    this.loadingError.set(null);
    this.decidingSirapRequestId.set(writeId);
    try {
      if (!isFakeActiveUser(user.uid)) {
        await this.sirapAccess.revokeUserAccess(user.uid, sirapId);
      }
      this.applyLocalSirapRevoke(user.uid, sirapId);
    } catch (error) {
      this.loadingError.set(this.toErrorMessage(error));
    } finally {
      this.decidingSirapRequestId.set(null);
    }
  }

  protected async saveUserAccess(user: AdminManagedUserRecord): Promise<void> {
    if (this.updatingUserUid()) {
      return;
    }

    this.loadingError.set(null);
    this.updatingUserUid.set(user.uid);
    try {
      const grant = this.userGrantFor(user);
      if (!isFakeActiveUser(user.uid)) {
        await this.adminRequests.updateUserAccess(user.uid, grant);
      }
      this.activeUsers.update((users) =>
        users.map((candidate) =>
          candidate.uid === user.uid
            ? {
                ...candidate,
                ...grant,
                role: this.roleLabelForTier(grant.tier),
                updatedAt: new Date(),
              }
            : candidate,
        ),
      );
    } catch (error) {
      this.loadingError.set(this.toErrorMessage(error));
    } finally {
      this.updatingUserUid.set(null);
    }
  }

  protected requestGrantFor(request: AccessRequestRecord): UserAccessGrant {
    return this.requestGrants()[request.uid] ?? this.defaultGrant();
  }

  protected hasRequestChanges(request: AccessRequestRecord): boolean {
    const grant = this.requestGrantFor(request);
    const baseline = this.requestGrantBaselines()[request.uid] ?? this.defaultGrant();
    return (
      grant.tier !== baseline.tier ||
      grant.isAdmin !== baseline.isAdmin ||
      !this.sameSirapIds(grant.administeredSirapIds, baseline.administeredSirapIds) ||
      !this.sameSirapIds(grant.allowedSirapIds, baseline.allowedSirapIds)
    );
  }

  protected resetRequestChanges(request: AccessRequestRecord): void {
    const baseline = this.requestGrantBaselines()[request.uid];
    if (!baseline) {
      return;
    }
    this.requestGrants.update((grants) => ({
      ...grants,
      [request.uid]: this.copyGrant(baseline),
    }));
    this.pendingStatusMessage.set(`Reset changes for ${request.displayName}.`);
  }

  protected userGrantFor(user: AdminManagedUserRecord): UserAccessGrant {
    return (
      this.userGrants()[user.uid] ?? {
        tier: user.tier,
        isAdmin: user.isAdmin,
        administeredSirapIds: user.administeredSirapIds,
        allowedSirapIds: user.allowedSirapIds,
      }
    );
  }

  protected hasUserChanges(user: AdminManagedUserRecord): boolean {
    const grant = this.userGrantFor(user);
    return (
      grant.tier !== user.tier ||
      grant.isAdmin !== user.isAdmin ||
      !this.sameSirapIds(grant.administeredSirapIds, user.administeredSirapIds) ||
      !this.sameSirapIds(grant.allowedSirapIds, user.allowedSirapIds)
    );
  }

  protected tierLabel(tier: UserTier): string {
    return tier >= UserTier.Manager ? 'Tier 3 - Publisher / scientist' : 'Tier 2 - Approved user';
  }

  protected adminLabel(isAdmin: boolean): string {
    return isAdmin ? 'Super admin' : 'Not a super admin';
  }

  protected pendingSirapRequestsFor(uid: string): SirapAccessRequestRecord[] {
    return this.sirapRequests().filter(
      (request) => request.uid === uid && request.status === 'pending',
    );
  }

  protected grantSummary(request: AccessRequestRecord): string {
    const grant = this.requestGrantFor(request);
    const dataAccess =
      grant.allowedSirapIds.length === 0
        ? 'No SIRAP data access'
        : `${grant.allowedSirapIds.length} SIRAP data grant${grant.allowedSirapIds.length === 1 ? '' : 's'}`;
    const administratorAccess =
      grant.administeredSirapIds.length === 0
        ? 'no regional administrator permissions'
        : `${grant.administeredSirapIds.length} regional administrator assignment${grant.administeredSirapIds.length === 1 ? '' : 's'}`;
    return `${this.tierLabel(grant.tier)} · ${dataAccess} · ${administratorAccess}`;
  }

  protected sirapLabel(sirapId: SirapRegionId): string {
    return sirapRegionLabel(sirapId);
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

  protected formatSirapRequestedAt(request: SirapAccessRequestRecord): string {
    if (!request.requestedAt) {
      return 'Not recorded';
    }
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(request.requestedAt);
  }

  protected formatOptional(value: string | null): string {
    return value || 'Not provided';
  }

  protected isFakePendingAccount(uid: string): boolean {
    return isFakePendingAccount(uid);
  }

  protected isFakeSirapRequester(uid: string): boolean {
    return isFakeSirapRequester(uid);
  }

  protected isFakeActiveUser(uid: string): boolean {
    return isFakeActiveUser(uid);
  }

  protected oldestSirapRequestDate(group: SirapRequestGroup): string {
    const dates = group.requests
      .map((request) => request.requestedAt)
      .filter((date): date is Date => date instanceof Date);
    if (dates.length === 0) {
      return 'Not recorded';
    }
    const oldest = dates.reduce((earliest, candidate) =>
      candidate.getTime() < earliest.getTime() ? candidate : earliest,
    );
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(oldest);
  }

  protected activeUserGrantSummary(user: AdminManagedUserRecord): string {
    const grant = this.userGrantFor(user);
    const dataAccess =
      grant.allowedSirapIds.length === 0
        ? 'No SIRAP data access'
        : `${grant.allowedSirapIds.length} SIRAP data grant${grant.allowedSirapIds.length === 1 ? '' : 's'}`;
    const administratorAccess =
      grant.administeredSirapIds.length === 0
        ? 'no regional administrator permissions'
        : `${grant.administeredSirapIds.length} regional administrator assignment${grant.administeredSirapIds.length === 1 ? '' : 's'}`;
    return `${this.tierLabel(grant.tier)} · ${this.adminLabel(grant.isAdmin)} · ${dataAccess} · ${administratorAccess}`;
  }

  private async loadRequests(): Promise<void> {
    this.isLoading.set(true);
    this.loadingError.set(null);
    try {
      const [administrator, realPendingRequests, realSirapRequests, realActiveUsers] =
        await Promise.all([
          this.sirapAccess.getCurrentAdministrator(),
          this.adminRequests.listPendingRequests(),
          this.sirapAccess.listRequestsForAdministrator(),
          this.adminRequests.listActiveUsers(),
        ]);
      const { pendingRequests, sirapRequests, activeUsers } = appendDevelopmentFakeDemoData(
        realPendingRequests,
        realSirapRequests,
        realActiveUsers,
        shouldAppendFakeDemoData(environment.production),
      );
      this.administrator.set(administrator);
      this.pendingRequests.set(pendingRequests);
      this.sirapRequests.set(sirapRequests);
      this.setActiveUsers(activeUsers);
      const initialGrants = Object.fromEntries(
        pendingRequests.map((request) => [
          request.uid,
          {
            ...this.defaultGrant(),
            allowedSirapIds: [
              ...new Set(
                sirapRequests
                  .filter(
                    (sirapRequest) =>
                      sirapRequest.uid === request.uid && sirapRequest.status === 'pending',
                  )
                  .map((sirapRequest) => sirapRequest.sirapId),
              ),
            ],
          },
        ]),
      );
      this.requestGrants.set(initialGrants);
      this.requestGrantBaselines.set(
        Object.fromEntries(
          Object.entries(initialGrants).map(([uid, grant]) => [uid, this.copyGrant(grant)]),
        ),
      );
      this.resetSectionPaginationState();
    } catch (error) {
      this.loadingError.set(this.toErrorMessage(error));
      this.pendingRequests.set([]);
      this.sirapRequests.set([]);
      this.activeUsers.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadUsers(): Promise<void> {
    const realActiveUsers = await this.adminRequests.listActiveUsers();
    const { activeUsers } = appendDevelopmentFakeDemoData(
      [],
      [],
      realActiveUsers,
      shouldAppendFakeDemoData(environment.production),
    );
    this.setActiveUsers(activeUsers);
    this.syncActiveUsersPagination();
  }

  private setActiveUsers(users: AdminManagedUserRecord[]): void {
    this.activeUsers.set(users);
    this.userGrants.set(
      Object.fromEntries(
        users.map((user) => [
          user.uid,
          {
            tier: user.tier,
            isAdmin: user.isAdmin,
            administeredSirapIds: user.administeredSirapIds,
            allowedSirapIds: user.allowedSirapIds,
          },
        ]),
      ),
    );
  }

  private resetSectionPaginationState(): void {
    this.pendingSectionExpanded.set(true);
    this.sirapRequestsSectionExpanded.set(true);
    this.currentSirapSectionExpanded.set(false);
    this.activeUsersSectionExpanded.set(false);
    this.pendingSearchQuery.set('');
    this.sirapSearchQuery.set('');
    this.currentSirapSearchQuery.set('');
    this.userSearchQuery.set('');
    this.pendingPage.set(1);
    this.sirapPage.set(1);
    this.currentSirapPage.set(1);
    this.activeUsersPage.set(1);
    this.pendingStatusMessage.set('');
    this.sirapStatusMessage.set('');
    this.currentSirapStatusMessage.set('');
    this.activeUsersStatusMessage.set('');
    this.expandedRequestUid.set(
      this.pendingRequests().length === 1 ? this.pendingRequests()[0].uid : null,
    );
    this.expandedSirapGroupUid.set(
      this.sirapRequestGroups().length === 1 ? this.sirapRequestGroups()[0].uid : null,
    );
    this.expandedCurrentSirapUid.set(
      this.currentSirapAccessGroups().length === 1
        ? this.currentSirapAccessGroups()[0].user.uid
        : null,
    );
    this.expandedActiveUserUid.set(
      this.filteredUsers().length === 1 ? this.filteredUsers()[0].uid : null,
    );
  }

  private syncActiveUsersPagination(): void {
    this.activeUsersPage.set(Math.min(this.activeUsersPage(), this.activeUsersPageCount()));
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Access request review failed.';
  }

  private defaultGrant(): UserAccessGrant {
    return {
      tier: UserTier.DecisionMaker,
      isAdmin: false,
      administeredSirapIds: [],
      allowedSirapIds: [],
    };
  }

  private copyGrant(grant: UserAccessGrant): UserAccessGrant {
    return {
      ...grant,
      administeredSirapIds: [...grant.administeredSirapIds],
      allowedSirapIds: [...grant.allowedSirapIds],
    };
  }

  private updateRequestGrant(uid: string, patch: Partial<UserAccessGrant>): void {
    this.requestGrants.update((grants) => ({
      ...grants,
      [uid]: {
        ...(grants[uid] ?? this.defaultGrant()),
        ...patch,
      },
    }));
  }

  private updateUserGrant(uid: string, patch: Partial<UserAccessGrant>): void {
    this.userGrants.update((grants) => ({
      ...grants,
      [uid]: {
        ...(grants[uid] ?? this.defaultGrant()),
        ...patch,
      },
    }));
  }

  private withoutGrant(
    grants: Record<string, UserAccessGrant>,
    uid: string,
  ): Record<string, UserAccessGrant> {
    const remaining = { ...grants };
    delete remaining[uid];
    return remaining;
  }

  private readTierFromSelect(event: Event): UserAccessGrant['tier'] {
    const value = Number((event.target as HTMLSelectElement).value);
    return value === UserTier.Manager ? UserTier.Manager : UserTier.DecisionMaker;
  }

  private readChecked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  private hasPendingWrite(): boolean {
    return !!this.approvingUid() || !!this.updatingUserUid() || !!this.decidingSirapRequestId();
  }

  private hasDirtyRequestDrafts(): boolean {
    return this.pendingRequests().some((request) => this.hasRequestChanges(request));
  }

  private hasDirtyUserDrafts(): boolean {
    return this.activeUsers().some((user) => this.hasUserChanges(user));
  }

  private confirmDraftDiscard(action: string): boolean {
    const draftSections: string[] = [];
    if (this.hasDirtyRequestDrafts()) {
      draftSections.push('pending-account');
    }
    if (this.hasDirtyUserDrafts()) {
      draftSections.push('active-user');
    }
    if (draftSections.length === 0) {
      return true;
    }
    const label =
      draftSections.length === 2
        ? 'pending-account and active-user changes'
        : `${draftSections[0]} changes`;
    return window.confirm(`You have unsaved ${label}. ${action}?`);
  }

  private applyLocalSirapDecision(
    request: SirapAccessRequestRecord,
    decision: 'approved' | 'denied',
  ): void {
    this.sirapRequests.update((requests) =>
      decision === 'approved'
        ? requests.map((candidate) =>
            candidate.id === request.id ? { ...candidate, status: 'approved' } : candidate,
          )
        : requests.filter((candidate) => candidate.id !== request.id),
    );
  }

  private applyLocalSirapRevoke(uid: string, sirapId: SirapRegionId): void {
    this.activeUsers.update((users) =>
      users.map((candidate) =>
        candidate.uid === uid
          ? {
              ...candidate,
              allowedSirapIds: candidate.allowedSirapIds.filter((id) => id !== sirapId),
            }
          : candidate,
      ),
    );
    this.userGrants.update((grants) => {
      const grant = grants[uid];
      return grant
        ? {
            ...grants,
            [uid]: {
              ...grant,
              allowedSirapIds: grant.allowedSirapIds.filter((id) => id !== sirapId),
            },
          }
        : grants;
    });
    this.sirapRequests.update((requests) =>
      requests.map((request) =>
        request.uid === uid && request.sirapId === sirapId && request.status === 'approved'
          ? { ...request, status: 'denied' }
          : request,
      ),
    );
  }

  private onAccordionHeaderKeydown<T>(
    event: KeyboardEvent,
    items: readonly T[],
    currentUid: string,
    readUid: (item: T) => string,
    focusHeader: (uid: string) => void,
  ): void {
    const currentIndex = items.findIndex((candidate) => readUid(candidate) === currentUid);
    let nextIndex: number | null = null;

    if (event.key === 'ArrowDown') {
      nextIndex = Math.min(currentIndex + 1, items.length - 1);
    } else if (event.key === 'ArrowUp') {
      nextIndex = Math.max(currentIndex - 1, 0);
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = items.length - 1;
    }

    if (nextIndex === null || nextIndex === currentIndex) {
      if (nextIndex !== null) {
        event.preventDefault();
      }
      return;
    }

    event.preventDefault();
    focusHeader(readUid(items[nextIndex]));
  }

  private removeApprovedPendingAccount(request: AccessRequestRecord): void {
    this.pendingRequests.update((requests) =>
      requests.filter((candidate) => candidate.uid !== request.uid),
    );
    const grantedIds = this.requestGrantFor(request).allowedSirapIds;
    this.sirapRequests.update((requests) =>
      requests.map((candidate) =>
        candidate.uid === request.uid &&
        candidate.status === 'pending' &&
        grantedIds.includes(candidate.sirapId)
          ? { ...candidate, status: 'approved' }
          : candidate,
      ),
    );
    this.requestGrants.update((grants) => this.withoutGrant(grants, request.uid));
    this.requestGrantBaselines.update((grants) => this.withoutGrant(grants, request.uid));
    this.adjustPendingPageAfterApproval();
  }

  private adjustPendingPageAfterApproval(): void {
    const page = Math.min(this.pendingPage(), this.pendingPageCount());
    this.pendingPage.set(page);
    const visibleRequests = this.pagedPendingRequests();
    const remainingRequests = this.pendingRequests();
    const nextRequest = visibleRequests[0] ?? null;
    this.expandedRequestUid.set(remainingRequests.length === 1 ? remainingRequests[0].uid : null);
    this.pendingStatusMessage.set('Account approved and removed from the pending queue.');

    if (nextRequest) {
      window.setTimeout(() => this.focusRequestHeader(nextRequest.uid));
    } else if (remainingRequests.length === 0) {
      window.setTimeout(() => this.focusElementById('admin-access-panel-refresh-button'));
    }
  }

  private focusRequestHeader(uid: string): void {
    this.focusElementById(`admin-access-panel-request-toggle-${uid}`);
  }

  private focusSirapGroupHeader(uid: string): void {
    this.focusElementById(`admin-access-panel-sirap-user-toggle-${uid}`);
  }

  private focusCurrentSirapHeader(uid: string): void {
    this.focusElementById(`admin-access-panel-current-sirap-toggle-${uid}`);
  }

  private focusActiveUserHeader(uid: string): void {
    this.focusElementById(`admin-access-panel-user-toggle-${uid}`);
  }

  private focusElementById(id: string): void {
    document.getElementById(id)?.focus();
  }

  private roleLabelForTier(tier: UserAccessGrant['tier']): string {
    return tier >= UserTier.Manager ? 'science_publisher' : 'authorized_viewer';
  }

  private toggleSirapId(ids: readonly SirapRegionId[], sirapId: SirapRegionId): SirapRegionId[] {
    return ids.includes(sirapId) ? ids.filter((id) => id !== sirapId) : [...ids, sirapId];
  }

  private sameSirapIds(a: readonly SirapRegionId[], b: readonly SirapRegionId[]): boolean {
    return a.length === b.length && a.every((id) => b.includes(id));
  }

  private visibleSirapIds(ids: readonly SirapRegionId[]): SirapRegionId[] {
    const administrator = this.administrator();
    if (!administrator || administrator.isSuperAdmin) {
      return [...ids];
    }
    return ids.filter((id) => administrator.administeredSirapIds.includes(id));
  }

  private matchesNameOrEmail(normalizedQuery: string, displayName: string, email: string): boolean {
    if (!normalizedQuery) {
      return true;
    }
    return (
      displayName.toLowerCase().includes(normalizedQuery) ||
      email.toLowerCase().includes(normalizedQuery)
    );
  }

  private groupSirapRequests(
    status: SirapAccessRequestRecord['status'],
    excludedUids = new Set<string>(),
  ): SirapRequestGroup[] {
    const groups = new Map<string, SirapRequestGroup>();
    for (const request of this.sirapRequests().filter(
      (candidate) => candidate.status === status && !excludedUids.has(candidate.uid),
    )) {
      const group = groups.get(request.uid) ?? {
        uid: request.uid,
        displayName: request.displayName,
        email: request.email,
        requests: [],
      };
      group.requests.push(request);
      groups.set(request.uid, group);
    }
    return [...groups.values()].sort((a, b) => {
      const fakeOrder = Number(isFakeSirapRequester(a.uid)) - Number(isFakeSirapRequester(b.uid));
      return (
        fakeOrder ||
        this.naturalNameCollator.compare(a.displayName || a.email, b.displayName || b.email)
      );
    });
  }
}
