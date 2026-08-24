import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { UserTier } from '@core/models';
import {
  AdminAccessRequestsService,
  type AccessRequestRecord,
  type AdminManagedUserRecord,
} from '../services/admin-access-requests.service';
import {
  SirapAccessService,
  type SirapAccessRequestRecord,
} from '../services/sirap-access.service';
import { AdminAccessRequestsPanelComponent } from './admin-access-requests-panel';
import {
  FAKE_ACTIVE_USER_UID_PREFIX,
  FAKE_DEMO_RECORD_COUNT,
  FAKE_PENDING_ACCOUNT_COUNT,
  FAKE_PENDING_UID_PREFIX,
  FAKE_SIRAP_REQUESTER_UID_PREFIX,
  setForceAppendFakeDemoDataForTests,
  setForceAppendFakePendingAccountsForTests,
} from './admin-access-requests-panel.fake-demo-data';

const pendingAccount: AccessRequestRecord = {
  uid: 'pending-user',
  email: 'pending@example.com',
  displayName: 'Pending User',
  organization: 'Test organization',
  reason: 'Needs regional data',
  provider: 'google',
  status: 'pending',
  requestedAt: new Date('2026-08-18T12:00:00Z'),
  submittedAt: null,
};

const activeUser: AdminManagedUserRecord = {
  uid: 'legacy-user',
  email: 'legacy@example.com',
  displayName: 'Legacy Direct Grant',
  status: 'active',
  role: 'authorized_viewer',
  tier: UserTier.DecisionMaker,
  isAdmin: false,
  administeredSirapIds: [],
  allowedSirapIds: ['amazonia'],
  updatedAt: null,
};

const sirapRequests: SirapAccessRequestRecord[] = [
  {
    id: 'pending-user_caribe',
    uid: 'pending-user',
    email: 'pending@example.com',
    displayName: 'Pending User',
    sirapId: 'caribe',
    status: 'pending',
    reason: null,
    requestedAt: new Date('2026-08-18T12:00:00Z'),
    decidedAt: null,
    decidedBy: null,
  },
  {
    id: 'active-request_pacifico',
    uid: 'active-request',
    email: 'active@example.com',
    displayName: 'Active Requester',
    sirapId: 'pacifico',
    status: 'pending',
    reason: null,
    requestedAt: new Date('2026-08-18T13:00:00Z'),
    decidedAt: null,
    decidedBy: null,
  },
];

