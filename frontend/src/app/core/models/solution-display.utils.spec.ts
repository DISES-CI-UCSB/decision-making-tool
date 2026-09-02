import { resolveSolutionDisplayLabel } from './solution-display.utils';

describe('resolveSolutionDisplayLabel', () => {
  it('returns the trimmed custom label when present', () => {
    expect(resolveSolutionDisplayLabel('  My workshop draft  ', 'Active Scenario')).toBe(
      'My workshop draft',
    );
  });

  it('falls back when the custom label is blank', () => {
    expect(resolveSolutionDisplayLabel('   ', 'Active Scenario')).toBe('Active Scenario');
    expect(resolveSolutionDisplayLabel(null, 'Active Scenario')).toBe('Active Scenario');
    expect(resolveSolutionDisplayLabel(undefined, 'Active Scenario')).toBe('Active Scenario');
  });
});
