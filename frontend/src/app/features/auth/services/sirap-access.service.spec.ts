import { repairedAllowedSirapIds, shouldDenyRequestHistoryOnRevoke } from './sirap-access.service';

describe('SirapAccessService revoke history', () => {
  it('does not require a request document to revoke an authoritative user grant', () => {
    expect(shouldDenyRequestHistoryOnRevoke(null)).toBe(false);
  });

  it('marks approved request history denied when a matching document exists', () => {
    expect(shouldDenyRequestHistoryOnRevoke({ status: 'approved' })).toBe(true);
    expect(shouldDenyRequestHistoryOnRevoke({ status: 'pending' })).toBe(false);
  });
});

describe('repairedAllowedSirapIds', () => {
  const legacyIds = [
    'caribe',
    'pacifico',
    'amazonia',
    'andes-occidentales',
    'andes-nororientales',
    'not-a-region',
  ];

  it('approves a current SIRAP and drops retired ids', () => {
    expect(
      repairedAllowedSirapIds([...legacyIds, 'orinoquia'], 'eje-cafetero', 'approved'),
    ).toEqual(['orinoquia', 'eje-cafetero']);
  });

  it('does not duplicate a SIRAP that is already granted', () => {
    expect(repairedAllowedSirapIds(['caribe', 'eje-cafetero'], 'eje-cafetero', 'approved')).toEqual(
      ['eje-cafetero'],
    );
  });

  it('denies a current SIRAP and drops retired ids', () => {
    expect(
      repairedAllowedSirapIds([...legacyIds, 'orinoquia', 'eje-cafetero'], 'orinoquia', 'denied'),
    ).toEqual(['eje-cafetero']);
  });

  it('does not write a retired SIRAP id back onto the user', () => {
    expect(repairedAllowedSirapIds(['caribe', 'pacifico'], 'caribe', 'approved')).toEqual([]);
    expect(repairedAllowedSirapIds('caribe', 'eje-cafetero', 'approved')).toEqual(['eje-cafetero']);
    expect(repairedAllowedSirapIds(null, 'orinoquia', 'denied')).toEqual([]);
  });
});
