import { TestBed } from '@angular/core/testing';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
  TranslateService,
} from '@ngx-translate/core';
import type {
  CustomAoiAreaProfileResponse,
  CustomPolygonMetricsGeometry,
  DetailedSpeciesJobResponse,
} from '@core/models';
import { ApiService } from '@core/services/api.service';
import { of, Subject } from 'rxjs';
import {
  clampSpeciesBarPercent,
  CustomAoiSpeciesInventoryComponent,
} from './custom-aoi-species-inventory';

describe('CustomAoiSpeciesInventoryComponent', () => {
  let api: {
    getCustomAoiAreaProfile: ReturnType<typeof vi.fn>;
    createDetailedSpeciesCoverageJob: ReturnType<typeof vi.fn>;
    getDetailedSpeciesCoverageJob: ReturnType<typeof vi.fn>;
    cancelDetailedSpeciesCoverageJob: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    api = {
      getCustomAoiAreaProfile: vi.fn(() => of(speciesResponse())),
      createDetailedSpeciesCoverageJob: vi.fn(() => of(job('queued'))),
      getDetailedSpeciesCoverageJob: vi.fn(() => of(job('running'))),
      cancelDetailedSpeciesCoverageJob: vi.fn(() => of(job('cancelled'))),
    };
    await TestBed.configureTestingModule({
      imports: [CustomAoiSpeciesInventoryComponent],
      providers: [
        { provide: ApiService, useValue: api },
        provideTranslateService({
          lang: 'en',
          fallbackLang: 'en',
          loader: provideTranslateLoader(TranslateNoOpLoader),
        }),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the searchable inventory usable without a solution', async () => {
    const fixture = createFixture(null);
    fixture.componentInstance.open();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const search = compiled.querySelector(
      '#custom-aoi-species-inventory-search',
    ) as HTMLInputElement;
    search.value = 'tremarctos';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(compiled.querySelectorAll('[id^="custom-aoi-species-inventory-row-"]')).toHaveLength(1);
    expect(compiled.textContent).toContain('Tremarctos ornatus');
    expect(compiled.textContent).toContain('analysis.aoi.customProfile.species.coverageNoSolution');
    expect(compiled.querySelector('[id*="-bar-"]')).toBeNull();
    expect(api.createDetailedSpeciesCoverageJob).not.toHaveBeenCalled();
  });

  it('renders one semantic row per species with grouped metric headers', () => {
    const fixture = createFixture(null);
    fixture.componentInstance.open();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('table#custom-aoi-species-inventory-table')).not.toBeNull();
    expect(compiled.querySelector('caption#custom-aoi-species-inventory-caption')).not.toBeNull();
    expect(
      compiled.querySelectorAll('#custom-aoi-species-inventory-table-head th[scope="colgroup"]'),
    ).toHaveLength(2);
    expect(
      compiled.querySelectorAll('#custom-aoi-species-inventory-table-head th[scope="col"]'),
    ).toHaveLength(5);
    expect(
      compiled.querySelectorAll('#custom-aoi-species-inventory-table-body th[scope="row"]'),
    ).toHaveLength(2);
    expect(
      compiled.querySelectorAll('[id^="custom-aoi-species-inventory-pending-metrics-"]'),
    ).toHaveLength(2);
    expect(
      compiled.querySelector('#custom-aoi-species-inventory-column-heading-row th')?.classList,
    ).toContain('top-8');
    expect(
      compiled.querySelector('#custom-aoi-species-inventory-group-heading-row')?.classList,
    ).toContain('h-8');
  });

  it('labels coverage columns with their within-AOI scope', () => {
    TestBed.inject(TranslateService).setTranslation('en', {
      analysis: {
        aoi: {
          customProfile: {
            species: {
              solutionCoverage: 'Total solution coverage (within AOI)',
              preExistingCoverage: 'Pre-existing coverage (within AOI)',
              newCoverage: 'New coverage (within AOI)',
            },
          },
        },
      },
    });
    const fixture = createFixture(null);
    fixture.componentInstance.open();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(
      compiled.querySelector('#custom-aoi-species-inventory-solutionCoverage-heading-label')
        ?.textContent,
    ).toContain('Total solution coverage (within AOI)');
    expect(
      compiled.querySelector('#custom-aoi-species-inventory-preExistingCoverage-heading-label')
        ?.textContent,
    ).toContain('Pre-existing coverage (within AOI)');
    expect(
      compiled.querySelector('#custom-aoi-species-inventory-newCoverage-heading-label')
        ?.textContent,
    ).toContain('New coverage (within AOI)');
    const denominatorLabels = compiled.querySelectorAll('[id$="-heading-denominator"]');
    expect(denominatorLabels).toHaveLength(1);
    expect(denominatorLabels[0].id).toBe(
      'custom-aoi-species-inventory-range-in-aoi-heading-denominator',
    );
  });

  it('polls queued and running coverage, then appends completed values to inventory rows', () => {
    vi.useFakeTimers();
    api.getDetailedSpeciesCoverageJob
      .mockReturnValueOnce(of(job('running')))
      .mockReturnValueOnce(of(job('complete')));
    const fixture = createFixture('solution-1');

    fixture.componentInstance.open();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '#custom-aoi-species-coverage-queued-position-wait',
      ),
    ).not.toBeNull();

    vi.advanceTimersByTime(1500);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#custom-aoi-species-coverage-running'),
    ).not.toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '#custom-aoi-species-coverage-active-spinner',
      ),
    ).not.toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '#custom-aoi-species-range-in-aoi-bar-0',
      ),
    ).toBeNull();

    vi.advanceTimersByTime(1500);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#custom-aoi-species-coverage-complete')).not.toBeNull();
    const expectedMetrics = [
      ['range-in-aoi', '10%', '10 km²'],
      ['solution-coverage', '50%', '5 km²'],
      ['pre-existing', '20%', '2 km²'],
      ['new', '30%', '3 km²'],
    ] as const;
    expectedMetrics.forEach(([metricId, percent, area]) => {
      const bar = compiled.querySelector(
        `#custom-aoi-species-${metricId}-bar-0`,
      ) as HTMLElement | null;
      expect(compiled.querySelector(`td#custom-aoi-species-${metricId}-0`)).not.toBeNull();
      expect(bar).not.toBeNull();
      expect(bar?.getAttribute('role')).toBe('img');
      expect(bar?.getAttribute('aria-label')).toContain('Tremarctos ornatus');
      expect(bar?.getAttribute('aria-label')).toContain(percent);
      expect(bar?.getAttribute('aria-label')).toContain(area);
      expect(
        compiled.querySelector(`#custom-aoi-species-${metricId}-percent-0`)?.textContent,
      ).toContain(percent);
      expect(
        compiled.querySelector(`#custom-aoi-species-${metricId}-area-0`)?.textContent,
      ).toContain(area);
    });
  });

  it('keeps inventory rows visible while the coverage job is submitting', () => {
    const createdJob$ = new Subject<DetailedSpeciesJobResponse>();
    api.createDetailedSpeciesCoverageJob.mockReturnValue(createdJob$.asObservable());
    const fixture = createFixture('solution-1');

    fixture.componentInstance.open();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('#custom-aoi-species-coverage-submitting')).not.toBeNull();
    expect(compiled.querySelector('#custom-aoi-species-coverage-active-spinner')).not.toBeNull();
    expect(
      compiled
        .querySelector('#custom-aoi-species-coverage-active-spinner')
        ?.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(
      compiled.querySelector('#custom-aoi-species-coverage-active-spinner')?.classList,
    ).toContain('motion-reduce:animate-none');
    expect(compiled.querySelectorAll('[id^="custom-aoi-species-inventory-row-"]')).toHaveLength(2);
    expect(compiled.querySelector('[id*="-bar-"]')).toBeNull();

    createdJob$.next(job('queued'));
    fixture.detectChanges();
    expect(
      compiled.querySelector('#custom-aoi-species-coverage-queued-position-wait'),
    ).not.toBeNull();
    expect(compiled.querySelector('#custom-aoi-species-coverage-active-spinner')).not.toBeNull();
  });

  it.each([null, 'failed', 'cancelled', 'complete'] as const)(
    'does not show the active coverage spinner for %s state',
    (status) => {
      if (status) {
        api.createDetailedSpeciesCoverageJob.mockReturnValue(of(job(status)));
      }
      const fixture = createFixture(status ? 'solution-1' : null);
      fixture.componentInstance.open();
      fixture.detectChanges();

      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          '#custom-aoi-species-coverage-active-spinner',
        ),
      ).toBeNull();
    },
  );

  it('continues polling after close and preserves completed coverage on reopen', () => {
    vi.useFakeTimers();
    api.getDetailedSpeciesCoverageJob.mockReturnValue(of(job('complete')));
    const fixture = createFixture('solution-1');
    fixture.componentInstance.open();
    fixture.detectChanges();

    (
      fixture.componentInstance as unknown as {
        close(): void;
      }
    ).close();
    fixture.detectChanges();
    expect(api.cancelDetailedSpeciesCoverageJob).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1500);
    fixture.detectChanges();
    fixture.componentInstance.open();
    fixture.detectChanges();

    expect(api.createDetailedSpeciesCoverageJob).toHaveBeenCalledTimes(1);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#custom-aoi-species-coverage-complete'),
    ).not.toBeNull();
  });

  it('supports explicit cancellation and restart', () => {
    api.createDetailedSpeciesCoverageJob
      .mockReturnValueOnce(of(job('queued')))
      .mockReturnValueOnce(of(job('complete')));
    const fixture = createFixture('solution-1');
    fixture.componentInstance.open();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const cancelButton = compiled.querySelector(
      '#custom-aoi-species-coverage-cancel-button',
    ) as HTMLButtonElement;
    expect(cancelButton.closest('#custom-aoi-species-coverage-status')).not.toBeNull();
    expect(cancelButton.classList).toContain('min-h-9');
    expect(cancelButton.classList).not.toContain('min-h-11');
    cancelButton.click();
    fixture.detectChanges();

    expect(api.cancelDetailedSpeciesCoverageJob).toHaveBeenCalledWith('job-1');
    expect(compiled.querySelector('#custom-aoi-species-coverage-cancelled')).not.toBeNull();

    (
      compiled.querySelector('#custom-aoi-species-coverage-restart-button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(api.createDetailedSpeciesCoverageJob).toHaveBeenCalledTimes(2);
    expect(compiled.querySelector('#custom-aoi-species-coverage-complete')).not.toBeNull();
  });

  it.each(['queued', 'running', 'failed', 'cancelled'] as const)(
    'keeps inventory visible without fake bars while coverage is %s',
    (status) => {
      vi.useFakeTimers();
      api.createDetailedSpeciesCoverageJob.mockReturnValue(of(job(status)));
      const fixture = createFixture('solution-1');

      fixture.componentInstance.open();
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelectorAll('[id^="custom-aoi-species-inventory-row-"]')).toHaveLength(
        2,
      );
      expect(compiled.querySelector('[id*="-bar-"]')).toBeNull();

      fixture.destroy();
    },
  );

  it('clamps bar width while displaying the backend percentage unchanged', () => {
    const completedJob = job('complete');
    completedJob.result!.records[0].range_in_aoi_pct = 125;
    api.createDetailedSpeciesCoverageJob.mockReturnValue(of(completedJob));
    const fixture = createFixture('solution-1');

    fixture.componentInstance.open();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const fill = compiled.querySelector('#custom-aoi-species-range-in-aoi-fill-0') as HTMLElement;

    expect(fill.style.width).toBe('100%');
    expect(
      compiled.querySelector('#custom-aoi-species-range-in-aoi-percent-0')?.textContent,
    ).toContain('125%');
  });

  it('renders failure with retry and completes the restarted calculation', () => {
    api.createDetailedSpeciesCoverageJob
      .mockReturnValueOnce(of(job('failed')))
      .mockReturnValueOnce(of(job('complete')));
    const fixture = createFixture('solution-1');
    fixture.componentInstance.open();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#custom-aoi-species-coverage-failed')).not.toBeNull();
    (
      compiled.querySelector('#custom-aoi-species-coverage-restart-button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(compiled.querySelector('#custom-aoi-species-coverage-complete')).not.toBeNull();
  });

  it('cancels and clears stale coverage when geometry or solution changes', () => {
    const fixture = createFixture('solution-1');
    fixture.componentInstance.open();
    fixture.detectChanges();

    fixture.componentRef.setInput('geometry', geometry(1));
    fixture.detectChanges();
    expect(api.cancelDetailedSpeciesCoverageJob).toHaveBeenCalledWith('job-1');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#custom-aoi-species-coverage-queued'),
    ).toBeNull();

    fixture.componentInstance.open();
    fixture.detectChanges();
    fixture.componentRef.setInput('solutionId', 'solution-2');
    fixture.detectChanges();
    expect(api.cancelDetailedSpeciesCoverageJob).toHaveBeenCalledTimes(2);
  });

  function createFixture(solutionId: string | null) {
    const fixture = TestBed.createComponent(CustomAoiSpeciesInventoryComponent);
    fixture.componentRef.setInput('geometry', geometry(0));
    fixture.componentRef.setInput('solutionId', solutionId);
    fixture.detectChanges();
    return fixture;
  }
});

