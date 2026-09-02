import { hasSirapGrantOverlap, parseAdminManagedUserRecord } from './admin-access-requests.service';

describe('AdminAccessRequestsService user grants', () => {
  it('parses a direct grant without relying on SIRAP request history', () => {
    const user = parseAdminManagedUserRecord('direct-grant-user', {
      status: 'active',
      email: 'direct@example.com',
      displayName: 'Direct Grant',
      role: 'authorized_viewer',
      tier: 2,
      isAdmin: false,
      allowedSirapIds: ['eje-cafetero'],
    });

    expect(user.allowedSirapIds).toEqual(['eje-cafetero']);
  });

  it('only accepts users whose authoritative grants overlap the regional scope', () => {
    expect(hasSirapGrantOverlap(['orinoquia', 'eje-cafetero'], ['orinoquia'])).toBe(true);
    expect(hasSirapGrantOverlap(['eje-cafetero'], ['orinoquia'])).toBe(false);
  });

  it('preserves an isSuperAdmin-only account as an admin when parsing edits', () => {
    const user = parseAdminManagedUserRecord('super-admin-user', {
      status: 'active',
      email: 'super@example.com',
      role: 'authorized_viewer',
      tier: 2,
      isAdmin: false,
      isSuperAdmin: true,
      allowedSirapIds: [],
      administeredSirapIds: [],
    });

    expect(user.isAdmin).toBe(true);
  });
});
