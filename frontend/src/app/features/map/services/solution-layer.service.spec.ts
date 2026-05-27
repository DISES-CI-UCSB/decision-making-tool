import { TestBed } from '@angular/core/testing';
import type { LoadedSolution } from '@core/models/solution-scenario.model';
import { AppStateService } from '@core/services/app-state.service';
import { MockDataService } from '@core/services/mock-data.service';
import { GeoTiffLoaderService } from './geotiff-loader.service';
import {
  DEFAULT_COMPARISON_BASELINE_HEX,
  DEFAULT_COMPARISON_CANDIDATE_HEX,
  DEFAULT_COMPARISON_OVERLAP_HEX,
  DEFAULT_SINGLE_SOLUTION_HEX,
  SolutionLayerService,
} from './solution-layer.service';

function createLoadedSolution(
  id: string,
  overrides: Partial<LoadedSolution['scenario']> = {},
): LoadedSolution {
  return {
    scenario: {
      id,
      filename: `${id}.tif`,
      name: `Scenario ${id}`,
      description: `Description ${id}`,
      scope: 'nacional',
      sirapId: null,
      displayUrl: `https://example.com/${id}.tif`,
      metadataUrl: `https://example.com/${id}.json`,
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
    },
    rasterData: new Float64Array([1, 0, 1, 0]),
    canvas: document.createElement('canvas'),
    loadTimeMs: 3,
  };
}

describe('SolutionLayerService', () => {
  let service: SolutionLayerService;
  const loaderMock = {
    loadSolution: vi.fn<(scenarioId: string) => Promise<LoadedSolution>>(),
  };
  const appStateMock = {
    loadSolution: vi.fn(),
    clearSolution: vi.fn(),
  };
  const mockDataMock = {
    getSolutionById: vi.fn().mockReturnValue({
      id: 'sol-001',
      name: 'Mock Solution',
      description: 'Mock description',
      matchPercentage: 75,
      geometryUrl: '/mock.geojson',
      metrics: [],
    }),
  };

  const mapMock = {
    add: vi.fn(),
    addMany: vi.fn(),
    remove: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        SolutionLayerService,
        { provide: GeoTiffLoaderService, useValue: loaderMock },
        { provide: AppStateService, useValue: appStateMock },
        { provide: MockDataService, useValue: mockDataMock },
      ],
    });
    service = TestBed.inject(SolutionLayerService);
    service.initialize(mapMock as never);
  });

  it('loads a single scenario and syncs active solution state', async () => {
    const loaded = createLoadedSolution('baseline');
    loaderMock.loadSolution.mockResolvedValue(loaded);

    await service.showSolution('baseline');

    expect(loaderMock.loadSolution).toHaveBeenCalledWith('baseline');
    expect(mapMock.add).toHaveBeenCalledTimes(1);
    expect(appStateMock.loadSolution).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'baseline',
        name: 'Scenario baseline',
        matchPercentage: 70,
        geometryUrl: 'https://example.com/baseline.tif',
        metadata: expect.objectContaining({
          scenarioId: 'baseline',
          rasterFile: 'baseline.tif',
          metadataUrl: 'https://example.com/baseline.json',
        }),
      }),
    );
    expect(service.isComparisonModeActive()).toBe(false);
  });

  it('uses an imagery tile layer when the scenario has a COG display URL', async () => {
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

  it('loads two scenarios for comparison and exposes both layers', async () => {
    const baselineLoaded = createLoadedSolution('baseline');
    const candidateLoaded = createLoadedSolution('candidate');
    loaderMock.loadSolution.mockImplementation(async (scenarioId: string) =>
      scenarioId === 'baseline' ? baselineLoaded : candidateLoaded,
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
    expect(appStateMock.loadSolution).not.toHaveBeenCalled();
    expect(service.isComparisonModeActive()).toBe(true);
    expect(service.getComparisonLayers()).toEqual({
      baselineLayer,
      candidateLayer,
    });
  });

  it('keeps the baseline default color distinct from the other comparison defaults', async () => {
    const baselineLoaded = createLoadedSolution('baseline');
    const candidateLoaded = createLoadedSolution('candidate');
    loaderMock.loadSolution.mockImplementation(async (scenarioId: string) =>
      scenarioId === 'baseline' ? baselineLoaded : candidateLoaded,
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
    );
    expect(createLayerSpy).toHaveBeenNthCalledWith(
      2,
      candidateLoaded,
      expect.any(String),
      expect.any(String),
      DEFAULT_COMPARISON_CANDIDATE_HEX,
    );
  });

  it('updates baseline and candidate layer visibility/opacities independently in comparison mode', async () => {
    const baselineLoaded = createLoadedSolution('baseline');
    const candidateLoaded = createLoadedSolution('candidate');
    loaderMock.loadSolution.mockImplementation(async (scenarioId: string) =>
      scenarioId === 'baseline' ? baselineLoaded : candidateLoaded,
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
    loaderMock.loadSolution.mockImplementation(async (scenarioId: string) =>
      scenarioId === 'baseline' ? baselineLoaded : candidateLoaded,
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
