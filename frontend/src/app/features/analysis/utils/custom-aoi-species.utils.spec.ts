import {
  classifyCustomAoiBiodiversityEstimate,
  getCustomAoiSpeciesLoadingKey,
} from './custom-aoi-species.utils';

describe('custom AOI species utilities', () => {
  it('classifies AOI area at each estimate boundary', () => {
    expect(classifyCustomAoiBiodiversityEstimate(null)).toBe('unknown');
    expect(classifyCustomAoiBiodiversityEstimate(1_000)).toBe('small');
    expect(classifyCustomAoiBiodiversityEstimate(1_001)).toBe('medium');
    expect(classifyCustomAoiBiodiversityEstimate(15_001)).toBe('large');
    expect(classifyCustomAoiBiodiversityEstimate(75_001)).toBe('veryLarge');
  });

  it('resolves stage and area-band translation keys', () => {
    expect(getCustomAoiSpeciesLoadingKey('initial', 'medium')).toBe(
      'analysis.aoi.customMetrics.speciesLoading.initial.medium',
    );
    expect(getCustomAoiSpeciesLoadingKey('delayed', 'small')).toBe(
      'analysis.aoi.customMetrics.speciesLoading.delayed.longerThanExpected',
    );
    expect(getCustomAoiSpeciesLoadingKey('delayed', 'large')).toBe(
      'analysis.aoi.customMetrics.speciesLoading.delayed.largeAoi',
    );
    expect(getCustomAoiSpeciesLoadingKey('extended', 'veryLarge')).toBe(
      'analysis.aoi.customMetrics.speciesLoading.extended',
    );
  });
});
