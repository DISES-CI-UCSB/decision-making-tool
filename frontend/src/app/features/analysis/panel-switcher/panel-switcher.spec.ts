import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { By } from '@angular/platform-browser';
import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
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
  CustomAoiAreaProfileResponse,
  CustomPolygonMetricsGeometry,
  CustomPolygonMetricsResponse,
  MecCompactDocument,
  MecCompactV2Document,
  MetricComparisonValue,
  MetricValue,
  Solution,
  SolutionGoalsDocument,
} from '@core/models';
import { AppStateService } from '@core/services/app-state.service';
import { MockDataService } from '@core/services/mock-data.service';
import {
  MecMetricsLoaderService,
  type MecMetricsLoadResult,
} from '@core/services/mec-metrics-loader.service';
import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import { SolutionGoalsLoaderService } from '@core/services/solution-goals-loader.service';
import { PanelSwitcherComponent } from './panel-switcher';

describe('PanelSwitcherComponent', () => {
  let appState: AppStateService;
  let appLocale: AppLocaleService;
  let mockData: MockDataService;
  let apiServiceSpy: Pick<
    ApiService,
    'getSolutionMetrics' | 'getCustomPolygonMetrics' | 'getCustomAoiAreaProfile'
  >;
  let mecMetricsLoaderSpy: Pick<MecMetricsLoaderService, 'loadMecMetrics'>;
  let httpClientSpy: { get: ReturnType<typeof vi.fn> };
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
      getCustomAoiAreaProfile: vi.fn((request) =>
        of({
          format: 'custom-aoi-area-profile-v1' as const,
          status: 'partial',
          selection: {
            status: 'unavailable' as const,
            selected_cell_count: null,
            available_cell_count: null,
            area_km2: null,
            source: 'test',
          },
          sections:
            request.sections[0] === 'species'
              ? { species: { status: 'unavailable' as const, records: [] } }
              : {
                  ecosystems: {
                    status: 'unavailable' as const,
                    canonical_summary_view: 'broadEcosystem' as const,
                    classified_area_km2: 0,
                    views: [],
                  },
                },
        }),
      ),
    };
    mecMetricsLoaderSpy = {
      loadMecMetrics: vi.fn(() => of({ status: 'unavailable' as const, document: null })),
    };
    httpClientSpy = {
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
    };

    await TestBed.configureTestingModule({
      imports: [PanelSwitcherComponent],
      providers: [
        { provide: ApiService, useValue: apiServiceSpy },
        { provide: MecMetricsLoaderService, useValue: mecMetricsLoaderSpy },
        {
          provide: SolutionGoalsLoaderService,
          useValue: { loadGoals: vi.fn(() => of(goalsDocument)) },
        },
        {
          provide: HttpClient,
          useValue: httpClientSpy,
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

  it('hosts the custom species inventory only inside the shared Biodiversity section', async () => {
    vi.mocked(apiServiceSpy.getCustomPolygonMetrics).mockReturnValue(
      of(buildCustomPolygonResponse({ priority_area_in_region: 2.5 })),
    );
    appState.selectCustomAOI(buildTestGeometry(), { name: 'Drawn AOI', areaKm2: 10 });
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const biodiversitySection = compiled.querySelector('#aoi-section-bio');
    const inventory = compiled.querySelector('#aoi-biodiversity-species-inventory');

    expect(inventory).not.toBeNull();
    expect(biodiversitySection?.contains(inventory)).toBe(true);
    expect(compiled.querySelector('#aoi-dashboard-custom-area-profile')).toBeNull();
    expect(compiled.querySelector('#custom-aoi-area-profile')).toBeNull();
    const openButton = compiled.querySelector(
      '#aoi-biodiversity-open-species-inventory-button',
    ) as HTMLButtonElement;
    expect(openButton).not.toBeNull();
    openButton.click();
    fixture.detectChanges();
    expect(openButton.getAttribute('aria-expanded')).toBe('true');
    expect(compiled.querySelector('#custom-aoi-species-inventory-modal')).not.toBeNull();
    expect(compiled.querySelector('#aoi-dashboard-area-unit-toggle')).not.toBeNull();
    expect(compiled.querySelector('#aoi-section-general')).not.toBeNull();
    expect(compiled.querySelector('#aoi-dashboard-download-metrics-csv-btn')).not.toBeNull();
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
    expect(compiled.querySelector('#aoi-dashboard-sirap-whole-feature-context')).toBeNull();
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
    expect(compiled.querySelector('#aoi-species-value-mammals')).toBeNull();
    expect(compiled.querySelector('#aoi-stat-threatened')).toBeNull();
    expect(compiled.querySelector('#aoi-stat-endemic')).toBeNull();
    expect(compiled.querySelector('#aoi-stat-national-species')).toBeNull();
    expect(compiled.querySelector('#aoi-body-bio')?.textContent).not.toContain('--');
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
    expect(compiled.querySelector('#aoi-stat-endemic')).toBeNull();
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
    expect(compiled.querySelector('#aoi-biodiversity-species-failure')).not.toBeNull();
    expect(compiled.querySelector('#aoi-biodiversity-species-retry-button')).not.toBeNull();
    expect(compiled.querySelector('#aoi-biodiversity-species-loading-status')).toBeNull();
    expect(compiled.querySelector('#aoi-biodiversity-species-loading-spinner')).toBeNull();
    expect(compiled.querySelector('#aoi-biodiversity-species-progressbar')).toBeNull();
    expect(compiled.querySelector('#aoi-hero-priority')?.textContent).toContain('2,5 km²');
    expect(compiled.querySelector('#aoi-stat-above-carbon')?.textContent).toContain('40 Mg');
    expect(compiled.querySelector('#aoi-species-value-mammals')).toBeNull();
    expect(compiled.querySelector('#aoi-stat-endemic')).toBeNull();
    expect(compiled.querySelector('#aoi-body-bio')?.textContent).not.toContain('--');

    vi.mocked(apiServiceSpy.getCustomPolygonMetrics).mockReturnValue(
      of(
        buildCustomPolygonResponse({
          species_richness_mammals: 4,
          species_richness_birds: 9,
          species_richness_amphibians: 1,
          species_richness_reptiles: 2,
          species_richness_plants: 7,
          threatened_species_count: 3,
          species_pct_of_national: 1.4,
        }),
      ),
    );
    (compiled.querySelector('#aoi-biodiversity-species-retry-button') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compiled.querySelector('#aoi-biodiversity-species-failure')).toBeNull();
    expect(compiled.querySelector('#aoi-species-value-mammals')?.textContent).toContain('4');
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

  it('renders fixed-AOI marine coverage from compact metrics and prioritized area', async () => {
    const solution = buildTestSolution();
    const solutionCatalog = TestBed.inject(SolutionCatalogService);
    vi.spyOn(solutionCatalog, 'getById').mockReturnValue({
      id: solution.id,
      domain: 'marine',
    } as CatalogSolution);
    vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(
      of(
        buildCachedAoiMetricsDocument(solution.id, [
          buildMetric('priority_area_in_region', 20, 'km²', 'number'),
          buildMetric('coral_reef_coverage', 5, 'km²', 'number'),
          buildMetric('marine_mangrove_coverage', 0, 'km²', 'number'),
          buildMetric('mangrove_coverage', 9, 'km²', 'number'),
          buildMetric('seagrass_coverage', 2.5, 'km²', 'number'),
        ]),
      ),
    );
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

    expect(compiled.querySelector('#aoi-biodiversity-species-inventory')).toBeNull();
    expect(compiled.querySelector('#aoi-section-marine')).not.toBeNull();
    expect(compiled.querySelector('#aoi-row-coral-value')?.textContent).toContain('5 km²');
    expect(compiled.querySelector('#aoi-row-coral-unit')?.textContent).toContain('25%');
    expect(compiled.querySelector('#aoi-row-mangrove-value')?.textContent).toContain('0 km²');
    expect(compiled.querySelector('#aoi-row-mangrove-value')?.textContent).not.toContain('9 km²');
    expect(compiled.querySelector('#aoi-row-mangrove-unit')?.textContent).toContain('0%');
    expect(compiled.querySelector('#aoi-row-seagrass-value')?.textContent).toContain('2,5 km²');
    expect(compiled.querySelector('#aoi-row-seagrass-unit')?.textContent).toContain('12,5%');
    expect(compiled.querySelector('#aoi-row-mpa-value')?.textContent).toContain('--');
    expect(compiled.querySelector('#aoi-row-eez-value')?.textContent).toContain('--');
    expect(compiled.querySelector('#aoi-row-mpa-conditional')).not.toBeNull();
    expect(compiled.querySelector('#aoi-row-eez-conditional')).not.toBeNull();
    expect(
      compiled.querySelector('#aoi-row-mpa-unavailable-trigger')?.getAttribute('aria-describedby'),
    ).toBe('aoi-row-mpa-unavailable-tooltip');
    expect(
      compiled.querySelector('#aoi-row-eez-unavailable-trigger')?.getAttribute('aria-describedby'),
    ).toBe('aoi-row-eez-unavailable-tooltip');
  });

  it('omits marine Section F for land solutions', async () => {
    const solution = buildTestSolution();
    const solutionCatalog = TestBed.inject(SolutionCatalogService);
    vi.spyOn(solutionCatalog, 'getById').mockReturnValue({
      id: solution.id,
      domain: 'land',
    } as CatalogSolution);
    vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(
      of(
        buildCachedAoiMetricsDocument(solution.id, [
          buildMetric('priority_area_in_region', 20, 'km²', 'number'),
          buildMetric('coral_reef_coverage', 5, 'km²', 'number'),
        ]),
      ),
    );
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

    expect((fixture.nativeElement as HTMLElement).querySelector('#aoi-section-marine')).toBeNull();
  });

  it('keeps custom marine AOI coverage unavailable without dummy or API values', async () => {
    const solution = buildTestSolution();
    const solutionCatalog = TestBed.inject(SolutionCatalogService);
    vi.spyOn(solutionCatalog, 'getById').mockReturnValue({
      id: solution.id,
      domain: 'marine',
    } as CatalogSolution);
    vi.mocked(apiServiceSpy.getCustomPolygonMetrics).mockReturnValue(
      of(buildCustomPolygonResponse({ priority_area_in_region: 2.5 })),
    );
    appState.activeSolution$.set(solution);
    appState.setFillDummyAoiMetrics(true);
    appState.selectCustomAOI(buildTestGeometry(), { name: 'Drawn marine AOI', areaKm2: 10 });
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('#aoi-section-marine')).not.toBeNull();
    expect(compiled.querySelector('#aoi-row-coral-value')?.textContent.trim()).toBe('--');
    expect(compiled.querySelector('#aoi-row-coral-unit')?.textContent.trim()).toBe('--');
    expect(compiled.querySelector('#aoi-row-mangrove-value')?.textContent.trim()).toBe('--');
    expect(compiled.querySelector('#aoi-row-mangrove-unit')?.textContent.trim()).toBe('--');
    expect(compiled.querySelector('#aoi-row-seagrass-value')?.textContent.trim()).toBe('--');
    expect(compiled.querySelector('#aoi-row-seagrass-unit')?.textContent.trim()).toBe('--');
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

  it('renders real MEC rows for a fixed AOI with candidate-share preview values', async () => {
    const solution = buildTestSolution();
    vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(
      of(
        buildCachedAoiMetricsDocument(solution.id, [
          buildMetric('priority_area_in_region', 8, 'km²', 'number'),
        ]),
      ),
    );
    vi.mocked(mecMetricsLoaderSpy.loadMecMetrics).mockReturnValue(
      of({
        status: 'loaded',
        document: buildMecDocument(solution.id),
        format: 'mec-compact-v1',
      }),
    );
    appState.activeSolution$.set(solution);
    appState.selectAOI(buildFixedMunicipalityAoi());
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(mecMetricsLoaderSpy.loadMecMetrics).toHaveBeenCalledWith(solution.id, 'municipalities');
    expect(compiled.querySelector('#aoi-mec-unavailable-state')).toBeNull();
    expect(compiled.querySelector('#aoi-mec-bar-label-0')?.textContent).toContain('Forest');
    expect(compiled.querySelector('#aoi-mec-bar-value-0')?.textContent).toContain('50%');

    (compiled.querySelector('#aoi-mec-open-modal-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(
      compiled.querySelector('#aoi-mec-modal-available-broadecosystem-forest')?.textContent,
    ).toContain('10');
    expect(
      compiled.querySelector('#aoi-mec-modal-coverage-values-broadecosystem-forest')?.textContent,
    ).toContain('0% + 40%');
  });

  it('renders v2 ecosystem share from scope area and exposes unclassified share', async () => {
    const solution = buildTestSolution();
    vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(
      of(
        buildCachedAoiMetricsDocument(solution.id, [
          buildMetric('priority_area_in_region', 8, 'km²', 'number'),
        ]),
      ),
    );
    vi.mocked(mecMetricsLoaderSpy.loadMecMetrics).mockReturnValue(
      of({
        status: 'loaded',
        document: buildV2MecDocument(solution.id),
        format: 'mec-compact-v2',
      }),
    );
    appState.activeSolution$.set(solution);
    appState.selectAOI(buildFixedMunicipalityAoi());
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('#aoi-mec-bar-value-0')?.textContent).toContain('50%');
    expect(compiled.querySelector('#aoi-mec-source')?.textContent).toContain(
      'analysis.aoi.mec.source',
    );

    (compiled.querySelector('#aoi-mec-open-modal-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('#aoi-mec-modal-unclassified-value')?.textContent).toContain(
      '20%',
    );
    expect(
      compiled.querySelector('#aoi-mec-modal-coverage-values-broadecosystem-forest')?.textContent,
    ).toContain('0% + 40%');
  });

  it('renders real rows for all five MEC views even when dummy AOI metrics are enabled', async () => {
    const solution = buildTestSolution();
    vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(
      of(
        buildCachedAoiMetricsDocument(solution.id, [
          buildMetric('priority_area_in_region', 8, 'km²', 'number'),
        ]),
      ),
    );
    vi.mocked(mecMetricsLoaderSpy.loadMecMetrics).mockReturnValue(
      of({
        status: 'loaded',
        document: buildFiveViewMecDocument(solution.id),
        format: 'mec-compact-v1',
      }),
    );
    appState.activeSolution$.set(solution);
    appState.selectAOI(buildFixedMunicipalityAoi());
    appState.setFillDummyAoiMetrics(true);
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const select = compiled.querySelector('#aoi-mec-breakdown-select') as HTMLSelectElement;
    const views = [
      ['family', '#aoi-mec-legend-label-0', '#aoi-mec-legend-value-0', 'Family real'],
      ['context', '#aoi-mec-legend-label-0', '#aoi-mec-legend-value-0', 'Context real'],
      ['broad', '#aoi-mec-bar-label-0', '#aoi-mec-bar-value-0', 'Broad real'],
      ['detailed', '#aoi-mec-bar-label-0', '#aoi-mec-bar-value-0', 'Detailed real'],
      ['iavh', '#aoi-mec-bar-label-0', '#aoi-mec-bar-value-0', 'IAvH real'],
    ] as const;

    for (const [breakdown, rowSelector, valueSelector, expectedLabel] of views) {
      select.value = breakdown;
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(compiled.querySelector(rowSelector)?.textContent).toContain(expectedLabel);
      expect(compiled.querySelector(valueSelector)?.textContent).toContain('50%');
      expect(compiled.querySelector('#aoi-mec-breakdown-select')?.textContent).toContain('(1)');
    }
  });

  it('keeps loaded MEC rows when the classification-summary fallback fails', async () => {
    const solution = buildTestSolution();
    httpClientSpy.get.mockReturnValue(throwError(() => new Error('summary unavailable')));
    vi.mocked(mecMetricsLoaderSpy.loadMecMetrics).mockReturnValue(
      of({
        status: 'loaded',
        document: buildMecDocument(solution.id),
        format: 'mec-compact-v1',
      }),
    );
    appState.activeSolution$.set(solution);
    appState.selectAOI(buildFixedMunicipalityAoi());
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('#aoi-mec-unavailable-state')).toBeNull();
    expect(compiled.querySelector('#aoi-mec-bar-label-0')?.textContent).toContain('Forest');
  });

  it('loads custom AOI ecosystems live without requesting MEC shards', async () => {
    const geometry = buildTestGeometry();
    vi.mocked(apiServiceSpy.getCustomPolygonMetrics).mockReturnValue(
      of(buildCustomPolygonResponse({ priority_area_in_region: 2 })),
    );
    appState.activeSolution$.set(buildTestSolution());
    appState.selectCustomAOI(geometry, { name: 'Drawn AOI', areaKm2: 20 });
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mecMetricsLoaderSpy.loadMecMetrics).not.toHaveBeenCalled();
    expect(apiServiceSpy.getCustomAoiAreaProfile).toHaveBeenCalledWith({
      geometry,
      sections: ['ecosystems'],
      solution_id: 'test-solution',
    });
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#aoi-mec-unavailable-title')
        ?.textContent,
    ).toContain('analysis.aoi.mec.states.custom.unavailableTitle');
  });

  it('renders all custom ecosystem presence and coverage measures in one table', async () => {
    const geometry = buildTestGeometry();
    vi.mocked(apiServiceSpy.getCustomPolygonMetrics).mockReturnValue(
      of(buildCustomPolygonResponse({ priority_area_in_region: 5 })),
    );
    vi.mocked(apiServiceSpy.getCustomAoiAreaProfile).mockImplementation((request) =>
      of(
        request.sections[0] === 'ecosystems'
          ? buildCustomEcosystemProfileResponse()
          : {
              ...buildCustomEcosystemProfileResponse(),
              sections: { species: { status: 'unavailable' as const, records: [] } },
            },
      ),
    );
    appState.activeSolution$.set(buildTestSolution());
    appState.selectCustomAOI(geometry, { name: 'Drawn AOI', areaKm2: 10 });
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const ecosystemCalls = vi
      .mocked(apiServiceSpy.getCustomAoiAreaProfile)
      .mock.calls.filter(([request]) => request.sections[0] === 'ecosystems');

    expect(ecosystemCalls).toHaveLength(1);
    expect(mecMetricsLoaderSpy.loadMecMetrics).not.toHaveBeenCalled();
    expect(compiled.querySelector('#custom-aoi-profile-ecosystems')).toBeNull();
    expect(compiled.querySelector('#aoi-mec-bar-label-0')?.textContent).toContain('Andean forest');
    expect(compiled.querySelector('#aoi-mec-bar-value-0')?.textContent).toContain('80%');

    (compiled.querySelector('#aoi-mec-open-modal-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelectorAll('#aoi-mec-modal-table')).toHaveLength(1);
    expect(compiled.querySelector('#aoi-mec-modal-mode-tabs')).toBeNull();
    expect(compiled.querySelector('#aoi-mec-modal-composition-tab')).toBeNull();
    expect(compiled.querySelector('#aoi-mec-modal-coverage-tab')).toBeNull();
    expect(compiled.querySelector('#aoi-mec-modal-heading-presence-group')?.textContent).toContain(
      'analysis.aoi.mec.modal.presenceGroup',
    );
    expect(compiled.querySelector('#aoi-mec-modal-heading-coverage-group')?.textContent).toContain(
      'analysis.aoi.mec.modal.coverageGroup',
    );
    expect(compiled.querySelector('#aoi-mec-modal-heading-available')?.textContent).toContain(
      'analysis.aoi.mec.modal.areaInsideAoi',
    );
    expect(compiled.querySelector('#aoi-mec-modal-heading-national-share')?.textContent).toContain(
      'analysis.aoi.mec.modal.nationalExtentInsideAoi',
    );
    expect(compiled.querySelector('#aoi-mec-modal-heading-aoi-share')?.textContent).toContain(
      'analysis.aoi.mec.modal.mappedAoiOccupied',
    );
    expect(
      compiled.querySelector('#aoi-mec-modal-heading-pre-existing-coverage')?.textContent,
    ).toContain('analysis.aoi.mec.modal.preExistingCoverage');
    expect(compiled.querySelector('#aoi-mec-modal-heading-new-coverage')?.textContent).toContain(
      'analysis.aoi.mec.modal.newCoverage',
    );
    expect(compiled.querySelector('#aoi-mec-modal-available-forest')?.textContent).toContain('8');
    const percentageMeasures = [
      ['national-share', '20%', '8 km²'],
      ['aoi-share', '80%', '8 km²'],
      ['total-coverage', '50%', '4 km²'],
      ['pre-existing-coverage', '12,5%', '1 km²'],
      ['new-coverage', '37,5%', '3 km²'],
    ] as const;
    for (const [metricId, expectedPercent, expectedArea] of percentageMeasures) {
      const measureId = `aoi-mec-modal-${metricId}-forest`;
      const measure = compiled.querySelector(`#${measureId}-measure`);
      const bar = compiled.querySelector(`#${measureId}-bar`);

      expect(measure?.textContent).toContain(expectedPercent);
      expect(measure?.textContent).toContain(expectedArea);
      expect(bar).not.toBeNull();
      expect(bar?.getAttribute('aria-label')).toContain('Andean forest');
      expect(bar?.getAttribute('aria-label')).toContain(expectedPercent);
      expect(bar?.getAttribute('aria-label')).toContain(expectedArea);
    }
    expect(
      compiled.querySelector('#aoi-mec-classifications-modal-body')?.textContent,
    ).not.toContain('--');
  });

  it('clamps custom ecosystem bar width without changing the displayed percentage', () => {
    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    const component = fixture.componentInstance as unknown as {
      clampMecBarPercent(value: number): number;
      formatCustomMecAreaKm2(value: number): string;
      formatMecCoveragePercent(value: number | null): string;
    };

    expect(component.clampMecBarPercent(-4)).toBe(0);
    expect(component.clampMecBarPercent(42.5)).toBe(42.5);
    expect(component.clampMecBarPercent(140)).toBe(100);
    expect(component.formatMecCoveragePercent(140)).toBe('140%');

    appState.setAreaDisplayUnit('hectares');
    expect(component.formatCustomMecAreaKm2(1.25)).toBe('1,3 km²');
  });

  it('keeps one custom table visible and populates coverage after solution selection', async () => {
    const geometry = buildTestGeometry();
    vi.mocked(apiServiceSpy.getCustomPolygonMetrics).mockReturnValue(
      of(buildCustomPolygonResponse({ priority_area_in_region: 5 })),
    );
    vi.mocked(apiServiceSpy.getCustomAoiAreaProfile).mockImplementation((request) =>
      of(
        request.sections[0] === 'ecosystems'
          ? buildCustomEcosystemProfileResponse(request.solution_id ?? null)
          : {
              ...buildCustomEcosystemProfileResponse(null),
              sections: { species: { status: 'unavailable' as const, records: [] } },
            },
      ),
    );
    appState.selectCustomAOI(geometry, { name: 'Drawn AOI', areaKm2: 10 });
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    let ecosystemCalls = vi
      .mocked(apiServiceSpy.getCustomAoiAreaProfile)
      .mock.calls.filter(([request]) => request.sections[0] === 'ecosystems');

    expect(ecosystemCalls).toHaveLength(1);
    expect(ecosystemCalls[0][0]).toEqual({ geometry, sections: ['ecosystems'] });
    expect(compiled.querySelector('#aoi-mec-bar-label-0')?.textContent).toContain('Andean forest');

    (compiled.querySelector('#aoi-mec-open-modal-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    const table = compiled.querySelector('#aoi-mec-modal-table');
    expect(table).not.toBeNull();
    expect(compiled.querySelectorAll('#aoi-mec-modal-table')).toHaveLength(1);
    expect(compiled.querySelector('#aoi-mec-modal-mode-tabs')).toBeNull();
    expect(compiled.querySelector('#aoi-mec-modal-coverage-solution-guidance')).not.toBeNull();
    expect(compiled.querySelector('#aoi-mec-modal-available-forest')?.textContent).toContain('8');
    expect(compiled.querySelector('#aoi-mec-modal-national-share-forest')?.textContent).toContain(
      '20%',
    );
    expect(compiled.querySelector('#aoi-mec-modal-aoi-share-forest')?.textContent).toContain('80%');
    expect(compiled.querySelector('#aoi-mec-modal-total-coverage-forest')?.textContent).toContain(
      'analysis.aoi.mec.modal.coverageNotCalculated',
    );
    expect(compiled.querySelector('#aoi-mec-modal-national-share-forest-bar')).not.toBeNull();
    expect(compiled.querySelector('#aoi-mec-modal-aoi-share-forest-bar')).not.toBeNull();
    expect(compiled.querySelector('#aoi-mec-modal-total-coverage-forest-bar')).toBeNull();
    expect(compiled.querySelector('#aoi-mec-modal-pre-existing-coverage-forest-bar')).toBeNull();
    expect(compiled.querySelector('#aoi-mec-modal-new-coverage-forest-bar')).toBeNull();
    expect(
      compiled.querySelector('#aoi-mec-classifications-modal-body')?.textContent,
    ).not.toContain('--');

    appState.activeSolution$.set(buildTestSolution());
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    ecosystemCalls = vi
      .mocked(apiServiceSpy.getCustomAoiAreaProfile)
      .mock.calls.filter(([request]) => request.sections[0] === 'ecosystems');

    expect(ecosystemCalls).toHaveLength(2);
    expect(ecosystemCalls[1][0]).toEqual({
      geometry,
      sections: ['ecosystems'],
      solution_id: 'test-solution',
    });
    expect(compiled.querySelector('#aoi-mec-modal-table')).toBe(table);
    expect(compiled.querySelector('#aoi-mec-modal-coverage-solution-guidance')).toBeNull();
    expect(compiled.querySelector('#aoi-mec-modal-total-coverage-forest')?.textContent).toContain(
      '50%',
    );
  });

  it.each([
    ['_6', 'SIRAP Caribe'],
    ['_5', 'SIRAP Andes Occidentales'],
    ['_10', 'SIRAP Pacifico'],
    ['_9', 'SIRAP Caribe'],
    ['_7', 'SIRAP Orinoquia'],
  ])('loads MEC for complete merged SIRAP %s without a scope warning', async (scopeId, name) => {
    vi.mocked(mecMetricsLoaderSpy.loadMecMetrics).mockReturnValue(
      of({
        status: 'loaded',
        document: buildV2MecDocument('test-solution', {
          geographyLevel: 'siraps',
          scopeId,
          scopeName: name,
          boundaryProvenanceRef: 'siraps',
        }),
        format: 'mec-compact-v2',
      }),
    );
    appState.activeSolution$.set(buildTestSolution());
    appState.selectAOI({
      id: `sirap:${scopeId}`,
      name,
      type: 'sirap',
      geometryUrl: 'https://example.com/inputs/boundaries/sirap/siraps_merged_polygon_v2.geojson',
      boundarySourceLayerKey: 'siraps',
      boundarySourceId: 'aoi-siraps-combined-colombia',
      boundaryGeometrySelection: 'whole-feature',
    });
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mecMetricsLoaderSpy.loadMecMetrics).toHaveBeenCalledWith('test-solution', 'siraps');
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#aoi-mec-unavailable-state')).toBeNull();
    expect(compiled.querySelector('#aoi-dashboard-scope-strip')).toBeNull();
    expect(compiled.querySelector('#aoi-dashboard-scope-polygon-btn')).toBeNull();
    expect(compiled.querySelector('#aoi-dashboard-scope-whole-btn')).toBeNull();
    const wholeFeatureContext = compiled.querySelector(
      '#aoi-dashboard-sirap-whole-feature-context',
    );
    expect(wholeFeatureContext?.textContent).toContain('analysis.aoi.sirapWholeFeatureContext');
    expect(wholeFeatureContext?.getAttribute('role')).toBe('note');
    expect(wholeFeatureContext?.getAttribute('aria-label')).toBe(
      'analysis.aoi.sirapWholeFeatureContext',
    );
    const csvMetadata = (
      fixture.componentInstance as unknown as {
        buildAoiCsvMetadata(): { exportDetails: string[][] };
      }
    ).buildAoiCsvMetadata();
    expect(csvMetadata.exportDetails).toContainEqual([
      'analysis.exports.metadata.sirapScope',
      'analysis.aoi.scopeFull',
    ]);
  });

  it('blocks crafted component provenance but accepts whole-feature provenance', async () => {
    vi.mocked(mecMetricsLoaderSpy.loadMecMetrics).mockReturnValue(
      of({
        status: 'loaded',
        document: buildV2MecDocument('test-solution', {
          geographyLevel: 'siraps',
          scopeId: 'caribe',
          scopeName: 'SIRAP Caribe',
          boundaryProvenanceRef: 'siraps',
        }),
        format: 'mec-compact-v2',
      }),
    );
    const componentAoi: AOI = {
      id: 'sirap:caribe',
      name: 'SIRAP Caribe',
      type: 'sirap',
      geometryUrl: 'https://example.com/inputs/boundaries/sirap/siraps_merged_polygon_v2.geojson',
      boundarySourceLayerKey: 'siraps',
      boundarySourceId: 'aoi-siraps-combined-colombia',
      boundaryGeometrySelection: 'component',
    };
    appState.activeSolution$.set(buildTestSolution());
    appState.selectAOI(componentAoi);
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();

    expect(mecMetricsLoaderSpy.loadMecMetrics).not.toHaveBeenCalled();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#aoi-mec-unavailable-title')
        ?.textContent,
    ).toContain('analysis.aoi.mec.states.partialSirapTitle');

    appState.selectAOI({ ...componentAoi, boundaryGeometrySelection: 'whole-feature' });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mecMetricsLoaderSpy.loadMecMetrics).toHaveBeenCalledWith('test-solution', 'siraps');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#aoi-mec-unavailable-state'),
    ).toBeNull();
  });

  it.each([
    ['territorial', 'siraps_territorial', 'aoi-siraps-territorial-colombia'],
    ['thematic', 'siraps_thematic', 'aoi-siraps-thematic-colombia'],
  ])('loads metrics for a whole %s SIRAP source', (_, boundarySourceLayerKey, boundarySourceId) => {
    appState.activeSolution$.set(buildTestSolution());
    appState.selectAOI({
      id: 'sirap:_5',
      name: 'Separate SIRAP source',
      type: 'sirap',
      geometryUrl: '/inputs/boundaries/sirap/separate.geojson',
      boundarySourceLayerKey,
      boundarySourceId,
      boundaryGeometrySelection: 'whole-feature',
    });
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();

    expect(mecMetricsLoaderSpy.loadMecMetrics).toHaveBeenCalledWith('test-solution', 'siraps');
  });

  it('blocks legacy SIRAP selections without provenance', () => {
    appState.activeSolution$.set(buildTestSolution());
    appState.selectAOI({
      id: 'sirap:_7',
      name: 'SIRAP Orinoquia',
      type: 'sirap',
      geometryUrl: 'https://example.com/inputs/boundaries/sirap/siraps_merged_polygon_v2.geojson',
    });
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();

    expect(mecMetricsLoaderSpy.loadMecMetrics).not.toHaveBeenCalled();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#aoi-mec-unavailable-title')
        ?.textContent,
    ).toContain('analysis.aoi.mec.states.partialSirapTitle');
  });

  it('does not request MEC shards for marine solutions', () => {
    const solution = buildTestSolution();
    vi.spyOn(TestBed.inject(SolutionCatalogService), 'getById').mockReturnValue({
      id: solution.id,
      domain: 'marine',
    } as CatalogSolution);
    appState.activeSolution$.set(solution);
    appState.selectAOI(buildFixedMunicipalityAoi());
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();

    expect(mecMetricsLoaderSpy.loadMecMetrics).not.toHaveBeenCalled();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#aoi-mec-unavailable-title')
        ?.textContent,
    ).toContain('analysis.aoi.mec.states.marineTitle');
  });

  it('renders accessible loading and load-error states', () => {
    const response = new Subject<MecMetricsLoadResult>();
    vi.mocked(mecMetricsLoaderSpy.loadMecMetrics).mockReturnValue(response);
    appState.activeSolution$.set(buildTestSolution());
    appState.selectAOI(buildFixedMunicipalityAoi());
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const status = compiled.querySelector('#aoi-mec-unavailable-state');

    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.textContent).toContain('analysis.aoi.mec.states.loadingTitle');

    response.next({ status: 'error', document: null, error: 'http' });
    fixture.detectChanges();
    expect(status?.getAttribute('role')).toBe('alert');
    expect(status?.textContent).toContain('analysis.aoi.mec.states.errorTitle');
  });

  it('shows a distinct state when the loaded MEC shard has no matching scope', async () => {
    vi.mocked(mecMetricsLoaderSpy.loadMecMetrics).mockReturnValue(
      of({
        status: 'loaded',
        document: buildMecDocument('sol-001', { scopeId: '05001', scopeName: 'Medellin' }),
        format: 'mec-compact-v1',
      }),
    );
    appState.activeSolution$.set(buildTestSolution());
    appState.selectAOI(buildFixedMunicipalityAoi());
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#aoi-mec-unavailable-title')
        ?.textContent,
    ).toContain('analysis.aoi.mec.states.scopeMissingTitle');
  });

  it('ignores stale MEC responses after the active solution changes', async () => {
    const firstResponse = new Subject<MecMetricsLoadResult>();
    const secondResponse = new Subject<MecMetricsLoadResult>();
    vi.mocked(mecMetricsLoaderSpy.loadMecMetrics)
      .mockReturnValueOnce(firstResponse)
      .mockReturnValueOnce(secondResponse);
    appState.activeSolution$.set({ ...buildTestSolution(), id: 'first-solution' });
    appState.selectAOI(buildFixedMunicipalityAoi());
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    appState.activeSolution$.set({ ...buildTestSolution(), id: 'second-solution' });
    fixture.detectChanges();
    await fixture.whenStable();

    firstResponse.next({
      status: 'loaded',
      document: buildMecDocument('first-solution', { classLabel: 'Stale forest' }),
      format: 'mec-compact-v1',
    });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Stale forest');

    secondResponse.next({
      status: 'loaded',
      document: buildMecDocument('second-solution', { classLabel: 'Current forest' }),
      format: 'mec-compact-v1',
    });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Current forest');
  });

  it('shows the integrated MEC count and CTA only for drilldown views', () => {
    appState.activeSolution$.set(buildTestSolution());
    appState.selectAOI(buildFixedMunicipalityAoi());
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
    appState.selectAOI(buildFixedMunicipalityAoi());
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
    appState.selectAOI(buildFixedMunicipalityAoi());
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
    appState.selectAOI(buildFixedMunicipalityAoi());
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
    const component = fixture.componentInstance as unknown as {
      goalsModalRows: () => unknown[];
    };
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    (
      compiled.querySelector(
        '#right-sidebar-v3-overview-goals-additional-domain-view-species',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(compiled.querySelector('#conservation-goals-modal-preparing-status')).not.toBeNull();
    expect(compiled.querySelector('#conservation-goals-modal-virtual-table')).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();

    expect((compiled.querySelector('#conservation-goals-modal') as HTMLDialogElement).open).toBe(
      true,
    );
    expect(component.goalsModalRows()).toHaveLength(3);
    expect(fixture.debugElement.query(By.directive(CdkVirtualScrollViewport))).not.toBeNull();
    expect(
      compiled.querySelector('#conservation-goals-modal-virtual-heading-checkpoints'),
    ).not.toBeNull();
    expect(compiled.querySelector('#conservation-goals-modal-virtual-heading-target')).toBeNull();

    const filter = compiled.querySelector(
      '#conservation-goals-modal-filter-select',
    ) as HTMLSelectElement;
    filter.value = 'reached30';
    filter.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(component.goalsModalRows()).toHaveLength(1);

    (compiled.querySelector('#conservation-goals-modal-close-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.querySelector('#conservation-goals-modal-virtual-table')).toBeNull();
    expect(compiled.querySelector('#conservation-goals-modal-preparing-status')).toBeNull();
  });

  it('bounds a large species breakdown with the virtual viewport', async () => {
    const document = buildGoalsDocument();
    document.features.species = Array.from({ length: 250 }, (_, index) =>
      buildGoalFeature(
        `species-${index}`,
        `Species ${index}`,
        'species',
        (index % 100) / 100,
        index % 3 === 0,
        'Birds',
        'LC',
      ),
    );
    document.summary.byType.species.totalSpeciesCount = 250;
    document.rollups.species.totalSpeciesCount = 250;
    goalsDocument = document;
    appState.activeSolution$.set(buildTestSolution());
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    const component = fixture.componentInstance as unknown as {
      goalsModalRows: () => unknown[];
    };
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '#right-sidebar-v3-overview-goals-additional-domain-view-species',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();

    const viewport = fixture.debugElement.query(By.directive(CdkVirtualScrollViewport))
      .componentInstance as CdkVirtualScrollViewport;
    const renderedRange = viewport.getRenderedRange();

    expect(component.goalsModalRows()).toHaveLength(250);
    expect(viewport.getDataLength()).toBe(250);
    expect(renderedRange.end - renderedRange.start).toBeLessThan(250);
  });

  it('labels and switches the national ecosystem classification breakdown', async () => {
    const solution = buildTestSolution();
    goalsDocument = buildGoalsDocument();
    vi.mocked(mecMetricsLoaderSpy.loadMecMetrics).mockReturnValue(
      of({
        status: 'loaded',
        document: buildFiveViewMecDocument(solution.id),
        format: 'mec-compact-v1',
      }),
    );
    appState.activeSolution$.set(solution);
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    (
      compiled.querySelector(
        '#right-sidebar-v3-overview-goals-domain-view-ecosystems',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();

    expect(mecMetricsLoaderSpy.loadMecMetrics).toHaveBeenCalledWith(solution.id, 'national');
    expect(compiled.querySelector('#conservation-goals-modal-domain-title')).toBeNull();
    expect(compiled.querySelector('#conservation-goals-modal-title')?.textContent).toContain(
      'analysis.overview.goalsWidget.modal.nationalEcosystemsTitle',
    );
    expect(
      compiled.querySelectorAll('button[id^="conservation-goals-modal-ecosystem-level-"]'),
    ).toHaveLength(5);
    expect(
      compiled
        .querySelector('#conservation-goals-modal-browser-title')
        ?.textContent?.replace(/\s+/g, ' '),
    ).toContain('analysis.aoi.mec.levels.iavh');

    (
      compiled.querySelector('#conservation-goals-modal-ecosystem-level-broad') as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(
      compiled
        .querySelector('#conservation-goals-modal-browser-title')
        ?.textContent?.replace(/\s+/g, ' '),
    ).toContain('analysis.aoi.mec.levels.broad');
    expect(
      compiled
        .querySelector('#conservation-goals-modal-ecosystem-level-broad')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      compiled.querySelector('#conservation-goals-modal-feature-name-0')?.textContent,
    ).toContain('Broad real');
    expect(
      compiled.querySelector('#conservation-goals-modal-pre-existing-coverage-0')?.textContent,
    ).toContain('10');
    expect(
      compiled.querySelector('#conservation-goals-modal-new-coverage-0')?.textContent,
    ).toContain('30');
    expect(
      compiled.querySelector('#conservation-goals-modal-coverage-value-0')?.textContent,
    ).toContain('40');
  });

  it('shows loading and recoverable error states for national ecosystem classifications', async () => {
    const nationalMecRequest = new Subject<MecMetricsLoadResult>();
    vi.mocked(mecMetricsLoaderSpy.loadMecMetrics).mockReturnValue(nationalMecRequest);
    goalsDocument = buildGoalsDocument();
    appState.activeSolution$.set(buildTestSolution());
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    (
      compiled.querySelector(
        '#right-sidebar-v3-overview-goals-domain-view-ecosystems',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();

    expect(
      compiled.querySelector('#conservation-goals-modal-ecosystem-classifications-loading'),
    ).not.toBeNull();
    expect(
      compiled
        .querySelector('#conservation-goals-modal-ecosystem-classifications-loading')
        ?.getAttribute('role'),
    ).toBe('status');

    nationalMecRequest.next({ status: 'unavailable', document: null });
    fixture.detectChanges();

    expect(
      compiled.querySelector('#conservation-goals-modal-ecosystem-classifications-error'),
    ).not.toBeNull();
    expect(
      compiled.querySelector('#conservation-goals-modal-ecosystem-classifications-retry-button'),
    ).not.toBeNull();
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

function buildCustomEcosystemProfileResponse(
  solutionId: string | null = 'test-solution',
): CustomAoiAreaProfileResponse {
  return {
    format: 'custom-aoi-area-profile-v1',
    status: 'complete',
    selection: {
      status: 'selected',
      selected_cell_count: 10,
      available_cell_count: 10,
      area_km2: 10,
      source: 'test-grid',
    },
    ...(solutionId ? { solution_id: solutionId } : {}),
    sections: {
      ecosystems: {
        status: 'complete',
        canonical_summary_view: 'broadEcosystem',
        classified_area_km2: 10,
        views: [
          {
            id: 'broadEcosystem',
            label: 'Broad ecosystem',
            records: [
              {
                id: 'forest',
                label: 'Andean forest',
                area_km2: 8,
                national_area_km2: 40,
                share_of_classified_pct: 80,
                share_of_national_class_pct: 20,
                solution_covered_area_km2: solutionId ? 4 : null,
                solution_covered_pct_of_aoi: solutionId ? 50 : null,
                pre_existing_covered_area_km2: solutionId ? 1 : null,
                pre_existing_covered_pct_of_aoi: solutionId ? 12.5 : null,
                new_covered_area_km2: solutionId ? 3 : null,
                new_covered_pct_of_aoi: solutionId ? 37.5 : null,
              },
              {
                id: 'savanna',
                label: 'Savanna',
                area_km2: 2,
                national_area_km2: 20,
                share_of_classified_pct: 20,
                share_of_national_class_pct: 10,
                solution_covered_area_km2: solutionId ? 1 : null,
                solution_covered_pct_of_aoi: solutionId ? 50 : null,
                pre_existing_covered_area_km2: solutionId ? 0.25 : null,
                pre_existing_covered_pct_of_aoi: solutionId ? 12.5 : null,
                new_covered_area_km2: solutionId ? 0.75 : null,
                new_covered_pct_of_aoi: solutionId ? 37.5 : null,
              },
            ],
          },
        ],
      },
    },
  };
}

function buildFixedMunicipalityAoi(): AOI {
  return {
    id: 'municipality:11001',
    name: 'Bogota',
    type: 'municipality',
    geometryUrl: '/boundaries/municipalities.geojson',
    areaKm2: 20,
  };
}

function buildMecDocument(
  solutionId: string,
  options: { scopeId?: string; scopeName?: string; classLabel?: string } = {},
): MecCompactDocument {
  return {
    format: 'mec-compact-v1',
    solutionId,
    geographyLevel: 'municipalities',
    generatedAt: '2026-07-24T00:00:00Z',
    sourceMode: 'composite',
    units: 'km2',
    rowLayout: ['scopeIndex', 'classIndex', 'availableKm2', 'existingKm2', 'additionalKm2'],
    viewCatalog: [['broadEcosystem', 'Broad ecosystem']],
    classCatalog: [
      [0, 'broadEcosystem:forest', options.classLabel ?? 'Forest'],
      [0, 'broadEcosystem:savanna', 'Savanna'],
    ],
    scopeCatalog: [[options.scopeId ?? '11001', options.scopeName ?? 'Bogota']],
    rows: [
      [0, 0, 10, 0, 4],
      [0, 1, 5, 1, 1],
    ],
    viewSupport: {
      supported: [{ view: 'broadEcosystem', mapping: 'authoritative', rule: 'Exact label.' }],
      unsupported: [],
    },
    semantics: {
      availableKm2: 'Available.',
      existingKm2: 'Existing.',
      additionalKm2: 'Additional.',
      percentages: 'Derived.',
      invariants: 'Disjoint.',
    },
  };
}

function buildV2MecDocument(
  solutionId: string,
  options: {
    geographyLevel?: MecCompactV2Document['geographyLevel'];
    scopeId?: string;
    scopeName?: string;
    boundaryProvenanceRef?: string;
  } = {},
): MecCompactV2Document {
  return {
    format: 'mec-compact-v2',
    solutionId,
    geographyLevel: options.geographyLevel ?? 'municipalities',
    generatedAt: '2026-07-24T00:00:00Z',
    sourceMode: 'composite',
    units: 'km2',
    rowLayout: [
      'scopeIndex',
      'classIndex',
      'ecosystemAreaKm2',
      'preExistingCoverageKm2',
      'newPrioritizrCoverageKm2',
    ],
    scopeStatsFields: ['scopeAreaKm2', 'classifiedKm2', 'unclassifiedKm2', 'boundaryProvenanceRef'],
    viewCatalog: [['broadEcosystem', 'Broad ecosystem']],
    classCatalog: [[0, 'broadEcosystem:forest', 'Forest']],
    scopeCatalog: [[options.scopeId ?? '11001', options.scopeName ?? 'Bogota']],
    scopeStats: {
      0: {
        scopeAreaKm2: 20,
        classifiedKm2: 16,
        unclassifiedKm2: 4,
        boundaryProvenanceRef: options.boundaryProvenanceRef ?? 'municipalities',
      },
    },
    rows: [[0, 0, 10, 0, 4]],
    viewSupport: {
      supported: [{ view: 'broadEcosystem', mapping: 'authoritative', rule: 'Exact label.' }],
      unsupported: [],
    },
    semantics: {
      ecosystemAreaKm2: 'Ecosystem area.',
      preExistingCoverageKm2: 'Pre-existing coverage.',
      newPrioritizrCoverageKm2: 'New Prioritizr coverage.',
      derivedValues: 'Derived values.',
      scopeStats: 'Scope stats.',
      nationalBenchmark: 'National benchmark.',
      invariants: 'Disjoint.',
    },
  };
}

function buildFiveViewMecDocument(solutionId: string): MecCompactDocument {
  const viewCatalog: MecCompactDocument['viewCatalog'] = [
    ['biomeFamily', 'Biome family'],
    ['broadBiomeContext', 'Broad biome context'],
    ['broadEcosystem', 'Broad ecosystem'],
    ['detailedEcosystem', 'Detailed ecosystem'],
    ['biomeRegion', 'Biome region'],
  ];
  const labels = ['Family real', 'Context real', 'Broad real', 'Detailed real', 'IAvH real'];

  return {
    ...buildMecDocument(solutionId),
    viewCatalog,
    classCatalog: labels.map((label, viewIndex) => [
      viewIndex,
      `${viewCatalog[viewIndex][0]}:real`,
      label,
    ]),
    rows: labels.map((_, classIndex) => [0, classIndex, 10, 1, 3]),
    viewSupport: {
      supported: viewCatalog.map(([view]) => ({
        view,
        mapping: 'authoritative',
        rule: 'Exact label.',
      })),
      unsupported: [],
    },
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
