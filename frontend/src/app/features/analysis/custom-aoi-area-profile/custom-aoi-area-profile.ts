import { Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import type {
  CustomAoiEcosystemView,
  CustomAoiProfileSectionStatus,
  CustomAoiSpeciesSection,
  CustomPolygonMetricsGeometry,
} from '@core/models';
import { ApiService } from '@core/services/api.service';
import { AppLocaleService } from '@core/services/app-locale.service';
import { ModalShellComponent } from '@core/shared/modal-shell/modal-shell';
import { TranslatePipe } from '@ngx-translate/core';
import { catchError, concat, map, of, startWith, Subject, switchMap, tap } from 'rxjs';
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

  private readonly api = inject(ApiService);
  private readonly appLocale = inject(AppLocaleService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly speciesRetry = new Subject<void>();
  private readonly ecosystemsRetry = new Subject<void>();

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
    toObservable(this.geometry)
      .pipe(
        tap(() => this.resetControls()),
        switchMap((geometry) => {
          if (!geometry) {
            return of<ProfileSectionState<CustomAoiSpeciesSection>>({ status: 'idle' });
          }
          return this.speciesRetry.pipe(
            startWith(undefined),
            switchMap(() =>
              concat(
                of<ProfileSectionState<CustomAoiSpeciesSection>>({ status: 'loading' }),
                this.api.getCustomAoiAreaProfile({ geometry, sections: ['species'] }).pipe(
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

    toObservable(this.geometry)
      .pipe(
        switchMap((geometry) => {
          if (!geometry) {
            return of<ProfileSectionState<ParsedCustomAoiEcosystemsSection>>({ status: 'idle' });
          }
          return this.ecosystemsRetry.pipe(
            startWith(undefined),
            switchMap(() =>
              concat(
                of<ProfileSectionState<ParsedCustomAoiEcosystemsSection>>({ status: 'loading' }),
                this.api.getCustomAoiAreaProfile({ geometry, sections: ['ecosystems'] }).pipe(
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
  }

  protected closeSpeciesModal(): void {
    this.speciesModalOpen.set(false);
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
      ? '--'
      : `${new Intl.NumberFormat(this.appLocale.locale(), { maximumFractionDigits: 2 }).format(value)} km²`;
  }

  protected formatPercent(value: number | null): string {
    return value === null
      ? '--'
      : `${new Intl.NumberFormat(this.appLocale.locale(), { maximumFractionDigits: 1 }).format(value)}%`;
  }

  protected sectionStateKey(status: ProfileSectionState<unknown>['status']): string {
    return `analysis.aoi.customProfile.states.${status}`;
  }

  protected isResolvedSection(status: ProfileSectionState<unknown>['status']): boolean {
    return status === 'complete' || status === 'empty';
  }

  private resetControls(): void {
    this.speciesModalOpen.set(false);
    this.speciesSearch.set('');
    this.speciesGroup.set('all');
    this.speciesIucn.set('all');
    this.ecosystemSearch.set('');
    this.selectedEcosystemView.set('broadEcosystem');
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
