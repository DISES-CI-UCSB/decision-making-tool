import { describe, expect, it } from 'vitest';

import {
  AVAILABLE_SIRAP_REGION_IDS,
  isSirapRegionId,
  readSirapRegionIds,
  sirapRegionLabel,
  SIRAP_REGION_IDS,
} from './sirap-access.model';

describe('SIRAP region access model', () => {
  it('limits the current product release to Eje Cafetero and Orinoquía', () => {
    expect(AVAILABLE_SIRAP_REGION_IDS).toEqual(['eje-cafetero', 'orinoquia']);
  });

  it('recognizes Eje Cafetero as a supported SIRAP region', () => {
    expect(SIRAP_REGION_IDS).toContain('eje-cafetero');
    expect(isSirapRegionId('eje-cafetero')).toBe(true);
    expect(readSirapRegionIds(['eje-cafetero', 'invalid-region', 'eje-cafetero'])).toEqual([
      'eje-cafetero',
    ]);
    expect(sirapRegionLabel('eje-cafetero')).toBe('SIRAP Eje Cafetero');
  });
});
