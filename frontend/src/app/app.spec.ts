import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import Point from '@arcgis/core/geometry/Point';
import { AppStateService } from '@core/services/app-state.service';
import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import type { CatalogSolution } from '@core/models/solution-catalog.model';
import { AdminBoundaryService } from '@features/map/services/admin-boundary.service';
import { SolutionLayerService } from '@features/map/services/solution-layer.service';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideTranslateService({
          lang: 'es',
          fallbackLang: 'en',
          loader: provideTranslateLoader(TranslateNoOpLoader),
        }),
        provideRouter([]),
        provideNoopAnimations(),
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#map-panel-title')?.textContent).toContain('app.mapTitle');
  });

  it('renders the landing welcome modal on initial load', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#landing-welcome-modal-title')?.textContent).toContain(
      'landingWelcome.title',
    );
    expect(compiled.querySelector('#landing-welcome-modal-select-solution-button')).not.toBeNull();
  });

  it('opens the solution finder from the landing welcome modal', () => {
    const fixture = TestBed.createComponent(App);
    const appState = TestBed.inject(AppStateService);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    compiled
      .querySelector<HTMLButtonElement>('#landing-welcome-modal-select-solution-button')
      ?.click();

    expect(appState.solutionFinderModalOpen$()).toBe(true);
    expect(
      (fixture.componentInstance as unknown as { landingWelcomeModalOpen: boolean })
        .landingWelcomeModalOpen,
    ).toBe(false);
  });

  it('loads solution, switches sidebar mode, and shows toast when applying a solution', () => {
    const fixture = TestBed.createComponent(App);
    const component = fixture.componentInstance;
    const appState = TestBed.inject(AppStateService);
    const solutionCatalog = TestBed.inject(SolutionCatalogService);
    const solutionLayer = TestBed.inject(SolutionLayerService);
    const solution = buildManifestSolution();
    vi.spyOn(solutionCatalog, 'getById').mockReturnValue(solution);
    const showSolutionSpy = vi.spyOn(solutionLayer, 'showSolution').mockResolvedValue(undefined);
    appState.setComparisonSolution({
      id: 'sol-002',
      name: 'Comparison Candidate',
      description: 'Candidate',
      matchPercentage: 81,
      geometryUrl: '/geometry/sol-002.json',
      metrics: [],
      metadata: { solutionId: 'candidate-solution' },
    });

    (
      component as unknown as {
        onSolutionApplied: (match: { solutionId: string }) => void;
      }
    ).onSolutionApplied({
      solutionId: solution.id,
    });

    expect(appState.activeSolution$()?.id).toBe(solution.id);
    expect(appState.comparisonSolution$()).toBeNull();
    expect(appState.rightSidebarMode$()).toBe('overview');
    expect(showSolutionSpy).toHaveBeenCalledWith(solution.id, { syncAppState: false });
  });

  it('applies a real manifest solution id from the finder', () => {
    const fixture = TestBed.createComponent(App);
    const component = fixture.componentInstance;
    const appState = TestBed.inject(AppStateService);
    const solutionCatalog = TestBed.inject(SolutionCatalogService);
    const solutionLayer = TestBed.inject(SolutionLayerService);
    const solution = buildManifestSolution();
    vi.spyOn(solutionCatalog, 'getById').mockReturnValue(solution);
    const showSolutionSpy = vi.spyOn(solutionLayer, 'showSolution').mockResolvedValue(undefined);

    (
      component as unknown as {
        onSolutionApplied: (match: { solutionId: string }) => void;
      }
    ).onSolutionApplied({
      solutionId: solution.id,
    });

    expect(appState.activeSolution$()?.id).toBe(solution.id);
    expect(appState.activeSolution$()?.metadata?.['metadataUrl']).toBe(solution.metadataUrl);
    expect(appState.rightSidebarMode$()).toBe('overview');
    expect(showSolutionSpy).toHaveBeenCalledWith(solution.id, { syncAppState: false });
  });

  it('renders an active SIRAP boundary as non-interactive finder context', async () => {
    const fixture = TestBed.createComponent(App);
    const component = fixture.componentInstance;
    const appState = TestBed.inject(AppStateService);
    const solutionCatalog = TestBed.inject(SolutionCatalogService);
    const solutionLayer = TestBed.inject(SolutionLayerService);
    const adminBoundaries = TestBed.inject(AdminBoundaryService);
    const map = createMapMock();
    const view = createMapViewMock();
    const solution = buildSirapManifestSolution();
    const switchedSolution = buildSirapManifestSolution('orinoquia');
    vi.spyOn(solutionCatalog, 'getById').mockImplementation((id) =>
      id === switchedSolution.id ? switchedSolution : solution,
    );
    vi.spyOn(solutionLayer, 'showSolution').mockResolvedValue(undefined);

    adminBoundaries.initialize(map as never, view as never);
    (
      component as unknown as {
        onSolutionApplied: (match: { solutionId: string }) => void;
      }
    ).onSolutionApplied({ solutionId: solution.id });
    TestBed.tick();

    const activeBoundary = map.layers.find((layer) => layer.id === 'aoi-active-sirap-boundary') as {
      definitionExpression?: string;
      renderer?: { symbol?: { outline?: { width?: number } } };
    };
    const countryOutline = map.layers.find(
      (layer) => layer.id === 'aoi-country-outline-colombia',
    ) as { renderer?: { symbol?: { outline?: { width?: number } } } };

    expect(appState.activeSolution$()?.metadata).toMatchObject({
      scope: 'sirap',
      sirapId: 'eje-cafetero',
    });
    expect(activeBoundary.definitionExpression).toBe("sirap_id = 'thematic_eje_cafetero_1'");
    expect(activeBoundary.renderer?.symbol?.outline?.width).toBe(3);
    expect(countryOutline.renderer?.symbol?.outline?.width).toBe(0.8);
    expect(map.layers.indexOf(activeBoundary as { id: string })).toBeGreaterThan(
      map.layers.indexOf(countryOutline as { id: string }),
    );

    (
      component as unknown as {
        onSolutionApplied: (match: { solutionId: string }) => void;
      }
    ).onSolutionApplied({ solutionId: switchedSolution.id });
    TestBed.tick();

    const switchedBoundary = map.layers.find(
      (layer) => layer.id === 'aoi-active-sirap-boundary',
    ) as { definitionExpression?: string };
    expect(switchedBoundary).not.toBe(activeBoundary);
    expect(switchedBoundary.definitionExpression).toBe(
      "sirap_id = 'territorial_territorial_orinoquia_7'",
    );

    view.handlers.get('click')?.({
      mapPoint: new Point({ x: -75.5, y: 4.5 }),
      x: 100,
      y: 100,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(view.hitTest).not.toHaveBeenCalled();
    expect(appState.selectedAOI$()).toBeNull();
    expect(appState.rightSidebarMode$()).toBe('overview');
  });
});

