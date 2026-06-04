import { TestBed } from '@angular/core/testing';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { AppLocaleService } from '@core/services/app-locale.service';
import { wrapFlatMetricsResponse } from '@core/services/cached-metrics.utils';
import type {
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

  it('loads backend metrics for a custom drawn AOI geometry', async () => {
    const solution = buildTestSolution();
    const geometry = buildTestGeometry();
    const response = buildCustomPolygonResponse({
      area: 10,
      priority_area_in_region: 2.5,
      national_contribution: 1.25,
    });
    vi.mocked(apiServiceSpy.getCustomPolygonMetrics).mockReturnValue(of(response));

    appState.activeSolution$.set(solution);
    appState.setRightSidebarMode('aoi');
    appState.selectCustomAOI(geometry, { name: 'Drawn AOI' });

    const fixture = TestBed.createComponent(PanelSwitcherComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(apiServiceSpy.getCustomPolygonMetrics).toHaveBeenCalledWith({
      geometry,
      metrics: ['area', 'priority_area_in_region', 'national_contribution'],
    });
    expect(compiled.querySelector('#aoi-custom-metrics-loaded')).not.toBeNull();
    expect(compiled.querySelector('#aoi-hero-priority')?.textContent).toContain('2,5 km²');
    expect(compiled.querySelector('#aoi-hero-priority')?.textContent).toContain('25%');
    expect(compiled.querySelector('#aoi-hero-national')?.textContent).toContain('1,3%');
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
    requested_metrics: ['area', 'priority_area_in_region', 'national_contribution'],
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
