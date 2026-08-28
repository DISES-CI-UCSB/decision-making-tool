import type { LoadedSolution } from '@core/models/solution-catalog.model';
import {
  buildOverlapRasterData,
  calculateLiveComparisonMetrics,
  calculateLiveSolutionMetrics,
  getPixelAreaKm2PerRow,
} from './solution-raster.utils';

function createLoadedSolution(
  rasterData: number[],
  rasterMeta: Partial<LoadedSolution['rasterMeta']> = {},
): LoadedSolution {
  return {
    solution: {
      id: 'solution',
      filename: 'solution.tif',
      name: 'Solution',
      description: '',
      scope: 'nacional',
      sirapId: null,
      displayUrl: 'https://example.com/solution.tif',
      metadataUrl: 'https://example.com/solution.json',
      rendering: {
        valueType: 'categorical',
        renderMode: 'categorical',
        noDataValue: 255,
        classColors: [],
      },
      finderInputs: {
        scope: 'nacional',
        targetFeatureSet: 'ecosystems',
        targetFeatureIds: [],
        targetPercent: 30,
        costLayerId: 'cost',
        includeLayerIds: [],
        excludeLayerIds: [],
      },
      inputLayerIds: { features: [], cost: 'cost', includes: [], excludes: [] },
      ecosystemTargets: 30,
      constraints: [],
      costLayer: 'cost',
      nSelected: 0,
      totalCost: 0,
      pctTargetsMet: 0,
    },
    rasterMeta: {
      width: rasterData.length,
      height: 1,
      bbox: [0, -1000, rasterData.length * 1000, 0],
      resolution: [1000, -1000],
      crs: 'EPSG:3857',
      bandCount: 1,
      bandDescription: 'selected',
      noDataValue: 255,
      selectedCount: 0,
      totalValidCells: rasterData.length,
      selectedPct: 0,
      countryValidCells: rasterData.length,
      newCoveragePctOfCountry: 0,
      ...rasterMeta,
    },
    rasterData: new Float64Array(rasterData),
    canvas: document.createElement('canvas'),
    loadTimeMs: 0,
  };
}

describe('solution raster utilities', () => {
  it('builds overlap cells from both new and pre-existing selected classes', () => {
    const baseline = createLoadedSolution([1, 2, 1, 0, 255, Number.NaN]);
    const candidate = createLoadedSolution([2, 1, 0, 1, 1, 1]);

    const overlap = buildOverlapRasterData(baseline, candidate);

    expect(overlap).not.toBeNull();
    expect(Array.from(overlap ?? [])).toEqual([1, 1, 0, 0, 0, 0]);
  });

  it('rejects overlap creation when rasters do not share a grid', () => {
    const baseline = createLoadedSolution([1, 1, 1]);
    const candidate = createLoadedSolution([1, 0]);

    expect(buildOverlapRasterData(baseline, candidate)).toBeNull();
  });

  it('rejects overlap creation when same-sized rasters have different extents', () => {
    const baseline = createLoadedSolution([1, 1]);
    const candidate = createLoadedSolution([1, 1], {
      bbox: [1000, -1000, 3000, 0],
    });

    expect(buildOverlapRasterData(baseline, candidate)).toBeNull();
  });

  it('rejects surplus raster data for overlap and comparison metrics', () => {
    const baseline = createLoadedSolution([1, 0, 2, 0], { width: 2, height: 2 });
    const candidate = createLoadedSolution([1, 0, 2, 0, 1], {
      width: 2,
      height: 2,
      bbox: baseline.rasterMeta.bbox,
    });

    expect(buildOverlapRasterData(baseline, candidate)).toBeNull();
    expect(calculateLiveComparisonMetrics(baseline, candidate)).toEqual(
      expect.objectContaining({
        status: 'unavailable',
        notes: 'Comparison rasters do not contain the expected number of cells.',
      }),
    );
  });

  it('converts projected pixel dimensions and country contribution to square kilometers', () => {
    const loaded = createLoadedSolution([1, 0, 2, 0], {
      width: 2,
      height: 2,
      resolution: [2000, -500],
      bbox: [0, -1000, 4000, 0],
    });

    expect(Array.from(getPixelAreaKm2PerRow(loaded.rasterMeta) ?? [])).toEqual([1, 1]);
    expect(calculateLiveSolutionMetrics(loaded)).toEqual(
      expect.objectContaining({
        selectedAreaKm2: 2,
        validAreaKm2: 4,
        nationalContributionPct: 50,
      }),
    );
  });

  it('calculates comparison areas on a shared projected grid', () => {
    const baseline = createLoadedSolution([1, 0, 2, 0], { width: 2, height: 2 });
    const candidate = createLoadedSolution([1, 2, 0, 0], { width: 2, height: 2 });

    expect(calculateLiveComparisonMetrics(baseline, candidate)).toEqual(
      expect.objectContaining({
        agreementAreaKm2: 1,
        uniqueToBaselineKm2: 1,
        uniqueToCandidateKm2: 1,
        baselinePreExistingAreaKm2: 1,
        candidatePreExistingAreaKm2: 1,
        baselineNationalContributionPct: 50,
        candidateNationalContributionPct: 50,
        status: 'ready',
      }),
    );
  });

  it('uses each solution valid footprint for comparison percentages', () => {
    const baseline = createLoadedSolution([1, 0, 255, 255]);
    const candidate = createLoadedSolution([1, 0, 0, 255]);

    const metrics = calculateLiveComparisonMetrics(baseline, candidate);

    expect(metrics.baselineNationalContributionPct).toBeCloseTo(50);
    expect(metrics.candidateNationalContributionPct).toBeCloseTo(100 / 3);
  });
});
