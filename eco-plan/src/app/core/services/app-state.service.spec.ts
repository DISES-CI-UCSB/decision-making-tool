import { TestBed } from '@angular/core/testing';
import { type AOI, type LayerConfig, type Solution, UserTier } from '@core/models';
import { AppStateService } from './app-state.service';

describe('AppStateService', () => {
  let service: AppStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AppStateService);
  });

  it('propagates solution and AOI updates through signals', () => {
    const solution: Solution = {
      id: 'solution-1',
      name: 'Demo Solution',
      matchPercentage: 72,
      geometryUrl: '/geometry/solution-1.json',
      metrics: [],
    };
    const aoi: AOI = {
      id: 'aoi-1',
      name: 'Bogota',
      type: 'municipality',
      geometryUrl: '/geometry/aoi-1.json',
    };

    expect(service.hasActiveSolution()).toBe(false);
    expect(service.activeSolution$()).toBe(null);
    expect(service.selectedAOI$()).toBe(null);

    service.loadSolution(solution);
    service.selectAOI(aoi);

    expect(service.activeSolution$()).toEqual(solution);
    expect(service.selectedAOI$()).toEqual(aoi);
    expect(service.hasActiveSolution()).toBe(true);

    service.clearAOI();
    service.clearSolution();

    expect(service.selectedAOI$()).toBe(null);
    expect(service.activeSolution$()).toBe(null);
    expect(service.hasActiveSolution()).toBe(false);
  });

  it('toggles layer visibility and updates sidebar mode', () => {
    const layers: LayerConfig[] = [
      {
        id: 'layer-a',
        name: 'Habitat',
        type: 'vector',
        category: 'ecology',
        visible: true,
        opacity: 1,
      },
      {
        id: 'layer-b',
        name: 'Communities',
        type: 'raster',
        category: 'social',
        visible: false,
        opacity: 0.7,
      },
    ];

    service.visibleLayers$.set(layers);
    service.setRightSidebarMode('comparison');

    service.toggleLayer('layer-a');
    service.toggleLayer('layer-b');

    expect(service.visibleLayers$()[0].visible).toBe(false);
    expect(service.visibleLayers$()[1].visible).toBe(true);
    expect(service.rightSidebarMode$()).toBe('comparison');
  });

  it('computes compare and tier access state', () => {
    const comparisonSolution: Solution = {
      id: 'solution-2',
      name: 'Comparison Solution',
      matchPercentage: 68,
      geometryUrl: '/geometry/solution-2.json',
      metrics: [],
    };

    expect(service.isComparing()).toBe(false);
    expect(service.canAccessTier2()).toBe(false);

    service.comparisonSolution$.set(comparisonSolution);
    service.userTier$.set(UserTier.DecisionMaker);

    expect(service.isComparing()).toBe(true);
    expect(service.canAccessTier2()).toBe(true);
  });
});