describe('AdminAccessRequestsPanelComponent', () => {
  let adminRequests: {
    listPendingRequests: ReturnType<typeof vi.fn>;
    listActiveUsers: ReturnType<typeof vi.fn>;
    approveRequest: ReturnType<typeof vi.fn>;
    updateUserAccess: ReturnType<typeof vi.fn>;
  };
  let sirapAccess: {
    getCurrentAdministrator: ReturnType<typeof vi.fn>;
    listRequestsForAdministrator: ReturnType<typeof vi.fn>;
    decideRequest: ReturnType<typeof vi.fn>;
    revokeUserAccess: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    setForceAppendFakeDemoDataForTests(false);
    setForceAppendFakePendingAccountsForTests(false);
    adminRequests = {
      listPendingRequests: vi.fn().mockResolvedValue([pendingAccount]),
      listActiveUsers: vi.fn().mockResolvedValue([activeUser]),
      approveRequest: vi.fn().mockResolvedValue(undefined),
      updateUserAccess: vi.fn().mockResolvedValue(undefined),
    };
    sirapAccess = {
      getCurrentAdministrator: vi.fn().mockResolvedValue({
        uid: 'admin-user',
        isSuperAdmin: true,
        administeredSirapIds: [],
      }),
      listRequestsForAdministrator: vi.fn().mockResolvedValue(sirapRequests),
      decideRequest: vi.fn().mockResolvedValue(undefined),
      revokeUserAccess: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [AdminAccessRequestsPanelComponent],
      providers: [
        { provide: AdminAccessRequestsService, useValue: adminRequests },
        { provide: SirapAccessService, useValue: sirapAccess },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    setForceAppendFakeDemoDataForTests(null);
    setForceAppendFakePendingAccountsForTests(null);
  });

  function pendingAccounts(count: number): AccessRequestRecord[] {
    return Array.from({ length: count }, (_, index) => ({
      ...pendingAccount,
      uid: `pending-user-${index + 1}`,
      email: `pending-${index + 1}@example.com`,
      displayName: `Pending User ${index + 1}`,
    }));
  }

  async function createFixture(): Promise<ComponentFixture<AdminAccessRequestsPanelComponent>> {
    const fixture = TestBed.createComponent(AdminAccessRequestsPanelComponent);
    fixture.detectChanges();
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    return fixture;
  }

  async function render(): Promise<HTMLElement> {
    return (await createFixture()).nativeElement as HTMLElement;
  }

  function expandSection(element: HTMLElement, toggleId: string): void {
    const toggle = element.querySelector(`#${toggleId}`) as HTMLButtonElement | null;
    if (toggle?.getAttribute('aria-expanded') === 'false') {
      toggle.click();
    }
  }

  function expandCurrentSirapSection(element: HTMLElement): void {
    expandSection(element, 'admin-access-panel-approved-sirap-section-toggle');
  }

  function expandActiveUsersSection(element: HTMLElement): void {
    expandSection(element, 'admin-access-panel-users-section-toggle');
  }

  function setSearchInput(element: HTMLElement, inputId: string, value: string): void {
    const searchInput = element.querySelector(`#${inputId}`) as HTMLInputElement;
    searchInput.value = value;
    searchInput.dispatchEvent(new Event('input'));
  }

  function expectSearchInSectionHeader(
    element: HTMLElement,
    headerId: string,
    contentId: string,
    inputId: string,
  ): void {
    const header = element.querySelector(`#${headerId}`);
    const content = element.querySelector(`#${contentId}`);
    const searchInput = element.querySelector(`#${inputId}`);

    expect(header).not.toBeNull();
    expect(searchInput).not.toBeNull();
    expect(header?.contains(searchInput)).toBe(true);
    expect(content?.contains(searchInput)).toBe(false);
  }

  it('auto-expands a single pending account', async () => {
    const element = await render();
    const toggle = element.querySelector(
      '#admin-access-panel-request-toggle-pending-user',
    ) as HTMLButtonElement;
    const region = element.querySelector(
      '#admin-access-panel-request-review-pending-user',
    ) as HTMLElement;

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(region.hidden).toBe(false);
    expect(toggle.getAttribute('aria-controls')).toBe(region.id);
  });

  it('starts multiple accounts collapsed and keeps only one open', async () => {
    adminRequests.listPendingRequests.mockResolvedValue(pendingAccounts(2));
    const fixture = await createFixture();
    const element = fixture.nativeElement as HTMLElement;
    const firstToggle = element.querySelector(
      '#admin-access-panel-request-toggle-pending-user-1',
    ) as HTMLButtonElement;
    const secondToggle = element.querySelector(
      '#admin-access-panel-request-toggle-pending-user-2',
    ) as HTMLButtonElement;

    expect(firstToggle.getAttribute('aria-expanded')).toBe('false');
    expect(secondToggle.getAttribute('aria-expanded')).toBe('false');

    firstToggle.click();
    fixture.detectChanges();
    secondToggle.click();
    fixture.detectChanges();

    expect(firstToggle.getAttribute('aria-expanded')).toBe('false');
    expect(secondToggle.getAttribute('aria-expanded')).toBe('true');
    expect(
      (element.querySelector('#admin-access-panel-request-review-pending-user-1') as HTMLElement)
        .hidden,
    ).toBe(true);
    expect(
      (element.querySelector('#admin-access-panel-request-review-pending-user-2') as HTMLElement)
        .hidden,
    ).toBe(false);
  });

  it('prevents scrolling for account-header navigation keys at boundaries', async () => {
    adminRequests.listPendingRequests.mockResolvedValue(pendingAccounts(2));
    const fixture = await createFixture();
    const firstToggle = (fixture.nativeElement as HTMLElement).querySelector(
      '#admin-access-panel-request-toggle-pending-user-1',
    ) as HTMLButtonElement;
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      bubbles: true,
      cancelable: true,
    });

    firstToggle.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('paginates five accounts at a time and collapses on page changes', async () => {
    adminRequests.listPendingRequests.mockResolvedValue(pendingAccounts(6));
    const fixture = await createFixture();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('[id^="admin-access-panel-request-card-"]')).toHaveLength(5);
    expect(element.querySelector('#admin-access-panel-pending-range')?.textContent).toContain(
      'Showing 1–5 of 6',
    );

    (
      element.querySelector(
        '#admin-access-panel-request-toggle-pending-user-1',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (element.querySelector('#admin-access-panel-pending-next-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(element.querySelectorAll('[id^="admin-access-panel-request-card-"]')).toHaveLength(1);
    expect(element.querySelector('#admin-access-panel-pending-page-status')?.textContent).toContain(
      'Page 2 of 2',
    );
    expect(
      element
        .querySelector('#admin-access-panel-request-toggle-pending-user-6')
        ?.getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('retains drafts across pages and shows a Draft badge', async () => {
    adminRequests.listPendingRequests.mockResolvedValue(pendingAccounts(6));
    const fixture = await createFixture();
    const element = fixture.nativeElement as HTMLElement;
    (
      element.querySelector(
        '#admin-access-panel-request-toggle-pending-user-1',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const checkbox = element.querySelector(
      '#admin-access-panel-request-allowed-sirap-checkbox-pending-user-1-amazonia',
    ) as HTMLInputElement;
    checkbox.click();
    fixture.detectChanges();

    expect(
      element.querySelector('#admin-access-panel-request-draft-pending-user-1'),
    ).not.toBeNull();

    (element.querySelector('#admin-access-panel-pending-next-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (
      element.querySelector('#admin-access-panel-pending-previous-button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(
      element.querySelector('#admin-access-panel-request-draft-pending-user-1'),
    ).not.toBeNull();
    (
      element.querySelector(
        '#admin-access-panel-request-toggle-pending-user-1',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(
      (
        element.querySelector(
          '#admin-access-panel-request-allowed-sirap-checkbox-pending-user-1-amazonia',
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it('resets a dirty pending-account draft', async () => {
    const fixture = await createFixture();
    const element = fixture.nativeElement as HTMLElement;
    const checkbox = element.querySelector(
      '#admin-access-panel-request-allowed-sirap-checkbox-pending-user-amazonia',
    ) as HTMLInputElement;
    checkbox.click();
    fixture.detectChanges();

    (
      element.querySelector('#admin-access-panel-reset-button-pending-user') as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(checkbox.checked).toBe(false);
    expect(element.querySelector('#admin-access-panel-request-draft-pending-user')).toBeNull();
  });

  it('keeps a dirty draft when close is cancelled and emits close when accepted', async () => {
    const fixture = await createFixture();
    const element = fixture.nativeElement as HTMLElement;
    const closeEmitted = vi.fn();
    fixture.componentInstance.closeRequested.subscribe(closeEmitted);
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    (
      element.querySelector(
        '#admin-access-panel-request-allowed-sirap-checkbox-pending-user-amazonia',
      ) as HTMLInputElement
    ).click();
    fixture.detectChanges();

    (element.querySelector('#admin-access-panel-close-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(confirm).toHaveBeenCalledOnce();
    expect(closeEmitted).not.toHaveBeenCalled();
    expect(element.querySelector('#admin-access-panel-request-draft-pending-user')).not.toBeNull();

    (element.querySelector('#admin-access-panel-close-button') as HTMLButtonElement).click();

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(closeEmitted).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });

  it('keeps a dirty draft when refresh is cancelled and discards it when accepted', async () => {
    const fixture = await createFixture();
    const element = fixture.nativeElement as HTMLElement;
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    (
      element.querySelector(
        '#admin-access-panel-request-allowed-sirap-checkbox-pending-user-amazonia',
      ) as HTMLInputElement
    ).click();
    fixture.detectChanges();
    adminRequests.listPendingRequests.mockClear();

    (element.querySelector('#admin-access-panel-refresh-button') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(adminRequests.listPendingRequests).not.toHaveBeenCalled();
    expect(element.querySelector('#admin-access-panel-request-draft-pending-user')).not.toBeNull();

    (element.querySelector('#admin-access-panel-refresh-button') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(adminRequests.listPendingRequests).toHaveBeenCalledOnce();
    expect(element.querySelector('#admin-access-panel-request-draft-pending-user')).toBeNull();
    expect(
      (
        element.querySelector(
          '#admin-access-panel-request-allowed-sirap-checkbox-pending-user-amazonia',
        ) as HTMLInputElement
      ).checked,
    ).toBe(false);
    confirm.mockRestore();
  });

  it('protects dirty drafts from Escape and scrim dismissal', async () => {
    const fixture = await createFixture();
    const element = fixture.nativeElement as HTMLElement;
    const closeEmitted = vi.fn();
    fixture.componentInstance.closeRequested.subscribe(closeEmitted);
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    (
      element.querySelector(
        '#admin-access-panel-request-allowed-sirap-checkbox-pending-user-amazonia',
      ) as HTMLInputElement
    ).click();
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(closeEmitted).not.toHaveBeenCalled();
    expect(element.querySelector('#admin-access-panel-request-draft-pending-user')).not.toBeNull();

    element
      .querySelector('#admin-access-panel-overlay')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(closeEmitted).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });

  it('returns to the previous valid page after approving its final account', async () => {
    adminRequests.listPendingRequests.mockResolvedValue(pendingAccounts(6));
    const fixture = await createFixture();
    const element = fixture.nativeElement as HTMLElement;
    (element.querySelector('#admin-access-panel-pending-next-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (
      element.querySelector(
        '#admin-access-panel-request-toggle-pending-user-6',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    (
      element.querySelector(
        '#admin-access-panel-approve-button-pending-user-6',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.querySelector('#admin-access-panel-pending-pagination')).toBeNull();
    expect(element.querySelector('#admin-access-panel-request-card-pending-user-6')).toBeNull();
    expect(element.querySelector('#admin-access-panel-request-card-pending-user-1')).not.toBeNull();
  });

  it('renders sections in the account-review workflow order', async () => {
    const element = await render();
    const sectionIds = [
      'admin-access-panel-pending-section',
      'admin-access-panel-sirap-requests-section',
      'admin-access-panel-approved-sirap-section',
      'admin-access-panel-users-section',
    ];
    const positions = sectionIds.map((id) => {
      const section = element.querySelector(`#${id}`);
      expect(section).not.toBeNull();
      return [...element.querySelectorAll('section')].indexOf(section as HTMLElement);
    });

    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('separates requested SIRAP evidence from editable grants', async () => {
    const element = await render();
    const evidence = element.querySelector(
      '#admin-access-panel-request-evidence-chip-pending-user_caribe',
    );
    const requestedGrant = element.querySelector(
      '#admin-access-panel-request-allowed-sirap-checkbox-pending-user-caribe',
    ) as HTMLInputElement;
    const unrequestedGrant = element.querySelector(
      '#admin-access-panel-request-allowed-sirap-checkbox-pending-user-amazonia',
    ) as HTMLInputElement;
    const footer = element.querySelector('#admin-access-panel-request-footer-pending-user');
    const approveButton = element.querySelector('#admin-access-panel-approve-button-pending-user');

    expect(evidence?.textContent).toContain('SIRAP Caribe');
    expect(requestedGrant.checked).toBe(true);
    expect(unrequestedGrant.checked).toBe(false);
    expect(footer?.contains(approveButton)).toBe(true);
  });

  it('keeps pending-account SIRAP requests out of the active-account queue', async () => {
    const element = await render();
    const queue = element.querySelector('#admin-access-panel-sirap-request-groups');

    expect(queue?.querySelector('#admin-access-panel-sirap-user-card-pending-user')).toBeNull();
    expect(
      queue?.querySelector('#admin-access-panel-sirap-user-card-active-request'),
    ).not.toBeNull();
  });

  it('renders current access from active user grants without an approved request', async () => {
    const fixture = await createFixture();
    const element = fixture.nativeElement as HTMLElement;
    expandCurrentSirapSection(element);
    fixture.detectChanges();

    expect(
      element.querySelector('#admin-access-panel-current-sirap-user-legacy-user'),
    ).not.toBeNull();
    (
      element.querySelector(
        '#admin-access-panel-current-sirap-toggle-legacy-user',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(
      element.querySelector('#admin-access-panel-current-sirap-region-legacy-user-amazonia')
        ?.textContent,
    ).toContain('SIRAP Amazonía');
  });

  it('revokes a direct grant through the authoritative user-access path', async () => {
    const fixture = TestBed.createComponent(AdminAccessRequestsPanelComponent);
    fixture.detectChanges();
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expandCurrentSirapSection(element);
    fixture.detectChanges();
    (
      element.querySelector(
        '#admin-access-panel-current-sirap-toggle-legacy-user',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const revokeButton = element.querySelector(
      '#admin-access-panel-current-sirap-revoke-legacy-user-amazonia',
    ) as HTMLButtonElement;

    revokeButton.click();
    await fixture.whenStable();

    expect(sirapAccess.revokeUserAccess).toHaveBeenCalledWith('legacy-user', 'amazonia');
  });

  it('limits regional admins to overlapping data grants and assignments', async () => {
    sirapAccess.getCurrentAdministrator.mockResolvedValue({
      uid: 'regional-admin',
      isSuperAdmin: false,
      administeredSirapIds: ['caribe'],
    });
    adminRequests.listPendingRequests.mockResolvedValue([]);
    adminRequests.listActiveUsers.mockResolvedValue([
      {
        ...activeUser,
        administeredSirapIds: ['caribe', 'amazonia'],
        allowedSirapIds: ['caribe', 'amazonia'],
      },
    ]);
    const fixture = await createFixture();
    const element = fixture.nativeElement as HTMLElement;
    expandCurrentSirapSection(element);
    fixture.detectChanges();
    (
      element.querySelector(
        '#admin-access-panel-current-sirap-toggle-legacy-user',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(
      element.querySelector('#admin-access-panel-current-sirap-region-legacy-user-caribe'),
    ).not.toBeNull();
    expect(
      element.querySelector('#admin-access-panel-current-sirap-region-legacy-user-amazonia'),
    ).toBeNull();
    expect(
      element.querySelector('#admin-access-panel-current-sirap-admin-region-legacy-user-caribe'),
    ).not.toBeNull();
    expect(
      element.querySelector('#admin-access-panel-current-sirap-admin-region-legacy-user-amazonia'),
    ).toBeNull();
  });

  describe('development fake pending accounts', () => {
    beforeEach(() => {
      setForceAppendFakeDemoDataForTests(true);
      setForceAppendFakePendingAccountsForTests(true);
    });

    it('appends 100 fake accounts after real pending accounts', async () => {
      const fixture = await createFixture();

      expect(fixture.componentInstance['pendingRequests']()).toHaveLength(
        1 + FAKE_PENDING_ACCOUNT_COUNT,
      );
      expect(fixture.componentInstance['pendingRequests']()[0].uid).toBe('pending-user');
      expect(fixture.componentInstance['pendingRequests']()[1].uid).toBe(
        `${FAKE_PENDING_UID_PREFIX}001`,
      );
    });

    it('includes fake accounts in pagination totals', async () => {
      const element = (await createFixture()).nativeElement as HTMLElement;

      expect(element.querySelector('#admin-access-panel-pending-range')?.textContent).toContain(
        `Showing 1–5 of ${1 + FAKE_PENDING_ACCOUNT_COUNT}`,
      );
      expect(
        element.querySelector('#admin-access-panel-pending-page-status')?.textContent,
      ).toContain(`Page 1 of ${Math.ceil((1 + FAKE_PENDING_ACCOUNT_COUNT) / 5)}`);
    });

    it('marks fake account cards as demo data', async () => {
      const element = (await createFixture()).nativeElement as HTMLElement;

      expect(
        element.querySelector(
          `#admin-access-panel-request-demo-badge-${FAKE_PENDING_UID_PREFIX}001`,
        ),
      ).not.toBeNull();
      expect(
        element.querySelector('#admin-access-panel-request-demo-badge-pending-user'),
      ).toBeNull();
    });

    it('approves fake accounts locally without calling Firebase services', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;
      const fakeUid = `${FAKE_PENDING_UID_PREFIX}001`;

      (
        element.querySelector(`#admin-access-panel-request-toggle-${fakeUid}`) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      (
        element.querySelector(`#admin-access-panel-approve-button-${fakeUid}`) as HTMLButtonElement
      ).click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(adminRequests.approveRequest).not.toHaveBeenCalled();
      expect(element.querySelector(`#admin-access-panel-request-card-${fakeUid}`)).toBeNull();
      expect(fixture.componentInstance['pendingRequests']()).toHaveLength(
        FAKE_PENDING_ACCOUNT_COUNT,
      );
    });
  });

  describe('section disclosure and pagination', () => {
    beforeEach(() => {
      setForceAppendFakeDemoDataForTests(true);
    });

    it('defaults pending and SIRAP sections expanded and collapses the others', async () => {
      const fixture = await createFixture();

      expect(fixture.componentInstance['pendingSectionExpanded']()).toBe(true);
      expect(fixture.componentInstance['sirapRequestsSectionExpanded']()).toBe(true);
      expect(fixture.componentInstance['currentSirapSectionExpanded']()).toBe(false);
      expect(fixture.componentInstance['activeUsersSectionExpanded']()).toBe(false);
    });

    it('toggles section disclosure independently', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;

      (
        element.querySelector('#admin-access-panel-pending-section-toggle') as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      expect(
        element
          .querySelector('#admin-access-panel-pending-section-toggle')
          ?.getAttribute('aria-expanded'),
      ).toBe('false');
      expect(
        element
          .querySelector('#admin-access-panel-sirap-requests-section-toggle')
          ?.getAttribute('aria-expanded'),
      ).toBe('true');
    });

    it('shows collapsed section summaries with counts', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;

      expect(
        element.querySelector('#admin-access-panel-approved-sirap-section-summary')?.textContent,
      ).toContain(`${1 + FAKE_DEMO_RECORD_COUNT} users with current SIRAP access`);
      expect(
        element.querySelector('#admin-access-panel-users-section-summary')?.textContent,
      ).toContain(`${1 + FAKE_DEMO_RECORD_COUNT} active users`);
    });

    it('paginates standalone pending SIRAP groups five at a time', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;

      expect(element.querySelector('#admin-access-panel-sirap-range')?.textContent).toContain(
        `Showing 1–5 of ${1 + FAKE_DEMO_RECORD_COUNT}`,
      );

      (element.querySelector('#admin-access-panel-sirap-next-button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(element.querySelector('#admin-access-panel-sirap-page-status')?.textContent).toContain(
        'Page 2 of',
      );
    });

    it('keeps one open SIRAP group per page and closes it on page change', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;
      const firstUid = `${FAKE_SIRAP_REQUESTER_UID_PREFIX}001`;
      const secondUid = `${FAKE_SIRAP_REQUESTER_UID_PREFIX}002`;

      (
        element.querySelector(
          `#admin-access-panel-sirap-user-toggle-${firstUid}`,
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      (
        element.querySelector(
          `#admin-access-panel-sirap-user-toggle-${secondUid}`,
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      expect(
        element
          .querySelector(`#admin-access-panel-sirap-user-toggle-${firstUid}`)
          ?.getAttribute('aria-expanded'),
      ).toBe('false');
      expect(
        element
          .querySelector(`#admin-access-panel-sirap-user-toggle-${secondUid}`)
          ?.getAttribute('aria-expanded'),
      ).toBe('true');

      (element.querySelector('#admin-access-panel-sirap-next-button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(fixture.componentInstance['expandedSirapGroupUid']()).toBeNull();
    });

    it('filters active users before pagination and resets to page 1', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;
      expandActiveUsersSection(element);
      fixture.detectChanges();
      (element.querySelector('#admin-access-panel-users-next-button') as HTMLButtonElement).click();
      fixture.detectChanges();

      const searchInput = element.querySelector(
        '#admin-access-panel-user-search-input',
      ) as HTMLInputElement;
      searchInput.value = 'Fake Active User 1';
      searchInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(fixture.componentInstance['activeUsersPage']()).toBe(1);
      expect(element.querySelector('#admin-access-panel-users-range')?.textContent).toContain(
        'Showing 1–',
      );
      expect(
        element.querySelector(`#admin-access-panel-user-card-${FAKE_ACTIVE_USER_UID_PREFIX}001`),
      ).not.toBeNull();
    });

    it('retains active-user drafts across pagination with Draft badges', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;
      expandActiveUsersSection(element);
      fixture.detectChanges();
      const fakeUid = `${FAKE_ACTIVE_USER_UID_PREFIX}001`;

      (
        element.querySelector(`#admin-access-panel-user-toggle-${fakeUid}`) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      (
        element.querySelector(
          `#admin-access-panel-user-admin-checkbox-${fakeUid}`,
        ) as HTMLInputElement
      ).click();
      fixture.detectChanges();

      expect(element.querySelector(`#admin-access-panel-user-draft-${fakeUid}`)).not.toBeNull();

      (element.querySelector('#admin-access-panel-users-next-button') as HTMLButtonElement).click();
      fixture.detectChanges();
      (
        element.querySelector('#admin-access-panel-users-previous-button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      expect(element.querySelector(`#admin-access-panel-user-draft-${fakeUid}`)).not.toBeNull();
    });
  });

  describe('development fake demo actions', () => {
    beforeEach(() => {
      setForceAppendFakeDemoDataForTests(true);
    });

    it('approves fake standalone SIRAP requests locally without service calls', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;
      const fakeUid = `${FAKE_SIRAP_REQUESTER_UID_PREFIX}001`;
      const requestId = `${fakeUid}_${fixture.componentInstance['sirapRequests']().find((request) => request.uid === fakeUid)?.sirapId}`;

      (
        element.querySelector(
          `#admin-access-panel-sirap-user-toggle-${fakeUid}`,
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      (
        element.querySelector(
          `#admin-access-panel-sirap-approve-button-${requestId}`,
        ) as HTMLButtonElement
      ).click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(sirapAccess.decideRequest).not.toHaveBeenCalled();
      expect(
        fixture.componentInstance['sirapRequests']().some(
          (request) => request.id === requestId && request.status === 'pending',
        ),
      ).toBe(false);
    });

    it('revokes fake current SIRAP access locally without Firebase calls', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;
      const fakeUid = `${FAKE_ACTIVE_USER_UID_PREFIX}001`;
      const sirapId = fixture.componentInstance['activeUsers']().find(
        (user) => user.uid === fakeUid,
      )?.allowedSirapIds[0];

      expandCurrentSirapSection(element);
      fixture.detectChanges();
      (
        element.querySelector(
          `#admin-access-panel-current-sirap-toggle-${fakeUid}`,
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      (
        element.querySelector(
          `#admin-access-panel-current-sirap-revoke-${fakeUid}-${sirapId}`,
        ) as HTMLButtonElement
      ).click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(sirapAccess.revokeUserAccess).not.toHaveBeenCalled();
      expect(
        fixture.componentInstance['activeUsers']().find((user) => user.uid === fakeUid)
          ?.allowedSirapIds,
      ).not.toContain(sirapId);
    });

    it('saves fake active users locally without Firebase calls', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;
      const fakeUid = `${FAKE_ACTIVE_USER_UID_PREFIX}001`;

      expandActiveUsersSection(element);
      fixture.detectChanges();
      (
        element.querySelector(`#admin-access-panel-user-toggle-${fakeUid}`) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      (
        element.querySelector(
          `#admin-access-panel-user-admin-checkbox-${fakeUid}`,
        ) as HTMLInputElement
      ).click();
      fixture.detectChanges();
      (
        element.querySelector(
          `#admin-access-panel-user-save-button-${fakeUid}`,
        ) as HTMLButtonElement
      ).click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(adminRequests.updateUserAccess).not.toHaveBeenCalled();
      expect(
        fixture.componentInstance['activeUsers']().find((user) => user.uid === fakeUid)?.isAdmin,
      ).toBe(true);
      expect(element.querySelector(`#admin-access-panel-user-draft-${fakeUid}`)).toBeNull();
    });

    it('appends fake active users and standalone SIRAP requesters after real records', async () => {
      const fixture = await createFixture();

      expect(fixture.componentInstance['activeUsers']()[0].uid).toBe('legacy-user');
      expect(fixture.componentInstance['activeUsers']()[1].uid).toBe(
        `${FAKE_ACTIVE_USER_UID_PREFIX}001`,
      );
      expect(fixture.componentInstance['sirapRequestGroups']()[0].uid).toBe('active-request');
      expect(fixture.componentInstance['sirapRequestGroups']()[1].uid).toBe(
        `${FAKE_SIRAP_REQUESTER_UID_PREFIX}001`,
      );
    });
  });

  describe('section disclosure control placement', () => {
    beforeEach(() => {
      setForceAppendFakeDemoDataForTests(true);
    });

    const compactHeaderGrid = 'lg:grid-cols-[minmax(0,1fr)_18rem_2.75rem]';
    const mobileHeaderGrid = 'grid-cols-[minmax(0,1fr)_2.75rem]';

    const disclosureControlCases = [
      {
        layoutId: 'admin-access-panel-pending-section-header-layout',
        toggleId: 'admin-access-panel-pending-section-toggle',
        headingId: 'admin-access-panel-pending-heading-row',
        searchRowId: 'admin-access-panel-pending-search-row',
        expandedLabel: 'Collapse Pending Firebase accounts',
        collapsedLabel: 'Expand Pending Firebase accounts',
        expandByDefault: true,
      },
      {
        layoutId: 'admin-access-panel-sirap-requests-section-header-layout',
        toggleId: 'admin-access-panel-sirap-requests-section-toggle',
        headingId: 'admin-access-panel-sirap-requests-heading',
        searchRowId: 'admin-access-panel-sirap-search-row',
        expandedLabel: 'Collapse Pending SIRAP requests',
        collapsedLabel: 'Expand Pending SIRAP requests',
        expandByDefault: true,
      },
      {
        layoutId: 'admin-access-panel-approved-sirap-section-header-layout',
        toggleId: 'admin-access-panel-approved-sirap-section-toggle',
        headingId: 'admin-access-panel-approved-sirap-heading',
        searchRowId: 'admin-access-panel-current-sirap-search-row',
        expandedLabel: 'Collapse Current SIRAP access',
        collapsedLabel: 'Expand Current SIRAP access',
        expandByDefault: false,
      },
      {
        layoutId: 'admin-access-panel-users-section-header-layout',
        toggleId: 'admin-access-panel-users-section-toggle',
        headingId: 'admin-access-panel-users-heading-copy',
        searchRowId: 'admin-access-panel-users-search-row',
        expandedLabel: 'Collapse Active users management',
        collapsedLabel: 'Expand Active users management',
        expandByDefault: false,
      },
    ] as const;

    function elementClasses(element: Element | null): string {
      if (!element) {
        return '';
      }
      return element.getAttribute('class') ?? '';
    }

    function expectCompactExpandedHeaderGrid(
      element: HTMLElement,
      layoutId: string,
      headingId: string,
      toggleId: string,
      searchRowId: string,
    ): void {
      const layout = element.querySelector(`#${layoutId}`);
      const heading = element.querySelector(`#${headingId}`);
      const toggle = element.querySelector(`#${toggleId}`) as HTMLButtonElement | null;
      const searchRow = element.querySelector(`#${searchRowId}`);

      expect(layout).not.toBeNull();
      expect(elementClasses(layout)).toContain(mobileHeaderGrid);
      expect(elementClasses(layout)).toContain(compactHeaderGrid);
      expect(layout?.contains(heading)).toBe(true);
      expect(layout?.contains(toggle)).toBe(true);
      expect(layout?.contains(searchRow)).toBe(true);
      expect(toggle?.contains(heading)).toBe(false);
      expect(searchRow?.contains(toggle)).toBe(false);
      expect(toggle?.querySelector('svg')).not.toBeNull();
      expect(toggle?.className).toContain('h-11');
      expect(toggle?.className).toContain('w-11');
      expect(elementClasses(heading)).toContain('lg:col-start-1');
      expect(elementClasses(heading)).toContain('lg:row-start-1');
      expect(elementClasses(searchRow)).toContain('lg:col-start-2');
      expect(elementClasses(searchRow)).toContain('lg:row-start-1');
      expect(elementClasses(toggle)).toContain('lg:col-start-3');
      expect(elementClasses(toggle)).toContain('lg:row-start-1');
      expect(elementClasses(searchRow)).toContain('col-span-2');
      expect(elementClasses(searchRow)).toContain('lg:col-span-1');

      const layoutChildren = [...(layout?.children ?? [])];
      expect(layoutChildren.indexOf(heading as Element)).toBeLessThan(
        layoutChildren.indexOf(toggle as Element),
      );
      expect(layoutChildren.indexOf(heading as Element)).toBeLessThan(
        layoutChildren.indexOf(searchRow as Element),
      );
    }

    function expectCompactCollapsedHeaderGrid(
      element: HTMLElement,
      layoutId: string,
      headingId: string,
      toggleId: string,
      searchRowId: string,
    ): void {
      const layout = element.querySelector(`#${layoutId}`);
      const heading = element.querySelector(`#${headingId}`);
      const toggle = element.querySelector(`#${toggleId}`);

      expect(layout).not.toBeNull();
      expect(elementClasses(layout)).toContain(mobileHeaderGrid);
      expect(layout?.contains(heading)).toBe(true);
      expect(layout?.contains(toggle)).toBe(true);
      expect(element.querySelector(`#${searchRowId}`)).toBeNull();
      expect(elementClasses(heading)).toContain('lg:col-start-1');
      expect(elementClasses(toggle)).toContain('lg:col-start-3');
    }

    it.each(disclosureControlCases)(
      'places $headingId, $searchRowId, and $toggleId in one compact lg grid row when expanded',
      async ({ layoutId, toggleId, headingId, searchRowId, expandByDefault }) => {
        const fixture = await createFixture();
        const element = fixture.nativeElement as HTMLElement;

        if (!expandByDefault) {
          expandSection(element, toggleId);
          fixture.detectChanges();
        }

        expectCompactExpandedHeaderGrid(element, layoutId, headingId, toggleId, searchRowId);
      },
    );

    it.each(disclosureControlCases)(
      'keeps collapsed $toggleId headers compact without search',
      async ({ layoutId, toggleId, headingId, searchRowId, expandByDefault }) => {
        const fixture = await createFixture();
        const element = fixture.nativeElement as HTMLElement;

        if (!expandByDefault) {
          expandSection(element, toggleId);
          fixture.detectChanges();
        }

        (element.querySelector(`#${toggleId}`) as HTMLButtonElement).click();
        fixture.detectChanges();

        expectCompactCollapsedHeaderGrid(element, layoutId, headingId, toggleId, searchRowId);
      },
    );

    it.each(disclosureControlCases)(
      'updates $toggleId aria-label when expanded state changes',
      async ({ toggleId, expandedLabel, collapsedLabel, expandByDefault }) => {
        const fixture = await createFixture();
        const element = fixture.nativeElement as HTMLElement;
        const toggle = element.querySelector(`#${toggleId}`) as HTMLButtonElement;

        if (!expandByDefault) {
          expandSection(element, toggleId);
          fixture.detectChanges();
        }

        expect(toggle.getAttribute('aria-label')).toBe(expandedLabel);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');

        toggle.click();
        fixture.detectChanges();

        expect(toggle.getAttribute('aria-label')).toBe(collapsedLabel);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
      },
    );

    it('keeps pending disclosure control in the far-right column when filtering', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;
      const toggle = element.querySelector(
        '#admin-access-panel-pending-section-toggle',
      ) as HTMLButtonElement;

      setSearchInput(element, 'admin-access-panel-pending-search-input', 'Pending User');
      fixture.detectChanges();

      expectCompactExpandedHeaderGrid(
        element,
        'admin-access-panel-pending-section-header-layout',
        'admin-access-panel-pending-heading-row',
        'admin-access-panel-pending-section-toggle',
        'admin-access-panel-pending-search-row',
      );
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });
  });

  describe('section header search placement', () => {
    beforeEach(() => {
      setForceAppendFakeDemoDataForTests(true);
    });

    const headerSearchCases = [
      {
        headerId: 'admin-access-panel-pending-section-header',
        contentId: 'admin-access-panel-pending-section-content',
        inputId: 'admin-access-panel-pending-search-input',
        toggleId: 'admin-access-panel-pending-section-toggle',
        expandByDefault: true,
      },
      {
        headerId: 'admin-access-panel-sirap-requests-section-header',
        contentId: 'admin-access-panel-sirap-requests-section-content',
        inputId: 'admin-access-panel-sirap-search-input',
        toggleId: 'admin-access-panel-sirap-requests-section-toggle',
        expandByDefault: true,
      },
      {
        headerId: 'admin-access-panel-approved-sirap-section-header',
        contentId: 'admin-access-panel-approved-sirap-section-content',
        inputId: 'admin-access-panel-current-sirap-search-input',
        toggleId: 'admin-access-panel-approved-sirap-section-toggle',
        expandByDefault: false,
      },
      {
        headerId: 'admin-access-panel-users-section-header',
        contentId: 'admin-access-panel-users-section-content',
        inputId: 'admin-access-panel-user-search-input',
        toggleId: 'admin-access-panel-users-section-toggle',
        expandByDefault: false,
      },
    ] as const;

    it.each(headerSearchCases)(
      'places $inputId inside its section header when expanded',
      async ({ headerId, contentId, inputId, toggleId, expandByDefault }) => {
        const fixture = await createFixture();
        const element = fixture.nativeElement as HTMLElement;

        if (!expandByDefault) {
          expandSection(element, toggleId);
          fixture.detectChanges();
        }

        expectSearchInSectionHeader(element, headerId, contentId, inputId);
      },
    );

    it.each(headerSearchCases)(
      'hides $inputId when its section is collapsed',
      async ({ inputId, toggleId, expandByDefault }) => {
        const fixture = await createFixture();
        const element = fixture.nativeElement as HTMLElement;

        if (!expandByDefault) {
          expandSection(element, toggleId);
          fixture.detectChanges();
        }

        expect(element.querySelector(`#${inputId}`)).not.toBeNull();

        (element.querySelector(`#${toggleId}`) as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(element.querySelector(`#${inputId}`)).toBeNull();
      },
    );

    it.each(headerSearchCases)(
      'does not collapse its section when typing in $inputId',
      async ({ inputId, toggleId, expandByDefault }) => {
        const fixture = await createFixture();
        const element = fixture.nativeElement as HTMLElement;

        if (!expandByDefault) {
          expandSection(element, toggleId);
          fixture.detectChanges();
        }

        setSearchInput(element, inputId, 'test query');
        fixture.detectChanges();

        expect(element.querySelector(`#${toggleId}`)?.getAttribute('aria-expanded')).toBe('true');
        expect(element.querySelector(`#${inputId}`)).not.toBeNull();
      },
    );

    it('does not collapse pending section when the search input receives focus', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;
      const searchInput = element.querySelector(
        '#admin-access-panel-pending-search-input',
      ) as HTMLInputElement;

      searchInput.focus();
      fixture.detectChanges();

      expect(
        element
          .querySelector('#admin-access-panel-pending-section-toggle')
          ?.getAttribute('aria-expanded'),
      ).toBe('true');
    });
  });

  describe('stable summary row grid alignment', () => {
    const threeColumnSummaryGrid =
      'lg:grid-cols-[minmax(180px,1.2fr)_minmax(110px,0.55fr)_minmax(180px,0.9fr)_220px_2rem]';
    const activeUserSummaryGrid = 'lg:grid-cols-[minmax(220px,1.2fr)_minmax(180px,1fr)_220px_2rem]';
    const compactSummaryGrid = 'grid-cols-[minmax(0,1fr)_auto]';

    beforeEach(() => {
      setForceAppendFakeDemoDataForTests(true);
      setForceAppendFakePendingAccountsForTests(true);
    });

    function elementClasses(element: Element | null): string {
      if (!element) {
        return '';
      }
      return element.getAttribute('class') ?? '';
    }

    function expectStableThreeColumnRow(
      element: HTMLElement,
      toggleSelector: string,
      statusAreaSelector: string,
      chevronSelector: string,
    ): void {
      const toggle = element.querySelector(toggleSelector);
      const statusArea = element.querySelector(statusAreaSelector);
      const chevron = element.querySelector(chevronSelector);

      expect(elementClasses(toggle)).toContain(threeColumnSummaryGrid);
      expect(elementClasses(statusArea)).toContain('lg:col-start-4');
      expect(elementClasses(chevron)).toContain('lg:col-start-5');
    }

    function expectStableActiveUserRow(
      element: HTMLElement,
      toggleSelector: string,
      statusAreaSelector: string,
      chevronSelector: string,
    ): void {
      const toggle = element.querySelector(toggleSelector);
      const statusArea = element.querySelector(statusAreaSelector);
      const chevron = element.querySelector(chevronSelector);

      expect(elementClasses(toggle)).toContain(activeUserSummaryGrid);
      expect(elementClasses(statusArea)).toContain('lg:col-start-3');
      expect(elementClasses(chevron)).toContain('lg:col-start-4');
    }

    it('keeps compact two-column summary rows below lg', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;
      expandCurrentSirapSection(element);
      expandActiveUsersSection(element);
      fixture.detectChanges();

      for (const selector of [
        '#admin-access-panel-request-toggle-pending-user',
        '#admin-access-panel-sirap-user-toggle-active-request',
        '#admin-access-panel-current-sirap-toggle-legacy-user',
        '#admin-access-panel-user-toggle-legacy-user',
      ]) {
        expect(elementClasses(element.querySelector(selector))).toContain(compactSummaryGrid);
      }
    });

    it('uses identical stable grid tracks for real and fake pending account rows', async () => {
      const element = (await createFixture()).nativeElement as HTMLElement;
      const realToggle = element.querySelector('#admin-access-panel-request-toggle-pending-user');
      const fakeToggle = element.querySelector(
        `#admin-access-panel-request-toggle-${FAKE_PENDING_UID_PREFIX}001`,
      );

      expect(elementClasses(realToggle)).toBe(elementClasses(fakeToggle));
      expectStableThreeColumnRow(
        element,
        '#admin-access-panel-request-toggle-pending-user',
        '#admin-access-panel-request-status-area-pending-user',
        '#admin-access-panel-request-chevron-pending-user',
      );
      expectStableThreeColumnRow(
        element,
        `#admin-access-panel-request-toggle-${FAKE_PENDING_UID_PREFIX}001`,
        `#admin-access-panel-request-status-area-${FAKE_PENDING_UID_PREFIX}001`,
        `#admin-access-panel-request-chevron-${FAKE_PENDING_UID_PREFIX}001`,
      );
      expect(
        element.querySelector(
          `#admin-access-panel-request-demo-badge-${FAKE_PENDING_UID_PREFIX}001`,
        ),
      ).not.toBeNull();
      expect(
        element.querySelector('#admin-access-panel-request-demo-badge-pending-user'),
      ).toBeNull();
    });

    it('uses identical stable grid tracks for real and fake pending SIRAP rows', async () => {
      const element = (await createFixture()).nativeElement as HTMLElement;

      expectStableThreeColumnRow(
        element,
        '#admin-access-panel-sirap-user-toggle-active-request',
        '#admin-access-panel-sirap-user-status-area-active-request',
        '#admin-access-panel-sirap-user-chevron-active-request',
      );
      expectStableThreeColumnRow(
        element,
        `#admin-access-panel-sirap-user-toggle-${FAKE_SIRAP_REQUESTER_UID_PREFIX}001`,
        `#admin-access-panel-sirap-user-status-area-${FAKE_SIRAP_REQUESTER_UID_PREFIX}001`,
        `#admin-access-panel-sirap-user-chevron-${FAKE_SIRAP_REQUESTER_UID_PREFIX}001`,
      );
      expect(
        element.querySelector(
          `#admin-access-panel-sirap-user-demo-badge-${FAKE_SIRAP_REQUESTER_UID_PREFIX}001`,
        ),
      ).not.toBeNull();
      expect(
        element.querySelector('#admin-access-panel-sirap-user-demo-badge-active-request'),
      ).toBeNull();
    });

    it('uses identical stable grid tracks for real and fake current SIRAP rows', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;
      expandCurrentSirapSection(element);
      fixture.detectChanges();

      expectStableThreeColumnRow(
        element,
        '#admin-access-panel-current-sirap-toggle-legacy-user',
        '#admin-access-panel-current-sirap-status-area-legacy-user',
        '#admin-access-panel-current-sirap-chevron-legacy-user',
      );
      expectStableThreeColumnRow(
        element,
        `#admin-access-panel-current-sirap-toggle-${FAKE_ACTIVE_USER_UID_PREFIX}001`,
        `#admin-access-panel-current-sirap-status-area-${FAKE_ACTIVE_USER_UID_PREFIX}001`,
        `#admin-access-panel-current-sirap-chevron-${FAKE_ACTIVE_USER_UID_PREFIX}001`,
      );
    });

    it('uses identical stable grid tracks for real and fake active user rows', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;
      expandActiveUsersSection(element);
      fixture.detectChanges();

      expectStableActiveUserRow(
        element,
        '#admin-access-panel-user-toggle-legacy-user',
        '#admin-access-panel-user-status-area-legacy-user',
        '#admin-access-panel-user-chevron-legacy-user',
      );
      expectStableActiveUserRow(
        element,
        `#admin-access-panel-user-toggle-${FAKE_ACTIVE_USER_UID_PREFIX}001`,
        `#admin-access-panel-user-status-area-${FAKE_ACTIVE_USER_UID_PREFIX}001`,
        `#admin-access-panel-user-chevron-${FAKE_ACTIVE_USER_UID_PREFIX}001`,
      );
    });
  });

  describe('section search filters', () => {
    beforeEach(() => {
      setForceAppendFakeDemoDataForTests(true);
    });

    it('matches pending accounts case-insensitively by name or email', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;

      setSearchInput(element, 'admin-access-panel-pending-search-input', 'PENDING USER');
      fixture.detectChanges();

      expect(fixture.componentInstance['filteredPendingRequests']()).toHaveLength(1);
      expect(fixture.componentInstance['filteredPendingRequests']()[0].uid).toBe('pending-user');

      setSearchInput(
        element,
        'admin-access-panel-pending-search-input',
        'FAKE.USER.002@EXAMPLE.TEST',
      );
      fixture.detectChanges();

      expect(fixture.componentInstance['filteredPendingRequests']()).toHaveLength(1);
      expect(fixture.componentInstance['filteredPendingRequests']()[0].uid).toBe(
        `${FAKE_PENDING_UID_PREFIX}002`,
      );
    });

    it('filters pending accounts before pagination and resets page and expansion', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;

      (
        element.querySelector('#admin-access-panel-pending-next-button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      (
        element.querySelector(
          `#admin-access-panel-request-toggle-${FAKE_PENDING_UID_PREFIX}006`,
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      setSearchInput(element, 'admin-access-panel-pending-search-input', 'Pending User');
      fixture.detectChanges();

      expect(fixture.componentInstance['pendingPage']()).toBe(1);
      expect(fixture.componentInstance['expandedRequestUid']()).toBeNull();
      expect(fixture.componentInstance['filteredPendingRequests']()).toHaveLength(1);
      expect(fixture.componentInstance['pendingPageCount']()).toBe(1);
      expect(element.querySelector('#admin-access-panel-pending-pagination')).toBeNull();
    });

    it('shows a pending-account no-results state without hiding underlying totals', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;

      setSearchInput(element, 'admin-access-panel-pending-search-input', 'no-such-account');
      fixture.detectChanges();

      expect(
        element.querySelector('#admin-access-panel-pending-no-results-title')?.textContent,
      ).toContain('No matching pending accounts');
      expect(element.querySelector('#admin-access-panel-pending-section-summary')).toBeNull();
      (
        element.querySelector('#admin-access-panel-pending-section-toggle') as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      expect(
        element.querySelector('#admin-access-panel-pending-section-summary')?.textContent,
      ).toContain(`${1 + FAKE_PENDING_ACCOUNT_COUNT} pending accounts`);
    });

    it('matches pending SIRAP groups case-insensitively by name or email', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;

      setSearchInput(element, 'admin-access-panel-sirap-search-input', 'active requester');
      fixture.detectChanges();

      expect(fixture.componentInstance['filteredSirapRequestGroups']()).toHaveLength(1);
      expect(fixture.componentInstance['filteredSirapRequestGroups']()[0].uid).toBe(
        'active-request',
      );

      setSearchInput(
        element,
        'admin-access-panel-sirap-search-input',
        'FAKE.SIRAP.REQUESTER.003@EXAMPLE.TEST',
      );
      fixture.detectChanges();

      expect(fixture.componentInstance['filteredSirapRequestGroups']()).toHaveLength(1);
      expect(fixture.componentInstance['filteredSirapRequestGroups']()[0].uid).toBe(
        `${FAKE_SIRAP_REQUESTER_UID_PREFIX}003`,
      );
    });

    it('filters pending SIRAP groups before pagination and resets page and expansion', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;

      (element.querySelector('#admin-access-panel-sirap-next-button') as HTMLButtonElement).click();
      fixture.detectChanges();
      (
        element.querySelector(
          `#admin-access-panel-sirap-user-toggle-${FAKE_SIRAP_REQUESTER_UID_PREFIX}006`,
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      setSearchInput(element, 'admin-access-panel-sirap-search-input', 'Active Requester');
      fixture.detectChanges();

      expect(fixture.componentInstance['sirapPage']()).toBe(1);
      expect(fixture.componentInstance['expandedSirapGroupUid']()).toBeNull();
      expect(fixture.componentInstance['filteredSirapRequestGroups']()).toHaveLength(1);
      expect(fixture.componentInstance['sirapPageCount']()).toBe(1);
      expect(element.querySelector('#admin-access-panel-sirap-pagination')).toBeNull();
    });

    it('shows a pending SIRAP no-results state without hiding underlying totals', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;

      setSearchInput(element, 'admin-access-panel-sirap-search-input', 'no-such-requester');
      fixture.detectChanges();

      expect(
        element.querySelector('#admin-access-panel-sirap-requests-no-results-title')?.textContent,
      ).toContain('No matching SIRAP request groups');
      (
        element.querySelector(
          '#admin-access-panel-sirap-requests-section-toggle',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      expect(
        element.querySelector('#admin-access-panel-sirap-requests-section-summary')?.textContent,
      ).toContain(`${1 + FAKE_DEMO_RECORD_COUNT} user groups`);
    });

    it('matches current SIRAP access case-insensitively by name or email', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;
      expandCurrentSirapSection(element);
      fixture.detectChanges();

      setSearchInput(
        element,
        'admin-access-panel-current-sirap-search-input',
        'legacy direct grant',
      );
      fixture.detectChanges();

      expect(fixture.componentInstance['filteredCurrentSirapAccessGroups']()).toHaveLength(1);
      expect(fixture.componentInstance['filteredCurrentSirapAccessGroups']()[0].user.uid).toBe(
        'legacy-user',
      );

      setSearchInput(
        element,
        'admin-access-panel-current-sirap-search-input',
        'FAKE.ACTIVE.USER.004@EXAMPLE.TEST',
      );
      fixture.detectChanges();

      expect(fixture.componentInstance['filteredCurrentSirapAccessGroups']()).toHaveLength(1);
      expect(fixture.componentInstance['filteredCurrentSirapAccessGroups']()[0].user.uid).toBe(
        `${FAKE_ACTIVE_USER_UID_PREFIX}004`,
      );
    });

    it('filters current SIRAP access before pagination and resets page and expansion', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;
      expandCurrentSirapSection(element);
      fixture.detectChanges();
      (
        element.querySelector('#admin-access-panel-current-sirap-next-button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      (
        element.querySelector(
          `#admin-access-panel-current-sirap-toggle-${FAKE_ACTIVE_USER_UID_PREFIX}006`,
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      setSearchInput(
        element,
        'admin-access-panel-current-sirap-search-input',
        'Legacy Direct Grant',
      );
      fixture.detectChanges();

      expect(fixture.componentInstance['currentSirapPage']()).toBe(1);
      expect(fixture.componentInstance['expandedCurrentSirapUid']()).toBeNull();
      expect(fixture.componentInstance['filteredCurrentSirapAccessGroups']()).toHaveLength(1);
      expect(fixture.componentInstance['currentSirapPageCount']()).toBe(1);
      expect(element.querySelector('#admin-access-panel-current-sirap-pagination')).toBeNull();
    });

    it('shows a current SIRAP no-results state without hiding underlying totals', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;
      expandCurrentSirapSection(element);
      fixture.detectChanges();

      setSearchInput(element, 'admin-access-panel-current-sirap-search-input', 'no-such-user');
      fixture.detectChanges();

      expect(
        element.querySelector('#admin-access-panel-current-sirap-no-results-title')?.textContent,
      ).toContain('No matching users with current SIRAP access');
      (
        element.querySelector(
          '#admin-access-panel-approved-sirap-section-toggle',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      expect(
        element.querySelector('#admin-access-panel-approved-sirap-section-summary')?.textContent,
      ).toContain(`${1 + FAKE_DEMO_RECORD_COUNT} users with current SIRAP access`);
    });

    it('matches active users case-insensitively by name or email and still supports role/tier', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;
      expandActiveUsersSection(element);
      fixture.detectChanges();

      setSearchInput(element, 'admin-access-panel-user-search-input', 'LEGACY@EXAMPLE.COM');
      fixture.detectChanges();

      expect(fixture.componentInstance['filteredUsers']()).toHaveLength(1);
      expect(fixture.componentInstance['filteredUsers']()[0].uid).toBe('legacy-user');

      setSearchInput(element, 'admin-access-panel-user-search-input', 'science_publisher');
      fixture.detectChanges();

      expect(
        fixture.componentInstance['filteredUsers']().some((user) =>
          user.uid.startsWith(FAKE_ACTIVE_USER_UID_PREFIX),
        ),
      ).toBe(true);
    });

    it('resets active-user page and expansion when search changes', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;
      expandActiveUsersSection(element);
      fixture.detectChanges();
      (element.querySelector('#admin-access-panel-users-next-button') as HTMLButtonElement).click();
      fixture.detectChanges();
      (
        element.querySelector(
          `#admin-access-panel-user-toggle-${FAKE_ACTIVE_USER_UID_PREFIX}006`,
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      setSearchInput(element, 'admin-access-panel-user-search-input', 'Legacy Direct Grant');
      fixture.detectChanges();

      expect(fixture.componentInstance['activeUsersPage']()).toBe(1);
      expect(fixture.componentInstance['expandedActiveUserUid']()).toBeNull();
      expect(element.querySelector('#admin-access-panel-users-no-results')).toBeNull();
      expect(element.querySelector('#admin-access-panel-user-card-legacy-user')).not.toBeNull();
    });

    it('keeps section search queries independent', async () => {
      const fixture = await createFixture();
      const element = fixture.nativeElement as HTMLElement;
      expandCurrentSirapSection(element);
      expandActiveUsersSection(element);
      fixture.detectChanges();

      setSearchInput(element, 'admin-access-panel-pending-search-input', 'Pending User');
      setSearchInput(element, 'admin-access-panel-sirap-search-input', 'Active Requester');
      setSearchInput(
        element,
        'admin-access-panel-current-sirap-search-input',
        'Legacy Direct Grant',
      );
      setSearchInput(
        element,
        'admin-access-panel-user-search-input',
        'fake.active.user.002@example.test',
      );
      fixture.detectChanges();

      expect(fixture.componentInstance['pendingSearchQuery']()).toBe('Pending User');
      expect(fixture.componentInstance['sirapSearchQuery']()).toBe('Active Requester');
      expect(fixture.componentInstance['currentSirapSearchQuery']()).toBe('Legacy Direct Grant');
      expect(fixture.componentInstance['userSearchQuery']()).toBe(
        'fake.active.user.002@example.test',
      );
      expect(fixture.componentInstance['filteredPendingRequests']()).toHaveLength(1);
      expect(fixture.componentInstance['filteredSirapRequestGroups']()).toHaveLength(1);
      expect(fixture.componentInstance['filteredCurrentSirapAccessGroups']()).toHaveLength(1);
      expect(fixture.componentInstance['filteredUsers']()).toHaveLength(1);
      expect(fixture.componentInstance['filteredUsers']()[0].uid).toBe(
        `${FAKE_ACTIVE_USER_UID_PREFIX}002`,
      );
    });
  });
});
