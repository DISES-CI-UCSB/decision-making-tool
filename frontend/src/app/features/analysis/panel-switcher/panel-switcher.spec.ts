import { TestBed } from '@angular/core/testing';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { of } from 'rxjs';
import { ApiService } from '@core/services/api.service';
import { AppLocaleService } from '@core/services/app-locale.service';
import { wrapFlatMetricsResponse } from '@core/services/cached-metrics.utils';
import { AppStateService } from '@core/services/app-state.service';
import { MockDataService } from '@core/services/mock-data.service';
import { PanelSwitcherComponent } from './panel-switcher';

describe('PanelSwitcherComponent', () => {
  let appState: AppStateService;
  let appLocale: AppLocaleService;
  let mockData: MockDataService;
  let apiServiceSpy: Pick<ApiService, 'getSolutionMetrics'>;

  beforeEach(async () => {
    mockData = new MockDataService();
    apiServiceSpy = {
      getSolutionMetrics: (solutionId: string) => {
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
      },
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
