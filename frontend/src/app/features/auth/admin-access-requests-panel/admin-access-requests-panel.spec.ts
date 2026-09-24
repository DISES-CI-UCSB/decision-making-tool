import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { UserTier } from '@core/models';
import { AdminAccessRequestsService } from '../services/admin-access-requests.service';
import { SirapAccessService } from '../services/sirap-access.service';
import { AdminAccessRequestsPanelComponent } from './admin-access-requests-panel';
import { setForceAppendFakeDemoDataForTests } from './admin-access-requests-panel.fake-demo-data';

describe('AdminAccessRequestsPanelComponent', () => {
  let fixture: ComponentFixture<AdminAccessRequestsPanelComponent>;
  const activeUser = {
    uid: 'user-1',
    email: 'user@example.com',
    displayName: 'User One',
    status: 'active' as const,
    role: 'user',
    tier: UserTier.DecisionMaker,
    isAdmin: false,
    administeredSirapIds: [],
    allowedSirapIds: ['orinoquia'],
    updatedAt: null,
  };
  const adminRequests = {
    listActiveUsers: vi.fn().mockResolvedValue([activeUser]),
    updateUserAccess: vi.fn(),
    updateRegionalUserAccess: vi.fn(),
  };
  const sirapAccess = {
    getCurrentAdministrator: vi.fn().mockResolvedValue({
      uid: 'admin-1',
      isSuperAdmin: true,
      administeredSirapIds: [],
    }),
    listRequestsForAdministrator: vi.fn().mockResolvedValue([]),
    decideRequest: vi.fn(),
    revokeUserAccess: vi.fn(),
  };

  beforeEach(async () => {
    setForceAppendFakeDemoDataForTests(false);
    await TestBed.configureTestingModule({
      imports: [AdminAccessRequestsPanelComponent],
      providers: [
        { provide: AdminAccessRequestsService, useValue: adminRequests },
        { provide: SirapAccessService, useValue: sirapAccess },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminAccessRequestsPanelComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  });

  afterEach(() => setForceAppendFakeDemoDataForTests(null));

  it('shows the three access-management tabs and starts on requests', () => {
    expect(fixture.nativeElement.querySelector('#admin-access-panel-requests-tab')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#admin-access-panel-access-tab')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#admin-access-panel-users-tab')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('#admin-access-panel-sirap-requests-section'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#admin-access-panel-pending-section')).toBeNull();

    fixture.nativeElement.querySelector('#admin-access-panel-access-tab').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#admin-access-panel-pending-section')).toBeNull();

    fixture.nativeElement.querySelector('#admin-access-panel-users-tab').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#admin-access-panel-pending-section')).toBeNull();

    fixture.nativeElement.querySelector('#admin-access-panel-requests-tab').click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('#admin-access-panel-sirap-requests-section'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#admin-access-panel-pending-section')).toBeNull();
  });

  it('switches to the active-user directory', () => {
    fixture.nativeElement.querySelector('#admin-access-panel-users-tab').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#admin-access-panel-users-section')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#admin-access-panel-pending-section')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('User One');
  });

  it('shows only the supported SIRAP access options', () => {
    fixture.nativeElement.querySelector('#admin-access-panel-users-tab').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('#admin-access-panel-user-toggle-user-1').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('SIRAP Orinoquía');
    expect(fixture.nativeElement.textContent).toContain('SIRAP Eje Cafetero');
    expect(fixture.nativeElement.textContent).not.toContain('SIRAP Amazonía');
  });

  it('normalizes the draft role when administered SIRAP access changes', () => {
    fixture.nativeElement.querySelector('#admin-access-panel-users-tab').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('#admin-access-panel-user-toggle-user-1').click();
    fixture.detectChanges();

    fixture.nativeElement
      .querySelector('#admin-access-panel-user-administered-sirap-checkbox-user-1-orinoquia')
      .dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('#admin-access-panel-user-role-select-user-1').value,
    ).toBe('sirap-admin');

    fixture.nativeElement
      .querySelector('#admin-access-panel-user-administered-sirap-checkbox-user-1-orinoquia')
      .dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('#admin-access-panel-user-role-select-user-1').value,
    ).toBe('sirap-user');
  });

  it('saves the recomputed role when data access is toggled', async () => {
    adminRequests.listActiveUsers.mockResolvedValueOnce([
      {
        ...activeUser,
        uid: 'user-plain',
        displayName: 'Plain User',
        role: 'user',
        allowedSirapIds: [],
      },
    ]);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('#admin-access-panel-users-tab').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('#admin-access-panel-user-toggle-user-plain').click();
    fixture.detectChanges();

    fixture.nativeElement
      .querySelector('#admin-access-panel-user-allowed-sirap-checkbox-user-plain-orinoquia')
      .dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('#admin-access-panel-user-role-select-user-plain').value,
    ).toBe('sirap-user');

    fixture.nativeElement.querySelector('#admin-access-panel-user-save-button-user-plain').click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(adminRequests.updateUserAccess).toHaveBeenCalledWith(
      'user-plain',
      expect.objectContaining({ role: 'sirap-user', allowedSirapIds: ['orinoquia'] }),
    );

    fixture.nativeElement
      .querySelector('#admin-access-panel-user-allowed-sirap-checkbox-user-plain-orinoquia')
      .dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('#admin-access-panel-user-role-select-user-plain').value,
    ).toBe('user');
    fixture.nativeElement.querySelector('#admin-access-panel-user-save-button-user-plain').click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(adminRequests.updateUserAccess).toHaveBeenLastCalledWith(
      'user-plain',
      expect.objectContaining({ role: 'user', allowedSirapIds: [] }),
    );
  });

  it('shows user role immediately after the last SIRAP grant is revoked', async () => {
    adminRequests.listActiveUsers.mockResolvedValueOnce([
      { ...activeUser, role: 'sirap-user', allowedSirapIds: ['orinoquia'] },
    ]);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('#admin-access-panel-access-tab').click();
    fixture.detectChanges();
    fixture.nativeElement
      .querySelector('#admin-access-panel-current-sirap-revoke-user-1-orinoquia')
      .click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('#admin-access-panel-users-tab').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('#admin-access-panel-user-toggle-user-1').click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('#admin-access-panel-user-role-select-user-1').value,
    ).toBe('user');
  });

  it('says Google sign-in fills the directory when no users are loaded', async () => {
    adminRequests.listActiveUsers.mockResolvedValueOnce([]);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('#admin-access-panel-users-tab').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#admin-access-panel-users-empty-copy')?.textContent).toContain(
      'as soon as they sign in',
    );
    expect(fixture.nativeElement.textContent).not.toContain('access requests are accepted');
  });

  it('shows a direct SIRAP grant for revocation without request history', async () => {
    sirapAccess.getCurrentAdministrator.mockResolvedValueOnce({
      uid: 'regional-admin-1',
      isSuperAdmin: false,
      administeredSirapIds: ['orinoquia'],
    });
    sirapAccess.listRequestsForAdministrator.mockResolvedValueOnce([]);

    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.nativeElement.querySelector('#admin-access-panel-access-tab').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('User One');
    expect(fixture.nativeElement.textContent).toContain('direct grants');
    expect(
      fixture.nativeElement.querySelector(
        '#admin-access-panel-current-sirap-revoke-user-1-orinoquia',
      ),
    ).not.toBeNull();
  });
});