function createMapMock() {
  const layers: { id: string }[] = [];
  return {
    layers,
    add: vi.fn((layer: { id: string }) => layers.push(layer)),
    addMany: vi.fn((newLayers: { id: string }[]) => layers.push(...newLayers)),
    remove: vi.fn((layer: { id: string }) => {
      const index = layers.indexOf(layer);
      if (index >= 0) layers.splice(index, 1);
    }),
    reorder: vi.fn((layer: { id: string }, index: number) => {
      const currentIndex = layers.indexOf(layer);
      if (currentIndex >= 0) layers.splice(currentIndex, 1);
      layers.splice(index, 0, layer);
    }),
  };
}

function createMapViewMock() {
  const handlers = new Map<string, (event: unknown) => void>();
  return {
    handlers,
    popupEnabled: true,
    highlights: [],
    allLayerViews: [],
    container: document.createElement('div'),
    whenLayerView: vi.fn().mockResolvedValue({}),
    on: vi.fn((eventName: string, handler: (event: unknown) => void) => {
      handlers.set(eventName, handler);
      return { remove: vi.fn() };
    }),
    hitTest: vi.fn(),
    goTo: vi.fn().mockResolvedValue(undefined),
  };
}

function buildManifestSolution(): CatalogSolution {
  return {
    id: 'ecos30_runap_hf',
    filename: 'Ecos30+RUNAP_HF.tif',
    name: 'Ecos30+RUNAP_HF',
    description: '30% ecosystem target with RUNAP and human footprint cost.',
    scope: 'nacional',
    sirapId: null,
    displayUrl: 'https://example.test/Ecos30+RUNAP_HF.tif',
    metadataUrl: 'https://example.test/Ecos30+RUNAP_HF.json',
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
    constraints: ['RUNAP'],
    costLayer: 'Human Footprint',
    nSelected: 387656,
    totalCost: 0,
    pctTargetsMet: 100,
  };
}

function buildSirapManifestSolution(
  sirapId: 'eje-cafetero' | 'orinoquia' = 'eje-cafetero',
): CatalogSolution {
  const base = buildManifestSolution();
  return {
    ...base,
    id: `${sirapId}-sirap-solution`,
    name: `${sirapId} SIRAP solution`,
    scope: 'sirap',
    sirapId,
    finderInputs: {
      ...base.finderInputs,
      scope: 'sirap',
    },
  };
}
