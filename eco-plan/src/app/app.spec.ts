import { TestBed } from '@angular/core/testing';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { AppStateService } from '@core/services/app-state.service';
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
});
