import type { StrategicEcosystemFeatureId, StrategicEcosystemOutcomesDocument } from '@core/models';

import {
  isStrategicEcosystemOutcomesDocument,
  strategicOutcomeRowsForSolution,
} from './strategic-ecosystem-outcomes.utils';

describe('strategic ecosystem outcomes', () => {
  it('returns the four validated raster-derived rows for an ecosystems-only solution', () => {
    const document = buildDocument();

    const rows = strategicOutcomeRowsForSolution(document, 'eco17_runap_iheh2022');

    expect(rows).toEqual([
      expect.objectContaining({
        featureId: 'paramos',
        coveredAreaKm2: 14543,
        coverageFraction: 14543 / 27401,
        reached17: true,
        reached30: true,
      }),
      expect.objectContaining({
        featureId: 'wetlands',
        coveredAreaKm2: 50912,
        reached17: true,
        reached30: false,
      }),
      expect.objectContaining({
        featureId: 'bosque_seco',
        coveredAreaKm2: 3025,
        reached17: true,
        reached30: false,
      }),
      expect.objectContaining({
        featureId: 'mangroves',
        coveredAreaKm2: 1200,
        reached17: true,
        reached30: true,
      }),
    ]);
  });

  it('fails closed when a denominator or derived fraction does not match', () => {
    const mismatchedDenominator = buildDocument();
    mismatchedDenominator.features.paramos.totalAlignedFeatureValue1AreaKm2 = 27000;
    const mismatchedFraction = buildDocument();
    mismatchedFraction.solutions['eco17_runap_iheh2022'].features.wetlands.coverageFraction = 0.9;

    expect(strategicOutcomeRowsForSolution(mismatchedDenominator, 'eco17_runap_iheh2022')).toEqual(
      [],
    );
    expect(strategicOutcomeRowsForSolution(mismatchedFraction, 'eco17_runap_iheh2022')).toEqual([]);
  });

  it('rejects documents with incompatible units or grid policy', () => {
    const wrongUnit = buildDocument() as unknown as Record<string, unknown>;
    wrongUnit['areaUnit'] = 'ha';
    const wrongGrid = buildDocument();
    wrongGrid.alignedGrid.resampling = 'bilinear' as 'nearest';

    expect(isStrategicEcosystemOutcomesDocument(wrongUnit)).toBe(false);
    expect(isStrategicEcosystemOutcomesDocument(wrongGrid)).toBe(false);
  });
});

function buildDocument(): StrategicEcosystemOutcomesDocument {
  const denominators: Record<StrategicEcosystemFeatureId, number> = {
    paramos: 27401,
    wetlands: 253986,
    bosque_seco: 10135,
    mangroves: 2702,
  };
  const covered: Record<StrategicEcosystemFeatureId, number> = {
    paramos: 14543,
    wetlands: 50912,
    bosque_seco: 3025,
    mangroves: 1200,
  };
  const metricIds: Record<StrategicEcosystemFeatureId, string> = {
    paramos: 'ecosystem_coverage_paramo',
    wetlands: 'ecosystem_coverage_wetlands',
    bosque_seco: 'ecosystem_coverage_dry_forest',
    mangroves: 'mangrove_coverage',
  };
  const sourcePaths: Record<StrategicEcosystemFeatureId, string> = {
    paramos: 'inputs/features/strategic/paramos.tif',
    wetlands: 'inputs/features/strategic/humedales.tif',
    bosque_seco: 'inputs/features/strategic/bosque_seco.tif',
    mangroves: 'inputs/features/strategic/mangroves.tif',
  };

  return {
    format: 'strategic-ecosystem-outcomes-v1',
    releaseId: 'solutions-v0-2-0-20260805',
    generatedAt: '2026-08-07T00:00:00Z',
    measurementMethod: 'post-hoc-raster-derived',
    areaUnit: 'km2',
    checkpointsPercent: [17, 30],
    denominatorSpecSha256: 'a'.repeat(64),
    sourceMetricsReportSha256: 'b'.repeat(64),
    alignedGrid: {
      crs: 'EPSG:9377',
      width: 1353,
      height: 1838,
      pixelSizeMeters: 1000,
      resampling: 'nearest',
      targetGridSha256: 'c'.repeat(64),
    },
    featurePresenceValue: 1,
    solutionSelectedValues: [1, 2],
    features: Object.fromEntries(
      (Object.keys(denominators) as StrategicEcosystemFeatureId[]).map((featureId) => [
        featureId,
        {
          metricId: metricIds[featureId],
          sourcePath: sourcePaths[featureId],
          sourceSha256: 'd'.repeat(64),
          alignedSha256: 'e'.repeat(64),
          alignmentPolicySha256: 'f'.repeat(64),
          totalAlignedFeatureValue1Cells: denominators[featureId],
          totalAlignedFeatureValue1AreaKm2: denominators[featureId],
        },
      ]),
    ) as StrategicEcosystemOutcomesDocument['features'],
    solutions: {
      eco17_runap_iheh2022: {
        features: Object.fromEntries(
          (Object.keys(covered) as StrategicEcosystemFeatureId[]).map((featureId) => {
            const fraction = covered[featureId] / denominators[featureId];
            return [
              featureId,
              {
                coveredAreaKm2: covered[featureId],
                coverageFraction: fraction,
                coveragePercent: fraction * 100,
                checkpoints: {
                  '17': fraction >= 0.17,
                  '30': fraction >= 0.3,
                },
              },
            ];
          }),
        ) as StrategicEcosystemOutcomesDocument['solutions'][string]['features'],
      },
    },
  };
}
