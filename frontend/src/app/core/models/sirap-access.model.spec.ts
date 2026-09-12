import { describe, expect, it } from 'vitest';

import {
  AVAILABLE_SIRAP_REGION_IDS,
  canAccessSirapScopedResource,
  canShowSirapScopedLayer,
  isSirapRegionId,
  readActiveSirapIdFromSolutionMetadata,
  readSirapRegionIds,
  sirapRegionLabel,
  SIRAP_REGION_IDS,
} from './sirap-access.model';

describe('SIRAP region access model', () => {
  it('limits the current product release to Eje Cafetero and Orinoquía', () => {
    expect(AVAILABLE_SIRAP_REGION_IDS).toEqual(['orinoquia', 'eje-cafetero']);
  });

  it('recognizes Eje Cafetero as a supported SIRAP region', () => {
    expect(SIRAP_REGION_IDS).toContain('eje-cafetero');
    expect(isSirapRegionId('eje-cafetero')).toBe(true);
    expect(readSirapRegionIds(['eje-cafetero', 'invalid-region', 'eje-cafetero'])).toEqual([
      'eje-cafetero',
    ]);
    expect(sirapRegionLabel('eje-cafetero')).toBe('SIRAP Eje Cafetero');
  });

  it('keeps national resources public and hides SIRAP layers without a matching grant', () => {
    expect(canAccessSirapScopedResource(null, [])).toBe(true);
    expect(canAccessSirapScopedResource(undefined, [])).toBe(true);
    expect(canAccessSirapScopedResource('orinoquia', [])).toBe(false);
    expect(canAccessSirapScopedResource('orinoquia', ['eje-cafetero'])).toBe(false);
    expect(canAccessSirapScopedResource('orinoquia', ['orinoquia'])).toBe(true);
    expect(canAccessSirapScopedResource('caribe', ['caribe'])).toBe(false);
  });

  it('shows SIRAP layers only when the loaded scenario is on a granted SIRAP', () => {
    const bothGrants = ['orinoquia', 'eje-cafetero'];

    expect(canShowSirapScopedLayer(null, bothGrants, 'orinoquia')).toBe(true);
    expect(canShowSirapScopedLayer('orinoquia', bothGrants, 'orinoquia')).toBe(true);
    expect(canShowSirapScopedLayer('eje-cafetero', bothGrants, 'orinoquia')).toBe(false);
    expect(canShowSirapScopedLayer('orinoquia', bothGrants, null)).toBe(false);
    expect(canShowSirapScopedLayer('orinoquia', bothGrants, undefined)).toBe(false);
    expect(canShowSirapScopedLayer('orinoquia', ['eje-cafetero'], 'orinoquia')).toBe(false);
    expect(canShowSirapScopedLayer('eje-cafetero', ['orinoquia'], 'eje-cafetero')).toBe(false);
  });

  it('reads the active SIRAP from loaded solution metadata', () => {
    expect(readActiveSirapIdFromSolutionMetadata(undefined)).toBeNull();
    expect(readActiveSirapIdFromSolutionMetadata({ scope: 'national', sirapId: null })).toBeNull();
    expect(readActiveSirapIdFromSolutionMetadata({ scope: 'sirap', sirapId: '' })).toBeNull();
    expect(readActiveSirapIdFromSolutionMetadata({ scope: 'sirap', sirapId: 'orinoquia' })).toBe(
      'orinoquia',
    );
    expect(
      readActiveSirapIdFromSolutionMetadata({ scope: 'national', sirapId: 'orinoquia' }),
    ).toBeNull();
  });
});
