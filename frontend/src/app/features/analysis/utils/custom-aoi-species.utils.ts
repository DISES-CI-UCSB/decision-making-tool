export type CustomAoiSpeciesLoadingStage = 'initial' | 'delayed' | 'extended';
export type CustomAoiBiodiversityEstimateBand =
  | 'small'
  | 'medium'
  | 'large'
  | 'veryLarge'
  | 'unknown';

const BIODIVERSITY_AREA_BANDS_KM2 = {
  smallMax: 1_000,
  mediumMax: 15_000,
  largeMax: 75_000,
} as const;

export function classifyCustomAoiBiodiversityEstimate(
  areaKm2: number | null,
): CustomAoiBiodiversityEstimateBand {
  if (areaKm2 === null || !Number.isFinite(areaKm2)) {
    return 'unknown';
  }
  if (areaKm2 <= BIODIVERSITY_AREA_BANDS_KM2.smallMax) {
    return 'small';
  }
  if (areaKm2 <= BIODIVERSITY_AREA_BANDS_KM2.mediumMax) {
    return 'medium';
  }
  if (areaKm2 <= BIODIVERSITY_AREA_BANDS_KM2.largeMax) {
    return 'large';
  }
  return 'veryLarge';
}

export function getCustomAoiSpeciesLoadingKey(
  stage: CustomAoiSpeciesLoadingStage,
  estimateBand: CustomAoiBiodiversityEstimateBand,
): string {
  if (stage === 'initial') {
    return `analysis.aoi.customMetrics.speciesLoading.initial.${estimateBand}`;
  }
  if (stage === 'delayed') {
    const delayedBand =
      estimateBand === 'large' || estimateBand === 'veryLarge' ? 'largeAoi' : 'longerThanExpected';
    return `analysis.aoi.customMetrics.speciesLoading.delayed.${delayedBand}`;
  }
  return 'analysis.aoi.customMetrics.speciesLoading.extended';
}
