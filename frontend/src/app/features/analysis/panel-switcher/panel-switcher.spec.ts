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
  DetailedSpeciesJobResponse,
  HydratedSpeciesGoalsRecord,
  MecCompactDocument,
  MecCompactV2Document,
  MetricComparisonValue,
  MetricValue,
  Solution,
  SolutionGoalsDocument,
  StrategicEcosystemOutcomesDocument,
} from '@core/models';
import { AppStateService } from '@core/services/app-state.service';
import { MockDataService } from '@core/services/mock-data.service';
import {
  MecMetricsLoaderService,
  type MecMetricsLoadResult,
} from '@core/services/mec-metrics-loader.service';
import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import { SolutionGoalsLoaderService } from '@core/services/solution-goals-loader.service';
import { SpeciesGoalsLoaderService } from '@core/services/species-goals-loader.service';
import { StrategicEcosystemOutcomesLoaderService } from '@core/services/strategic-ecosystem-outcomes-loader.service';
import { MESA_IAVH_FEATURE_COUNT } from './aoi-ecosystems.utils';
import { PanelSwitcherComponent } from './panel-switcher';

describe('PanelSwitcherComponent', () => {
  let appState: AppStateService;
  let appLocale: AppLocaleService;
  let mockData: MockDataService;
  let apiServiceSpy: Pick<
    ApiService,
    | 'getSolutionMetrics'
    | 'getCustomPolygonMetrics'
    | 'getCustomAoiAreaProfile'
    | 'createDetailedSpeciesCoverageJob'
    | 'getDetailedSpeciesCoverageJob'
    | 'cancelDetailedSpeciesCoverageJob'
  >;
  let mecMetricsLoaderSpy: Pick<
    MecMetricsLoaderService,
    'loadMecMetrics' | 'loadNationalDenominator'
  >;
  let speciesGoalsLoaderSpy: Pick<SpeciesGoalsLoaderService, 'load'>;
  let solutionGoalsLoaderSpy: Pick<SolutionGoalsLoaderService, 'loadGoals'>;
  let httpClientSpy: { get: ReturnType<typeof vi.fn> };
  let goalsDocument: SolutionGoalsDocument | null;
  let strategicOutcomesDocument: StrategicEcosystemOutcomesDocument | null;

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockData = new MockDataService();
    goalsDocument = null;
    strategicOutcomesDocument = null;
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
      createDetailedSpeciesCoverageJob: vi.fn(() => of(buildDetailedSpeciesJob('complete'))),
      getDetailedSpeciesCoverageJob: vi.fn(() => of(buildDetailedSpeciesJob('complete'))),
      cancelDetailedSpeciesCoverageJob: vi.fn(() => of(buildDetailedSpeciesJob('cancelled'))),
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
      loadNationalDenominator: vi.fn(() => of({ status: 'unavailable' as const, document: null })),
    };
    speciesGoalsLoaderSpy = {
      load: vi.fn(() => of(buildHydratedSpeciesRecords(goalsDocument))),
    };
    solutionGoalsLoaderSpy = {
      loadGoals: vi.fn(() => of(goalsDocument)),
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
        { provide: SpeciesGoalsLoaderService, useValue: speciesGoalsLoaderSpy },
        {
          provide: SolutionGoalsLoaderService,
          useValue: solutionGoalsLoaderSpy,
        },
        {
          provide: StrategicEcosystemOutcomesLoaderService,
          useValue: { loadForSolution: vi.fn(() => of(strategicOutcomesDocument)) },
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

  it('opens detailed species coverage for a custom AOI with a land solution', async () => {
    const solution = buildTestSolution();
    const geometry = buildTestGeometry();
    appState.activeSolution$.set({
      ...solution,
      metadata: { ...solution.metadata, domain: 'land' },
    });
    vi.mocked(apiServiceSpy.getCustomPolygonMetrics).mockReturnValue(
      of(buildCustomPolygonResponse({ priority_area_in_region: 2.5 })),
    );
    appState.selectCustomAOI(geometry, { name: 'Drawn AOI', areaKm2: 10 });
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#analysis-species-inventory')).toBeNull();
    expect(compiled.querySelector('#aoi-dashboard-custom-area-profile')).toBeNull();
    expect(compiled.querySelector('#custom-aoi-area-profile')).toBeNull();
    const openButton = compiled.querySelector(
      '#aoi-biodiversity-open-species-inventory-button',
    ) as HTMLButtonElement;
    expect(openButton).not.toBeNull();
    expect(openButton.disabled).toBe(false);
    expect(openButton.getAttribute('aria-controls')).toBe('custom-aoi-species-inventory-modal');
    openButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(openButton.getAttribute('aria-expanded')).toBe('true');
    expect(compiled.querySelector('#custom-aoi-species-inventory-modal')).not.toBeNull();
    expect(apiServiceSpy.createDetailedSpeciesCoverageJob).toHaveBeenCalledWith({
      geometry,
      solution_id: solution.id,
    });
    expect(compiled.querySelector('#aoi-dashboard-area-unit-toggle')).not.toBeNull();
    expect(compiled.querySelector('#aoi-section-general')).not.toBeNull();
    expect(compiled.querySelector('#aoi-dashboard-download-metrics-csv-btn')).not.toBeNull();
  });

  it('resets custom modal state across custom, fixed, and custom AOI changes', async () => {
    const solution = buildTestSolution();
    appState.activeSolution$.set({
      ...solution,
      metadata: { ...solution.metadata, domain: 'land' },
    });
    vi.mocked(apiServiceSpy.getCustomPolygonMetrics).mockReturnValue(
      of(buildCustomPolygonResponse({ priority_area_in_region: 2.5 })),
    );
    vi.mocked(apiServiceSpy.createDetailedSpeciesCoverageJob).mockReturnValue(
      of(buildDetailedSpeciesJob('queued')),
    );
    appState.selectCustomAOI(buildTestGeometry(), { name: 'First custom AOI', areaKm2: 10 });
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '#aoi-biodiversity-open-species-inventory-button',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement
        .querySelector('#aoi-biodiversity-open-species-inventory-button')
        ?.getAttribute('aria-expanded'),
    ).toBe('true');

    appState.selectAOI(buildFixedMunicipalityAoi());
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#custom-aoi-species-inventory-modal')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('#aoi-biodiversity-open-species-inventory-button'),
    ).toBeNull();
    expect(apiServiceSpy.cancelDetailedSpeciesCoverageJob).toHaveBeenCalledWith(
      'panel-species-job',
    );

    appState.selectCustomAOI(buildTestGeometry(), { name: 'Second custom AOI', areaKm2: 12 });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#custom-aoi-species-inventory-modal')).toBeNull();
    expect(
      fixture.nativeElement
        .querySelector('#aoi-biodiversity-open-species-inventory-button')
        ?.getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('keeps custom species coverage unavailable without a solution', async () => {
    vi.mocked(apiServiceSpy.getCustomPolygonMetrics).mockReturnValue(
      of(buildCustomPolygonResponse({ priority_area_in_region: 2.5 })),
    );
    appState.selectCustomAOI(buildTestGeometry(), { name: 'Drawn AOI', areaKm2: 10 });
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      '#aoi-biodiversity-open-species-inventory-button',
    ) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.hasAttribute('title')).toBe(false);
    expect(button.getAttribute('aria-describedby')).toBe(
      'aoi-biodiversity-species-inventory-unavailable-help',
    );
    expect(
      fixture.nativeElement.querySelector('#aoi-biodiversity-species-inventory-unavailable-help')
        ?.textContent,
    ).toContain('inventoryUnavailableSolution');
    button.click();
    expect(apiServiceSpy.createDetailedSpeciesCoverageJob).not.toHaveBeenCalled();
  });

  it('keeps custom species coverage unavailable without valid geometry', async () => {
    const solution = buildTestSolution();
    appState.activeSolution$.set({
      ...solution,
      metadata: { ...solution.metadata, domain: 'land' },
    });
    appState.selectCustomAOI(buildTestGeometry(), { name: 'Drawn AOI', areaKm2: 10 });
    appState.customAOIGeometry$.set(null);
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      '#aoi-biodiversity-open-species-inventory-button',
    ) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBe(
      'aoi-biodiversity-species-inventory-unavailable-help',
    );
    expect(
      fixture.nativeElement.querySelector('#aoi-biodiversity-species-inventory-unavailable-help')
        ?.textContent,
    ).toContain('inventoryUnavailableGeometry');
    button.click();
    expect(apiServiceSpy.createDetailedSpeciesCoverageJob).not.toHaveBeenCalled();
  });

  it('does not offer detailed custom species coverage for marine solutions', async () => {
    const solution = buildTestSolution();
    vi.spyOn(TestBed.inject(SolutionCatalogService), 'getById').mockReturnValue({
      id: solution.id,
      domain: 'marine',
    } as CatalogSolution);
    vi.mocked(apiServiceSpy.getCustomPolygonMetrics).mockReturnValue(
      of(buildCustomPolygonResponse({ priority_area_in_region: 2.5 })),
    );
    appState.activeSolution$.set(solution);
    appState.selectCustomAOI(buildTestGeometry(), { name: 'Marine AOI', areaKm2: 10 });
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      '#aoi-biodiversity-open-species-inventory-button',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBe(
      'aoi-biodiversity-species-inventory-unavailable-help',
    );
    expect(
      fixture.nativeElement.querySelector('#aoi-biodiversity-species-inventory-unavailable-help')
        ?.textContent,
    ).toContain('inventoryUnavailableMarine');
    button.click();
    expect(apiServiceSpy.createDetailedSpeciesCoverageJob).not.toHaveBeenCalled();
  });

  it('normalizes prefixed municipality IDs before sidecar hydration', async () => {
    const solution = mockData.getSolutionById('sol-001');
    expect(solution).not.toBeNull();
    goalsDocument = buildGoalsDocument();
    vi.spyOn(TestBed.inject(SolutionCatalogService), 'getById').mockReturnValue({
      id: solution!.id,
      domain: 'land',
      precomputedMetricUrls: {
        speciesGoalsCatalog: '/releases/test/species-goals/catalog.json',
        speciesGoalsByGeography: {
          municipalities: '/releases/test/species-goals/municipalities.json',
        },
      },
    } as CatalogSolution);
    appState.activeSolution$.set({
      ...solution!,
      metadata: { ...solution!.metadata, domain: 'land' },
    });
    appState.selectAOI(buildFixedMunicipalityAoi());
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      '#aoi-biodiversity-open-species-inventory-button',
    ) as HTMLButtonElement;
    button.click();
    fixture.detectChanges();

    expect(speciesGoalsLoaderSpy.load).toHaveBeenCalledWith(
      solution!.id,
      'municipalities',
      '11001',
    );
  });

  it('renders overview content without a standalone species inventory control', () => {
    const solution = mockData.getSolutionById('sol-001');
    expect(solution).not.toBeNull();

    appState.activeSolution$.set(solution);
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#solution-overview-panel')).not.toBeNull();
    expect(
      compiled.querySelector('#right-sidebar-overview-open-species-inventory-button'),
    ).toBeNull();
    expect(speciesGoalsLoaderSpy.load).not.toHaveBeenCalled();
  });

  it('combines selected priority area with its share of Colombia in overview', async () => {
    const solution = buildTestSolution();
    vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(
      of({
        solutionId: solution.id,
        generatedAt: '2026-08-26T00:00:00.000Z',
        geographies: {
          national: {
            colombia: {
              name: 'Colombia',
              metrics: [buildMetric('priority_area_in_region', 293_400, 'km²', 'number')],
            },
          },
        },
      }),
    );
    appLocale.setLocale('en');
    appState.activeSolution$.set(solution);
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(
      compiled.querySelector('#right-sidebar-v3-overview-gain-value-metric-18-priority-area-total')
        ?.textContent,
    ).toContain('293.4K km² (25.7%)');
    expect(
      compiled.querySelector('#right-sidebar-v3-overview-gain-row-metric-17-national-contribution'),
    ).toBeNull();
  });

  it('disables AOI and comparison tabs until a scenario is active', () => {
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
    expect(compiled.querySelector('#aoi-overview-aligned-metrics')).toBeNull();
    expect(compiled.querySelector('#aoi-strategic-value-paramos')?.textContent).toContain('20%');
    expect(compiled.querySelector('#aoi-strategic-description')?.textContent).toContain(
      'analysis.aoi.strategic.customDescription',
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
    expect(compiled.querySelector('#aoi-hero-national')).toBeNull();
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
    expect(compiled.querySelector('#aoi-hero-national')).toBeNull();
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
      'threatened_species_secured',
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

  it('renders separate ecosystems, strategic ecosystems, and ecosystem services sections', async () => {
    const solution = buildTestSolution();
    vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(
      of(
        buildCachedAoiMetricsDocument(solution.id, [
          buildMetric('priority_area_in_region', 10, 'km²', 'number'),
          buildMetric('ecosystem_coverage_paramo', 2, 'km²', 'number'),
          buildMetric('ecosystem_coverage_wetlands', 15, 'km²', 'number'),
          buildMetric('carbon_storage_biomass', 40, 'Mg', 'number'),
          buildMetric('water_regulation_area', 78, 'km²', 'number'),
          buildMetric('threatened_species_secured', 90, 'count', 'number'),
          buildMetric('agricultural_area', 125, 'km²', 'number'),
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
    expect(compiled.querySelector('#aoi-label-carbon')?.textContent).toContain(
      'analysis.aoi.sections.ecosystemServices',
    );
    expect(compiled.querySelector('#aoi-strategic-value-paramos')?.textContent).toContain('20%');
    expect(compiled.querySelector('#aoi-strategic-value-wetlands')?.textContent).toContain('100%');
    expect(compiled.querySelector('#aoi-stat-above-carbon')?.textContent).toContain('40 Mg');
    expect(compiled.querySelector('#aoi-stat-water-regulation')?.textContent).toContain('78 km²');
    expect(compiled.querySelector('#aoi-stat-threatened-secured')?.textContent).toContain('90');
    expect(
      compiled.querySelector('#aoi-stat-agricultural-conservation-area')?.textContent,
    ).toContain('125 km²');
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
    expect(compiled.querySelector('#aoi-mec-modal-heading-national-share')).toBeNull();
  });

  it('gates expanded known-AOI ecosystem columns and loads the national v2 partition', async () => {
    const solution = buildTestSolution();
    vi.spyOn(TestBed.inject(SolutionCatalogService), 'getById').mockReturnValue({
      id: solution.id,
      capabilities: { aoiCoverageMetrics: 'v2' },
    } as CatalogSolution);
    vi.mocked(mecMetricsLoaderSpy.loadMecMetrics).mockImplementation((_solutionId, level) => {
      const document = buildV2MecDocument(solution.id);
      if (level === 'national') {
        document.geographyLevel = 'national';
        document.scopeCatalog = [['colombia', 'Colombia']];
        document.rows = [[0, 0, 50, 10, 15]];
      }
      return of({ status: 'loaded', document, format: 'mec-compact-v2' });
    });
    appState.activeSolution$.set(solution);
    appState.selectAOI(buildFixedMunicipalityAoi());
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    (compiled.querySelector('#aoi-mec-open-modal-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(mecMetricsLoaderSpy.loadMecMetrics).toHaveBeenCalledWith(solution.id, 'national');
    expect(compiled.querySelector('#aoi-mec-modal-heading-national-share')).not.toBeNull();
    expect(
      compiled.querySelector('#aoi-mec-modal-national-share-broadecosystem-forest-measure')
        ?.textContent,
    ).toContain('20%');
    expect(
      compiled.querySelector('#aoi-mec-modal-aoi-share-broadecosystem-forest-measure')?.textContent,
    ).toContain('50%');
    expect(
      compiled.querySelector('#aoi-mec-modal-total-coverage-broadecosystem-forest-measure')
        ?.textContent,
    ).toContain('40%');
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
    ).toContain('analysis.aoi.mec.states.custom.failedTitle');
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
    expect(compiled.querySelector('#aoi-mec-bar-value-0')?.textContent).toContain('50%');

    (compiled.querySelector('#aoi-mec-open-modal-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelectorAll('#aoi-mec-modal-table')).toHaveLength(1);
    expect(compiled.querySelector('#aoi-mec-modal-mode-tabs')).toBeNull();
    expect(compiled.querySelector('#aoi-mec-modal-composition-tab')).toBeNull();
    expect(compiled.querySelector('#aoi-mec-modal-coverage-tab')).toBeNull();
    expect(compiled.querySelector('#aoi-mec-modal-sort-composition')?.textContent).toContain(
      'analysis.aoi.mec.modal.customMesa.sortComposition',
    );
    expect(compiled.querySelector('#aoi-mec-modal-sort-national')?.textContent).toContain(
      'analysis.aoi.mec.modal.customMesa.sortNational',
    );
    expect(compiled.querySelector('#aoi-mec-modal-sort-coverage')?.textContent).toContain(
      'analysis.aoi.mec.modal.customMesa.sortCoverage',
    );
    expect(compiled.querySelector('#aoi-mec-modal-sort-existing')?.textContent).toContain(
      'analysis.aoi.mec.modal.customMesa.sortExisting',
    );
    expect(compiled.querySelector('#aoi-mec-modal-sort-additional')?.textContent).toContain(
      'analysis.aoi.mec.modal.customMesa.sortNew',
    );
    expect(compiled.querySelector('#aoi-mec-modal-heading-presence-group')?.textContent).toContain(
      'analysis.aoi.mec.modal.presenceGroup',
    );
    expect(compiled.querySelector('#aoi-mec-modal-heading-coverage-group')?.textContent).toContain(
      'analysis.aoi.mec.modal.customMesa.coverageGroup',
    );
    expect(compiled.querySelector('#aoi-mec-modal-heading-available')?.textContent).toContain(
      'analysis.aoi.mec.modal.customMesa.areaInsideAoi',
    );
    expect(compiled.querySelector('#aoi-mec-modal-heading-national-share')?.textContent).toContain(
      'analysis.aoi.mec.modal.customMesa.nationalExtentInsideAoi',
    );
    expect(compiled.querySelector('#aoi-mec-modal-heading-aoi-share')?.textContent).toContain(
      'analysis.aoi.mec.modal.customMesa.mappedAoiOccupied',
    );
    expect(compiled.querySelector('#aoi-mec-modal-heading-total-coverage')?.textContent).toContain(
      'analysis.aoi.mec.modal.customMesa.totalCoverage',
    );
    expect(
      compiled.querySelector('#aoi-mec-modal-heading-pre-existing-coverage')?.textContent,
    ).toContain('analysis.aoi.mec.modal.customMesa.preExistingCoverage');
    expect(compiled.querySelector('#aoi-mec-modal-heading-new-coverage')?.textContent).toContain(
      'analysis.aoi.mec.modal.customMesa.newCoverage',
    );
    expect(
      compiled
        .querySelector('#aoi-mec-modal-heading-total-coverage-help-trigger')
        ?.getAttribute('aria-label'),
    ).toBe('analysis.aoi.mec.modal.customMesa.columnQuestions.totalCoverage');
    expect(
      compiled
        .querySelector('#aoi-mec-modal-heading-pre-existing-coverage-help-trigger')
        ?.getAttribute('aria-label'),
    ).toBe('analysis.aoi.mec.modal.customMesa.columnQuestions.preExistingCoverage');
    expect(
      compiled
        .querySelector('#aoi-mec-modal-heading-new-coverage-help-trigger')
        ?.getAttribute('aria-label'),
    ).toBe('analysis.aoi.mec.modal.customMesa.columnQuestions.newCoverage');
    expect(
      compiled
        .querySelector('#aoi-mec-modal-total-coverage-andean-forest-bar')
        ?.getAttribute('aria-label'),
    ).toContain('analysis.aoi.mec.modal.customMesa.totalCoverage');
    expect(
      compiled
        .querySelector('#aoi-mec-modal-pre-existing-coverage-andean-forest-bar')
        ?.getAttribute('aria-label'),
    ).toContain('analysis.aoi.mec.modal.customMesa.preExistingCoverage');
    expect(
      compiled
        .querySelector('#aoi-mec-modal-new-coverage-andean-forest-bar')
        ?.getAttribute('aria-label'),
    ).toContain('analysis.aoi.mec.modal.customMesa.newCoverage');
    expect(
      compiled
        .querySelector('#aoi-mec-modal-national-share-andean-forest')
        ?.getAttribute('data-label'),
    ).toBe('analysis.aoi.mec.modal.customMesa.nationalExtentInsideAoi');
    expect(
      compiled.querySelector('#aoi-mec-modal-aoi-share-andean-forest')?.getAttribute('data-label'),
    ).toBe('analysis.aoi.mec.modal.customMesa.mappedAoiOccupied');
    expect(
      compiled
        .querySelector('#aoi-mec-modal-total-coverage-andean-forest')
        ?.getAttribute('data-label'),
    ).toBe('analysis.aoi.mec.modal.customMesa.totalCoverage');
    expect(
      compiled
        .querySelector('#aoi-mec-modal-pre-existing-coverage-andean-forest')
        ?.getAttribute('data-label'),
    ).toBe('analysis.aoi.mec.modal.customMesa.preExistingCoverage');
    expect(
      compiled
        .querySelector('#aoi-mec-modal-new-coverage-andean-forest')
        ?.getAttribute('data-label'),
    ).toBe('analysis.aoi.mec.modal.customMesa.newCoverage');
    expect(
      compiled.querySelector('#aoi-mec-modal-total-coverage-andean-forest-value')?.textContent,
    ).toContain('50%');
    expect(
      compiled.querySelector('#aoi-mec-modal-total-coverage-andean-forest-value')?.textContent,
    ).toContain('analysis.aoi.mec.modal.mesaCellCount');
    expect(
      compiled.querySelector('#aoi-mec-modal-total-coverage-andean-forest-bar'),
    ).not.toBeNull();
    expect(
      compiled.querySelector('#aoi-mec-modal-pre-existing-coverage-andean-forest-bar'),
    ).not.toBeNull();
    expect(compiled.querySelector('#aoi-mec-modal-new-coverage-andean-forest-bar')).not.toBeNull();
    expect(compiled.querySelector('#aoi-mec-modal-available-andean-forest')?.textContent).toContain(
      'analysis.aoi.mec.modal.mesaPlanningCellAmount',
    );
    expect(
      compiled.querySelector('#aoi-mec-modal-national-share-andean-forest-value')?.textContent,
    ).toContain('20%');
    expect(
      compiled.querySelector('#aoi-mec-modal-aoi-share-andean-forest-value')?.textContent,
    ).toContain('80%');
    expect(
      compiled.querySelector('#aoi-mec-modal-pre-existing-coverage-andean-forest-value')
        ?.textContent,
    ).toContain('12,5%');
    expect(
      compiled.querySelector('#aoi-mec-modal-new-coverage-andean-forest-value')?.textContent,
    ).toContain('37,5%');
    expect(compiled.querySelector('#aoi-mec-modal-row-andean-forest')?.textContent).not.toContain(
      'analysis.common.valueUnavailable',
    );
    expect(
      compiled.querySelector('#aoi-mec-modal-total-coverage-biome-region-3-zero-denominator')
        ?.textContent,
    ).toContain('analysis.aoi.mec.modal.zeroDenominator');
    expect(compiled.querySelector('#aoi-mec-modal-table-caption')?.textContent).toContain(
      'analysis.aoi.mec.modal.customMesaTableCaption',
    );
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
    expect(compiled.querySelector('#aoi-mec-modal-heading-total-coverage')?.textContent).toContain(
      'analysis.aoi.mec.modal.totalCoverage',
    );
    expect(
      compiled
        .querySelector('#aoi-mec-modal-heading-total-coverage-help-trigger')
        ?.getAttribute('aria-label'),
    ).toBe('analysis.aoi.mec.modal.columnQuestions.totalCoverage');
    expect(compiled.querySelector('#aoi-mec-modal-table-caption')?.textContent).toContain(
      'analysis.aoi.mec.modal.customTableCaption',
    );
    expect(compiled.querySelector('#aoi-mec-modal-sort-coverage')?.textContent).toContain(
      'analysis.aoi.mec.modal.sortCoverage',
    );
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
    expect(
      compiled.querySelector('#aoi-mec-modal-total-coverage-andean-forest')?.textContent,
    ).toContain('50%');
    expect(compiled.querySelector('#aoi-mec-modal-heading-total-coverage')?.textContent).toContain(
      'analysis.aoi.mec.modal.customMesa.totalCoverage',
    );
    expect(
      compiled
        .querySelector('#aoi-mec-modal-heading-total-coverage-help-trigger')
        ?.getAttribute('aria-label'),
    ).toBe('analysis.aoi.mec.modal.customMesa.columnQuestions.totalCoverage');
    expect(compiled.querySelector('#aoi-mec-modal-table-caption')?.textContent).toContain(
      'analysis.aoi.mec.modal.customMesaTableCaption',
    );
    expect(compiled.querySelector('#aoi-mec-modal-sort-coverage')?.textContent).toContain(
      'analysis.aoi.mec.modal.customMesa.sortCoverage',
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
    ['combined', 'siraps', 'aoi-siraps-combined-colombia'],
    ['territorial', 'siraps_territorial_updated', 'aoi-siraps-territorial-updated-colombia'],
    ['thematic', 'siraps_thematic', 'aoi-siraps-thematic-colombia'],
  ])(
    'loads cached and MEC metrics for a whole production %s SIRAP source',
    async (_, boundarySourceLayerKey, boundarySourceId) => {
      const solution = buildTestSolution();
      vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(
        of(
          buildCachedSirapMetricsDocument(solution.id, [
            buildMetric('priority_area_in_region', 42, 'km²', 'number'),
          ]),
        ),
      );
      appState.activeSolution$.set(solution);
      appState.selectAOI({
        id: 'sirap:territorial_territorial_amazonia_3',
        name: 'Territorial Amazonia',
        type: 'sirap',
        geometryUrl: '/inputs/boundaries/sirap/production.geojson',
        boundarySourceLayerKey,
        boundarySourceId,
        boundaryGeometrySelection: 'whole-feature',
      });
      appState.setRightSidebarMode('aoi');

      const fixture = TestBed.createComponent(PanelSwitcherComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const component = fixture.componentInstance as unknown as {
        aoiMetrics(): MetricValue[];
      };
      expect(component.aoiMetrics().map((metric) => metric.value)).toContain(42);
      expect(mecMetricsLoaderSpy.loadMecMetrics).toHaveBeenCalledWith('test-solution', 'siraps');
    },
  );

  it('renders regional SIRAP species and ecosystem aggregates from its primary packet scope', async () => {
    const solution = buildTestSolution();
    vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(
      of(buildRegionalSirapMetricsDocument(solution.id)),
    );
    appState.activeSolution$.set(solution);
    appState.selectAOI({
      id: 'sirap:eje-cafetero',
      name: 'SIRAP Eje Cafetero',
      type: 'sirap',
      geometryUrl: '/inputs/boundaries/sirap/production.geojson',
      boundarySourceLayerKey: 'siraps',
      boundarySourceId: 'aoi-siraps-combined-colombia',
      boundaryGeometrySelection: 'whole-feature',
    });
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#aoi-species-value-mammals')?.textContent).toContain('64');
    expect(compiled.querySelector('#aoi-species-value-plants')?.textContent).toContain('1248');
    expect(compiled.querySelector('#aoi-strategic-value-paramos')?.textContent).toContain('25%');
    expect(
      (fixture.componentInstance as unknown as { aoiMetrics(): MetricValue[] })
        .aoiMetrics()
        .map((metric) => metric.metricId),
    ).toContain('ecosystem_coverage_paramo');
  });

  it('presents Vichada-like SIRAP AOI aggregates without MEC or species drilldown artifacts', async () => {
    const solution = {
      ...buildTestSolution(),
      metadata: { ...buildTestSolution().metadata, domain: 'land' },
    };
    const document = buildRegionalSirapMetricsDocument(solution.id);
    const metrics = document.geographies.sirap?.['eje-cafetero'].metrics ?? [];
    replaceMetric(metrics, buildMetric('ecosystem_coverage_paramo', 0, 'km²', 'number'));
    replaceMetric(metrics, buildUnavailableMetric('ecosystem_coverage_wetlands', 'blocked'));
    vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(of(document));
    vi.spyOn(TestBed.inject(SolutionCatalogService), 'getById').mockReturnValue({
      id: solution.id,
      domain: 'land',
      scope: 'sirap',
      precomputedMetricUrls: {},
    } as CatalogSolution);
    appLocale.setLocale('en');
    appState.activeSolution$.set(solution);
    appState.selectAOI({
      id: 'sirap:eje-cafetero',
      name: 'SIRAP Vichada',
      type: 'sirap',
      geometryUrl: '/inputs/boundaries/sirap/production.geojson',
      boundarySourceLayerKey: 'siraps',
      boundarySourceId: 'aoi-siraps-combined-colombia',
      boundaryGeometrySelection: 'whole-feature',
    });
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#aoi-sirap-biodiversity-context')?.textContent).toContain(
      'analysis.aoi.sirapAggregate.speciesContext',
    );
    expect(compiled.querySelector('#aoi-sirap-ecosystem-aggregate-iavh')?.textContent).toContain(
      '1.3K km²',
    );
    expect(compiled.querySelector('#aoi-sirap-ecosystem-aggregate-paramo')?.textContent).toContain(
      '0 km²',
    );
    expect(
      compiled.querySelector('#aoi-sirap-ecosystem-aggregate-status-wetlands')?.textContent,
    ).toContain('blocked');
    expect(compiled.querySelector('#aoi-mec-breakdown-select')).toBeNull();
    expect(compiled.querySelector('#aoi-biodiversity-open-species-inventory-button')).toBeNull();
    expect(speciesGoalsLoaderSpy.load).not.toHaveBeenCalled();
  });

  it('keeps the species drilldown for departments with explicit artifacts', async () => {
    const solution = {
      ...buildTestSolution(),
      metadata: { ...buildTestSolution().metadata, domain: 'land' },
    };
    goalsDocument = buildGoalsDocument();
    vi.spyOn(TestBed.inject(SolutionCatalogService), 'getById').mockReturnValue({
      id: solution.id,
      domain: 'land',
      precomputedMetricUrls: {
        speciesGoalsCatalog: '/releases/test/species-goals/catalog.json',
        speciesGoalsByGeography: {
          departments: '/releases/test/species-goals/departments.json',
        },
      },
    } as CatalogSolution);
    appState.activeSolution$.set(solution);
    appState.selectAOI(buildMetaDepartmentAoi());
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      '#aoi-biodiversity-open-species-inventory-button',
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();

    button.click();
    expect(speciesGoalsLoaderSpy.load).toHaveBeenCalledWith(solution.id, 'departments', '50');
  });

  it('renders authoritative SIRAP targets and opens regional additional coverage', async () => {
    const solution = buildTestSolution();
    goalsDocument = buildSirapGoalsDocument(solution.id);
    vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(
      of(buildRegionalSirapMetricsDocument(solution.id)),
    );
    vi.spyOn(TestBed.inject(SolutionCatalogService), 'getById').mockReturnValue({
      id: solution.id,
      scope: 'sirap',
      sirapId: 'eje-cafetero',
      precomputedMetricUrls: {
        goals: '/releases/sirap-test/goals/cache/test-solution.goals.json',
        speciesGoalsCatalog: '/releases/sirap-test/species-goals/catalog/v1/catalog.json',
        speciesGoalsByGeography: {
          siraps: '/releases/sirap-test/species-goals/test-solution/siraps.json',
        },
        mecV2ByGeography: {
          siraps: '/releases/sirap-test/mec/test-solution/siraps.json',
        },
      },
    } as CatalogSolution);
    vi.mocked(mecMetricsLoaderSpy.loadMecMetrics).mockReturnValue(
      of({
        status: 'loaded',
        document: buildV2MecDocument(solution.id, {
          geographyLevel: 'siraps',
          scopeId: 'eje-cafetero',
          scopeName: 'Eje Cafetero',
          boundaryProvenanceRef: 'siraps',
        }),
        format: 'mec-compact-v2',
      }),
    );
    appState.activeSolution$.set(solution);
    appState.clearAOI();
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(
      (
        fixture.componentInstance as unknown as {
          cachedMetricsDocument(): CachedSolutionMetricsDocument | null;
        }
      ).cachedMetricsDocument()?.primaryGeography,
    ).toEqual({ level: 'sirap', scopeId: 'eje-cafetero' });
    expect(
      (
        fixture.componentInstance as unknown as { isSirapPacketOverview(): boolean }
      ).isSirapPacketOverview(),
    ).toBe(true);
    expect(compiled.querySelector('#right-sidebar-v3-overview-sirap-certified-badge')).toBeNull();
    expect(
      compiled.querySelector('#right-sidebar-v3-overview-goals-widget-target-rule'),
    ).toBeNull();
    const targetGroups = (
      fixture.componentInstance as unknown as {
        sirapOverviewTargetGroups(): {
          id: string;
          features: { id: string; achievedPercent: number; targetPercent: number }[];
        }[];
      }
    ).sirapOverviewTargetGroups();
    expect(targetGroups[0].features[0]).toMatchObject({
      id: 'paramos',
      achievedPercent: 51.6,
      targetPercent: 17,
    });
    expect(
      compiled.querySelector(
        '#right-sidebar-v3-overview-sirap-target-feature-strategic-ecosystems-paramos',
      )?.textContent,
    ).toContain('analysis.overview.goalsWidget.sirap.achievedLabel');
    expect(
      compiled.querySelector(
        '#right-sidebar-v3-overview-sirap-target-feature-dry-forest-bosque-seco',
      )?.textContent,
    ).toContain('analysis.overview.goalsWidget.sirap.achievedLabel');
    expect(
      compiled.querySelector('#right-sidebar-v3-overview-sirap-target-group-mode-dry-forest')
        ?.textContent,
    ).toContain('analysis.overview.goalsWidget.sirap.targetModes.inheritsStrategic');
    expect(
      compiled.querySelector('#right-sidebar-v3-overview-sirap-additional-outcomes-description')
        ?.textContent,
    ).toContain('analysis.overview.goalsWidget.sirap.additionalOutcomesDescription');
    expect(
      compiled.querySelector('#right-sidebar-v3-overview-sirap-ecosystem-iavh-total')?.textContent,
    ).toContain('1.250 km²');
    expect(
      compiled.querySelector('#right-sidebar-v3-overview-sirap-ecosystem-dry-forest')?.textContent,
    ).toContain('24 km²');
    expect(
      compiled.querySelector('#right-sidebar-v3-overview-sirap-species-mammals')?.textContent,
    ).toContain('64');
    expect(
      compiled.querySelector('#right-sidebar-v3-overview-sirap-species-plants')?.textContent,
    ).toContain('1.248');
    expect(compiled.querySelector('#right-sidebar-v3-overview-goals-widget-empty')).toBeNull();
    const speciesCoverageButton = compiled.querySelector(
      '#right-sidebar-v3-overview-sirap-species-view-additional-coverage',
    ) as HTMLButtonElement;
    const ecosystemCoverageButton = compiled.querySelector(
      '#right-sidebar-v3-overview-sirap-ecosystem-view-additional-coverage',
    ) as HTMLButtonElement;
    expect(speciesCoverageButton).not.toBeNull();
    expect(ecosystemCoverageButton).not.toBeNull();
    expect(solutionGoalsLoaderSpy.loadGoals).toHaveBeenCalledWith(solution.id);

    speciesCoverageButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(speciesGoalsLoaderSpy.load).toHaveBeenCalledWith(solution.id, 'siraps', 'eje-cafetero');

    (
      fixture.componentInstance as unknown as {
        closeGoalsModal(): void;
      }
    ).closeGoalsModal();
    ecosystemCoverageButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(mecMetricsLoaderSpy.loadMecMetrics).toHaveBeenCalledWith(solution.id, 'siraps');
  });

  it('does not present pending or blocked SIRAP metrics as zero', async () => {
    const solution = buildTestSolution();
    const document = buildRegionalSirapMetricsDocument(solution.id);
    const metrics = document.geographies.sirap?.['eje-cafetero'].metrics ?? [];
    replaceMetric(metrics, buildUnavailableMetric('ecosystem_coverage_wetlands', 'blocked'));
    replaceMetric(metrics, buildUnavailableMetric('species_richness_reptiles', 'pending'));
    vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(of(document));
    vi.spyOn(TestBed.inject(SolutionCatalogService), 'getById').mockReturnValue({
      id: solution.id,
      scope: 'sirap',
    } as CatalogSolution);
    appState.activeSolution$.set(solution);
    appState.clearAOI();
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(
      compiled.querySelector('#right-sidebar-v3-overview-sirap-ecosystem-wetlands'),
    ).toBeNull();
    expect(compiled.querySelector('#right-sidebar-v3-overview-sirap-species-reptiles')).toBeNull();
  });

  it('never falls back to Colombia metrics while a SIRAP primary scope is missing', async () => {
    const solution = buildTestSolution();
    vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(
      of({
        solutionId: solution.id,
        generatedAt: '2026-08-31T00:00:00Z',
        geographies: {
          national: {
            colombia: {
              metrics: [buildMetric('conservation_goals_met', 99, '%', 'percent')],
            },
          },
        },
      }),
    );
    vi.spyOn(TestBed.inject(SolutionCatalogService), 'getById').mockReturnValue({
      id: solution.id,
      scope: 'sirap',
      sirapId: 'eje-cafetero',
      precomputedMetricUrls: {},
    } as CatalogSolution);
    appState.activeSolution$.set(solution);
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      isSirapScopedSolution(): boolean;
      isSirapPacketOverview(): boolean;
      overviewSections(): unknown[];
    };
    expect(component.isSirapScopedSolution()).toBe(true);
    expect(component.isSirapPacketOverview()).toBe(false);
    expect(component.overviewSections()).toEqual([]);
    expect(
      fixture.nativeElement.querySelector(
        '#right-sidebar-v3-overview-sirap-target-progress-unavailable',
      ),
    ).not.toBeNull();
    expect(solutionGoalsLoaderSpy.loadGoals).not.toHaveBeenCalled();
  });

  it('renders the paired Orinoquía targets from its regional goal summary', async () => {
    const solution = buildTestSolution();
    goalsDocument = buildOrinoquiaGoalsDocument(solution.id);
    vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(
      of(buildRegionalSirapMetricsDocument(solution.id, 'orinoquia')),
    );
    vi.spyOn(TestBed.inject(SolutionCatalogService), 'getById').mockReturnValue({
      id: solution.id,
      scope: 'sirap',
      sirapId: 'orinoquia',
      precomputedMetricUrls: {
        goals: '/releases/sirap-test/goals/cache/orinoquia.goals.json',
      },
    } as CatalogSolution);
    appState.activeSolution$.set(solution);
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(
      compiled.querySelector('#right-sidebar-v3-overview-sirap-target-group-congriales'),
    ).not.toBeNull();
    expect(
      compiled.querySelector('#right-sidebar-v3-overview-sirap-target-group-savannas'),
    ).not.toBeNull();
    expect(
      compiled.querySelector('#right-sidebar-v3-overview-sirap-target-group-mode-congriales')
        ?.textContent,
    ).toContain('analysis.overview.goalsWidget.sirap.targetModes.pairedWithStrategic');
  });

  it('blocks stale cached and MEC metrics for the outdated territorial source', async () => {
    const solution = buildTestSolution();
    vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(
      of(
        buildCachedSirapMetricsDocument(solution.id, [
          buildMetric('priority_area_in_region', 321, 'km²', 'number'),
        ]),
      ),
    );
    appState.activeSolution$.set(solution);
    appState.selectAOI({
      id: 'sirap:territorial_territorial_amazonia_3',
      name: 'Territorial Amazonia',
      type: 'sirap',
      geometryUrl: '/inputs/boundaries/sirap/siraps_territorial.geojson',
      boundarySourceLayerKey: 'siraps_territorial',
      boundarySourceId: 'aoi-siraps-territorial-colombia',
      boundaryGeometrySelection: 'whole-feature',
    });
    appState.setRightSidebarMode('aoi');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      aoiMetrics(): MetricValue[];
      buildAoiMetricsCsvRows(): string[][];
    };
    const compiled = fixture.nativeElement as HTMLElement;

    expect(component.aoiMetrics()).toEqual([]);
    expect(compiled.querySelector('#aoi-hero-priority')?.textContent).not.toContain('321');
    expect(compiled.querySelector('#aoi-hero-priority')?.textContent).toContain('--');
    expect(
      component.buildAoiMetricsCsvRows().some((row) => row.some((cell) => cell.includes('321'))),
    ).toBe(false);
    expect(mecMetricsLoaderSpy.loadMecMetrics).not.toHaveBeenCalled();
    expect(compiled.querySelector('#aoi-mec-unavailable-title')?.textContent).toContain(
      'analysis.aoi.mec.states.partialSirapTitle',
    );
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
      compiled.querySelector('#right-sidebar-v3-overview-goals-domain-count-ecosystems')
        ?.textContent,
    ).toContain('1 / 2');
    expect(
      compiled
        .querySelector('#right-sidebar-v3-overview-goals-domain-bar-ecosystems')
        ?.getAttribute('aria-label'),
    ).toBe('50%');
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
    expect(
      compiled.querySelector('#right-sidebar-v3-overview-goals-additional-taxa-Mammals'),
    ).not.toBeNull();
    expect(
      compiled.querySelector('#right-sidebar-v3-overview-goals-additional-taxa-count-17-Mammals')
        ?.textContent,
    ).toContain('1');
    expect(
      compiled.querySelector('#right-sidebar-v3-overview-goals-additional-taxa-count-30-Mammals')
        ?.textContent,
    ).toContain('1');
    expect(compiled.querySelector('#right-sidebar-v3-overview-goals-domain-species')).toBeNull();
  });

  it('uses complete species rollups without filtering post-hoc provenance', () => {
    goalsDocument = buildGoalsDocument();
    goalsDocument.targetContext.targetFeatureSet = 'species';
    goalsDocument.targetContext.targetFeatureIds = ['species'];
    goalsDocument.summary.byType.species = {
      metSpeciesCount: 7_978,
      totalSpeciesCount: 7_980,
      pctMet: 99.9749,
    };
    goalsDocument.diagnostics.evaluationSourceCounts = {
      prioritizr_model: 288,
      'post-hoc': 7_692,
    };
    goalsDocument.features.species = goalsDocument.features.species.slice(0, 2);
    goalsDocument.features.species[0].evaluationSource = 'prioritizr_model';
    goalsDocument.features.species[1].evaluationSource = 'post-hoc';
    appState.activeSolution$.set(buildTestSolution());
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();

    const domains = (
      fixture.componentInstance as unknown as {
        buildOverviewGoalsDomains(): { id: string; metCount: number; totalCount: number }[];
      }
    ).buildOverviewGoalsDomains();
    expect(domains.find((domain) => domain.id === 'species')).toEqual(
      expect.objectContaining({ metCount: 7_978, totalCount: 7_980 }),
    );
  });

  it('shows raster-derived strategic outcomes without changing solver target progress', async () => {
    goalsDocument = buildGoalsDocument();
    strategicOutcomesDocument = buildStrategicOutcomesDocument();
    appState.activeSolution$.set(buildTestSolution());
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(
      compiled.querySelector('#right-sidebar-v3-overview-goals-domain-ecosystems'),
    ).not.toBeNull();
    expect(
      compiled.querySelector(
        '#right-sidebar-v3-overview-goals-additional-domain-strategic-ecosystems',
      ),
    ).not.toBeNull();
    expect(
      compiled.querySelector(
        '#right-sidebar-v3-overview-goals-additional-domain-count-17-strategic-ecosystems',
      )?.textContent,
    ).toContain('4');
    expect(
      compiled.querySelector(
        '#right-sidebar-v3-overview-goals-additional-domain-count-30-strategic-ecosystems',
      )?.textContent,
    ).toContain('2');
    expect(
      compiled.querySelector(
        '#right-sidebar-v3-overview-goals-additional-domain-method-tooltip-strategic-ecosystems',
      )?.textContent,
    ).toContain('strategicRasterDerivedMethod');
    const strategicLabel = compiled.querySelector(
      '#right-sidebar-v3-overview-goals-additional-domain-label-strategic-ecosystems',
    );
    expect(strategicLabel?.childNodes[0]?.textContent?.trim()).toBe(
      'analysis.overview.goalsWidget.strategicEcosystems',
    );
    expect(
      compiled
        .querySelector(
          '#right-sidebar-v3-overview-goals-additional-domain-method-tooltip-strategic-ecosystems',
        )
        ?.classList.contains('v3-methodology-tooltip-overlay'),
    ).toBe(true);
    expect(
      compiled
        .querySelector(
          '#right-sidebar-v3-overview-goals-additional-domain-method-tooltip-strategic-ecosystems',
        )
        ?.getAttribute('popover'),
    ).toBe('manual');

    (
      compiled.querySelector(
        '#right-sidebar-v3-overview-goals-additional-domain-view-strategic-ecosystems',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();

    expect(compiled.querySelector('#conservation-goals-modal-description')?.textContent).toContain(
      'strategicRasterAdditionalDescription',
    );
    expect(
      compiled.querySelector('#conservation-goals-modal-measured-value')?.textContent,
    ).toContain('4');
    expect(compiled.querySelector('#conservation-goals-modal-feature-secondary-0')).toBeNull();
    expect(
      compiled.querySelector('#conservation-goals-modal-coverage-area-0')?.textContent,
    ).toContain('km²');
    expect(
      compiled.querySelector('#conservation-goals-modal-heading-coverage')?.textContent,
    ).toContain('analysis.overview.goalsWidget.modal.nationalTotalCoverage');
    expect(
      compiled.querySelector('#conservation-goals-modal-heading-coverage')?.textContent,
    ).not.toContain('rangeCoverage');
  });

  it('keeps targeted strategic progress on solver summary rows', () => {
    goalsDocument = buildGoalsDocument();
    goalsDocument.targetContext.targetFeatureSet = 'strategic_ecosystems';
    goalsDocument.targetContext.targetFeatureIds = ['strategic_ecosystems'];
    strategicOutcomesDocument = buildStrategicOutcomesDocument();
    appState.activeSolution$.set(buildTestSolution());
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(
      compiled.querySelector('#right-sidebar-v3-overview-goals-domain-strategic-ecosystems'),
    ).not.toBeNull();
    expect(
      compiled.querySelector(
        '#right-sidebar-v3-overview-goals-additional-domain-strategic-ecosystems',
      ),
    ).toBeNull();
    expect(
      compiled.querySelector('#right-sidebar-v3-overview-goals-domain-count-strategic-ecosystems')
        ?.textContent,
    ).toContain('2 / 4');
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
    expect(speciesGoalsLoaderSpy.load).toHaveBeenCalledWith(
      buildTestSolution().id,
      'national',
      'colombia',
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();

    expect((compiled.querySelector('#conservation-goals-modal') as HTMLDialogElement).open).toBe(
      true,
    );
    expect(component.goalsModalRows()).toHaveLength(3);
    expect(fixture.debugElement.query(By.directive(CdkVirtualScrollViewport))).not.toBeNull();
    expect(
      compiled.querySelector('#conservation-goals-modal-national-virtual-heading-checkpoints'),
    ).not.toBeNull();
    expect(
      compiled.querySelector('#conservation-goals-modal-national-virtual-heading-target'),
    ).toBeNull();
    expect(compiled.querySelector('#conservation-goals-modal-title')?.textContent).toContain(
      'analysis.overview.goalsWidget.modal.nationalSpeciesTitle',
    );
    expect(
      compiled.querySelector('#conservation-goals-modal-national-virtual-heading-range'),
    ).not.toBeNull();
    expect(
      compiled.querySelector('#conservation-goals-modal-national-virtual-heading-coverage-group')
        ?.textContent,
    ).toContain('analysis.overview.goalsWidget.modal.solutionCoverageGroup');
    expect(
      compiled.querySelector('#conservation-goals-modal-national-range-0')?.textContent,
    ).toContain('km²');
    expect(
      compiled.querySelector('#conservation-goals-modal-pre-existing-coverage-area-0')?.textContent,
    ).toContain('km²');
    expect(
      compiled.querySelector('#conservation-goals-modal-new-coverage-area-0')?.textContent,
    ).toContain('km²');
    expect(
      compiled.querySelector('#conservation-goals-modal-coverage-area-0')?.textContent,
    ).toContain('km²');

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

  it('gates expanded known-AOI species metrics while preserving checkpoints', async () => {
    const solution = buildTestSolution();
    goalsDocument = buildGoalsDocument();
    vi.spyOn(TestBed.inject(SolutionCatalogService), 'getById').mockReturnValue({
      id: solution.id,
      capabilities: { aoiCoverageMetrics: 'v2' },
    } as CatalogSolution);
    appState.activeSolution$.set(solution);
    appState.selectAOI(buildFixedMunicipalityAoi());
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
    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();

    expect(
      compiled.querySelector('#conservation-goals-modal-virtual-heading-rangeInAoi'),
    ).not.toBeNull();
    expect(
      compiled.querySelector('#conservation-goals-modal-virtual-heading-preExistingCoverage'),
    ).not.toBeNull();
    expect(
      compiled.querySelector('#conservation-goals-modal-range-in-aoi-percent-0')?.textContent,
    ).toContain('100%');
    expect(
      compiled.querySelector('#conservation-goals-modal-solution-coverage-area-0')?.textContent,
    ).toContain('km²');
    expect(
      compiled.querySelector('#conservation-goals-modal-virtual-heading-checkpoints'),
    ).not.toBeNull();
  });

  it('uses SIRAP additional-coverage column order without changing national order', () => {
    const nationalFixture = TestBed.createComponent(PanelSwitcherComponent);
    nationalFixture.detectChanges();
    const nationalComponent = nationalFixture.componentInstance as unknown as {
      goalsModalCoverageMetrics(): { id: string }[];
    };
    expect(nationalComponent.goalsModalCoverageMetrics().map((metric) => metric.id)).toEqual([
      'range-in-aoi',
      'solution-coverage',
      'pre-existing-coverage',
      'new-coverage',
    ]);

    const solution = buildTestSolution();
    vi.spyOn(TestBed.inject(SolutionCatalogService), 'getById').mockReturnValue({
      id: solution.id,
      scope: 'sirap',
      sirapId: 'eje-cafetero',
      capabilities: { aoiCoverageMetrics: 'v2' },
    } as CatalogSolution);
    appState.activeSolution$.set(solution);
    const sirapFixture = TestBed.createComponent(PanelSwitcherComponent);
    sirapFixture.detectChanges();
    const sirapComponent = sirapFixture.componentInstance as unknown as {
      goalsModalCoverageMetrics(): { id: string }[];
      goalsModalUsesExpandedCoverageLayout(): boolean;
      toSpeciesGoalsModalRow(
        record: HydratedSpeciesGoalsRecord,
        rangeInSirapAreaKm2: number | null,
      ): {
        rangeInSirapPercent: number | null;
        remainingRelativeHeld: number | null;
      };
    };
    expect(sirapComponent.goalsModalCoverageMetrics().map((metric) => metric.id)).toEqual([
      'range-in-aoi',
      'pre-existing-coverage',
      'new-coverage',
      'solution-coverage',
    ]);
    expect(sirapComponent.goalsModalUsesExpandedCoverageLayout()).toBe(true);
    expect(
      sirapComponent.toSpeciesGoalsModalRow(
        {
          ...buildHydratedSpeciesRecords(buildGoalsDocument())[0]!,
          range_in_aoi_area_km2: 10,
          solution_covered_in_aoi_area_km2: 3,
        },
        40,
      ),
    ).toMatchObject({
      rangeInSirapPercent: 0.25,
      remainingRelativeHeld: 0.7,
    });
    nationalFixture.destroy();
    sirapFixture.destroy();
  });

  it('bounds a large species breakdown with the virtual viewport', async () => {
    const document = buildGoalsDocument();
    const baseRecord = buildHydratedSpeciesRecords(document)[0]!;
    vi.mocked(speciesGoalsLoaderSpy.load).mockReturnValue(
      of(
        Array.from({ length: 8_300 }, (_, index) => ({
          ...baseRecord,
          id: `species-${index}`,
          scientific_name: `Species ${index}`,
          solution_covered_in_aoi_pct: index % 100,
          met_17_percent: index % 100 >= 17,
          met_30_percent: index % 100 >= 30,
        })),
      ),
    );
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

    expect(component.goalsModalRows()).toHaveLength(8_300);
    expect(viewport.getDataLength()).toBe(8_300);
    expect(renderedRange.end - renderedRange.start).toBeLessThan(100);
    expect(
      fixture.nativeElement.querySelectorAll('[id^="conservation-goals-modal-row-"]').length,
    ).toBeLessThan(100);
  });

  it('uses summary species rows as the national targeted modal denominator', async () => {
    const document = buildGoalsDocument();
    document.targetContext.targetFeatureSet = 'species';
    document.targetContext.targetFeatureIds = ['especies'];
    const templates = buildHydratedSpeciesRecords(document);
    const records = Array.from({ length: 8_300 }, (_, index) => ({
      ...templates[index % templates.length],
      id: `species-${index}`,
      configured_target_percent: index < 8_001 ? 17 : null,
      configured_target_met: index < 8_001 ? false : null,
    }));
    vi.mocked(speciesGoalsLoaderSpy.load).mockReturnValue(of(records));
    goalsDocument = document;
    appState.activeSolution$.set(buildTestSolution());
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    const component = fixture.componentInstance as unknown as {
      goalsModalRows: () => unknown[];
      goalsModalSummary: () => { totalCount: number; metCount: number; pctMet: number | null };
    };
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '#right-sidebar-v3-overview-goals-domain-view-species',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();

    expect(component.goalsModalRows()).toHaveLength(3);
    expect(component.goalsModalSummary()).toMatchObject({
      totalCount: 3,
      metCount: 0,
      pctMet: 0,
    });
    expect(speciesGoalsLoaderSpy.load).not.toHaveBeenCalled();
    expect(
      fixture.nativeElement.querySelector(
        '#conservation-goals-modal-national-virtual-heading-target',
      ),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector(
        '#conservation-goals-modal-national-virtual-heading-status',
      ),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('#conservation-goals-modal-coverage-bar-0'),
    ).not.toBeNull();
  });

  it('renders true, false, and unavailable species target statuses distinctly', async () => {
    const document = buildGoalsDocument();
    document.targetContext.targetFeatureSet = 'species';
    document.targetContext.targetFeatureIds = ['especies'];
    const records = buildHydratedSpeciesRecords(document).map((record, index) => ({
      ...record,
      configured_target_percent: 17,
      configured_target_met: [true, false, null][index] ?? null,
    }));
    vi.mocked(speciesGoalsLoaderSpy.load).mockReturnValue(of(records));
    goalsDocument = document;
    appState.activeSolution$.set(buildTestSolution());
    appState.selectAOI(buildFixedMunicipalityAoi());
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '#right-sidebar-v3-overview-goals-domain-view-species',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const metBadge = compiled.querySelector('#conservation-goals-modal-status-badge-0');
    const notMetBadge = compiled.querySelector('#conservation-goals-modal-status-badge-1');
    const unavailableBadge = compiled.querySelector('#conservation-goals-modal-status-badge-2');

    expect(metBadge?.textContent).toContain('analysis.overview.goalsWidget.modal.met');
    expect(metBadge?.classList).toContain('bg-emerald-100');
    expect(notMetBadge?.textContent).toContain('analysis.overview.goalsWidget.modal.notMet');
    expect(notMetBadge?.classList).toContain('bg-amber-100');
    expect(unavailableBadge?.textContent?.trim()).toBe('—');
    expect(unavailableBadge?.textContent).not.toContain(
      'analysis.overview.goalsWidget.modal.notMet',
    );
    expect(unavailableBadge?.classList).not.toContain('bg-amber-100');
    expect(unavailableBadge?.classList).toContain('bg-slate-100');
    expect(unavailableBadge?.getAttribute('aria-label')).toContain(
      'analysis.overview.goalsWidget.modal.statusUnavailable',
    );
  });

  it.each([
    ['department', buildMetaDepartmentAoi(), 'departments', '50'],
    ['prefixed municipality', buildFixedMunicipalityAoi(), 'municipalities', '11001'],
  ])('loads the selected %s species sidecar scope', async (_label, aoi, level, scopeId) => {
    goalsDocument = buildGoalsDocument();
    appState.activeSolution$.set(buildTestSolution());
    appState.selectAOI(aoi);
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '#right-sidebar-v3-overview-goals-additional-domain-view-species',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(speciesGoalsLoaderSpy.load).toHaveBeenCalledWith(buildTestSolution().id, level, scopeId);
  });

  it.each([
    ['combined', 'siraps', 'aoi-siraps-combined-colombia'],
    ['territorial', 'siraps_territorial_updated', 'aoi-siraps-territorial-updated-colombia'],
    ['thematic', 'siraps_thematic', 'aoi-siraps-thematic-colombia'],
  ])(
    'loads the selected production %s SIRAP species sidecar',
    (_label, boundarySourceLayerKey, boundarySourceId) => {
      goalsDocument = buildGoalsDocument();
      appState.activeSolution$.set(buildTestSolution());
      appState.selectAOI(buildSirapAoi(boundarySourceLayerKey, boundarySourceId));
      appState.setRightSidebarMode('overview');

      const fixture = TestBed.createComponent(PanelSwitcherComponent);
      fixture.detectChanges();
      (
        fixture.nativeElement.querySelector(
          '#right-sidebar-v3-overview-goals-additional-domain-view-species',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      expect(speciesGoalsLoaderSpy.load).toHaveBeenCalledWith(
        buildTestSolution().id,
        'siraps',
        'territorial_territorial_amazonia_3',
      );
    },
  );

  it('does not request species goals for the outdated territorial SIRAP source', () => {
    goalsDocument = buildGoalsDocument();
    appState.activeSolution$.set(buildTestSolution());
    appState.selectAOI(buildSirapAoi('siraps_territorial', 'aoi-siraps-territorial-colombia'));
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '#right-sidebar-v3-overview-goals-additional-domain-view-species',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(speciesGoalsLoaderSpy.load).not.toHaveBeenCalled();
  });

  it('disables the species breakdown for a custom polygon without starting a runtime job', () => {
    goalsDocument = buildGoalsDocument();
    vi.mocked(apiServiceSpy.getCustomPolygonMetrics).mockReturnValue(
      of(buildCustomPolygonResponse({ priority_area_in_region: 2.5 })),
    );
    appState.activeSolution$.set(buildTestSolution());
    appState.selectCustomAOI(buildTestGeometry(), { name: 'Drawn AOI', areaKm2: 10 });
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      '#right-sidebar-v3-overview-goals-additional-domain-view-species',
    ) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.title).toContain('customSpeciesUnavailable');
    button.click();
    expect(speciesGoalsLoaderSpy.load).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('#conservation-goals-modal')).toBeNull();
  });

  it('enables SIRAP custom AOI expanded coverage for eje-cafetero solutions', async () => {
    const solution = buildTestSolution();
    goalsDocument = buildSirapGoalsDocument(solution.id);
    mockSirapCatalogSolution(solution);
    vi.mocked(apiServiceSpy.getCustomPolygonMetrics).mockReturnValue(
      of(buildCustomPolygonResponse({ priority_area_in_region: 2.5 })),
    );
    vi.mocked(apiServiceSpy.getCustomAoiAreaProfile).mockImplementation((request) =>
      of(
        request.sections[0] === 'ecosystems'
          ? {
              ...buildCustomEcosystemProfileResponse(solution.id),
              sections: {
                ecosystems: {
                  ...buildCustomEcosystemProfileResponse(solution.id).sections.ecosystems!,
                  solution_coverage: buildMesaEcosystemCoverageFixture().slice(0, 2),
                },
              },
            }
          : buildCustomEcosystemProfileResponse(solution.id),
      ),
    );
    appState.activeSolution$.set(solution);
    appState.selectCustomAOI(buildTestGeometry(), { name: 'Drawn AOI', areaKm2: 10 });
    appState.setRightSidebarMode('overview');

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    const component = fixture.componentInstance as unknown as {
      supportsSirapCustomAoiMetrics(): boolean;
      goalsModalUsesExpandedCoverageLayout(): boolean;
    };
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.supportsSirapCustomAoiMetrics()).toBe(true);
    expect(component.goalsModalUsesExpandedCoverageLayout()).toBe(true);
    expect(apiServiceSpy.getCustomPolygonMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        geometry: buildTestGeometry(),
        solution_id: solution.id,
      }),
    );

    (
      fixture.componentInstance as unknown as { openGoalsModal(domainId: string): void }
    ).openGoalsModal('species');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();

    expect(speciesGoalsLoaderSpy.load).toHaveBeenCalledWith(solution.id, 'siraps', 'eje-cafetero');
    expect(apiServiceSpy.createDetailedSpeciesCoverageJob).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('#conservation-goals-modal')).not.toBeNull();
  });

  it('shows species loading and recoverable error states', async () => {
    const request = new Subject<HydratedSpeciesGoalsRecord[] | null>();
    vi.mocked(speciesGoalsLoaderSpy.load).mockReturnValue(request);
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
    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();

    expect(compiled.querySelector('#conservation-goals-modal-species-loading')).not.toBeNull();
    expect(compiled.querySelector('#conservation-goals-modal-species-viewport')).toBeNull();

    request.next(null);
    fixture.detectChanges();
    expect(compiled.querySelector('#conservation-goals-modal-species-error')).not.toBeNull();
    (
      compiled.querySelector('#conservation-goals-modal-species-retry-button') as HTMLButtonElement
    ).click();
    expect(speciesGoalsLoaderSpy.load).toHaveBeenCalledTimes(2);
  });

  it('labels and switches the national ecosystem classification breakdown', async () => {
    const solution = buildTestSolution();
    goalsDocument = buildGoalsDocument();
    const mecDocument = buildFiveViewV2MecDocument(solution.id);
    mecDocument.classCatalog[4] = [4, 'biomeRegion:andean-forest', 'Andean forest'];
    mecDocument.classCatalog.push([4, 'biomeRegion:taxonomy-only', 'Taxonomy-only ecosystem']);
    mecDocument.rows.push([0, mecDocument.classCatalog.length - 1, 0, 0, 0]);
    vi.mocked(mecMetricsLoaderSpy.loadMecMetrics).mockReturnValue(
      of({
        status: 'loaded',
        document: mecDocument,
        format: 'mec-compact-v2',
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
    expect(compiled.querySelector('#conservation-goals-modal-met-value')?.textContent).toContain(
      '1 / 2',
    );
    expect(
      compiled.querySelector('#conservation-goals-modal-feature-name-0')?.textContent,
    ).toContain('Andean forest');
    expect(
      compiled.querySelector('#conservation-goals-modal-ecosystem-area-0')?.textContent,
    ).toContain('10 km²');
    expect(
      compiled.querySelector('#conservation-goals-modal-pre-existing-coverage-0')?.textContent,
    ).toContain('10');
    expect(
      compiled.querySelector('#conservation-goals-modal-pre-existing-coverage-area-0')?.textContent,
    ).toContain('1 km²');
    expect(
      compiled.querySelector('#conservation-goals-modal-new-coverage-0')?.textContent,
    ).toContain('30');
    expect(
      compiled.querySelector('#conservation-goals-modal-new-coverage-area-0')?.textContent,
    ).toContain('3 km²');
    expect(
      compiled.querySelector('#conservation-goals-modal-coverage-value-0')?.textContent,
    ).toContain('40');
    expect(
      compiled.querySelector('#conservation-goals-modal-coverage-area-0')?.textContent,
    ).toContain('4 km²');
    expect(compiled.textContent).not.toContain('Taxonomy-only ecosystem');

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
      compiled.querySelector('#conservation-goals-modal-ecosystem-area-0')?.textContent,
    ).toContain('10 km²');
    expect(
      compiled.querySelector('#conservation-goals-modal-pre-existing-coverage-area-0')?.textContent,
    ).toContain('1 km²');
    expect(
      compiled.querySelector('#conservation-goals-modal-new-coverage-0')?.textContent,
    ).toContain('30');
    expect(
      compiled.querySelector('#conservation-goals-modal-new-coverage-area-0')?.textContent,
    ).toContain('3 km²');
    expect(
      compiled.querySelector('#conservation-goals-modal-coverage-value-0')?.textContent,
    ).toContain('40');
    expect(
      compiled.querySelector('#conservation-goals-modal-coverage-area-0')?.textContent,
    ).toContain('4 km²');
    expect(compiled.querySelector('#conservation-goals-modal-met-value')?.textContent).toContain(
      '1 / 2',
    );
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

  describe('release species exception (partial status, real values)', () => {
    it('shows targetless species reference outcomes and their aggregate breakdown', async () => {
      const solution = buildTestSolution();
      goalsDocument = buildGoalsDocument();
      vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(
        of(buildTargetlessSpeciesMetricsDocument(solution.id)),
      );
      appLocale.setLocale('en');
      appState.activeSolution$.set(solution);
      appState.setRightSidebarMode('overview');

      const fixture = TestBed.createComponent(PanelSwitcherComponent);
      await fixture.whenStable();
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      const component = fixture.componentInstance as unknown as {
        additionalOutcomeGoalsDomains: () => { id: string; totalCount: number }[];
      };

      expect(
        compiled.querySelector(
          '#right-sidebar-v3-overview-gain-row-metric-02-species-groups-protected',
        )?.textContent,
      ).toContain('17%: 7.8K · 30%: 1.5K');
      expect(
        compiled.querySelector(
          '#right-sidebar-v3-overview-gain-row-metric-03-threatened-species-secured',
        )?.textContent,
      ).toContain('17%: 175 · 30%: 70');
      expect(
        component.additionalOutcomeGoalsDomains().find((domain) => domain.id === 'species')
          ?.totalCount,
      ).toBe(8132);
      expect(
        compiled.querySelector('#right-sidebar-v3-overview-goals-additional-taxa-birds'),
      ).not.toBeNull();
      expect(
        compiled.querySelector('#right-sidebar-v3-overview-goals-additional-taxa-count-17-birds')
          ?.textContent,
      ).toContain('1440');
      expect(
        compiled.querySelector('#right-sidebar-v3-overview-goals-additional-taxa-count-30-birds')
          ?.textContent,
      ).toContain('313');

      (
        compiled.querySelector(
          '#right-sidebar-v3-overview-goals-additional-domain-view-species',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve, 20));
      fixture.detectChanges();

      expect(
        compiled.querySelector('#conservation-goals-modal-species-reference-breakdown'),
      ).not.toBeNull();
      expect(
        compiled.querySelector('#conservation-goals-modal-species-reference-17-birds')?.textContent,
      ).toContain('1,440 / 1,490');
    });

    it('renders partial species values on the overview cards with a coverage caveat', async () => {
      const solution = buildTestSolution();
      vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(
        of(buildPartialSpeciesMetricsDocument(solution.id)),
      );
      appLocale.setLocale('en');
      appState.activeSolution$.set(solution);
      appState.setRightSidebarMode('overview');

      const fixture = TestBed.createComponent(PanelSwitcherComponent);
      await fixture.whenStable();
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const groupsCard = compiled.querySelector(
        '#right-sidebar-v3-overview-gain-row-metric-02-species-groups-protected',
      );
      const threatenedCard = compiled.querySelector(
        '#right-sidebar-v3-overview-gain-row-metric-03-threatened-species-secured',
      );

      expect(groupsCard?.textContent).toContain('8K / 8.1K');
      expect(
        groupsCard
          ?.querySelector(
            '#right-sidebar-v3-overview-gain-value-metric-02-species-groups-protected',
          )
          ?.getAttribute('data-full-value'),
      ).toBe('8,043 / 8,132');
      expect(groupsCard?.textContent).not.toContain('--');
      expect(threatenedCard?.textContent).toContain('193');
      expect(threatenedCard?.textContent).not.toContain('--');
      expect(
        compiled.querySelector(
          '#right-sidebar-v3-overview-gain-partial-note-metric-02-species-groups-protected',
        )?.textContent,
      ).toContain('analysis.common.partialSpeciesCoverage');
      expect(
        compiled.querySelector(
          '#right-sidebar-v3-overview-gain-partial-note-metric-03-threatened-species-secured',
        ),
      ).not.toBeNull();
      expect(
        compiled.querySelector(
          '#right-sidebar-v3-overview-gain-partial-note-metric-18-priority-area-total',
        ),
      ).toBeNull();
      expect(
        compiled.querySelector(
          '#right-sidebar-v3-overview-gain-unavailable-help-metric-03-threatened-species-secured',
        ),
      ).toBeNull();
    });

    it('renders partial species-richness bars for a fixed department AOI', async () => {
      const solution = buildTestSolution();
      vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(
        of(buildPartialSpeciesMetricsDocument(solution.id)),
      );
      appLocale.setLocale('en');
      appState.activeSolution$.set(solution);
      appState.selectAOI(buildMetaDepartmentAoi());
      appState.setRightSidebarMode('aoi');

      const fixture = TestBed.createComponent(PanelSwitcherComponent);
      await fixture.whenStable();
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('#aoi-species-value-mammals')?.textContent).toContain('186');
      expect(compiled.querySelector('#aoi-species-value-birds')?.textContent).toContain('1081');
      expect(compiled.querySelector('#aoi-species-value-amphibians')?.textContent).toContain('61');
      expect(compiled.querySelector('#aoi-species-value-reptiles')?.textContent).toContain('86');
      expect(compiled.querySelector('#aoi-species-value-plants')?.textContent).toContain('4726');
      expect(compiled.querySelector('#aoi-species-chart')?.textContent).not.toContain('--');
      expect(compiled.querySelector('#aoi-species-partial-note')?.textContent).toContain(
        'analysis.common.partialSpeciesCoverage',
      );
    });

    it('exports partial species values to CSV instead of "unavailable"', async () => {
      const solution = buildTestSolution();
      vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(
        of(buildPartialSpeciesMetricsDocument(solution.id)),
      );
      appLocale.setLocale('en');
      appState.activeSolution$.set(solution);
      appState.selectAOI(buildMetaDepartmentAoi());
      appState.setRightSidebarMode('aoi');

      const fixture = TestBed.createComponent(PanelSwitcherComponent);
      await fixture.whenStable();
      fixture.detectChanges();

      const component = fixture.componentInstance as unknown as {
        buildAoiMetricsCsvRows(): string[][];
      };
      const valueByMetricLabel = new Map(
        component.buildAoiMetricsCsvRows().map((row) => [row[0], row[2]] as const),
      );

      expect(valueByMetricLabel.get('metrics.species_richness_mammals')).toBe('186');
      expect(valueByMetricLabel.get('metrics.species_richness_plants')).toBe('4,726');
      expect(valueByMetricLabel.get('metrics.threatened_species_count')).toBe('89');
      expect([...valueByMetricLabel.values()]).not.toContain('analysis.common.valueUnavailable');
    });

    it('leaves valueless species metrics blank for targetless and marine solutions', async () => {
      const solution = buildTestSolution();
      vi.mocked(apiServiceSpy.getSolutionMetrics).mockReturnValue(
        of(buildValuelessSpeciesMetricsDocument(solution.id)),
      );
      appLocale.setLocale('en');
      appState.activeSolution$.set(solution);
      appState.selectAOI(buildMetaDepartmentAoi());
      appState.setRightSidebarMode('aoi');

      const fixture = TestBed.createComponent(PanelSwitcherComponent);
      await fixture.whenStable();
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('#aoi-species-value-mammals')?.textContent).toContain('--');
      expect(compiled.querySelector('#aoi-species-partial-note')).toBeNull();
    });
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

function buildDetailedSpeciesJob(
  status: DetailedSpeciesJobResponse['status'],
): DetailedSpeciesJobResponse {
  return {
    job_id: 'panel-species-job',
    status,
    queue_position: null,
    estimated_wait_seconds: null,
    compute_ms: status === 'complete' ? 10 : null,
    result:
      status === 'complete'
        ? {
            artifact_version: 'test',
            solution_id: 'test-solution',
            solution_raster_checksum: 'checksum',
            records: [],
          }
        : null,
    error_code: null,
    coalesced: false,
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
      solutionDomain: 'land',
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

function buildSirapGoalsDocument(solutionId: string): SolutionGoalsDocument {
  const base = buildGoalsDocument();
  const paramos = {
    ...buildGoalFeature('paramos', 'paramos', 'strategicEcosystems', 0.516, true),
    relativeTarget: 0.17,
    absoluteTarget: 17,
    absoluteShortfall: 0,
    relativeShortfall: 0,
    evaluationSource: 'prioritizr_model',
  };
  const wetlands = {
    ...buildGoalFeature('humedales', 'humedales', 'strategicEcosystems', 0.17, true),
    relativeTarget: 0.17,
    absoluteTarget: 17,
    absoluteShortfall: 0,
    relativeShortfall: 0,
    evaluationSource: 'prioritizr_model',
  };
  const dryForest = {
    ...buildGoalFeature('bosque-seco', 'bosque seco', 'strategicEcosystems', 0.17, true),
    relativeTarget: 0.17,
    absoluteTarget: 17,
    absoluteShortfall: 0,
    relativeShortfall: 0,
    evaluationSource: 'prioritizr_model',
  };
  const ejeWetlands = {
    ...buildGoalFeature('ec-wetlands', 'EC wetlands', 'strategicEcosystems', 0.7, true),
    relativeTarget: 0.7,
    absoluteTarget: 70,
    absoluteShortfall: 0,
    relativeShortfall: 0,
    evaluationSource: 'prioritizr_model',
  };
  const features = [paramos, wetlands, dryForest, ejeWetlands];

  return {
    ...base,
    solutionId,
    solutionName: 'Estr17+HuEC70+RUNAP_IHEH2022',
    source: {
      ...base.source,
      summaryCsvUrl: '/certified/eje-summary.csv',
      summaryCsvSha256: 'a'.repeat(64),
      summaryCsvRows: 100,
      summarySchema: 'prioritizr-summary-v1',
    },
    targetContext: {
      ...base.targetContext,
      finderTargetPercent: null,
      targetFeatureSet: 'sirap:eje-cafetero:step-1',
      targetFeatureIds: ['strategic-ecosystems', 'dry-forest', 'eje-wetlands'],
      sirap: {
        regionId: 'eje-cafetero',
        selectionStep: 1,
        source: 'certified-solution-name',
        groups: [
          { id: 'strategic-ecosystems', targetPercent: 17, targetMode: 'configured' },
          { id: 'dry-forest', targetPercent: 17, targetMode: 'inherits-strategic' },
          { id: 'eje-wetlands', targetPercent: 70, targetMode: 'configured' },
        ],
      },
    },
    features: {
      species: [],
      strategicEcosystems: features,
      ecosystems: [],
      other: [],
    },
    regionalTargetGroups: [
      {
        id: 'strategic-ecosystems',
        targetPercent: 17,
        targetMode: 'configured',
        evaluationSource: 'prioritizr_model',
        features: [paramos, wetlands],
      },
      {
        id: 'dry-forest',
        targetPercent: 17,
        targetMode: 'inherits-strategic',
        evaluationSource: 'prioritizr_model',
        features: [dryForest],
      },
      {
        id: 'eje-wetlands',
        targetPercent: 70,
        targetMode: 'configured',
        evaluationSource: 'prioritizr_model',
        features: [ejeWetlands],
      },
    ],
  };
}

function buildOrinoquiaGoalsDocument(solutionId: string): SolutionGoalsDocument {
  const base = buildSirapGoalsDocument(solutionId);
  const congriales = {
    ...buildGoalFeature('congriales', 'congriales', 'strategicEcosystems', 0.65, true),
    relativeTarget: 0.17,
    absoluteTarget: 17,
    absoluteShortfall: 0,
    relativeShortfall: 0,
    evaluationSource: 'prioritizr_model',
  };
  const savannas = {
    ...buildGoalFeature('savannas', 'savannas', 'strategicEcosystems', 0.29, false),
    relativeTarget: 0.3,
    absoluteTarget: 30,
    absoluteShortfall: 1,
    relativeShortfall: 0.01,
    evaluationSource: 'prioritizr_model',
  };
  const strategicFeatures = base.regionalTargetGroups?.[0].features ?? [];

  return {
    ...base,
    solutionName: 'Estr17+Cong17+Sab30+RUNAP_IHEH2022',
    targetContext: {
      ...base.targetContext,
      targetFeatureSet: 'sirap:orinoquia:step-1',
      targetFeatureIds: ['strategic-ecosystems', 'congriales', 'savannas'],
      sirap: {
        regionId: 'orinoquia',
        selectionStep: 1,
        source: 'certified-solution-name',
        groups: [
          { id: 'strategic-ecosystems', targetPercent: 17, targetMode: 'paired' },
          { id: 'congriales', targetPercent: 17, targetMode: 'paired-with-strategic' },
          { id: 'savannas', targetPercent: 30, targetMode: 'configured' },
        ],
      },
    },
    features: {
      species: [],
      strategicEcosystems: [...strategicFeatures, congriales, savannas],
      ecosystems: [],
      other: [],
    },
    regionalTargetGroups: [
      {
        id: 'strategic-ecosystems',
        targetPercent: 17,
        targetMode: 'paired',
        evaluationSource: 'prioritizr_model',
        features: strategicFeatures,
      },
      {
        id: 'congriales',
        targetPercent: 17,
        targetMode: 'paired-with-strategic',
        evaluationSource: 'prioritizr_model',
        features: [congriales],
      },
      {
        id: 'savannas',
        targetPercent: 30,
        targetMode: 'configured',
        evaluationSource: 'prioritizr_model',
        features: [savannas],
      },
    ],
  };
}

function buildStrategicOutcomesDocument(): StrategicEcosystemOutcomesDocument {
  const features = {
    paramos: buildStrategicDenominator(
      'ecosystem_coverage_paramo',
      'inputs/features/strategic/paramos.tif',
      27401,
    ),
    wetlands: buildStrategicDenominator(
      'ecosystem_coverage_wetlands',
      'inputs/features/strategic/humedales.tif',
      253986,
    ),
    bosque_seco: buildStrategicDenominator(
      'ecosystem_coverage_dry_forest',
      'inputs/features/strategic/bosque_seco.tif',
      10135,
    ),
    mangroves: buildStrategicDenominator(
      'mangrove_coverage',
      'inputs/features/strategic/mangroves.tif',
      2702,
    ),
  };
  return {
    format: 'strategic-ecosystem-outcomes-v1',
    releaseId: 'solutions-v0-2-0-20260805',
    generatedAt: '2026-08-07T00:00:00Z',
    measurementMethod: 'post-hoc-raster-derived',
    areaUnit: 'km2',
    checkpointsPercent: [17, 30],
    denominatorSpecSha256: 'a'.repeat(64),
    sourceMetricsReportSha256: 'b'.repeat(64),
    alignedGrid: {
      crs: 'EPSG:9377',
      width: 1353,
      height: 1838,
      pixelSizeMeters: 1000,
      resampling: 'nearest',
      targetGridSha256: 'c'.repeat(64),
    },
    featurePresenceValue: 1,
    solutionSelectedValues: [1, 2],
    features,
    solutions: {
      'test-solution': {
        features: {
          paramos: buildStrategicOutcome(14543, 27401),
          wetlands: buildStrategicOutcome(50912, 253986),
          bosque_seco: buildStrategicOutcome(3025, 10135),
          mangroves: buildStrategicOutcome(1200, 2702),
        },
      },
    },
  };
}

function buildStrategicDenominator(metricId: string, sourcePath: string, areaKm2: number) {
  return {
    metricId,
    sourcePath,
    sourceSha256: 'd'.repeat(64),
    alignedSha256: 'e'.repeat(64),
    alignmentPolicySha256: 'f'.repeat(64),
    totalAlignedFeatureValue1Cells: areaKm2,
    totalAlignedFeatureValue1AreaKm2: areaKm2,
  };
}

function buildStrategicOutcome(coveredAreaKm2: number, denominatorKm2: number) {
  const coverageFraction = coveredAreaKm2 / denominatorKm2;
  return {
    coveredAreaKm2,
    coverageFraction,
    coveragePercent: coverageFraction * 100,
    checkpoints: {
      '17': coverageFraction >= 0.17,
      '30': coverageFraction >= 0.3,
    },
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

function buildHydratedSpeciesRecords(
  document: SolutionGoalsDocument | null,
): HydratedSpeciesGoalsRecord[] {
  return (document?.features.species ?? []).map((feature) => {
    const coveragePercent = (feature.relativeHeld ?? 0) * 100;
    return {
      id: feature.featureId,
      scientific_name: feature.label ?? feature.featureName,
      group: feature.taxonGroup ?? 'other',
      iucn_status: feature.iucnStatus ?? null,
      range_area_km2: feature.totalAmount ?? 0,
      range_in_aoi_area_km2: feature.totalAmount ?? 0,
      range_in_aoi_pct: 100,
      solution_covered_in_aoi_area_km2: feature.absoluteHeld ?? 0,
      solution_covered_in_aoi_pct: coveragePercent,
      pre_existing_covered_in_aoi_area_km2: 0,
      pre_existing_covered_in_aoi_pct: 0,
      new_covered_in_aoi_area_km2: feature.absoluteHeld ?? 0,
      new_covered_in_aoi_pct: coveragePercent,
      availability: 'available',
      no_range_in_scope: false,
      configured_target_percent: (feature.relativeTarget ?? 0) * 100,
      met_17_percent: coveragePercent >= 17,
      met_30_percent: coveragePercent >= 30,
      configured_target_met: feature.met,
    };
  });
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
        ...(solutionId
          ? {
              solution_coverage: buildMesaEcosystemCoverageFixture(),
            }
          : {}),
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
                share_of_total_aoi_pct: 80,
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
                share_of_total_aoi_pct: 20,
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

function buildMesaEcosystemCoverageFixture() {
  return Array.from({ length: MESA_IAVH_FEATURE_COUNT }, (_, index) => {
    if (index === 0) {
      return {
        feature: 'Andean forest',
        total_in_aoi: 8,
        national_total: 40,
        classified_total_in_aoi: 10,
        share_of_national_total: 0.2,
        share_of_classified_aoi: 0.8,
        held_in_aoi: 4,
        coverage_within_aoi: 0.5,
        pre_existing_held_in_aoi: 1,
        pre_existing_coverage_within_aoi: 0.125,
        new_prioritizr_held_in_aoi: 3,
        new_prioritizr_coverage_within_aoi: 0.375,
        contribution_to_national_coverage: 0.1,
        pre_existing_contribution_to_national_coverage: 0.025,
        new_prioritizr_contribution_to_national_coverage: 0.075,
        contribution_to_national_target: null,
      };
    }
    if (index === 1) {
      return {
        feature: 'Savanna',
        total_in_aoi: 2,
        national_total: 20,
        classified_total_in_aoi: 10,
        share_of_national_total: 0.1,
        share_of_classified_aoi: 0.2,
        held_in_aoi: 1,
        coverage_within_aoi: 0.5,
        pre_existing_held_in_aoi: 0,
        pre_existing_coverage_within_aoi: 0,
        new_prioritizr_held_in_aoi: 1,
        new_prioritizr_coverage_within_aoi: 0.5,
        contribution_to_national_coverage: 0.05,
        pre_existing_contribution_to_national_coverage: 0,
        new_prioritizr_contribution_to_national_coverage: 0.05,
        contribution_to_national_target: 0.2,
      };
    }
    return {
      feature: `Biome region ${index + 1}`,
      total_in_aoi: 0,
      national_total: 0,
      classified_total_in_aoi: 10,
      share_of_national_total: null,
      share_of_classified_aoi: 0,
      held_in_aoi: 0,
      coverage_within_aoi: null,
      pre_existing_held_in_aoi: 0,
      pre_existing_coverage_within_aoi: null,
      new_prioritizr_held_in_aoi: 0,
      new_prioritizr_coverage_within_aoi: null,
      contribution_to_national_coverage: null,
      pre_existing_contribution_to_national_coverage: null,
      new_prioritizr_contribution_to_national_coverage: null,
      contribution_to_national_target: null,
    };
  });
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

function buildFiveViewV2MecDocument(solutionId: string): MecCompactV2Document {
  const v1Document = buildFiveViewMecDocument(solutionId);
  return {
    ...buildV2MecDocument(solutionId, {
      geographyLevel: 'national',
      scopeId: 'colombia',
      scopeName: 'Colombia',
    }),
    viewCatalog: v1Document.viewCatalog,
    classCatalog: v1Document.classCatalog,
    rows: v1Document.rows.map(
      ([
        scopeIndex,
        classIndex,
        ecosystemAreaKm2,
        existingKm2,
        newKm2,
      ]): MecCompactV2Document['rows'][number] => [
        scopeIndex,
        classIndex,
        ecosystemAreaKm2,
        existingKm2,
        newKm2,
      ],
    ),
    viewSupport: v1Document.viewSupport,
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

function buildCachedSirapMetricsDocument(
  solutionId: string,
  metrics: MetricValue[],
): CachedSolutionMetricsDocument {
  return {
    solutionId,
    generatedAt: '2026-06-04T00:00:00.000Z',
    geographies: {
      national: { colombia: { metrics: [] } },
      siraps: {
        territorial_territorial_amazonia_3: {
          name: 'Territorial Amazonia',
          metrics,
        },
      },
    },
  };
}

function buildRegionalSirapMetricsDocument(
  solutionId: string,
  scopeId = 'eje-cafetero',
): CachedSolutionMetricsDocument {
  return {
    solutionId,
    generatedAt: '2026-08-29T00:00:00.000Z',
    primaryGeography: { level: 'sirap', scopeId },
    geographies: {
      national: { colombia: { metrics: [] } },
      sirap: {
        [scopeId]: {
          name: `SIRAP ${scopeId}`,
          metrics: [
            buildMetric('priority_area_in_region', 40, 'km²', 'number'),
            buildMetric('conservation_goals_met', 73, '%', 'percent'),
            buildMetric('ecosystem_coverage', 1_250, 'km²', 'number'),
            buildMetric('ecosystem_coverage_paramo', 10, 'km²', 'number'),
            buildMetric('ecosystem_coverage_dry_forest', 24, 'km²', 'number'),
            buildMetric('ecosystem_coverage_wetlands', 18, 'km²', 'number'),
            buildMetric('species_richness_mammals', 64, 'count', 'number'),
            buildMetric('species_richness_birds', 412, 'count', 'number'),
            buildMetric('species_richness_amphibians', 31, 'count', 'number'),
            buildMetric('species_richness_reptiles', 47, 'count', 'number'),
            buildMetric('species_richness_plants', 1_248, 'count', 'number'),
          ],
        },
      },
    },
  };
}

function buildUnavailableMetric(
  metricId: string,
  status: Extract<MetricValue['status'], 'blocked' | 'pending'>,
): MetricValue {
  return {
    ...buildMetric(metricId, 0, 'km²', 'number'),
    value: null,
    status,
  };
}

function replaceMetric(metrics: MetricValue[], replacement: MetricValue): void {
  const index = metrics.findIndex((metric) => metric.metricId === replacement.metricId);
  metrics[index] = replacement;
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

function buildMetaDepartmentAoi(): AOI {
  return {
    id: 'department:50',
    name: 'Meta',
    type: 'department',
    geometryUrl: '/boundaries/departments.geojson',
    areaKm2: 85_635,
  };
}

function buildSirapAoi(boundarySourceLayerKey: string, boundarySourceId: string): AOI {
  return {
    id: 'sirap:territorial_territorial_amazonia_3',
    name: 'Territorial Amazonia',
    type: 'sirap',
    geometryUrl: '/inputs/boundaries/sirap/example.geojson',
    boundarySourceLayerKey,
    boundarySourceId,
    boundaryGeometrySelection: 'whole-feature',
  };
}

function mockSirapCatalogSolution(solution: ReturnType<typeof buildTestSolution>): void {
  vi.spyOn(TestBed.inject(SolutionCatalogService), 'getById').mockReturnValue({
    id: solution.id,
    scope: 'sirap',
    sirapId: 'eje-cafetero',
    precomputedMetricUrls: {
      goals: '/releases/sirap-test/goals/cache/test-solution.goals.json',
      speciesGoalsCatalog: '/releases/sirap-test/species-goals/catalog/v1/catalog.json',
      speciesGoalsByGeography: {
        siraps: '/releases/sirap-test/species-goals/test-solution/siraps.json',
      },
    },
  } as CatalogSolution);
}

/**
 * Mirrors `solutions-v0-2-0-20260805`, where the signed species exception (8,298 of 8,300 species
 * available upstream) marks every species metric `partial` while its value stays correct.
 */
const RELEASE_SPECIES_EXCEPTION = {
  format: 'release-species-exception-binding-v1',
  policyId: 'solutions-v0-2-0-20260805-upstream-source-missing-v1',
  catalogTotal: 8_300,
  availableExpected: 8_298,
  excluded: 2,
} as const;

function buildPartialSpeciesMetric(
  metricId: string,
  value: number | null,
  extraDetails: Record<string, unknown> = {},
): MetricValue {
  return {
    metricId,
    value,
    unit: 'count',
    status: 'partial',
    source: 'cached-test',
    notes: null,
    labelKey: `metrics.${metricId}`,
    formatHint: 'number',
    details: { speciesException: RELEASE_SPECIES_EXCEPTION, ...extraDetails },
  };
}

function buildPartialSpeciesMetricsDocument(solutionId: string): CachedSolutionMetricsDocument {
  return {
    solutionId,
    generatedAt: '2026-08-05T00:00:00.000Z',
    geographies: {
      national: {
        colombia: {
          name: 'Colombia',
          metrics: [
            buildPartialSpeciesMetric('species_groups_protected', 8_043, {
              summary: { metSpeciesCount: 8_043, totalSpeciesCount: 8_132 },
            }),
            buildPartialSpeciesMetric('threatened_species_secured', 193),
          ],
        },
      },
      departments: {
        '50': {
          name: 'Meta',
          metrics: [
            buildMetric('priority_area_in_region', 18_003, 'km²', 'number'),
            buildPartialSpeciesMetric('species_richness_mammals', 186),
            buildPartialSpeciesMetric('species_richness_birds', 1_081),
            buildPartialSpeciesMetric('species_richness_amphibians', 61),
            buildPartialSpeciesMetric('species_richness_reptiles', 86),
            buildPartialSpeciesMetric('species_richness_plants', 4_726),
            buildPartialSpeciesMetric('threatened_species_count', 89),
          ],
        },
      },
    },
  };
}

function buildTargetlessSpeciesMetricsDocument(solutionId: string): CachedSolutionMetricsDocument {
  const speciesGroups = buildPartialSpeciesMetric('species_groups_protected', null, {
    thresholdOutcomes: [
      {
        targetPercent: 17,
        value: 7793,
        details: {
          summary: { metSpeciesCount: 7793, totalSpeciesCount: 8132 },
          groups: {
            birds: { label: 'Birds', metSpeciesCount: 1440, totalSpeciesCount: 1490 },
          },
        },
      },
      {
        targetPercent: 30,
        value: 1529,
        details: {
          summary: { metSpeciesCount: 1529, totalSpeciesCount: 8132 },
          groups: {
            birds: { label: 'Birds', metSpeciesCount: 313, totalSpeciesCount: 1490 },
          },
        },
      },
    ],
  });
  const threatened = buildPartialSpeciesMetric('threatened_species_secured', null, {
    thresholdOutcomes: [
      { targetPercent: 17, value: 175 },
      { targetPercent: 30, value: 70 },
    ],
  });
  return {
    solutionId,
    generatedAt: '2026-08-05T00:00:00.000Z',
    geographies: {
      national: {
        colombia: {
          name: 'Colombia',
          metrics: [speciesGroups, threatened],
        },
      },
    },
  };
}

function buildValuelessSpeciesMetricsDocument(solutionId: string): CachedSolutionMetricsDocument {
  const document = buildPartialSpeciesMetricsDocument(solutionId);
  const departmentScope = document.geographies.departments?.['50'];
  return {
    ...document,
    geographies: {
      ...document.geographies,
      departments: {
        '50': {
          name: 'Meta',
          metrics: (departmentScope?.metrics ?? []).map((metric) =>
            metric.metricId.startsWith('species_richness_') ? { ...metric, value: null } : metric,
          ),
        },
      },
    },
  };
}
