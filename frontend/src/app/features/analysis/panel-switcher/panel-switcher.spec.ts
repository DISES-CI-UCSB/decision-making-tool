import { TestBed } from '@angular/core/testing';
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
  CustomPolygonMetricsGeometry,
  CustomPolygonMetricsResponse,
  MetricValue,
  Solution,
} from '@core/models';
import { AppStateService } from '@core/services/app-state.service';
import { MockDataService } from '@core/services/mock-data.service';
import { PanelSwitcherComponent } from './panel-switcher';

describe('PanelSwitcherComponent', () => {
  let appState: AppStateService;
  let appLocale: AppLocaleService;
  let mockData: MockDataService;
  let apiServiceSpy: Pick<ApiService, 'getSolutionMetrics' | 'getCustomPolygonMetrics'>;

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockData = new MockDataService();
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
        provideTranslateService({
          lang: 'en',
          fallbackLang: 'en',
          loader: provideTranslateLoader(TranslateNoOpLoader),
        }),
      ],
    }).compileComponents();

    appState = TestBed.inject(AppStateService);
    appLocale = TestBed.inject(AppLocaleService);
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
    expect(compiled.querySelector('#right-sidebar-overview-solution-name')?.textContent).toContain(
      'Bosque Alto Andino',
    );
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
    expect(compiled.querySelector('#aoi-custom-metrics-loaded')).not.toBeNull();
    expect(compiled.querySelector('#aoi-custom-metrics-loaded')?.textContent).toContain(
      'analysis.aoi.customMetrics.loaded',
    );
    expect(compiled.querySelector('#aoi-custom-species-metrics-loading')).not.toBeNull();
    expect(compiled.querySelector('#aoi-custom-species-metrics-loading')?.textContent).toContain(
      'analysis.aoi.customMetrics.speciesLoading.initial.small',
    );
    expect(
      compiled.querySelector('#aoi-custom-species-metrics-loading')?.textContent,
    ).not.toContain('35-45');
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
    expect(compiled.querySelector('#aoi-custom-metrics-summary-value-area')?.textContent).toContain(
      '10 km²',
    );
    expect(compiled.querySelector('#aoi-hero-priority')?.textContent).toContain('2,5 km²');
    expect(compiled.querySelector('#aoi-hero-priority')?.textContent).toContain('25%');
    expect(compiled.querySelector('#aoi-hero-national')?.textContent).toContain('1,3%');
    expect(compiled.querySelector('#aoi-species-value-mammals')?.textContent).toContain('--');
    expect(compiled.querySelector('#aoi-stat-above-carbon')?.textContent).toContain('40 Mg·km²');

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
    expect(compiled.querySelector('#aoi-custom-species-metrics-warning')?.textContent).toContain(
      'species request timed out',
    );
    expect(compiled.querySelector('#aoi-biodiversity-species-loading-status')).toBeNull();
    expect(compiled.querySelector('#aoi-biodiversity-species-loading-spinner')).toBeNull();
    expect(compiled.querySelector('#aoi-biodiversity-species-progressbar')).toBeNull();
    expect(compiled.querySelector('#aoi-hero-priority')?.textContent).toContain('2,5 km²');
    expect(compiled.querySelector('#aoi-stat-above-carbon')?.textContent).toContain('40 Mg·km²');
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

  it('surfaces custom AOI backend loading errors', async () => {
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
    expect(compiled.querySelector('#aoi-custom-metrics-error')?.textContent).toContain(
      'backend unavailable',
    );
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
