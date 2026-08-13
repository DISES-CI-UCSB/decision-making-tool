import { Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import type {
  CustomAoiProfileSectionStatus,
  CustomAoiSpeciesSection,
  CustomPolygonMetricsGeometry,
  DetailedSpeciesCoverageRecord,
  DetailedSpeciesJobResponse,
  GeographyLevel,
  HydratedSpeciesGoalsRecord,
} from '@core/models';
import { ApiService } from '@core/services/api.service';
import { AppLocaleService } from '@core/services/app-locale.service';
import { SpeciesGoalsLoaderService } from '@core/services/species-goals-loader.service';
import { ModalShellComponent } from '@core/shared/modal-shell/modal-shell';
import { TableHeaderTooltipComponent } from '@core/shared/table-header-tooltip/table-header-tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  catchError,
  concat,
  map,
  of,
  startWith,
  Subject,
  Subscription,
  switchMap,
  takeWhile,
  tap,
  timer,
} from 'rxjs';
import { parseSpeciesSection } from '../custom-aoi-area-profile/custom-aoi-area-profile.utils';

type InventoryState =
  | { status: 'idle' | 'loading' }
  | { status: CustomAoiProfileSectionStatus; data: CustomAoiSpeciesSection | null };

type CoverageState = 'idle' | 'submitting' | 'active' | 'failed' | 'cancelled';

interface SpeciesCoverageMetric {
  id: 'range-in-aoi' | 'solution-coverage' | 'pre-existing' | 'new';
  labelKey: string;
  denominatorKey: string;
  formattedPercent: string;
  formattedArea: string;
  barPercent: number;
  color: string;
  ariaLabel: string;
}

interface SpeciesCoverageView {
  presence: SpeciesCoverageMetric;
  coverage: readonly SpeciesCoverageMetric[];
  formattedNationalRangeArea: string;
}

