import { TestBed } from '@angular/core/testing';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { AppStateService } from '@core/services/app-state.service';
import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import type { SolutionScenario } from '@core/models/solution-scenario.model';
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
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
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

  it('loads solution, switches sidebar mode, and shows toast when applying a scenario', () => {
    const fixture = TestBed.createComponent(App);
    const component = fixture.componentInstance;
    const appState = TestBed.inject(AppStateService);
    const solutionLayer = TestBed.inject(SolutionLayerService);
    const showSolutionSpy = vi.spyOn(solutionLayer, 'showSolution').mockResolvedValue(undefined);
    appState.setComparisonSolution({
      id: 'sol-002',
      name: 'Comparison Candidate',
      description: 'Candidate',
      matchPercentage: 81,
      geometryUrl: '/geometry/sol-002.json',
      metrics: [],
      metadata: { scenarioId: 'candidate-scenario' },
    });

    (
      component as unknown as {
        onScenarioApplied: (match: { solutionId: string; scenarioId: string }) => void;
      }
    ).onScenarioApplied({
      solutionId: 'sol-001',
      scenarioId: 'Ecos30+RUNAP_HF',
    });

    expect(appState.activeSolution$()?.id).toBe('sol-001');
    expect(appState.comparisonSolution$()).toBeNull();
    expect(appState.rightSidebarMode$()).toBe('overview');
    expect(showSolutionSpy).toHaveBeenCalledWith('Ecos30+RUNAP_HF');
    expect(
      (component as unknown as { solutionLoadedToastVisible: boolean }).solutionLoadedToastVisible,
    ).toBe(true);
  });

  it('applies a real manifest solution id from the finder', () => {
    const fixture = TestBed.createComponent(App);
    const component = fixture.componentInstance;
    const appState = TestBed.inject(AppStateService);
    const solutionCatalog = TestBed.inject(SolutionCatalogService);
    const solutionLayer = TestBed.inject(SolutionLayerService);
    const scenario = buildManifestScenario();
    vi.spyOn(solutionCatalog, 'getById').mockReturnValue(scenario);
    const showSolutionSpy = vi.spyOn(solutionLayer, 'showSolution').mockResolvedValue(undefined);

    (
      component as unknown as {
        onScenarioApplied: (match: { solutionId: string; scenarioId: string }) => void;
      }
    ).onScenarioApplied({
      solutionId: scenario.id,
      scenarioId: scenario.id,
    });

    expect(appState.activeSolution$()?.id).toBe(scenario.id);
    expect(appState.activeSolution$()?.metadata?.['metadataUrl']).toBe(scenario.metadataUrl);
    expect(appState.rightSidebarMode$()).toBe('overview');
    expect(showSolutionSpy).toHaveBeenCalledWith(scenario.id);
  });

  it('prefers manifest solution records over mock solution ids when applying a scenario', () => {
    const fixture = TestBed.createComponent(App);
    const component = fixture.componentInstance;
    const appState = TestBed.inject(AppStateService);
    const solutionCatalog = TestBed.inject(SolutionCatalogService);
    const solutionLayer = TestBed.inject(SolutionLayerService);
    const scenario = buildManifestScenario();
    vi.spyOn(solutionCatalog, 'getById').mockImplementation((id: string) =>
      id === scenario.id ? scenario : null,
    );
    const showSolutionSpy = vi.spyOn(solutionLayer, 'showSolution').mockResolvedValue(undefined);

    (
      component as unknown as {
        onScenarioApplied: (match: { solutionId: string; scenarioId: string }) => void;
      }
    ).onScenarioApplied({
      solutionId: 'sol-001',
      scenarioId: scenario.id,
    });

    expect(appState.activeSolution$()?.id).toBe(scenario.id);
    expect(appState.activeSolution$()?.name).toBe(scenario.name);
    expect(showSolutionSpy).toHaveBeenCalledWith(scenario.id);
  });
});

function buildManifestScenario(): SolutionScenario {
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
