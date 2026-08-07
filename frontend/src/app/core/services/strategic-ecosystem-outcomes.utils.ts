import type {
  StrategicEcosystemFeatureId,
  StrategicEcosystemOutcome,
  StrategicEcosystemOutcomesDocument,
} from '@core/models';

export interface StrategicEcosystemOutcomeRow {
  featureId: StrategicEcosystemFeatureId;
  labelKey: string;
  coveredAreaKm2: number;
  coverageFraction: number;
  reached17: boolean;
  reached30: boolean;
}

const FEATURE_CONTRACT: Record<
  StrategicEcosystemFeatureId,
  { metricId: string; sourcePath: string; labelKey: string }
> = {
  paramos: {
    metricId: 'ecosystem_coverage_paramo',
    sourcePath: 'inputs/features/strategic/paramos.tif',
    labelKey: 'analysis.overview.goalsWidget.strategicFeatures.paramos',
  },
  wetlands: {
    metricId: 'ecosystem_coverage_wetlands',
    sourcePath: 'inputs/features/strategic/humedales.tif',
    labelKey: 'analysis.overview.goalsWidget.strategicFeatures.wetlands',
  },
  bosque_seco: {
    metricId: 'ecosystem_coverage_dry_forest',
    sourcePath: 'inputs/features/strategic/bosque_seco.tif',
    labelKey: 'analysis.overview.goalsWidget.strategicFeatures.dryForest',
  },
  mangroves: {
    metricId: 'mangrove_coverage',
    sourcePath: 'inputs/features/strategic/mangroves.tif',
    labelKey: 'analysis.overview.goalsWidget.strategicFeatures.mangroves',
  },
};
const FEATURE_IDS = Object.keys(FEATURE_CONTRACT) as StrategicEcosystemFeatureId[];

export function isStrategicEcosystemOutcomesDocument(
  value: unknown,
): value is StrategicEcosystemOutcomesDocument {
  if (!value || typeof value !== 'object') return false;
  const document = value as Partial<StrategicEcosystemOutcomesDocument>;
  const grid = document.alignedGrid;
  return (
    document.format === 'strategic-ecosystem-outcomes-v1' &&
    document.measurementMethod === 'post-hoc-raster-derived' &&
    document.areaUnit === 'km2' &&
    document.featurePresenceValue === 1 &&
    hasExactNumbers(document.solutionSelectedValues, [1, 2]) &&
    hasExactNumbers(document.checkpointsPercent, [17, 30]) &&
    grid?.crs === 'EPSG:9377' &&
    grid.width === 1353 &&
    grid.height === 1838 &&
    grid.pixelSizeMeters === 1000 &&
    grid.resampling === 'nearest' &&
    isSha256(grid.targetGridSha256) &&
    isSha256(document.denominatorSpecSha256) &&
    isSha256(document.sourceMetricsReportSha256) &&
    Boolean(document.features) &&
    Boolean(document.solutions)
  );
}

export function strategicOutcomeRowsForSolution(
  document: StrategicEcosystemOutcomesDocument | null | undefined,
  solutionId: string | null | undefined,
): StrategicEcosystemOutcomeRow[] {
  if (!document || !solutionId || !isStrategicEcosystemOutcomesDocument(document)) return [];
  const solution = document.solutions[solutionId];
  if (!solution?.features) return [];

  const rows: StrategicEcosystemOutcomeRow[] = [];
  for (const featureId of FEATURE_IDS) {
    const contract = FEATURE_CONTRACT[featureId];
    const denominator = document.features[featureId];
    const outcome = solution.features[featureId];
    if (
      !denominator ||
      denominator.metricId !== contract.metricId ||
      denominator.sourcePath !== contract.sourcePath ||
      !isSha256(denominator.sourceSha256) ||
      !isSha256(denominator.alignedSha256) ||
      !isSha256(denominator.alignmentPolicySha256) ||
      !isPositiveInteger(denominator.totalAlignedFeatureValue1Cells) ||
      denominator.totalAlignedFeatureValue1AreaKm2 !== denominator.totalAlignedFeatureValue1Cells ||
      !isValidOutcome(outcome, denominator.totalAlignedFeatureValue1AreaKm2)
    ) {
      return [];
    }
    rows.push({
      featureId,
      labelKey: contract.labelKey,
      coveredAreaKm2: outcome.coveredAreaKm2,
      coverageFraction: outcome.coverageFraction,
      reached17: outcome.checkpoints['17'],
      reached30: outcome.checkpoints['30'],
    });
  }
  return rows;
}

function isValidOutcome(
  outcome: StrategicEcosystemOutcome | undefined,
  denominatorKm2: number,
): outcome is StrategicEcosystemOutcome {
  if (
    !outcome ||
    !isFiniteNumber(outcome.coveredAreaKm2) ||
    !isFiniteNumber(outcome.coverageFraction) ||
    !isFiniteNumber(outcome.coveragePercent) ||
    outcome.coveredAreaKm2 < 0 ||
    outcome.coverageFraction < 0 ||
    outcome.coverageFraction > 1
  ) {
    return false;
  }
  const expectedFraction = outcome.coveredAreaKm2 / denominatorKm2;
  return (
    nearlyEqual(outcome.coverageFraction, expectedFraction) &&
    nearlyEqual(outcome.coveragePercent, expectedFraction * 100) &&
    outcome.checkpoints?.['17'] === expectedFraction + 1e-12 >= 0.17 &&
    outcome.checkpoints?.['30'] === expectedFraction + 1e-12 >= 0.3
  );
}

function hasExactNumbers(value: unknown, expected: number[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => entry === expected[index])
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
}
