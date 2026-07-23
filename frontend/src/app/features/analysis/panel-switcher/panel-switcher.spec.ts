import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { of, Subject, throwError } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { AppLocaleService } from '@core/services/app-locale.service';
import { wrapFlatMetricsResponse } from '@core/services/cached-metrics.utils';
import type {
  AOI,
  CachedSolutionMetricsDocument,
  CatalogSolution,
  CustomPolygonMetricsGeometry,
  CustomPolygonMetricsResponse,
  MetricComparisonValue,
  MetricValue,
  Solution,
  SolutionGoalsDocument,
} from '@core/models';
import { AppStateService } from '@core/services/app-state.service';
import { MockDataService } from '@core/services/mock-data.service';
import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import { SolutionGoalsLoaderService } from '@core/services/solution-goals-loader.service';
import { PanelSwitcherComponent } from './panel-switcher';

describe('PanelSwitcherComponent', () => {
  let appState: AppStateService;
  let appLocale: AppLocaleService;
  let mockData: MockDataService;
  let apiServiceSpy: Pick<ApiService, 'getSolutionMetrics' | 'getCustomPolygonMetrics'>;
  let goalsDocument: SolutionGoalsDocument | null;

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockData = new MockDataService();
    goalsDocument = null;
    apiServiceSpy = {
      getSolutionMetrics: vi.fn((solutionId: string) => {
        const flat = mockData.getSolutionMetrics(solutionId);
        return of(
          flat
            ? wrapFlatMetricsResponse(flat)
            : {
                solutionId,
                generatedAt: '2026-03-17T00:00:00.000Z',
                geographies: { national: { colombia: { metrics: [] } } },
              },
        );
      }),
      getCustomPolygonMetrics: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [PanelSwitcherComponent],
      providers: [
        { provide: ApiService, useValue: apiServiceSpy },
        {
          provide: SolutionGoalsLoaderService,
          useValue: { loadGoals: vi.fn(() => of(goalsDocument)) },
        },
        {
          provide: HttpClient,
          useValue: {
            get: vi.fn(() =>
              of({
                classifications: [
                  {
                    view: 'broadEcosystem',
                    values: Array.from({ length: 28 }, (_, index) => ({
                      label: `Ecosystem ${index + 1}`,
                    })),
                  },
                ],
              }),
            ),
          },
        },
        provideTranslateService({
          lang: 'en',
          fallbackLang: 'en',
          loader: provideTranslateLoader(TranslateNoOpLoader),
        }),
      ],
    }).compileComponents();

    appState = TestBed.inject(AppStateService);
    appLocale = TestBed.inject(AppLocaleService);
    appLocale.setLocale('es');
    mockData = TestBed.inject(MockDataService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the welcome panel by default', () => {
    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#right-sidebar-welcome-panel')).not.toBeNull();
    expect(compiled.querySelector('#solution-overview-panel')).toBeNull();
  });

  it('renders an empty analysis state when no solution is active', () => {
    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('#right-sidebar-welcome-panel')).not.toBeNull();
    expect(compiled.querySelector('#right-sidebar-welcome-get-started-button')).toBeNull();
    expect(compiled.querySelector('#right-sidebar-welcome-title')?.textContent).toContain(
      'analysis.empty.title',
    );
    expect(compiled.querySelector('#right-sidebar-welcome-hero-card')).toBeNull();
  });

  it('renders overview content for an active solution', () => {
    const solution = mockData.getSolutionById('sol-001');
    expect(solution).not.toBeNull();

    appState.activeSolution$.set(solution);
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#solution-overview-panel')).not.toBeNull();
  });

  it('disables AOI and comparison tabs when no solution is active', () => {
    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const aoiTab = compiled.querySelector('#right-sidebar-panel-tab-aoi') as HTMLButtonElement;
    const comparisonTab = compiled.querySelector(
      '#right-sidebar-panel-tab-comparison',
    ) as HTMLButtonElement;

    expect(aoiTab.disabled).toBe(true);
    expect(comparisonTab.disabled).toBe(true);
  });

  it('switches tabs from overview to aoi when clicked and a solution is active', () => {
    const solution = mockData.getSolutionById('sol-001');
    expect(solution).not.toBeNull();
    appState.activeSolution$.set(solution!);
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const aoiTabButton = compiled.querySelector(
      '#right-sidebar-panel-tab-aoi',
    ) as HTMLButtonElement;
    expect(aoiTabButton).not.toBeNull();
    expect(aoiTabButton.disabled).toBe(false);

    aoiTabButton.click();
    fixture.detectChanges();

    expect(compiled.querySelector('#aoi-dashboard-empty-state')).not.toBeNull();
    expect(compiled.querySelector('#right-sidebar-welcome-panel')).toBeNull();
  });

  it('starts custom AOI with fast metrics and renders them without waiting for species', async () => {
    const solution = buildTestSolution();
    const geometry = buildTestGeometry();
    const fastResponse = buildCustomPolygonResponse({
      priority_area_in_region: 2.5,
      national_contribution: 1.25,
      carbon_storage_biomass: 40,
      carbon_biomass_total: 40,
      carbon_pct_of_national: 3.5,
      ecosystem_coverage_paramo: 0.5,
    });
    const fastMetrics$ = new Subject<CustomPolygonMetricsResponse>();
    const speciesMetrics$ = new Subject<CustomPolygonMetricsResponse>();
    vi.mocked(apiServiceSpy.getCustomPolygonMetrics).mockImplementation((request) =>
      request.metrics?.includes('species_richness_mammals')
        ? speciesMetrics$.asObservable()
        : fastMetrics$.asObservable(),
    );

    appState.activeSolution$.set(solution);
    appState.setRightSidebarMode('aoi');
    appState.selectCustomAOI(geometry, { name: 'Drawn AOI', areaKm2: 10 });

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();

    expect(apiServiceSpy.getCustomPolygonMetrics).toHaveBeenCalledWith({
      geometry,
      metrics: expect.arrayContaining(['priority_area_in_region', 'carbon_storage_biomass']),
    });
    expect(apiServiceSpy.getCustomPolygonMetrics).not.toHaveBeenCalledWith({
      geometry,
      metrics: expect.arrayContaining(['species_richness_mammals']),
    });

    fastMetrics$.next(fastResponse);
    fastMetrics$.complete();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(apiServiceSpy.getCustomPolygonMetrics).toHaveBeenCalledWith({
      geometry,
      metrics: expect.arrayContaining(['species_richness_mammals']),
    });
    expect(compiled.querySelector('#aoi-custom-metrics-status')).toBeNull();
    expect(compiled.querySelector('#aoi-custom-metrics-summary-grid')).toBeNull();
    expect(compiled.querySelector('#aoi-dashboard-scope-explanation')?.textContent).toContain(
      'analysis.aoi.scopeExplanation',
    );
    expect(compiled.querySelector('#aoi-overview-aligned-title')?.textContent).toContain(
      'analysis.aoi.alignedMetrics.title',
    );
    expect(
      compiled.querySelector('#aoi-overview-aligned-value-aoi-summary-priority-area')?.textContent,
    ).toContain('2,5 km²');
    expect(
      compiled.querySelector('#aoi-overview-aligned-name-aoi-summary-priority-area')?.textContent,
    ).toContain('analysis.aoi.alignedMetrics.priorityAreaDrawn');
    expect(
      compiled.querySelector('#aoi-overview-aligned-value-aoi-summary-carbon')?.textContent,
    ).toContain('40 Mg');
    expect(compiled.querySelector('#aoi-strategic-value-paramos')?.textContent).toContain('20%');
    expect(compiled.querySelector('#aoi-strategic-description')?.textContent).toContain(
      'analysis.aoi.strategic.customDescription',
    );
    expect(compiled.querySelector('#aoi-local-drilldown-title')?.textContent).toContain(
      'analysis.aoi.drillDown.title',
    );
    const biodiversityLoadingStatus = compiled.querySelector(
      '#aoi-biodiversity-species-loading-status',
    );
    expect(biodiversityLoadingStatus).not.toBeNull();
    expect(biodiversityLoadingStatus?.getAttribute('role')).toBe('status');
    expect(biodiversityLoadingStatus?.getAttribute('aria-live')).toBe('polite');
    const biodiversityLoadingSpinner = compiled.querySelector(
      '#aoi-biodiversity-species-loading-spinner',
    );
    expect(biodiversityLoadingSpinner).not.toBeNull();
    expect(biodiversityLoadingSpinner?.getAttribute('aria-hidden')).toBe('true');
    expect(biodiversityLoadingStatus?.textContent).toContain(
      'analysis.aoi.customMetrics.speciesLoading.initial.small',
    );
    expect(compiled.querySelector('#aoi-biodiversity-species-progressbar')).toBeNull();
    expect(compiled.querySelector('#aoi-hero-priority')?.textContent).toContain('2,5 km²');
    expect(compiled.querySelector('#aoi-hero-priority')?.textContent).toContain('25%');
    expect(compiled.querySelector('#aoi-hero-national')?.textContent).toContain('1,3%');
    expect(compiled.querySelector('#aoi-species-value-mammals')?.textContent).toContain('--');
    expect(compiled.querySelector('#aoi-stat-above-carbon')?.textContent).toContain('40 Mg');

    const hectaresToggle = compiled.querySelector(
      '#aoi-dashboard-area-unit-toggle-hectares',
    ) as HTMLButtonElement;
    hectaresToggle.click();
    fixture.detectChanges();

    expect(compiled.querySelector('#aoi-hero-priority')?.textContent).toContain('250 ha');
    expect(compiled.querySelector('#aoi-hero-priority')?.textContent).toContain('25%');
    expect(compiled.querySelector('#aoi-hero-national')?.textContent).toContain('1,3%');
    expect(compiled.querySelector('#aoi-stat-above-carbon')?.textContent).toContain('40 Mg');

    speciesMetrics$.complete();
  });

  it('advances custom AOI species loading guidance after elapsed time', () => {
    vi.useFakeTimers();
    const solution = buildTestSolution();
    const geometry = buildTestGeometry();
    const fastMetrics$ = new Subject<CustomPolygonMetricsResponse>();
    const speciesMetrics$ = new Subject<CustomPolygonMetricsResponse>();
    vi.mocked(apiServiceSpy.getCustomPolygonMetrics).mockImplementation((request) =>
      request.metrics?.includes('species_richness_mammals')
        ? speciesMetrics$.asObservable()
        : fastMetrics$.asObservable(),
    );

    appState.activeSolution$.set(solution);
    appState.setRightSidebarMode('aoi');
    appState.selectCustomAOI(geometry, { name: 'Drawn AOI', areaKm2: 10 });

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    fastMetrics$.next(
      buildCustomPolygonResponse({
        priority_area_in_region: 2.5,
        national_contribution: 1.25,
        carbon_storage_biomass: 40,
      }),
    );
    fastMetrics$.complete();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const loadingStatus = () => compiled.querySelector('#aoi-biodiversity-species-loading-status');
    expect(loadingStatus()?.textContent).toContain(
      'analysis.aoi.customMetrics.speciesLoading.initial.small',
    );

    vi.advanceTimersByTime(10_000);
    fixture.detectChanges();
    expect(loadingStatus()?.textContent).toContain(
      'analysis.aoi.customMetrics.speciesLoading.delayed.longerThanExpected',
    );

    vi.advanceTimersByTime(50_000);
    fixture.detectChanges();
    expect(loadingStatus()?.textContent).toContain(
      'analysis.aoi.customMetrics.speciesLoading.extended',
    );

    speciesMetrics$.complete();
    fixture.destroy();
  });

  it('selects custom AOI biodiversity estimate copy from AOI area bands', () => {
    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    const component = fixture.componentInstance as unknown as {
      getCustomAoiSpeciesLoadingKey(): string;
    };

    appState.selectedAOI$.set(buildCustomAoiWithArea(10));
    expect(component.getCustomAoiSpeciesLoadingKey()).toBe(
      'analysis.aoi.customMetrics.speciesLoading.initial.small',
    );

    appState.selectedAOI$.set(buildCustomAoiWithArea(5_000));
    expect(component.getCustomAoiSpeciesLoadingKey()).toBe(
      'analysis.aoi.customMetrics.speciesLoading.initial.medium',
    );

    appState.selectedAOI$.set(buildCustomAoiWithArea(60_000));
    expect(component.getCustomAoiSpeciesLoadingKey()).toBe(
      'analysis.aoi.customMetrics.speciesLoading.initial.large',
    );

    appState.selectedAOI$.set(buildCustomAoiWithArea(100_000));
    expect(component.getCustomAoiSpeciesLoadingKey()).toBe(
      'analysis.aoi.customMetrics.speciesLoading.initial.veryLarge',
    );
  });

  it('merges species metrics into custom AOI metrics when the second request returns', async () => {
    const solution = buildTestSolution();
    const geometry = buildTestGeometry();
    const fastMetrics$ = new Subject<CustomPolygonMetricsResponse>();
    const speciesMetrics$ = new Subject<CustomPolygonMetricsResponse>();
    vi.mocked(apiServiceSpy.getCustomPolygonMetrics).mockImplementation((request) =>
      request.metrics?.includes('species_richness_mammals')
        ? speciesMetrics$.asObservable()
        : fastMetrics$.asObservable(),
    );

    appState.activeSolution$.set(solution);
    appState.setRightSidebarMode('aoi');
    appState.selectCustomAOI(geometry, { name: 'Drawn AOI', areaKm2: 10 });

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    fastMetrics$.next(
      buildCustomPolygonResponse({
        priority_area_in_region: 2.5,
        national_contribution: 1.25,
        carbon_storage_biomass: 40,
      }),
    );
    fastMetrics$.complete();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(apiServiceSpy.getCustomPolygonMetrics).toHaveBeenCalledWith({
      geometry,
      metrics: expect.arrayContaining(['species_richness_mammals']),
    });
    const speciesRequest = vi
      .mocked(apiServiceSpy.getCustomPolygonMetrics)
      .mock.calls.find(([request]) => request.metrics?.includes('species_richness_mammals'))?.[0];
    expect(speciesRequest?.metrics).toEqual([
      'species_richness_mammals',
      'species_richness_birds',
      'species_richness_amphibians',
      'species_richness_reptiles',
      'species_richness_plants',
      'threatened_species_count',
      'species_pct_of_national',
    ]);

    speciesMetrics$.next(
      buildCustomPolygonResponse({
        species_richness_mammals: 4,
        species_richness_birds: 9,
        species_richness_amphibians: 1,
        species_richness_reptiles: 2,
        species_richness_plants: 7,
        threatened_species_count: 3,
        species_pct_of_national: 1.4,
      }),
    );
    speciesMetrics$.complete();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#aoi-custom-species-metrics-loading')).toBeNull();
    expect(compiled.querySelector('#aoi-biodiversity-species-loading-status')).toBeNull();
    expect(compiled.querySelector('#aoi-biodiversity-species-loading-spinner')).toBeNull();
    expect(compiled.querySelector('#aoi-biodiversity-species-progressbar')).toBeNull();
    expect(compiled.querySelector('#aoi-species-value-mammals')?.textContent).toContain('4');
    expect(compiled.querySelector('#aoi-species-value-birds')?.textContent).toContain('9');
    expect(compiled.querySelector('#aoi-species-value-amphibians')?.textContent).toContain('1');
    expect(compiled.querySelector('#aoi-species-value-reptiles')?.textContent).toContain('2');
    expect(compiled.querySelector('#aoi-species-value-plants')?.textContent).toContain('7');
    expect(compiled.querySelector('#aoi-stat-threatened')?.textContent).toContain('3');
    expect(compiled.querySelector('#aoi-stat-national-species')?.textContent).toContain('1,4%');
    expect(compiled.querySelector('#aoi-stat-endemic')?.textContent).toContain('--');
  });

  it('keeps fast custom AOI metrics visible when the species request fails', async () => {
    const solution = buildTestSolution();
    const geometry = buildTestGeometry();
    const fastMetrics$ = new Subject<CustomPolygonMetricsResponse>();
    const speciesMetrics$ = new Subject<CustomPolygonMetricsResponse>();
    vi.mocked(apiServiceSpy.getCustomPolygonMetrics).mockImplementation((request) =>
      request.metrics?.includes('species_richness_mammals')
        ? speciesMetrics$.asObservable()
        : fastMetrics$.asObservable(),
    );

    appState.activeSolution$.set(solution);
    appState.setRightSidebarMode('aoi');
    appState.selectCustomAOI(geometry, { name: 'Drawn AOI', areaKm2: 10 });

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    fastMetrics$.next(
      buildCustomPolygonResponse({
        priority_area_in_region: 2.5,
        national_contribution: 1.25,
        carbon_storage_biomass: 40,
      }),
    );
    fastMetrics$.complete();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(apiServiceSpy.getCustomPolygonMetrics).toHaveBeenCalledWith({
      geometry,
      metrics: expect.arrayContaining(['species_richness_mammals']),
    });

    speciesMetrics$.error(new Error('species request timed out'));
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#aoi-custom-metrics-status')).toBeNull();
    expect(compiled.querySelector('#aoi-custom-species-metrics-warning')).toBeNull();
    expect(compiled.querySelector('#aoi-biodiversity-species-loading-status')).toBeNull();
    expect(compiled.querySelector('#aoi-biodiversity-species-loading-spinner')).toBeNull();
    expect(compiled.querySelector('#aoi-biodiversity-species-progressbar')).toBeNull();
    expect(compiled.querySelector('#aoi-hero-priority')?.textContent).toContain('2,5 km²');
    expect(compiled.querySelector('#aoi-stat-above-carbon')?.textContent).toContain('40 Mg');
    expect(compiled.querySelector('#aoi-species-value-mammals')?.textContent).toContain('--');
  });

  it('keeps fixed boundary AOIs on cached metrics instead of the backend client', async () => {
    const solution = buildTestSolution();
    const cachedDocument = buildCachedAoiMetricsDocument(solution.id, [
      buildMetric('priority_area_in_region', 9, 'km²', 'number'),
      buildMetric('national_contribution', 0.9, '%', 'percent'),
    ]);
    vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(of(cachedDocument));

    appState.activeSolution$.set(solution);
    appState.selectAOI({
      id: 'municipality:11001',
      name: 'Bogota',
      type: 'municipality',
      geometryUrl: '/boundaries/municipalities.geojson',
      areaKm2: 30,
    });
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(apiServiceSpy.getSolutionMetrics).toHaveBeenCalledWith(solution.id);
    expect(apiServiceSpy.getCustomPolygonMetrics).not.toHaveBeenCalled();
    expect(compiled.querySelector('#aoi-custom-metrics-status')).toBeNull();
    expect(compiled.querySelector('#aoi-hero-priority')?.textContent).toContain('9 km²');
    expect(compiled.querySelector('#aoi-hero-priority')?.textContent).toContain('30%');
  });

  it('renders separate ecosystems, strategic ecosystems, and carbon sections', async () => {
    const solution = buildTestSolution();
    vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(
      of(
        buildCachedAoiMetricsDocument(solution.id, [
          buildMetric('priority_area_in_region', 10, 'km²', 'number'),
          buildMetric('ecosystem_coverage_paramo', 2, 'km²', 'number'),
          buildMetric('ecosystem_coverage_wetlands', 15, 'km²', 'number'),
          buildMetric('carbon_storage_biomass', 40, 'Mg', 'number'),
        ]),
      ),
    );
    appState.activeSolution$.set(solution);
    appState.selectAOI({
      id: 'municipality:11001',
      name: 'Bogota',
      type: 'municipality',
      geometryUrl: '/boundaries/municipalities.geojson',
      areaKm2: 20,
    });
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('#aoi-section-ecosystems')).not.toBeNull();
    expect(compiled.querySelector('#aoi-section-strategic')).not.toBeNull();
    expect(compiled.querySelector('#aoi-section-carbon')).not.toBeNull();
    expect(compiled.querySelector('#aoi-strategic-value-paramos')?.textContent).toContain('20%');
    expect(compiled.querySelector('#aoi-strategic-value-wetlands')?.textContent).toContain('100%');
    expect(compiled.querySelector('#aoi-stat-above-carbon')?.textContent).toContain('40 Mg');
  });

  it('shows the integrated MEC count and CTA only for drilldown views', () => {
    appState.activeSolution$.set(buildTestSolution());
    appState.selectAOI(buildCustomAoiWithArea(20));
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const select = compiled.querySelector('#aoi-mec-breakdown-select') as HTMLSelectElement;

    expect(compiled.querySelector('#aoi-mec-preview-count-row')).not.toBeNull();
    expect(compiled.querySelector('#aoi-mec-open-modal-button')).not.toBeNull();

    select.value = 'family';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(compiled.querySelector('#aoi-mec-preview-count-row')).toBeNull();
    expect(compiled.querySelector('#aoi-mec-open-modal-button')).toBeNull();
  });

  it('derives the IAvH run badge from the active catalog solution targets', () => {
    const solutionCatalog = TestBed.inject(SolutionCatalogService);
    const getById = vi.spyOn(solutionCatalog, 'getById').mockReturnValue({
      id: 'ecosystem-solution',
      name: 'Ecosystem Solution',
      finderInputs: {
        targetFeatureSet: 'ecosystems',
        targetFeatureIds: ['ecosistemas'],
      },
      inputLayerIds: {
        features: ['ecosistemas'],
      },
    } as unknown as CatalogSolution);
    appState.activeSolution$.set({
      ...buildTestSolution(),
      id: 'ecosystem-solution',
    });

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    const component = fixture.componentInstance as unknown as {
      iavhConsideredInRun(): boolean;
    };

    expect(component.iavhConsideredInRun()).toBe(true);

    getById.mockReturnValue({
      id: 'strategic-solution',
      name: 'Strategic Solution',
      finderInputs: {
        targetFeatureSet: 'strategic-ecosystems',
        targetFeatureIds: ['paramos'],
      },
      inputLayerIds: {
        features: ['paramos'],
      },
    } as unknown as CatalogSolution);
    appState.activeSolution$.set({
      ...buildTestSolution(),
      id: 'strategic-solution',
    });
    const strategicFixture = TestBed.createComponent(PanelSwitcherComponent);
    const strategicComponent = strategicFixture.componentInstance as unknown as {
      iavhConsideredInRun(): boolean;
    };

    expect(strategicComponent.iavhConsideredInRun()).toBe(false);
  });

  it('opens and closes the MEC coverage modal with the shared modal shell', async () => {
    appState.activeSolution$.set(buildTestSolution());
    appState.selectAOI(buildCustomAoiWithArea(20));
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const opener = compiled.querySelector('#aoi-mec-open-modal-button') as HTMLButtonElement;

    opener.focus();
    opener.click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const dialog = compiled.querySelector('#aoi-mec-classifications-modal') as HTMLDialogElement;
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.open).toBe(true);
    expect(dialog.classList.contains('w-screen')).toBe(true);
    expect(dialog.classList.contains('max-md:p-0')).toBe(true);
    expect(compiled.querySelector('#aoi-mec-classifications-modal-panel')).not.toBeNull();

    (
      compiled.querySelector('#aoi-mec-classifications-modal-close-button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 230));
    expect(opener.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(opener);
  });

  it('gates MEC preview and modal coverage values behind the dummy flag', () => {
    appState.activeSolution$.set(buildTestSolution());
    appState.selectAOI(buildCustomAoiWithArea(20));
    appState.setRightSidebarMode('aoi');
    appState.setFillDummyAoiMetrics(true);

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('#aoi-mec-unavailable-state')).toBeNull();
    expect(compiled.querySelector('#aoi-mec-bar-value-0')?.textContent).toContain('32%');

    (compiled.querySelector('#aoi-mec-open-modal-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('#aoi-mec-modal-unavailable-state')).toBeNull();
    expect(compiled.querySelector('[id^="aoi-mec-modal-available-"]')?.textContent).not.toContain(
      '--',
    );
  });

  it('shows an honest unavailable state without synthetic MEC AOI values', () => {
    appState.activeSolution$.set(buildTestSolution());
    appState.selectAOI(buildCustomAoiWithArea(20));
    appState.setRightSidebarMode('aoi');
    appState.setFillDummyAoiMetrics(false);

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('#aoi-mec-unavailable-state')).not.toBeNull();
    expect(compiled.querySelector('#aoi-mec-bar-value-0')?.textContent ?? '--').toContain('--');

    (compiled.querySelector('#aoi-mec-open-modal-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('#aoi-mec-modal-unavailable-state')).not.toBeNull();
    expect(compiled.querySelector('#aoi-mec-modal-aoi-area-value')?.textContent).toContain('20');
    expect(compiled.querySelector('#aoi-mec-modal-candidate-area-value')?.textContent).toContain(
      '--',
    );
  });

  it('normalizes comparison units and converts only area metrics to hectares', () => {
    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    const component = fixture.componentInstance as unknown as {
      formatMetricValue(metric: MetricValue): string;
      formatDelta(metric: MetricComparisonValue): string;
    };
    const areaMetric = buildMetric('priority_area_in_region', 9, 'km2', 'number');
    const carbonMetric = buildMetric('carbon_storage_biomass', 40, 'Mg·km²', 'number');
    const percentMetric = buildMetric('national_contribution', 1.25, '%', 'percent');
    const areaComparison: MetricComparisonValue = {
      metricId: 'priority_area_in_region',
      labelKey: 'metrics.priority_area_total',
      formatHint: 'number',
      baseline: buildMetric('priority_area_in_region', 7, 'km2', 'number'),
      candidate: areaMetric,
      delta: 2,
    };

    expect(component.formatMetricValue(areaMetric)).toBe('9 km²');
    expect(component.formatMetricValue(carbonMetric)).toBe('40 Mg·km²');
    expect(component.formatMetricValue(percentMetric)).toBe('1,3%');
    expect(component.formatDelta(areaComparison)).toBe('+2 km²');

    appState.setAreaDisplayUnit('hectares');

    expect(component.formatMetricValue(areaMetric)).toBe('900 ha');
    expect(component.formatMetricValue(carbonMetric)).toBe('40 Mg·km²');
    expect(component.formatMetricValue(percentMetric)).toBe('1,3%');
    expect(component.formatDelta(areaComparison)).toBe('+200 ha');
  });

  it('separates configured targets from measured additional outcomes', () => {
    goalsDocument = buildGoalsDocument();
    appState.activeSolution$.set(buildTestSolution());
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(
      compiled.querySelector('#right-sidebar-v3-overview-goals-domain-ecosystems'),
    ).not.toBeNull();
    expect(
      compiled.querySelector('#right-sidebar-v3-overview-goals-additional-domain-species'),
    ).not.toBeNull();
    expect(
      compiled.querySelector('#right-sidebar-v3-overview-goals-additional-domain-count-17-species')
        ?.textContent,
    ).toContain('2');
    expect(
      compiled.querySelector('#right-sidebar-v3-overview-goals-additional-domain-count-30-species')
        ?.textContent,
    ).toContain('1');
    expect(compiled.querySelector('#right-sidebar-v3-overview-goals-domain-species')).toBeNull();
  });

  it('opens and filters the additional outcomes feature modal', async () => {
    goalsDocument = buildGoalsDocument();
    appState.activeSolution$.set(buildTestSolution());
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    (
      compiled.querySelector(
        '#right-sidebar-v3-overview-goals-additional-domain-view-species',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((compiled.querySelector('#conservation-goals-modal') as HTMLDialogElement).open).toBe(
      true,
    );
    expect(compiled.querySelectorAll('[id^="conservation-goals-modal-row-"]')).toHaveLength(3);
    expect(compiled.querySelector('#conservation-goals-modal-heading-checkpoints')).not.toBeNull();
    expect(compiled.querySelector('#conservation-goals-modal-heading-target')).toBeNull();

    const filter = compiled.querySelector(
      '#conservation-goals-modal-filter-select',
    ) as HTMLSelectElement;
    filter.value = 'reached30';
    filter.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(compiled.querySelectorAll('[id^="conservation-goals-modal-row-"]')).toHaveLength(1);
    expect(
      compiled.querySelector('#conservation-goals-modal-feature-name-0')?.textContent,
    ).toContain('Andean bear');
  });

  it('falls back when custom AOI backend loading fails', async () => {
    const solution = buildTestSolution();
    const geometry = buildTestGeometry();
    vi.mocked(apiServiceSpy.getCustomPolygonMetrics).mockReturnValue(
      throwError(() => new Error('backend unavailable')),
    );

    appState.activeSolution$.set(solution);
    appState.setRightSidebarMode('aoi');
    appState.selectCustomAOI(geometry);

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(apiServiceSpy.getCustomPolygonMetrics).toHaveBeenCalledOnce();
    expect(compiled.querySelector('#aoi-custom-metrics-status')).toBeNull();
    expect(compiled.querySelector('#aoi-custom-metrics-error')).toBeNull();
    expect(compiled.querySelector('#aoi-hero-priority')?.textContent).toContain('--');
  });

  it('formats metric decimals with the active app locale', () => {
    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    const component = fixture.componentInstance as unknown as {
      getGoalsAchievedPercent(value: number): string;
    };

    appLocale.setLocale('es');
    expect(component.getGoalsAchievedPercent(49.1)).toBe('49,1');

    appLocale.setLocale('en');
    expect(component.getGoalsAchievedPercent(49.1)).toBe('49.1');
  });
});

function buildTestSolution(): Solution {
  return {
    id: 'test-solution',
    name: 'Test Solution',
    matchPercentage: 80,
    geometryUrl: '/geometry/test-solution.geojson',
    metrics: [],
  };
}

function buildGoalsDocument(): SolutionGoalsDocument {
  const species = [
    buildGoalFeature('species-1', 'Andean bear', 'species', 0.35, false, 'Mammals', 'VU'),
    buildGoalFeature('species-2', 'Bogota rail', 'species', 0.2, false, 'Birds', 'EN'),
    buildGoalFeature('species-3', 'Tree frog', 'species', 0.1, false, 'Amphibians', 'LC'),
  ];
  const ecosystems = [
    buildGoalFeature('ecosystem-1', 'Andean forest', 'ecosystems', 0.35, true),
    buildGoalFeature('ecosystem-2', 'Dry forest', 'ecosystems', 0.2, false),
  ];
  const strategicEcosystems = [
    buildGoalFeature('strategic-1', 'Páramos', 'strategicEcosystems', 0.4, false),
  ];

  return {
    format: 'conservation-goals-v1',
    solutionId: 'test-solution',
    solutionName: 'Test Solution',
    generatedAt: '2026-07-23T00:00:00.000Z',
    source: {
      summaryCsvUrl: null,
      summaryCsvRows: 6,
      speciesLookupUrl: '/species.csv',
    },
    targetContext: {
      finderTargetPercent: 30,
      targetFeatureSet: 'ecosystems',
      targetFeatureIds: ['ecosistemas'],
      relativeTargetsByType: {
        species: [0.3],
        strategicEcosystems: [0.3],
        ecosystems: [0.3],
      },
    },
    summary: {
      metCount: 1,
      totalCount: 6,
      pctMet: 50,
      byType: {
        species: { metSpeciesCount: 0, totalSpeciesCount: 3, pctMet: 0 },
        strategicEcosystems: { metCount: 0, totalCount: 1, pctMet: 0 },
        ecosystems: { metCount: 1, totalCount: 2, pctMet: 50 },
        other: { metCount: 0, totalCount: 0, pctMet: null },
      },
    },
    rollups: {
      species: {
        metSpeciesCount: 0,
        totalSpeciesCount: 3,
        pctMet: 0,
        byTaxa: {
          Mammals: { label: 'Mammals', metSpeciesCount: 0, totalSpeciesCount: 1, pctMet: 0 },
          Birds: { label: 'Birds', metSpeciesCount: 0, totalSpeciesCount: 1, pctMet: 0 },
          Amphibians: {
            label: 'Amphibians',
            metSpeciesCount: 0,
            totalSpeciesCount: 1,
            pctMet: 0,
          },
        },
        byIucnStatus: {},
        unmatchedSpeciesCount: 0,
        ignoredSpeciesRowCount: 0,
      },
      strategicEcosystems: { metCount: 0, totalCount: 1, pctMet: 0 },
      ecosystems: { metCount: 1, totalCount: 2, pctMet: 50 },
    },
    features: { species, strategicEcosystems, ecosystems, other: [] },
    diagnostics: { rawTypeCounts: {}, rowCounts: {} },
  };
}

function buildGoalFeature(
  featureId: string,
  featureName: string,
  featureType: 'species' | 'strategicEcosystems' | 'ecosystems',
  relativeHeld: number,
  met: boolean,
  taxonGroup: string | null = null,
  iucnStatus: string | null = null,
) {
  return {
    featureId,
    featureName,
    featureType,
    met,
    totalAmount: 100,
    absoluteTarget: 30,
    absoluteHeld: relativeHeld * 100,
    absoluteShortfall: Math.max(0, 30 - relativeHeld * 100),
    relativeTarget: 0.3,
    relativeHeld,
    relativeShortfall: Math.max(0, 0.3 - relativeHeld),
    scenario: 'test',
    taxonGroup,
    iucnStatus,
  };
}

function buildTestGeometry(): CustomPolygonMetricsGeometry {
  return {
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
}

function buildCustomAoiWithArea(areaKm2: number): AOI {
  return {
    id: 'custom:drawn-polygon',
    name: 'Drawn AOI',
    type: 'custom',
    geometryUrl: 'custom-polygon://drawn-aoi',
    areaKm2,
  };
}

function buildCustomPolygonResponse(
  metrics: NonNullable<CustomPolygonMetricsResponse['metrics']>,
): CustomPolygonMetricsResponse {
  return {
    status: 'ok',
    message: 'Custom polygon metrics calculated from the loaded runtime artifact.',
    artifact_state: {
      required: true,
      available: true,
      manifest_path: '/opt/dmt/metrics-artifacts/manifest.json',
      schema_version: 'metrics-artifact-manifest/v1',
      artifact_version: 'test-artifact',
      checksum: 'test-checksum',
      message: 'Artifact loaded.',
      warmup_status: 'ready',
      warmup_ms: 1,
      loaded_at: '2026-06-04T00:00:00.000Z',
      metadata: {},
    },
    requested_metrics: Object.keys(metrics),
    metrics,
    metadata: {},
  };
}

function buildCachedAoiMetricsDocument(
  solutionId: string,
  metrics: MetricValue[],
): CachedSolutionMetricsDocument {
  return {
    solutionId,
    generatedAt: '2026-06-04T00:00:00.000Z',
    geographies: {
      national: { colombia: { metrics: [] } },
      municipalities: {
        '11001': {
          name: 'Bogota',
          metrics,
        },
      },
    },
  };
}

function buildMetric(
  metricId: string,
  value: number,
  unit: string,
  formatHint: MetricValue['formatHint'],
): MetricValue {
  return {
    metricId,
    value,
    unit,
    status: 'ready',
    source: 'cached-test',
    notes: null,
    labelKey: `metrics.${metricId}`,
    formatHint,
  };
}