describe('clampSpeciesBarPercent', () => {
  it('clamps visual widths without changing valid values', () => {
    expect(clampSpeciesBarPercent(-5)).toBe(0);
    expect(clampSpeciesBarPercent(42.5)).toBe(42.5);
    expect(clampSpeciesBarPercent(125)).toBe(100);
    expect(clampSpeciesBarPercent(Number.NaN)).toBe(0);
  });
});

function geometry(offset: number): CustomPolygonMetricsGeometry {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [offset, 0],
        [offset + 1, 0],
        [offset, 1],
        [offset, 0],
      ],
    ],
  };
}

function speciesResponse(): CustomAoiAreaProfileResponse {
  return {
    format: 'custom-aoi-area-profile-v1',
    status: 'complete',
    selection: {
      status: 'selected',
      selected_cell_count: 2,
      available_cell_count: 4,
      area_km2: 12,
      source: 'test',
    },
    sections: {
      species: {
        status: 'complete',
        records: [
          { id: '1', scientific_name: 'Tremarctos ornatus', group: 'Mammals', iucn_status: 'VU' },
          { id: '2', scientific_name: 'Rallus semiplumbeus', group: 'Birds', iucn_status: 'EN' },
        ],
      },
    },
  };
}

function job(status: DetailedSpeciesJobResponse['status']): DetailedSpeciesJobResponse {
  return {
    job_id: 'job-1',
    status,
    queue_position: status === 'queued' ? 2 : null,
    estimated_wait_seconds: status === 'queued' ? 90 : null,
    compute_ms: status === 'complete' ? 100 : null,
    result:
      status === 'complete'
        ? {
            artifact_version: 'test',
            solution_id: 'solution-1',
            solution_raster_checksum: 'checksum',
            records: [
              {
                id: '1',
                scientific_name: 'Tremarctos ornatus',
                group: 'Mammals',
                iucn_status: 'VU',
                range_area_km2: 100,
                range_in_aoi_area_km2: 10,
                range_in_aoi_pct: 10,
                solution_covered_in_aoi_area_km2: 5,
                solution_covered_in_aoi_pct: 50,
                pre_existing_covered_in_aoi_area_km2: 2,
                pre_existing_covered_in_aoi_pct: 20,
                new_covered_in_aoi_area_km2: 3,
                new_covered_in_aoi_pct: 30,
              },
            ],
          }
        : null,
    error_code: status === 'failed' ? 'test_failure' : null,
    coalesced: false,
  };
}
