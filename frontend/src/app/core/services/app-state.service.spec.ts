import { TestBed } from '@angular/core/testing';
import {
  type AOI,
  type CustomPolygonMetricsGeometry,
  type LayerConfig,
  type Solution,
  UserTier,
} from '@core/models';
import { environment } from '../../../environments/environment';
import {
  AppStateService,
  buildContinuousGradientLegendEntry,
  isContinuousGradientRendering,
} from './app-state.service';

describe('map legend helpers', () => {
  it('builds gradient legend entries for continuous gradient rasters', () => {
    const rendering = {
      valueType: 'continuous',
      renderMode: 'gradient',
      minValue: 0,
      maxValue: 100,
      startColor: '#fee2e2',
      endColor: '#991b1b',
    } as const;

    expect(isContinuousGradientRendering(rendering)).toBe(true);
    expect(
      buildContinuousGradientLegendEntry({
        id: 'layer-human_footprint_2022',
        name: 'Human Footprint 2022',
        color: '#991b1b',
        rendering,
      }),
    ).toEqual({
      id: 'layer-human_footprint_2022',
      name: 'Human Footprint 2022',
      swatchType: 'gradient',
      color: '#991b1b',
      lineStyle: 'solid',
      lineWidth: 1,
      gradientStartColor: '#fee2e2',
      gradientEndColor: '#991b1b',
      gradientMinLabel: '0',
      gradientMaxLabel: '100',
    });
  });

  it('omits gradient labels when continuous raster min/max metadata is unavailable', () => {
    const rendering = {
      valueType: 'continuous',
      renderMode: 'gradient',
      minValue: null,
      maxValue: null,
      startColor: '#fef3c7',
      endColor: '#854d0e',
    } as const;

    const entry = buildContinuousGradientLegendEntry({
      id: 'layer-future-continuous-raster',
      name: 'Future Continuous Raster',
      color: '#854d0e',
      rendering,
    });

    expect(entry.swatchType).toBe('gradient');
    expect(entry.gradientStartColor).toBe('#fef3c7');
    expect(entry.gradientEndColor).toBe('#854d0e');
    expect(entry.gradientMinLabel).toBeUndefined();
    expect(entry.gradientMaxLabel).toBeUndefined();
  });
});

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
    expect(service.rightSidebarMode$()).toBe('overview');

    service.clearAOI();
    service.clearSolution();

    expect(service.selectedAOI$()).toBe(null);
    expect(service.activeSolution$()).toBe(null);
    expect(service.hasActiveSolution()).toBe(false);
    expect(service.rightSidebarMode$()).toBe('welcome');
  });

  it('tracks custom AOI geometry separately from fixed boundary selections', () => {
    const geometry: CustomPolygonMetricsGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [-74.1, 4.6],
          [-74.0, 4.6],
          [-74.0, 4.7],
          [-74.1, 4.6],
        ],
      ],
    };
    const fixedAoi: AOI = {
      id: 'municipality:11001',
      name: 'Bogota',
      type: 'municipality',
      geometryUrl: '/boundaries/municipalities.geojson',
    };

    service.selectCustomAOI(geometry, { name: 'Drawn test AOI', areaKm2: 12.5 });

    expect(service.customAOIGeometry$()).toEqual(geometry);
    expect(service.selectedAOI$()).toEqual(
      expect.objectContaining({
        id: 'custom:drawn-polygon',
        name: 'Drawn test AOI',
        type: 'custom',
        areaKm2: 12.5,
      }),
    );

    service.selectAOI(fixedAoi);

    expect(service.customAOIGeometry$()).toBeNull();
    expect(service.selectedAOI$()).toEqual(fixedAoi);
  });

  it('toggles layer visibility and updates sidebar mode', () => {
    const layers: LayerConfig[] = [
      {
        id: 'layer-a',
        name: 'Habitat',
        arcgisType: 'feature',
        category: 'ecology',
        visible: true,
        opacity: 1,
      },
      {
        id: 'layer-b',
        name: 'Communities',
        arcgisType: 'imagery-tile',
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
    expect(service.canAccessTier2()).toBe(environment.bypassLoginForDevelopment);

    service.comparisonSolution$.set(comparisonSolution);
    service.userTier$.set(UserTier.DecisionMaker);

    expect(service.isComparing()).toBe(true);
    expect(service.canAccessTier2()).toBe(true);
  });

  it('allows switching sidebar tabs while comparison data is present', () => {
    const comparisonSolution: Solution = {
      id: 'solution-2',
      name: 'Comparison Solution',
      matchPercentage: 68,
      geometryUrl: '/geometry/solution-2.json',
      metrics: [],
    };

    service.setComparisonSolution(comparisonSolution);
    service.setRightSidebarMode('comparison');
    service.setRightSidebarMode('overview');

    expect(service.rightSidebarMode$()).toBe('overview');
    expect(service.isComparing()).toBe(true);
  });
});
