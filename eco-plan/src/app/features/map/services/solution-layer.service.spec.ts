import { TestBed } from '@angular/core/testing';
import type { LoadedSolution } from '@core/models/solution-scenario.model';
import { AppStateService } from '@core/services/app-state.service';
import { MockDataService } from '@core/services/mock-data.service';
import { GeoTiffLoaderService } from './geotiff-loader.service';
import { SolutionLayerService } from './solution-layer.service';

function createLoadedSolution(id: string): LoadedSolution {
  return {
    scenario: {
      id,
      filename: `${id}.tif`,
      name: `Scenario ${id}`,
      description: `Description ${id}`,
      ecosystemTargets: 30,
      constraints: [],
      costLayer: 'cost',
      nSelected: 100,
      totalCost: 2500,
      pctTargetsMet: 70,
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
    const singleLayer = { id: 'single-layer', destroy: vi.fn(), opacity: 0.7 };
    const createLayerSpy = vi.spyOn(
      service as unknown as { createLayerFromLoaded: (...args: unknown[]) => unknown },
      'createLayerFromLoaded',
    );
    createLayerSpy.mockReturnValue(singleLayer as never);

    await service.showSolution('baseline');

    expect(loaderMock.loadSolution).toHaveBeenCalledWith('baseline');
    expect(mapMock.add).toHaveBeenCalledWith(singleLayer);
    expect(appStateMock.loadSolution).toHaveBeenCalledTimes(1);
    expect(service.isComparisonModeActive()).toBe(false);
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
