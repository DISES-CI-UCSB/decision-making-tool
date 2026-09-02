import { TestBed } from '@angular/core/testing';
import type { LoadedSolution } from '@core/models/solution-catalog.model';
import { AppStateService } from '@core/services/app-state.service';
import {
  DEFAULT_COMPARISON_BASELINE_HEX,
  DEFAULT_COMPARISON_CANDIDATE_HEX,
  DEFAULT_COMPARISON_OVERLAP_HEX,
  DEFAULT_SINGLE_SOLUTION_HEX,
  solutionClassColors,
  spatialReferenceForRaster,
} from '../utils/solution-rendering.utils';
import { GeoTiffLoaderService } from './geotiff-loader.service';
import { SolutionLayerService } from './solution-layer.service';

function createLoadedSolution(
  id: string,
  overrides: Partial<LoadedSolution['solution']> = {},
): LoadedSolution {
  return {
    solution: {
      id,
      filename: `${id}.tif`,
      name: `Solution ${id}`,
      description: `Description ${id}`,
      scope: 'nacional',
      sirapId: null,
      displayUrl: `https://example.com/${id}.tif`,
      metadataUrl: `https://example.com/${id}.json`,
      rendering: {
        valueType: 'categorical',
        renderMode: 'categorical',
        noDataValue: 255,
        classColors: [
          { value: 1, color: '#16a34a', label: 'New coverage' },
          { value: 2, color: '#2563eb', label: 'Existing protected areas' },
        ],
      },
      finderInputs: {
        scope: 'nacional',
        targetFeatureSet: 'ecosystems',
        targetFeatureIds: ['ecosistemas'],
        targetPercent: 30,
        costLayerId: 'human_footprint_2022',
        includeLayerIds: ['runap'],
        excludeLayerIds: [],
      },
      inputLayerIds: {
        features: ['ecosistemas'],
        cost: 'human_footprint_2022',
        includes: ['runap'],
        excludes: [],
      },
      ecosystemTargets: 30,
      constraints: [],
      costLayer: 'cost',
      nSelected: 100,
      totalCost: 2500,
      pctTargetsMet: 70,
      ...overrides,
    },
    rasterMeta: {
      width: 2,
      height: 2,
      bbox: [-80, -5, -60, 10],
      resolution: [0.1, -0.1],
      crs: 'EPSG:4326',
      bandCount: 1,
      bandDescription: 'selected',
      noDataValue: null,
      selectedCount: 2,
      totalValidCells: 4,
      selectedPct: 50,
      countryValidCells: 8,
      newCoveragePctOfCountry: 25,
    },
    rasterData: new Float64Array([2, 1, 2, 0]),
    canvas: document.createElement('canvas'),
    loadTimeMs: 3,
  };
}

