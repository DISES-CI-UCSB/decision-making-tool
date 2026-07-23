import { buildDummyCoverageRows, calculateOverlapPercent } from './aoi-ecosystems.utils';

describe('AOI ecosystems utilities', () => {
  it('calculates strategic overlap against candidate area and clamps the result', () => {
    expect(calculateOverlapPercent(2, 10)).toBe(20);
    expect(calculateOverlapPercent(15, 10)).toBe(100);
    expect(calculateOverlapPercent(-2, 10)).toBe(0);
  });

  it('returns unavailable strategic overlap when either input is missing or invalid', () => {
    expect(calculateOverlapPercent(null, 10)).toBeNull();
    expect(calculateOverlapPercent(2, null)).toBeNull();
    expect(calculateOverlapPercent(2, 0)).toBeNull();
  });

  it('only builds synthetic MEC coverage through the explicit dummy helper', () => {
    const rows = buildDummyCoverageRows(['Bosque', 'Sabana'], 100);

    expect(rows).toHaveLength(2);
    expect(rows[0].availableKm2).toBeGreaterThan(0);
    expect(rows[0].existingPercent).toBeGreaterThan(0);
    expect(rows[0].additionalPercent).toBeGreaterThan(0);
  });
});
