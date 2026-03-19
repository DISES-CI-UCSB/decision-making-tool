import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  type AnalysisMetricSectionFixture,
  type MetricComparisonValue,
  type MetricReadinessStatus,
  type MetricValue,
} from '@core/models';
import { ApiService } from '@core/services/api.service';
import { AppStateService, type RightSidebarMode } from '@core/services/app-state.service';
import { MockDataService } from '@core/services/mock-data.service';
import {
  AdminBoundaryService,
  type SirapSelectionScope,
} from '@features/map/services/admin-boundary.service';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, distinctUntilChanged, finalize, map, of, switchMap } from 'rxjs';

type SidebarTab = 'overview' | 'aoi' | 'comparison';
type OverviewMetricSection = 'gains' | 'costs';

interface OverviewMetricBlueprint {
  id: string;
  section: OverviewMetricSection;
  labelKey: string;
  descriptionKey: string;
  realMetricId?: string;
  dummyValue: string;
  dummyUnit: string;
  conditional?: boolean;
}

interface OverviewMetricDisplayEntry {
  id: string;
  labelKey: string;
  descriptionKey: string;
  value: string;
  unit: string;
  conditional: boolean;
  unavailable: boolean;
}

@Component({
  selector: 'app-panel-switcher',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './panel-switcher.html',
  styleUrl: './panel-switcher.scss',
})
export class PanelSwitcherComponent {
  private readonly appState = inject(AppStateService);
  private readonly api = inject(ApiService);
  private readonly mockData = inject(MockDataService);
  private readonly adminBoundaries = inject(AdminBoundaryService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly overviewSectionLookup: Record<string, { id: string; labelKey: string }> = {
    'm-biodiversity': { id: 'ecology', labelKey: 'analysis.sections.ecology' },
    'm-carbon': { id: 'climate', labelKey: 'analysis.sections.climate' },
    'm-cost': { id: 'finance', labelKey: 'analysis.sections.finance' },
  };
  private readonly overviewSectionOrder = ['ecology', 'climate', 'finance'];
  private readonly overviewMetricBlueprints: OverviewMetricBlueprint[] = [
    {
      id: 'metric-02-species-groups-protected',
      section: 'gains',
      labelKey: 'analysis.overview.metrics.speciesGroupsProtected',
      descriptionKey: 'analysis.overview.metrics.speciesGroupsProtectedDesc',
      realMetricId: 'm-biodiversity',
      dummyValue: '45 / 50',
      dummyUnit: '90% of total',
    },
    {
      id: 'metric-03-threatened-species-secured',
      section: 'gains',
      labelKey: 'analysis.overview.metrics.threatenedSpeciesSecured',
      descriptionKey: 'analysis.overview.metrics.threatenedSpeciesSecuredDesc',
      dummyValue: '28 / 32',
      dummyUnit: '88% secured',
    },
    {
      id: 'metric-04-ecosystem-coverage',
      section: 'gains',
      labelKey: 'analysis.overview.metrics.ecosystemCoverage',
      descriptionKey: 'analysis.overview.metrics.ecosystemCoverageDesc',
      dummyValue: '125k km²',
      dummyUnit: '85% of target',
    },
    {
      id: 'metric-05-carbon-storage-capacity',
      section: 'gains',
      labelKey: 'analysis.overview.metrics.carbonStorageCapacity',
      descriptionKey: 'analysis.overview.metrics.carbonStorageCapacityDesc',
      realMetricId: 'm-carbon',
      dummyValue: '2.3B',
      dummyUnit: 'tCO2e',
    },
    {
      id: 'metric-06-water-regulation-services',
      section: 'gains',
      labelKey: 'analysis.overview.metrics.waterRegulationServices',
      descriptionKey: 'analysis.overview.metrics.waterRegulationServicesDesc',
      dummyValue: '450M',
      dummyUnit: 'm³ index',
      conditional: true,
    },
    {
      id: 'metric-09-affected-agricultural-area',
      section: 'costs',
      labelKey: 'analysis.overview.metrics.affectedAgriculturalArea',
      descriptionKey: 'analysis.overview.metrics.affectedAgriculturalAreaDesc',
      dummyValue: '8,500 km²',
      dummyUnit: '15% overlap',
    },
    {
      id: 'metric-08-agricultural-opportunity-cost',
      section: 'costs',
      labelKey: 'analysis.overview.metrics.agriculturalOpportunityCost',
      descriptionKey: 'analysis.overview.metrics.agriculturalOpportunityCostDesc',
      realMetricId: 'm-cost',
      dummyValue: '$350M',
      dummyUnit: 'USD',
      conditional: true,
    },
    {
      id: 'metric-13-conflict-zone-overlap',
      section: 'costs',
      labelKey: 'analysis.overview.metrics.conflictZoneOverlap',
      descriptionKey: 'analysis.overview.metrics.conflictZoneOverlapDesc',
      dummyValue: '95,000 km²',
      dummyUnit: 'Area affected',
      conditional: true,
    },
  ];

  protected readonly rightSidebarMode = this.appState.rightSidebarMode$;
  protected readonly activeSolution = this.appState.activeSolution$;
  protected readonly selectedAoi = this.appState.selectedAOI$;
  protected readonly sirapSelectionScope = this.adminBoundaries.sirapSelectionScope$;
  protected readonly comparisonSolution = this.appState.comparisonSolution$;
  protected readonly fillDummyOverviewMetrics = this.appState.fillDummyOverviewMetrics$;
  protected readonly sidebarTabs: SidebarTab[] = ['overview', 'aoi', 'comparison'];
  protected readonly overviewSections = signal<AnalysisMetricSectionFixture[]>([]);
  protected readonly isOverviewLoading = signal(false);
  protected readonly overviewLoadFailed = signal(false);
  protected readonly overviewGainMetrics = computed<OverviewMetricDisplayEntry[]>(() =>
    this.buildOverviewMetricDisplayEntries('gains'),
  );
  protected readonly overviewCostMetrics = computed<OverviewMetricDisplayEntry[]>(() =>
    this.buildOverviewMetricDisplayEntries('costs'),
  );

  protected readonly aoiMetrics = computed(() => {
    const solution = this.activeSolution();
    const aoi = this.selectedAoi();
    if (!solution || !aoi) {
      return [];
    }

    return this.mockData.getAoiMetrics(solution.id, aoi.id)?.metrics ?? [];
  });
  protected readonly isSirapAoiSelected = computed(() => this.selectedAoi()?.type === 'sirap');

  protected readonly comparisonMetrics = computed(() => {
    const baselineSolution = this.activeSolution();
    const candidateSolution = this.comparisonSolution();
    if (!baselineSolution || !candidateSolution) {
      return [];
    }

    return this.mockData.compareSolutions(baselineSolution.id, candidateSolution.id)?.metrics ?? [];
  });

  constructor() {
    toObservable(this.activeSolution)
      .pipe(
        map((solution) => solution?.id ?? null),
        distinctUntilChanged(),
        switchMap((solutionId) => {
          if (!solutionId) {
            this.overviewSections.set([]);
            this.isOverviewLoading.set(false);
            this.overviewLoadFailed.set(false);
            return of<MetricValue[] | null>(null);
          }

          this.isOverviewLoading.set(true);
          this.overviewLoadFailed.set(false);

          return this.api.getSolutionMetrics(solutionId).pipe(
            map((response) => response.metrics),
            catchError(() => {
              this.overviewLoadFailed.set(true);
              return of<MetricValue[]>([]);
            }),
            finalize(() => this.isOverviewLoading.set(false)),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((metrics) => {
        if (metrics === null) {
          return;
        }
        this.overviewSections.set(this.buildOverviewSections(metrics));
      });
  }

  protected formatMetricValue(metric: MetricValue): string {
    if (metric.value === null) {
      return this.translate.instant('analysis.common.valueUnavailable');
    }

    switch (metric.formatHint) {
      case 'percent':
        return `${this.formatNumber(metric.value, 0, 1)}%`;
      case 'currency':
        return this.appendUnit(this.formatNumber(metric.value, 1, 1), metric.unit);
      default:
        return this.appendUnit(this.formatNumber(metric.value, 0, 2), metric.unit);
    }
  }

  protected formatDelta(metric: MetricComparisonValue): string {
    if (metric.delta === null) {
      return this.translate.instant('analysis.common.deltaUnavailable');
    }

    const sign = metric.delta > 0 ? '+' : '';

    switch (metric.formatHint) {
      case 'percent':
        return `${sign}${this.formatNumber(metric.delta, 0, 1)}%`;
      case 'currency':
        return this.appendUnit(
          `${sign}${this.formatNumber(metric.delta, 1, 1)}`,
          metric.candidate.unit,
        );
      default:
        return this.appendUnit(
          `${sign}${this.formatNumber(metric.delta, 0, 2)}`,
          metric.candidate.unit,
        );
    }
  }

  protected getModeLabelKey(mode: RightSidebarMode): string {
    return `analysis.modes.${mode}`;
  }

  protected getStatusKey(status: MetricReadinessStatus): string {
    return `analysis.status.${status}`;
  }

  protected getTabLabelKey(tab: SidebarTab): string {
    return `analysis.modes.${tab}`;
  }

  protected isTabActive(tab: SidebarTab): boolean {
    const mode = this.rightSidebarMode();
    if (tab === 'overview') {
      return mode === 'welcome' || mode === 'overview';
    }

    return mode === tab;
  }

  protected selectTab(tab: SidebarTab): void {
    if (tab === 'overview') {
      const hasSolution = this.activeSolution() !== null;
      this.appState.setRightSidebarMode(hasSolution ? 'overview' : 'welcome');
      return;
    }

    this.appState.setRightSidebarMode(tab);
  }

  protected isSirapScopeSelected(scope: SirapSelectionScope): boolean {
    return this.sirapSelectionScope() === scope;
  }

  protected setSirapSelectionScope(scope: SirapSelectionScope): void {
    this.adminBoundaries.setSirapSelectionScope(scope);
  }

  protected isMetricReady(metric: MetricValue): boolean {
    return metric.status === 'ready' && metric.value !== null;
  }

  protected isPositiveDelta(delta: number | null): boolean {
    return delta !== null && delta > 0;
  }

  protected isNegativeDelta(delta: number | null): boolean {
    return delta !== null && delta < 0;
  }

  protected getContributionPercent(matchPercentage: number): number {
    return Math.max(10, Math.min(60, Math.round(matchPercentage * 0.42)));
  }

  protected getContributionAddedPercent(matchPercentage: number): number {
    const contribution = this.getContributionPercent(matchPercentage);
    return Math.max(2, Math.round(contribution * 0.33));
  }

  protected getGoalsMetCount(matchPercentage: number): number {
    return Math.round(matchPercentage / 12);
  }

  private formatNumber(
    value: number,
    minimumFractionDigits: number,
    maximumFractionDigits: number,
  ): string {
    return new Intl.NumberFormat(this.resolveLocale(), {
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(value);
  }

  private appendUnit(value: string, unit: string | null): string {
    return unit ? `${value} ${unit}` : value;
  }

  private resolveLocale(): string {
    return this.translate.currentLang === 'es' ? 'es-CO' : 'en-US';
  }

  private buildOverviewSections(metrics: MetricValue[]): AnalysisMetricSectionFixture[] {
    const grouped = new Map<string, AnalysisMetricSectionFixture>();

    for (const metric of metrics) {
      const sectionDefinition = this.overviewSectionLookup[metric.metricId];
      if (!sectionDefinition) {
        continue;
      }

      const section =
        grouped.get(sectionDefinition.id) ??
        ({
          sectionId: sectionDefinition.id,
          sectionLabelKey: sectionDefinition.labelKey,
          metrics: [],
        } satisfies AnalysisMetricSectionFixture);

      section.metrics.push(metric);
      grouped.set(sectionDefinition.id, section);
    }

    return this.overviewSectionOrder
      .map((sectionId) => grouped.get(sectionId))
      .filter((section): section is AnalysisMetricSectionFixture => section !== undefined);
  }

  private buildOverviewMetricDisplayEntries(
    section: OverviewMetricSection,
  ): OverviewMetricDisplayEntry[] {
    const metricsById = new Map(
      this.overviewSections()
        .flatMap((metricSection) => metricSection.metrics)
        .map((metric) => [metric.metricId, metric] as const),
    );
    const shouldFillDummy = this.fillDummyOverviewMetrics();

    return this.overviewMetricBlueprints
      .filter((metric) => metric.section === section)
      .map((metric) => {
        const realMetric = metric.realMetricId ? metricsById.get(metric.realMetricId) : undefined;
        const realValueAvailable = realMetric?.status === 'ready' && realMetric.value !== null;

        if (realMetric && realValueAvailable) {
          return {
            id: metric.id,
            labelKey: metric.labelKey,
            descriptionKey: metric.descriptionKey,
            value: this.formatMetricValue(realMetric),
            unit: 'Ready',
            conditional: Boolean(metric.conditional),
            unavailable: false,
          };
        }

        if (shouldFillDummy) {
          return {
            id: metric.id,
            labelKey: metric.labelKey,
            descriptionKey: metric.descriptionKey,
            value: metric.dummyValue,
            unit: metric.dummyUnit,
            conditional: Boolean(metric.conditional),
            unavailable: false,
          };
        }

        return {
          id: metric.id,
          labelKey: metric.labelKey,
          descriptionKey: metric.descriptionKey,
          value: '--',
          unit: '--',
          conditional: Boolean(metric.conditional),
          unavailable: true,
        };
      });
  }
}