describe('SolutionLayerService', () => {
  let service: SolutionLayerService;
  const loaderMock = {
    loadSolution: vi.fn<(solutionId: string) => Promise<LoadedSolution>>(),
  };
  const appStateMock = {
    loadSolution: vi.fn(),
    clearSolution: vi.fn(),
    showExistingProtectedCoverage$: vi.fn(() => true),
  };
  const mapMock = {
    add: vi.fn(),
    addMany: vi.fn(),
    remove: vi.fn(),
    reorder: vi.fn(),
    findLayerById: vi.fn(),
    layers: { length: 4 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    appStateMock.showExistingProtectedCoverage$.mockReturnValue(true);
    TestBed.configureTestingModule({
      providers: [
        SolutionLayerService,
        { provide: GeoTiffLoaderService, useValue: loaderMock },
        { provide: AppStateService, useValue: appStateMock },
      ],
    });
    service = TestBed.inject(SolutionLayerService);
    service.initialize(mapMock as never);
  });

  it('retains the SIRAP region ID in active solution metadata', () => {
    const loaded = createLoadedSolution('caribe-solution', {
      scope: 'sirap',
      sirapId: 'caribe',
    });

    const sidebarSolution = (
      service as unknown as {
        toSidebarSolution(value: LoadedSolution): {
          metadata: Record<string, unknown>;
        };
      }
    ).toSidebarSolution(loaded);

    expect(sidebarSolution.metadata).toMatchObject({
      scope: 'sirap',
      sirapId: 'caribe',
    });
  });

  it('loads a single solution and syncs active solution state', async () => {
    const loaded = createLoadedSolution('baseline');
    loaderMock.loadSolution.mockResolvedValue(loaded);

    await service.showSolution('baseline');

    expect(loaderMock.loadSolution).toHaveBeenCalledWith('baseline');
    expect(mapMock.add).toHaveBeenCalledTimes(1);
    expect(appStateMock.loadSolution).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'baseline',
        name: 'Solution baseline',
        matchPercentage: 70,
        geometryUrl: 'https://example.com/baseline.tif',
        metadata: expect.objectContaining({
          solutionId: 'baseline',
          rasterFile: 'baseline.tif',
          metadataUrl: 'https://example.com/baseline.json',
        }),
      }),
    );
    expect(service.isComparisonModeActive()).toBe(false);
    expect(service.liveSolutionMetrics$()).toEqual(
      expect.objectContaining({
        priorityZoneCount: 1,
        status: 'ready',
      }),
    );
    expect(service.liveSolutionMetrics$()?.nationalContributionPct).toBeCloseTo(75, 1);
  });

  it('counts diagonal selected cells as one contiguous priority zone', async () => {
    const loaded = {
      ...createLoadedSolution('baseline'),
      rasterMeta: {
        ...createLoadedSolution('baseline').rasterMeta,
        width: 3,
        height: 3,
        selectedCount: 4,
        totalValidCells: 9,
      },
      rasterData: new Float64Array([1, 0, 0, 0, 2, 0, 0, 0, 1]),
    };
    loaderMock.loadSolution.mockResolvedValue(loaded);

    await service.showSolution('baseline');

    expect(service.liveSolutionMetrics$()).toEqual(
      expect.objectContaining({
        priorityZoneCount: 1,
      }),
    );
  });

  it('counts separated selected patches as separate priority zones', async () => {
    const loaded = {
      ...createLoadedSolution('baseline'),
      rasterMeta: {
        ...createLoadedSolution('baseline').rasterMeta,
        width: 3,
        height: 3,
        selectedCount: 4,
        totalValidCells: 9,
      },
      rasterData: new Float64Array([1, 1, 0, 0, 0, 0, 0, 2, 2]),
    };
    loaderMock.loadSolution.mockResolvedValue(loaded);

    await service.showSolution('baseline');

    expect(service.liveSolutionMetrics$()).toEqual(
      expect.objectContaining({
        priorityZoneCount: 2,
      }),
    );
  });

  it('uses an imagery tile layer when the solution has a COG display URL', async () => {
    const loaded = createLoadedSolution('baseline', {
      displayCogUrl: 'https://example.com/baseline.cog.tif',
    });
    loaderMock.loadSolution.mockResolvedValue(loaded);

    await service.showSolution('baseline');

    const addedLayer = mapMock.add.mock.calls[0]?.[0] as {
      url?: string;
      interpolation?: string;
      renderer?: unknown;
    };
    expect(addedLayer.url).toBe('https://example.com/baseline.cog.tif');
    expect(addedLayer.interpolation).toBe('nearest');
    expect(addedLayer.renderer).toBeTruthy();
  });

  it('uses the raster EPSG code when georeferencing canvas-rendered solutions', () => {
    const spatialReference = spatialReferenceForRaster({
      ...createLoadedSolution('baseline').rasterMeta,
      crs: 'EPSG:9377',
    });

    expect(spatialReference).toEqual({ wkid: 9377 });
  });

  it('falls back to WGS84 when raster CRS metadata is unavailable', () => {
    const spatialReference = spatialReferenceForRaster({
      ...createLoadedSolution('baseline').rasterMeta,
      crs: 'Unknown',
    });

    expect(spatialReference).toEqual({ wkid: 4326 });
  });

  it('splits included area coverage into its own color by default', () => {
    const loaded = createLoadedSolution('baseline');
    const classColors = solutionClassColors(loaded, '#ff0000');

    expect(classColors).toEqual([
      { value: 2, color: '#2563eb', label: 'Existing conservation areas (RUNAP)' },
      { value: 1, color: '#ff0000', label: 'New coverage' },
    ]);
  });

  it('uses the user-selected included coverage color for single-solution rendering', () => {
    const loaded = createLoadedSolution('baseline');
    const classColors = solutionClassColors(loaded, '#ff0000', {
      existingProtectedColorHex: '#f97316',
    });

    expect(classColors).toEqual([
      { value: 2, color: '#f97316', label: 'Existing conservation areas (RUNAP)' },
      { value: 1, color: '#ff0000', label: 'New coverage' },
    ]);
  });

  it('can collapse existing include coverage into the selected solution color for dev review', () => {
    const loaded = createLoadedSolution('baseline');
    const classColors = solutionClassColors(loaded, '#ff0000', {
      showExistingProtectedCoverage: false,
    });

    expect(classColors).toEqual([
      { value: 2, color: '#ff0000', label: 'Selected scenario' },
      { value: 1, color: '#ff0000', label: 'Selected scenario' },
    ]);
  });

  it('collapses existing include coverage into the selected color for comparison layers', () => {
    const loaded = createLoadedSolution('baseline');
    const classColors = solutionClassColors(loaded, '#7c3aed', {
      collapseExistingProtectedCoverage: true,
    });

    expect(classColors).toEqual([
      { value: 2, color: '#7c3aed', label: 'Selected scenario' },
      { value: 1, color: '#7c3aed', label: 'Selected scenario' },
    ]);
  });

  it('creates the overlap immediately for an initial three-color comparison', async () => {
    const baselineLoaded = createLoadedSolution('baseline');
    const candidateLoaded = createLoadedSolution('candidate');
    loaderMock.loadSolution.mockImplementation(async (solutionId: string) =>
      solutionId === 'baseline' ? baselineLoaded : candidateLoaded,
    );
    const baselineLayer = { id: 'baseline-layer', destroy: vi.fn(), opacity: 0.7 };
    const candidateLayer = { id: 'candidate-layer', destroy: vi.fn(), opacity: 0.7 };
    const createLayerSpy = vi.spyOn(
      service as unknown as { createLayerFromLoaded: (...args: unknown[]) => unknown },
      'createLayerFromLoaded',
    );
    createLayerSpy
      .mockReturnValueOnce(baselineLayer as never)
      .mockReturnValueOnce(candidateLayer as never);

    await service.showComparison('baseline', 'candidate');

    expect(mapMock.addMany).toHaveBeenCalledWith([baselineLayer, candidateLayer]);
    expect(mapMock.add).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'solution-raster-layer-overlap',
        visible: true,
      }),
    );
    expect(appStateMock.loadSolution).not.toHaveBeenCalled();
    expect(service.isComparisonModeActive()).toBe(true);
    expect(service.getComparisonLayers()).toEqual({
      baselineLayer,
      candidateLayer,
    });
  });

  it('renders overlap pixels through an imagery tile layer on the display COG grid', async () => {
    const projectedRasterMeta: LoadedSolution['rasterMeta'] = {
      ...createLoadedSolution('baseline').rasterMeta,
      bbox: [4_310_000, 1_047_000, 5_702_000, 2_965_000],
      resolution: [1000, -1000],
      crs: 'EPSG:9377',
    };
    const baselineLoaded = {
      ...createLoadedSolution('baseline', {
        displayCogUrl: 'https://example.com/baseline.epsg9377.cog.tif',
      }),
      rasterMeta: projectedRasterMeta,
    };
    const candidateLoaded = {
      ...createLoadedSolution('candidate', {
        displayCogUrl: 'https://example.com/candidate.epsg9377.cog.tif',
      }),
      rasterMeta: projectedRasterMeta,
    };
    loaderMock.loadSolution.mockImplementation(async (solutionId: string) =>
      solutionId === 'baseline' ? baselineLoaded : candidateLoaded,
    );

    await service.showComparison('baseline', 'candidate');

    const overlapLayer = mapMock.add.mock.calls[0]?.[0] as {
      type: string;
      interpolation: string;
      load(): Promise<unknown>;
      symbolizer: {
        symbolize(input: { pixelBlock: unknown }): {
          getAsRGBA(): Uint8ClampedArray;
        };
      };
      source: {
        extent: {
          xmin: number;
          ymin: number;
          xmax: number;
          ymax: number;
          spatialReference: { wkid: number };
        };
        pixelBlock: {
          width: number;
          height: number;
          pixels: Uint8Array[];
          mask: Uint8Array;
        };
      };
    };
    const { extent, pixelBlock } = overlapLayer.source;
    expect(overlapLayer.type).toBe('imagery-tile');
    expect(overlapLayer.interpolation).toBe('nearest');
    expect([extent.xmin, extent.ymin, extent.xmax, extent.ymax]).toEqual(projectedRasterMeta.bbox);
    expect(extent.spatialReference.wkid).toBe(9377);
    expect(pixelBlock.width).toBe(projectedRasterMeta.width);
    expect(pixelBlock.height).toBe(projectedRasterMeta.height);
    expect(Array.from(pixelBlock.pixels[0] ?? [])).toEqual([1, 1, 1, 0]);
    expect(Array.from(pixelBlock.mask)).toEqual([1, 1, 1, 0]);

    await overlapLayer.load();
    const renderedPixels = overlapLayer.symbolizer.symbolize({ pixelBlock }).getAsRGBA();
    expect(Array.from(renderedPixels)).toEqual([
      236, 72, 153, 255, 236, 72, 153, 255, 236, 72, 153, 255, 0, 0, 0, 0,
    ]);
  });

  it('calculates live comparison metrics from selected solution cells', async () => {
    const rasterMeta: LoadedSolution['rasterMeta'] = {
      width: 2,
      height: 2,
      bbox: [0, -2000, 2000, 0],
      resolution: [1000, -1000],
      crs: 'EPSG:3857',
      bandCount: 1,
      bandDescription: 'selected',
      noDataValue: 255,
      selectedCount: 2,
      totalValidCells: 4,
      selectedPct: 50,
      countryValidCells: 4,
      newCoveragePctOfCountry: 50,
    };
    const baselineLoaded = {
      ...createLoadedSolution('baseline'),
      rasterMeta,
      rasterData: new Float64Array([1, 0, 2, 0]),
    };
    const candidateLoaded = {
      ...createLoadedSolution('candidate'),
      rasterMeta,
      rasterData: new Float64Array([1, 2, 0, 0]),
    };
    loaderMock.loadSolution.mockImplementation(async (solutionId: string) =>
      solutionId === 'baseline' ? baselineLoaded : candidateLoaded,
    );
    const createLayerSpy = vi.spyOn(
      service as unknown as { createLayerFromLoaded: (...args: unknown[]) => unknown },
      'createLayerFromLoaded',
    );
    createLayerSpy
      .mockReturnValueOnce({ id: 'baseline-layer', destroy: vi.fn(), opacity: 0.7 } as never)
      .mockReturnValueOnce({ id: 'candidate-layer', destroy: vi.fn(), opacity: 0.7 } as never);

    await service.showComparison('baseline', 'candidate');

    expect(service.liveComparisonMetrics$()).toEqual(
      expect.objectContaining({
        agreementAreaKm2: 1,
        uniqueToBaselineKm2: 1,
        uniqueToCandidateKm2: 1,
        baselineSelectedAreaKm2: 2,
        candidateSelectedAreaKm2: 2,
        newAgreementAreaKm2: 1,
        newUniqueToBaselineKm2: 0,
        newUniqueToCandidateKm2: 0,
        baselineTotalSelectedAreaKm2: 2,
        candidateTotalSelectedAreaKm2: 2,
        baselinePreExistingAreaKm2: 1,
        candidatePreExistingAreaKm2: 1,
        baselineNewAreaKm2: 1,
        candidateNewAreaKm2: 1,
        status: 'ready',
        notes: null,
      }),
    );
    expect(service.liveComparisonMetrics$()?.baselineNationalContributionPct).toBeCloseTo(50);
    expect(service.liveComparisonMetrics$()?.candidateNationalContributionPct).toBeCloseTo(50);
  });

  it('marks live comparison metrics unavailable when solution grids differ', async () => {
    const baselineLoaded = createLoadedSolution('baseline');
    const candidateLoaded = {
      ...createLoadedSolution('candidate'),
      rasterMeta: {
        ...createLoadedSolution('candidate').rasterMeta,
        width: 3,
      },
    };
    loaderMock.loadSolution.mockImplementation(async (solutionId: string) =>
      solutionId === 'baseline' ? baselineLoaded : candidateLoaded,
    );
    const createLayerSpy = vi.spyOn(
      service as unknown as { createLayerFromLoaded: (...args: unknown[]) => unknown },
      'createLayerFromLoaded',
    );
    createLayerSpy
      .mockReturnValueOnce({ id: 'baseline-layer', destroy: vi.fn(), opacity: 0.7 } as never)
      .mockReturnValueOnce({ id: 'candidate-layer', destroy: vi.fn(), opacity: 0.7 } as never);

    await service.showComparison('baseline', 'candidate');

    expect(service.liveComparisonMetrics$()).toEqual(
      expect.objectContaining({
        agreementAreaKm2: null,
        baselineSelectedAreaKm2: null,
        status: 'unavailable',
      }),
    );
    expect(mapMock.add).not.toHaveBeenCalled();
  });

  it('reorders arbitrary map layers from bottom to top so the first id ends up above the rest', () => {
    const topLayer = { id: 'map-view-runap-vector-layer' };
    const bottomLayer = { id: 'solution-raster-layer' };
    mapMock.findLayerById.mockImplementation((id: string) => {
      if (id === topLayer.id) {
        return topLayer;
      }
      if (id === bottomLayer.id) {
        return bottomLayer;
      }
      return null;
    });

    service.reorderLayersByIds([topLayer.id, bottomLayer.id]);

    expect(mapMock.reorder).toHaveBeenNthCalledWith(1, bottomLayer, mapMock.layers.length - 1);
    expect(mapMock.reorder).toHaveBeenNthCalledWith(2, topLayer, mapMock.layers.length - 1);
  });

  it('keeps the baseline default color distinct from the other comparison defaults', async () => {
    const baselineLoaded = createLoadedSolution('baseline');
    const candidateLoaded = createLoadedSolution('candidate');
    loaderMock.loadSolution.mockImplementation(async (solutionId: string) =>
      solutionId === 'baseline' ? baselineLoaded : candidateLoaded,
    );
    const createLayerSpy = vi.spyOn(
      service as unknown as { createLayerFromLoaded: (...args: unknown[]) => unknown },
      'createLayerFromLoaded',
    );
    createLayerSpy
      .mockReturnValueOnce({ id: 'baseline-layer', destroy: vi.fn(), opacity: 0.7 } as never)
      .mockReturnValueOnce({ id: 'candidate-layer', destroy: vi.fn(), opacity: 0.7 } as never);

    await service.showComparison('baseline', 'candidate');

    expect(DEFAULT_COMPARISON_BASELINE_HEX).toBe(DEFAULT_SINGLE_SOLUTION_HEX);
    expect(service.baselineColor$()).toBe(DEFAULT_SINGLE_SOLUTION_HEX);
    expect(service.candidateColor$()).toBe(DEFAULT_COMPARISON_CANDIDATE_HEX);
    expect(service.overlapColor$()).toBe(DEFAULT_COMPARISON_OVERLAP_HEX);
    expect(
      new Set([service.baselineColor$(), service.candidateColor$(), service.overlapColor$()]).size,
    ).toBe(3);
    expect(createLayerSpy).toHaveBeenNthCalledWith(
      1,
      baselineLoaded,
      expect.any(String),
      expect.any(String),
      DEFAULT_SINGLE_SOLUTION_HEX,
      { collapseExistingProtectedCoverage: true },
    );
    expect(createLayerSpy).toHaveBeenNthCalledWith(
      2,
      candidateLoaded,
      expect.any(String),
      expect.any(String),
      DEFAULT_COMPARISON_CANDIDATE_HEX,
      { collapseExistingProtectedCoverage: true },
    );
  });

  it('updates baseline and candidate layer visibility/opacities independently in comparison mode', async () => {
    const baselineLoaded = createLoadedSolution('baseline');
    const candidateLoaded = createLoadedSolution('candidate');
    loaderMock.loadSolution.mockImplementation(async (solutionId: string) =>
      solutionId === 'baseline' ? baselineLoaded : candidateLoaded,
    );
    const baselineLayer = { id: 'baseline-layer', destroy: vi.fn(), opacity: 0.7, visible: true };
    const candidateLayer = { id: 'candidate-layer', destroy: vi.fn(), opacity: 0.7, visible: true };
    const createLayerSpy = vi.spyOn(
      service as unknown as { createLayerFromLoaded: (...args: unknown[]) => unknown },
      'createLayerFromLoaded',
    );
    createLayerSpy
      .mockReturnValueOnce(baselineLayer as never)
      .mockReturnValueOnce(candidateLayer as never);

    await service.showComparison('baseline', 'candidate');
    service.setBaselineVisibility(false);
    service.setCandidateVisibility(true);
    service.setBaselineOpacity(0.35);
    service.setCandidateOpacity(0.9);

    expect(baselineLayer.visible).toBe(false);
    expect(candidateLayer.visible).toBe(true);
    expect(baselineLayer.opacity).toBe(0.35);
    expect(candidateLayer.opacity).toBe(0.9);
  });

  it('updates overlap controls without rebuilding its in-memory imagery source', async () => {
    const baselineLoaded = createLoadedSolution('baseline');
    const candidateLoaded = createLoadedSolution('candidate');
    loaderMock.loadSolution.mockImplementation(async (solutionId: string) =>
      solutionId === 'baseline' ? baselineLoaded : candidateLoaded,
    );

    await service.showComparison('baseline', 'candidate');

    const overlapLayer = mapMock.add.mock.calls[0]?.[0] as {
      source: unknown;
      renderer: unknown;
      opacity: number;
      visible: boolean;
    };
    const initialSource = overlapLayer.source;
    const initialRenderer = overlapLayer.renderer;

    service.setOverlapColor('#f97316');
    service.setOverlapOpacity(0.45);
    service.setOverlapVisibility(false);

    expect(overlapLayer.source).toBe(initialSource);
    expect(overlapLayer.renderer).not.toBe(initialRenderer);
    expect(overlapLayer.opacity).toBe(0.45);
    expect(overlapLayer.visible).toBe(false);
  });

  it('restores overlap visibility after switching from swipe back to overlay mode', () => {
    const overlapLayer = { visible: true };
    const serviceInternals = service as unknown as {
      comparisonMode: boolean;
      overlapComparisonLayer: { visible: boolean };
      ensureOverlapLayer: () => void;
    };
    serviceInternals.comparisonMode = true;
    serviceInternals.overlapComparisonLayer = overlapLayer;
    const ensureOverlapLayerSpy = vi
      .spyOn(serviceInternals, 'ensureOverlapLayer')
      .mockImplementation(() => undefined);

    service.applyComparisonVisualizationMode('swipe');
    service.applyComparisonVisualizationMode('threeColorOverlay');

    expect(overlapLayer.visible).toBe(true);
    expect(ensureOverlapLayerSpy).toHaveBeenCalledTimes(1);
  });

  it('replaces the solution image element when color changes', async () => {
    const loaded = createLoadedSolution('baseline');
    loaderMock.loadSolution.mockResolvedValue(loaded);
    await service.showSolution('baseline');

    const currentLayer = (
      service as unknown as {
        currentLayer: {
          source: {
            elements: {
              getItemAt(index: number): unknown;
              length: number;
            };
          };
        } | null;
      }
    ).currentLayer;

    expect(currentLayer).not.toBeNull();
    const before = currentLayer!.source.elements.getItemAt(0);
    service.setColor('#ff0000');
    const after = currentLayer!.source.elements.getItemAt(0);

    expect(currentLayer!.source.elements.length).toBe(1);
    expect(after).not.toBe(before);
  });

  it('clears map layers and app state when removing solution', async () => {
    const baselineLoaded = createLoadedSolution('baseline');
    const candidateLoaded = createLoadedSolution('candidate');
    loaderMock.loadSolution.mockImplementation(async (solutionId: string) =>
      solutionId === 'baseline' ? baselineLoaded : candidateLoaded,
    );
    const baselineLayer = { id: 'baseline-layer', destroy: vi.fn(), opacity: 0.7 };
    const candidateLayer = { id: 'candidate-layer', destroy: vi.fn(), opacity: 0.7 };
    const createLayerSpy = vi.spyOn(
      service as unknown as { createLayerFromLoaded: (...args: unknown[]) => unknown },
      'createLayerFromLoaded',
    );
    createLayerSpy
      .mockReturnValueOnce(baselineLayer as never)
      .mockReturnValueOnce(candidateLayer as never);

    await service.showComparison('baseline', 'candidate');
    service.removeSolutionLayer();

    expect(mapMock.remove).toHaveBeenCalledWith(baselineLayer);
    expect(mapMock.remove).toHaveBeenCalledWith(candidateLayer);
    expect(baselineLayer.destroy).toHaveBeenCalled();
    expect(candidateLayer.destroy).toHaveBeenCalled();
    expect(appStateMock.clearSolution).toHaveBeenCalledTimes(1);
    expect(service.getComparisonLayers()).toBe(null);
  });
});
