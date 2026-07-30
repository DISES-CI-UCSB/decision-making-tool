import { Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import type {
  CustomAoiEcosystemView,
  CustomAoiProfileSectionStatus,
  CustomAoiSpeciesSection,
  CustomPolygonMetricsGeometry,
  DetailedSpeciesCoverageRecord,
  DetailedSpeciesJobResponse,
} from '@core/models';
import { ApiService } from '@core/services/api.service';
import { AppLocaleService } from '@core/services/app-locale.service';
import { ModalShellComponent } from '@core/shared/modal-shell/modal-shell';
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
import {
  CUSTOM_AOI_ECOSYSTEM_VIEWS,
  parseEcosystemsSection,
  parseSpeciesSection,
  type ParsedCustomAoiEcosystemsSection,
} from './custom-aoi-area-profile.utils';

type ProfileSectionState<T> =
  | { status: 'idle' | 'loading' }
  | { status: CustomAoiProfileSectionStatus; data: T | null };

const THREATENED_STATUSES = new Set(['CR', 'EN', 'VU']);

@Component({
  selector: 'app-custom-aoi-area-profile',
  standalone: true,
  imports: [TranslatePipe, ModalShellComponent],
  templateUrl: './custom-aoi-area-profile.html',
})
export class CustomAoiAreaProfileComponent {
  readonly geometry = input<CustomPolygonMetricsGeometry | null>(null);
  readonly areaKm2 = input<number | null>(null);
  readonly solutionId = input<string | null>(null);

  private readonly api = inject(ApiService);
  private readonly appLocale = inject(AppLocaleService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly speciesRetry = new Subject<void>();
  private readonly ecosystemsRetry = new Subject<void>();
  private detailedSpeciesSubscription: Subscription | null = null;

  protected readonly ecosystemViews = CUSTOM_AOI_ECOSYSTEM_VIEWS;
  protected readonly speciesState = signal<ProfileSectionState<CustomAoiSpeciesSection>>({
    status: 'idle',
  });
  protected readonly ecosystemsState = signal<
    ProfileSectionState<ParsedCustomAoiEcosystemsSection>
  >({
    status: 'idle',
  });
  protected readonly speciesModalOpen = signal(false);
  protected readonly detailedSpeciesState = signal<'idle' | 'submitting' | 'active' | 'failed'>(
    'idle',
  );
  protected readonly detailedSpeciesJob = signal<DetailedSpeciesJobResponse | null>(null);
  protected readonly speciesSearch = signal('');
  protected readonly speciesGroup = signal('all');
  protected readonly speciesIucn = signal('all');
  protected readonly ecosystemSearch = signal('');
  protected readonly selectedEcosystemView = signal<CustomAoiEcosystemView>('broadEcosystem');

  protected readonly speciesRecords = computed(() => {
    const state = this.speciesState();
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
  protected readonly speciesGroupCounts = computed(() =>
    this.speciesGroups().map((group) => ({
      group,
      count: this.speciesRecords().filter((record) => record.group === group).length,
    })),
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
    const records = this.detailedSpeciesJob()?.result?.records ?? [];
    return new Map(records.map((record) => [record.id, record]));
  });
  protected readonly ecosystemRows = computed(() => {
    const state = this.ecosystemsState();
    return 'data' in state ? (state.data?.views[this.selectedEcosystemView()] ?? []) : [];
  });
  protected readonly filteredEcosystems = computed(() => {
    const query = this.ecosystemSearch().trim().toLocaleLowerCase(this.appLocale.locale());
    return query
      ? this.ecosystemRows().filter((row) =>
          row.label.toLocaleLowerCase(this.appLocale.locale()).includes(query),
        )
      : this.ecosystemRows();
  });
  protected readonly threatenedCount = computed(
    () =>
      this.speciesRecords().filter((record) =>
        THREATENED_STATUSES.has(record.iucn_status?.toUpperCase() ?? ''),
      ).length,
  );
  protected readonly broadEcosystemCount = computed(() => {
    const state = this.ecosystemsState();
    return 'data' in state ? (state.data?.views.broadEcosystem.length ?? null) : null;
  });

  constructor() {
    const request = computed(() => ({
      geometry: this.geometry(),
      solutionId: this.solutionId(),
    }));

    toObservable(request)
      .pipe(
        tap(() => this.resetControls()),
        switchMap(({ geometry, solutionId }) => {
          if (!geometry) {
            return of<ProfileSectionState<CustomAoiSpeciesSection>>({ status: 'idle' });
          }
          return this.speciesRetry.pipe(
            startWith(undefined),
            switchMap(() =>
              concat(
                of<ProfileSectionState<CustomAoiSpeciesSection>>({ status: 'loading' }),
                this.api
                  .getCustomAoiAreaProfile({
                    geometry,
                    sections: ['species'],
                    ...(solutionId ? { solution_id: solutionId } : {}),
                  })
                  .pipe(
                    map((response) => this.toSpeciesState(parseSpeciesSection(response))),
                    catchError(() =>
                      of<ProfileSectionState<CustomAoiSpeciesSection>>({
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
      .subscribe((state) => this.speciesState.set(state));

    toObservable(request)
      .pipe(
        switchMap(({ geometry, solutionId }) => {
          if (!geometry) {
            return of<ProfileSectionState<ParsedCustomAoiEcosystemsSection>>({ status: 'idle' });
          }
          return this.ecosystemsRetry.pipe(
            startWith(undefined),
            switchMap(() =>
              concat(
                of<ProfileSectionState<ParsedCustomAoiEcosystemsSection>>({ status: 'loading' }),
                this.api
                  .getCustomAoiAreaProfile({
                    geometry,
                    sections: ['ecosystems'],
                    ...(solutionId ? { solution_id: solutionId } : {}),
                  })
                  .pipe(
                    map((response) => this.toEcosystemsState(parseEcosystemsSection(response))),
                    catchError(() =>
                      of<ProfileSectionState<ParsedCustomAoiEcosystemsSection>>({
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
      .subscribe((state) => this.ecosystemsState.set(state));
  }

  protected retrySpecies(): void {
    this.speciesRetry.next();
  }

  protected retryEcosystems(): void {
    this.ecosystemsRetry.next();
  }

  protected openSpeciesModal(): void {
    this.speciesModalOpen.set(true);
    this.startDetailedSpeciesCoverage();
  }

  protected closeSpeciesModal(): void {
    this.speciesModalOpen.set(false);
    this.cancelDetailedSpeciesCoverage();
  }

  protected speciesCoverage(speciesId: string): DetailedSpeciesCoverageRecord | undefined {
    return this.detailedCoverageBySpecies().get(speciesId);
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

  protected updateEcosystemSearch(event: Event): void {
    this.ecosystemSearch.set((event.target as HTMLInputElement).value);
  }

  protected updateEcosystemView(event: Event): void {
    this.selectedEcosystemView.set(
      (event.target as HTMLSelectElement).value as CustomAoiEcosystemView,
    );
  }

  protected formatArea(value: number | null): string {
    return value === null
      ? this.translate.instant('analysis.common.valueUnavailable')
      : `${new Intl.NumberFormat(this.appLocale.locale(), { maximumFractionDigits: 2 }).format(value)} km²`;
  }

  protected formatPercent(value: number | null): string {
    return value === null
      ? this.translate.instant('analysis.common.valueUnavailable')
      : `${new Intl.NumberFormat(this.appLocale.locale(), { maximumFractionDigits: 1 }).format(value)}%`;
  }

  protected formatIucn(value: string | null): string {
    return value || this.translate.instant('analysis.aoi.customProfile.species.iucnNotReported');
  }

  protected sectionStateKey(status: ProfileSectionState<unknown>['status']): string {
    return `analysis.aoi.customProfile.states.${status}`;
  }

  protected isResolvedSection(status: ProfileSectionState<unknown>['status']): boolean {
    return status === 'complete' || status === 'empty';
  }

  private resetControls(): void {
    this.cancelDetailedSpeciesCoverage();
    this.speciesModalOpen.set(false);
    this.speciesSearch.set('');
    this.speciesGroup.set('all');
    this.speciesIucn.set('all');
    this.ecosystemSearch.set('');
    this.selectedEcosystemView.set('broadEcosystem');
  }

  private startDetailedSpeciesCoverage(): void {
    const geometry = this.geometry();
    const solutionId = this.solutionId();
    if (!geometry || !solutionId || this.detailedSpeciesState() === 'active') {
      return;
    }

    this.detailedSpeciesState.set('submitting');
    this.detailedSpeciesJob.set(null);
    this.detailedSpeciesSubscription = this.api
      .createDetailedSpeciesCoverageJob({
        geometry,
        solution_id: solutionId,
      })
      .pipe(
        switchMap((created) =>
          created.status === 'complete'
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
          this.detailedSpeciesState.set('active');
          this.detailedSpeciesJob.set(job);
        }),
        catchError(() => {
          this.detailedSpeciesState.set('failed');
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  private cancelDetailedSpeciesCoverage(): void {
    this.detailedSpeciesSubscription?.unsubscribe();
    this.detailedSpeciesSubscription = null;
    const job = this.detailedSpeciesJob();
    if (job && (job.status === 'queued' || job.status === 'running')) {
      this.api
        .cancelDetailedSpeciesCoverageJob(job.job_id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe();
    }
    this.detailedSpeciesState.set('idle');
    this.detailedSpeciesJob.set(null);
  }

  private isTerminalJob(job: DetailedSpeciesJobResponse): boolean {
    return job.status === 'complete' || job.status === 'failed' || job.status === 'cancelled';
  }

  private toSpeciesState(
    section: CustomAoiSpeciesSection,
  ): ProfileSectionState<CustomAoiSpeciesSection> {
    return { status: section.status, data: section };
  }

  private toEcosystemsState(
    section: ParsedCustomAoiEcosystemsSection,
  ): ProfileSectionState<ParsedCustomAoiEcosystemsSection> {
    return { status: section.status, data: section };
  }
}