export function clampSpeciesBarPercent(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

@Component({
  selector: 'app-custom-aoi-species-inventory',
  standalone: true,
  imports: [TranslatePipe, ModalShellComponent, TableHeaderTooltipComponent],
  templateUrl: './custom-aoi-species-inventory.html',
})
export class CustomAoiSpeciesInventoryComponent {
  readonly geometry = input<CustomPolygonMetricsGeometry | null>(null);
  readonly solutionId = input<string | null>(null);
  readonly geographyLevel = input<GeographyLevel | null>(null);
  readonly scopeId = input<string | null>(null);
  readonly preExistingCoverageColor = input('#2563eb');
  readonly newCoverageColor = input('#16a34a');
  readonly modalOpenChange = output<boolean>();

  private readonly api = inject(ApiService);
  private readonly appLocale = inject(AppLocaleService);
  private readonly speciesGoals = inject(SpeciesGoalsLoaderService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly inventoryRetry = new Subject<void>();
  private coverageSubscription: Subscription | null = null;
  private contextVersion = 0;

  protected readonly inventoryState = signal<InventoryState>({ status: 'idle' });
  protected readonly modalOpen = signal(false);
  protected readonly coverageState = signal<CoverageState>('idle');
  protected readonly coverageJob = signal<DetailedSpeciesJobResponse | null>(null);
  protected readonly precomputedCoverageRecords = signal<HydratedSpeciesGoalsRecord[]>([]);
  protected readonly speciesSearch = signal('');
  protected readonly speciesGroup = signal('all');
  protected readonly speciesIucn = signal('all');
  private readonly percentNumberFormatter = computed(
    () =>
      new Intl.NumberFormat(this.appLocale.locale(), {
        maximumFractionDigits: 1,
      }),
  );
  private readonly areaNumberFormatter = computed(
    () =>
      new Intl.NumberFormat(this.appLocale.locale(), {
        maximumFractionDigits: 2,
      }),
  );

  protected readonly speciesRecords = computed(() => {
    const state = this.inventoryState();
    return 'data' in state ? (state.data?.records ?? []) : [];
  });
  protected readonly speciesGroups = computed(() =>
    [...new Set(this.speciesRecords().map((record) => record.group))].sort((a, b) =>
      a.localeCompare(b, this.appLocale.locale()),
    ),
  );
  protected readonly speciesIucnStatuses = computed(() =>
    [
      ...new Set(
        this.speciesRecords()
          .map((record) => record.iucn_status)
          .filter(Boolean),
      ),
    ].sort(),
  );
  protected readonly filteredSpecies = computed(() => {
    const query = this.speciesSearch().trim().toLocaleLowerCase(this.appLocale.locale());
    return this.speciesRecords().filter(
      (record) =>
        (!query ||
          record.scientific_name.toLocaleLowerCase(this.appLocale.locale()).includes(query)) &&
        (this.speciesGroup() === 'all' || record.group === this.speciesGroup()) &&
        (this.speciesIucn() === 'all' || record.iucn_status === this.speciesIucn()),
    );
  });
  protected readonly detailedCoverageBySpecies = computed(() => {
    const records =
      this.precomputedCoverageRecords().length > 0
        ? this.precomputedCoverageRecords()
        : (this.coverageJob()?.result?.records ?? []);
    return new Map(records.map((record) => [record.id, record]));
  });
  protected readonly coverageViewBySpecies = computed(() => {
    this.appLocale.locale();
    return new Map(
      [...this.detailedCoverageBySpecies()].map(([speciesId, record]) => [
        speciesId,
        this.buildCoverageView(record),
      ]),
    );
  });
  protected readonly canCancelCoverage = computed(() => {
    const status = this.coverageJob()?.status;
    return status === 'queued' || status === 'running';
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      const job = this.coverageJob();
      this.stopCoveragePolling();
      if (job && (job.status === 'queued' || job.status === 'running')) {
        this.api.cancelDetailedSpeciesCoverageJob(job.job_id).subscribe({ error: () => undefined });
      }
    });

    const request = computed(() => ({
      geometry: this.geometry(),
      solutionId: this.solutionId(),
      geographyLevel: this.geographyLevel(),
      scopeId: this.scopeId(),
    }));

    toObservable(request)
      .pipe(
        tap(() => this.resetForContextChange()),
        switchMap(({ geometry, solutionId, geographyLevel, scopeId }) => {
          if (!geometry && (!solutionId || !geographyLevel || !scopeId)) {
            return of<InventoryState>({ status: 'idle' });
          }
          if (!geometry && solutionId && geographyLevel && scopeId) {
            return concat(
              of<InventoryState>({ status: 'loading' }),
              this.speciesGoals.load(solutionId, geographyLevel, scopeId).pipe(
                map((records) => {
                  if (records === null) {
                    return { status: 'unavailable', data: null } satisfies InventoryState;
                  }
                  this.precomputedCoverageRecords.set(records);
                  return {
                    status: records.length > 0 ? 'complete' : 'empty',
                    data: {
                      status: records.length > 0 ? 'complete' : 'empty',
                      records,
                    },
                  } satisfies InventoryState;
                }),
                catchError(() =>
                  of<InventoryState>({
                    status: 'failed',
                    data: null,
                  }),
                ),
              ),
            );
          }
          if (!geometry) {
            return of<InventoryState>({ status: 'idle' });
          }
          return this.inventoryRetry.pipe(
            startWith(undefined),
            switchMap(() =>
              concat(
                of<InventoryState>({ status: 'loading' }),
                this.api
                  .getCustomAoiAreaProfile({
                    geometry,
                    sections: ['species'],
                    ...(solutionId ? { solution_id: solutionId } : {}),
                  })
                  .pipe(
                    map((response) => this.toInventoryState(parseSpeciesSection(response))),
                    catchError(() =>
                      of<InventoryState>({
                        status: 'failed',
                        data: null,
                      }),
                    ),
                  ),
              ),
            ),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((state) => this.inventoryState.set(state));
  }

  open(): void {
    this.modalOpen.set(true);
    this.modalOpenChange.emit(true);
    if (this.geometry() && this.coverageState() === 'idle') {
      this.startDetailedSpeciesCoverage();
    }
  }

  protected close(): void {
    this.modalOpen.set(false);
    this.modalOpenChange.emit(false);
  }

  protected retryInventory(): void {
    this.inventoryRetry.next();
  }

  protected restartCoverage(): void {
    this.startDetailedSpeciesCoverage(true);
  }

  protected cancelCoverage(): void {
    const job = this.coverageJob();
    if (!job || (job.status !== 'queued' && job.status !== 'running')) {
      return;
    }

    this.stopCoveragePolling();
    this.coverageState.set('cancelled');
    this.coverageJob.set({ ...job, status: 'cancelled' });
    this.api
      .cancelDetailedSpeciesCoverageJob(job.job_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => undefined });
  }

  protected speciesCoverageView(speciesId: string): SpeciesCoverageView | undefined {
    return this.coverageViewBySpecies().get(speciesId);
  }

  protected updateSpeciesSearch(event: Event): void {
    this.speciesSearch.set((event.target as HTMLInputElement).value);
  }

  protected updateSpeciesGroup(event: Event): void {
    this.speciesGroup.set((event.target as HTMLSelectElement).value);
  }

  protected updateSpeciesIucn(event: Event): void {
    this.speciesIucn.set((event.target as HTMLSelectElement).value);
  }

  protected formatPercent(value: number): string {
    return `${this.percentNumberFormatter().format(value)}%`;
  }

  protected formatAreaKm2(value: number): string {
    return `${this.areaNumberFormatter().format(value)} km²`;
  }

  protected formatIucn(value: string | null): string {
    return value || this.translate.instant('analysis.aoi.customProfile.species.iucnNotReported');
  }

  protected inventoryStateKey(status: InventoryState['status']): string {
    return `analysis.aoi.customProfile.states.${status}`;
  }

  protected hasQueuePosition(job: DetailedSpeciesJobResponse | null): boolean {
    return job?.queue_position !== null && job?.queue_position !== undefined;
  }

  protected hasWaitEstimate(job: DetailedSpeciesJobResponse | null): boolean {
    return job?.estimated_wait_seconds !== null && job?.estimated_wait_seconds !== undefined;
  }

  protected formatWaitEstimate(seconds: number | null | undefined): string {
    if (seconds === null || seconds === undefined) {
      return '';
    }
    if (seconds < 60) {
      return this.translate.instant('analysis.aoi.customProfile.species.waitSeconds', {
        count: Math.max(0, Math.round(seconds)),
      });
    }
    return this.translate.instant('analysis.aoi.customProfile.species.waitMinutes', {
      count: Math.max(1, Math.ceil(seconds / 60)),
    });
  }

  private resetForContextChange(): void {
    this.contextVersion += 1;
    this.cancelStaleCoverage();
    this.speciesSearch.set('');
    this.speciesGroup.set('all');
    this.speciesIucn.set('all');
    this.precomputedCoverageRecords.set([]);
    if (this.modalOpen()) {
      this.startDetailedSpeciesCoverage();
    }
  }

  private startDetailedSpeciesCoverage(forceRestart = false): void {
    const geometry = this.geometry();
    const solutionId = this.solutionId();
    if (!geometry || !solutionId) {
      return;
    }
    if (!forceRestart && this.coverageState() !== 'idle') {
      return;
    }

    this.stopCoveragePolling();
    const version = this.contextVersion;
    this.coverageState.set('submitting');
    this.coverageJob.set(null);
    this.coverageSubscription = this.api
      .createDetailedSpeciesCoverageJob({
        geometry,
        solution_id: solutionId,
      })
      .pipe(
        switchMap((created) =>
          this.isTerminalJob(created)
            ? of(created)
            : concat(
                of(created),
                timer(1500, 1500).pipe(
                  switchMap(() => this.api.getDetailedSpeciesCoverageJob(created.job_id)),
                  takeWhile((job) => !this.isTerminalJob(job), true),
                ),
              ),
        ),
        tap((job) => {
          if (version !== this.contextVersion) {
            return;
          }
          this.coverageJob.set(job);
          this.coverageState.set(
            job.status === 'failed'
              ? 'failed'
              : job.status === 'cancelled'
                ? 'cancelled'
                : 'active',
          );
        }),
        catchError(() => {
          if (version === this.contextVersion) {
            this.coverageState.set('failed');
          }
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  private cancelStaleCoverage(): void {
    const job = this.coverageJob();
    this.stopCoveragePolling();
    if (job && (job.status === 'queued' || job.status === 'running')) {
      this.api
        .cancelDetailedSpeciesCoverageJob(job.job_id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ error: () => undefined });
    }
    this.coverageState.set('idle');
    this.coverageJob.set(null);
  }

  private stopCoveragePolling(): void {
    this.coverageSubscription?.unsubscribe();
    this.coverageSubscription = null;
  }

  private isTerminalJob(job: DetailedSpeciesJobResponse): boolean {
    return job.status === 'complete' || job.status === 'failed' || job.status === 'cancelled';
  }

  private buildCoverageView(record: DetailedSpeciesCoverageRecord): SpeciesCoverageView {
    return {
      presence: this.buildCoverageMetric(
        'range-in-aoi',
        'analysis.aoi.customProfile.species.rangeInAoi',
        'analysis.aoi.customProfile.species.ofNationalModeledRange',
        record.scientific_name,
        record.range_in_aoi_pct,
        record.range_in_aoi_area_km2,
        '#0284c7',
      ),
      coverage: [
        this.buildCoverageMetric(
          'solution-coverage',
          'analysis.aoi.customProfile.species.solutionCoverage',
          'analysis.aoi.customProfile.species.ofSpeciesRangeInsideAoi',
          record.scientific_name,
          record.solution_covered_in_aoi_pct,
          record.solution_covered_in_aoi_area_km2,
          '#475569',
        ),
        this.buildCoverageMetric(
          'pre-existing',
          'analysis.aoi.customProfile.species.preExistingCoverage',
          'analysis.aoi.customProfile.species.ofSpeciesRangeInsideAoi',
          record.scientific_name,
          record.pre_existing_covered_in_aoi_pct,
          record.pre_existing_covered_in_aoi_area_km2,
          this.preExistingCoverageColor(),
        ),
        this.buildCoverageMetric(
          'new',
          'analysis.aoi.customProfile.species.newCoverage',
          'analysis.aoi.customProfile.species.ofSpeciesRangeInsideAoi',
          record.scientific_name,
          record.new_covered_in_aoi_pct,
          record.new_covered_in_aoi_area_km2,
          this.newCoverageColor(),
        ),
      ],
      formattedNationalRangeArea: this.formatAreaKm2(record.range_area_km2),
    };
  }

  private buildCoverageMetric(
    id: SpeciesCoverageMetric['id'],
    labelKey: string,
    denominatorKey: string,
    scientificName: string,
    percent: number,
    areaKm2: number,
    color: string,
  ): SpeciesCoverageMetric {
    const formattedPercent = this.formatPercent(percent);
    const formattedArea = this.formatAreaKm2(areaKm2);
    return {
      id,
      labelKey,
      denominatorKey,
      formattedPercent,
      formattedArea,
      barPercent: clampSpeciesBarPercent(percent),
      color,
      ariaLabel: [
        this.translate.instant(labelKey),
        scientificName,
        formattedPercent,
        formattedArea,
        this.translate.instant(denominatorKey),
      ].join(', '),
    };
  }

  private toInventoryState(section: CustomAoiSpeciesSection): InventoryState {
    return { status: section.status, data: section };
  }
}
