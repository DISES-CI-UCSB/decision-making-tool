import { UserTier } from '@core/models';
import {
  hasSirapGrantOverlap,
  nextRegionalReadGrant,
  parseAdminManagedUserRecord,
} from './admin-access-requests.service';

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

    expect(user.role).toBe('sirap-user');
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

    expect(user.role).toBe('super-admin');
    expect(user.isAdmin).toBe(true);
    expect(user.tier).toBe(UserTier.Manager);
  });

  it('preserves another SIRAP and syncs role when a regional admin adds or removes access', () => {
    expect(
      nextRegionalReadGrant(['eje-cafetero'], ['orinoquia'], ['orinoquia'], 'sirap-user', []),
    ).toEqual({
      allowedSirapIds: ['eje-cafetero', 'orinoquia'],
      role: 'sirap-user',
    });
    expect(
      nextRegionalReadGrant(
        ['eje-cafetero', 'orinoquia'],
        [],
        ['orinoquia'],
        'sirap-user',
        [],
      ),
    ).toEqual({
      allowedSirapIds: ['eje-cafetero'],
      role: 'sirap-user',
    });
    expect(nextRegionalReadGrant(['orinoquia'], [], ['orinoquia'], 'sirap-user', [])).toEqual({
      allowedSirapIds: [],
      role: 'user',
    });
    expect(nextRegionalReadGrant([], ['eje-cafetero'], ['orinoquia'], 'user', [])).toEqual({
      allowedSirapIds: [],
      role: 'user',
    });
  });
});
