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
import { BaseChartDirective } from 'ng2-charts';
import type { ChartConfiguration, ChartOptions, Scale } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { catchError, distinctUntilChanged, finalize, map, of, switchMap } from 'rxjs';

type SidebarTab = 'overview' | 'aoi' | 'comparison';
type OverviewMetricSection = 'gains' | 'costs';
type ComparisonSectionId = 'general' | 'biodiversity' | 'ecosystems' | 'socio' | 'protection';
type ComparisonDeltaTone = 'positive' | 'negative' | 'neutral';
type AoiSectionId = 'general' | 'bio' | 'eco' | 'land' | 'cultural' | 'marine';

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

interface ComparisonMetricBlueprint {
  id: string;
  section: ComparisonSectionId;
  label: string;
  description: string;
  metricId?: string;
  dummyBaseline: string;
  dummyCandidate: string;
  dummyDelta: string;
  conditional?: boolean;
  deltaTone?: ComparisonDeltaTone;
}

interface ComparisonMetricDisplayEntry {
  id: string;
  label: string;
  description: string;
  baseline: string;
  candidate: string;
  delta: string;
  conditional: boolean;
  unavailable: boolean;
  deltaTone: ComparisonDeltaTone;
}

interface ComparisonMetricSection {
  id: ComparisonSectionId;
  title: string;
  toneClass: 'general' | 'bio' | 'eco' | 'socio' | 'protect';
  insight: string;
  metrics: ComparisonMetricDisplayEntry[];
}

interface AoiBiodiversityBar {
  id: string;
  label: string;
  count: number | null;
}

@Component({
  selector: 'app-panel-switcher',
  standalone: true,
  imports: [TranslatePipe, BaseChartDirective],
  templateUrl: './panel-switcher.html',
  styleUrl: './panel-switcher.scss',
})
export class PanelSwitcherComponent {
  private readonly aoiBiodiversityBaseCounts: readonly {
    id: string;
    label: string;
    count: number;
  }[] = [
    { id: 'mammals', label: 'Mammals', count: 42 },
    { id: 'birds', label: 'Birds', count: 131 },
    { id: 'amphibians', label: 'Amphibians', count: 44 },
    { id: 'reptiles', label: 'Reptiles', count: 38 },
    { id: 'plants', label: 'Plants', count: 27 },
  ];
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
  private readonly comparisonSectionMeta: Record<
    ComparisonSectionId,
    Pick<ComparisonMetricSection, 'title' | 'toneClass' | 'insight'>
  > = {
    general: {
      title: 'Regional Conservation Summary',
      toneClass: 'general',
      insight: '',
    },
    biodiversity: {
      title: 'Biodiversity',
      toneClass: 'bio',
      insight:
        'Species indicators highlight sensitivity shifts between the baseline and candidate configuration.',
    },
    ecosystems: {
      title: 'Ecosystems & Carbon',
      toneClass: 'eco',
      insight:
        'Ecosystem and carbon metrics indicate whether trade-offs preserve climate benefits while improving biodiversity.',
    },
    socio: {
      title: 'Land Use & Socio-Economic',
      toneClass: 'socio',
      insight:
        'Socio-economic cards keep conditional indicators visible to support policy and implementation review.',
    },
    protection: {
      title: 'Cultural & Protection',
      toneClass: 'protect',
      insight:
        'Governance and overlap metrics help flag consultation-sensitive areas before final selection decisions.',
    },
  };
  private readonly comparisonSectionOrder: ComparisonSectionId[] = [
    'general',
    'biodiversity',
    'ecosystems',
    'socio',
    'protection',
  ];
  private readonly comparisonMetricBlueprints: ComparisonMetricBlueprint[] = [
    {
      id: 'comp-priority-area',
      section: 'general',
      label: 'Priority Conservation Area',
      description: 'Estimated protected footprint under each solution.',
      dummyBaseline: '210 km²',
      dummyCandidate: '230 km²',
      dummyDelta: '+20 km²',
      deltaTone: 'positive',
    },
    {
      id: 'comp-national-target',
      section: 'general',
      label: 'Contribution to 30x30 Target',
      description: 'Relative contribution toward national conservation commitments.',
      dummyBaseline: '1.3%',
      dummyCandidate: '1.9%',
      dummyDelta: '+0.6%',
      deltaTone: 'positive',
    },
    {
      id: 'comp-biodiversity',
      section: 'biodiversity',
      label: 'Biodiversity',
      description: 'Composite biodiversity performance score.',
      metricId: 'm-biodiversity',
      dummyBaseline: '83%',
      dummyCandidate: '92%',
      dummyDelta: '+9%',
    },
    {
      id: 'comp-threatened-species',
      section: 'biodiversity',
      label: 'Threatened Species Coverage',
      description: 'CR/EN/VU species with habitat represented in priority zones.',
      dummyBaseline: '4 species',
      dummyCandidate: '5 species',
      dummyDelta: '+1',
      deltaTone: 'positive',
    },
    {
      id: 'comp-endemic-species',
      section: 'biodiversity',
      label: 'Endemic Species Coverage',
      description: 'Colombia endemic species represented in selected areas.',
      dummyBaseline: '10 species',
      dummyCandidate: '12 species',
      dummyDelta: '+2',
      deltaTone: 'positive',
    },
    {
      id: 'comp-carbon',
      section: 'ecosystems',
      label: 'Carbon Storage',
      description: 'Estimated carbon storage retained in selected areas.',
      metricId: 'm-carbon',
      dummyBaseline: '69 t/ha',
      dummyCandidate: '74 t/ha',
      dummyDelta: '+5 t/ha',
    },
    {
      id: 'comp-water-regulation',
      section: 'ecosystems',
      label: 'Water Regulation Capacity',
      description: 'Hydrological service support for downstream communities.',
      dummyBaseline: '72 / 100',
      dummyCandidate: '78 / 100',
      dummyDelta: '+6',
      deltaTone: 'positive',
    },
    {
      id: 'comp-cost',
      section: 'socio',
      label: 'Implementation Cost',
      description: 'Estimated implementation cost envelope.',
      metricId: 'm-cost',
      dummyBaseline: '$1.7M COP',
      dummyCandidate: '$2.1M COP',
      dummyDelta: '+$0.4M COP',
      conditional: true,
    },
    {
      id: 'comp-ag-opportunity',
      section: 'socio',
      label: 'Agricultural Opportunity Cost',
      description: 'Estimated agricultural trade-off in affected zones.',
      dummyBaseline: '$108M USD',
      dummyCandidate: '$125M USD',
      dummyDelta: '+$17M USD',
      conditional: true,
      deltaTone: 'negative',
    },
    {
      id: 'comp-conflict-overlap',
      section: 'socio',
      label: 'Conflict Zone Overlap',
      description: 'Overlap with historically conflict-affected areas.',
      dummyBaseline: '31 km²',
      dummyCandidate: '38 km²',
      dummyDelta: '+7 km²',
      conditional: true,
      deltaTone: 'negative',
    },
    {
      id: 'comp-protected-overlap',
      section: 'protection',
      label: 'Overlap with National Parks',
      description: 'Candidate overlap with existing formal protected areas.',
      dummyBaseline: '14%',
      dummyCandidate: '18%',
      dummyDelta: '+4%',
      deltaTone: 'positive',
    },
    {
      id: 'comp-indigenous-overlap',
      section: 'protection',
      label: 'Overlap with Indigenous Territories',
      description: 'Consultation-sensitive overlap across indigenous territories.',
      dummyBaseline: '10%',
      dummyCandidate: '12%',
      dummyDelta: '+2%',
      conditional: true,
      deltaTone: 'neutral',
    },
  ];

  protected readonly rightSidebarMode = this.appState.rightSidebarMode$;
  protected readonly activeSolution = this.appState.activeSolution$;
  protected readonly selectedAoi = this.appState.selectedAOI$;
  protected readonly sirapSelectionScope = this.adminBoundaries.sirapSelectionScope$;
  protected readonly comparisonSolution = this.appState.comparisonSolution$;
  protected readonly fillDummyOverviewMetrics = this.appState.fillDummyOverviewMetrics$;
  protected readonly fillDummyComparisonMetrics = this.appState.fillDummyComparisonMetrics$;
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
  protected readonly fillDummyAoiMetrics = this.appState.fillDummyAoiMetrics$;
  protected readonly aoiSectionExpanded = signal<Record<AoiSectionId, boolean>>({
    general: true,
    bio: true,
    eco: true,
    land: false,
    cultural: false,
    marine: false,
  });
  protected readonly aoiDonutGradient = computed(() => {
    if (!this.fillDummyAoiMetrics()) return '#e2e8f0';
    return 'conic-gradient(#334155 0 39%, #64748b 39% 62%, #94a3b8 62% 79%, #cbd5e1 79% 91%, #e2e8f0 91% 100%)';
  });
  protected readonly aoiBiodiversityBars = computed<AoiBiodiversityBar[]>(() => {
    if (!this.fillDummyAoiMetrics()) {
      return this.aoiBiodiversityBaseCounts.map((item) => ({
        id: item.id,
        label: item.label,
        count: null,
      }));
    }

    const selectedAoi = this.selectedAoi();
    const scale = selectedAoi ? this.getAoiBiodiversityScale(selectedAoi.id) : 1;

    return this.aoiBiodiversityBaseCounts.map((item) => ({
      id: item.id,
      label: item.label,
      count: Math.max(0, Math.round(item.count * scale)),
    }));
  });
  protected readonly aoiBiodiversityAxisTicks = computed<number[]>(() => {
    const maxCount = this.getAoiBiodiversityMaxCount();
    if (maxCount <= 0) {
      return [0];
    }

    const targetTickCount = 5;
    const step = this.getNiceTickStep(maxCount / targetTickCount);
    const axisMax = Math.ceil(maxCount / step) * step;
    const ticks: number[] = [];

    for (let value = 0; value <= axisMax; value += step) {
      ticks.push(value);
    }

    return ticks;
  });
  protected readonly aoiBiodiversityAxisMax = computed<number>(() => {
    const ticks = this.aoiBiodiversityAxisTicks();
    return ticks[ticks.length - 1] ?? 0;
  });
  protected readonly aoiBiodiversityChartType = 'bar' as const;
  protected readonly aoiBiodiversityChartPlugins = [ChartDataLabels];
  protected readonly aoiBiodiversityChartData = computed<ChartConfiguration<'bar'>['data']>(() => ({
    labels: this.aoiBiodiversityBars().map((entry) => entry.label),
    datasets: [
      {
        data: this.aoiBiodiversityBars().map((entry) => entry.count ?? 0),
        backgroundColor: '#334155',
        borderRadius: 999,
        borderSkipped: false,
        clip: false,
        barPercentage: 0.86,
        categoryPercentage: 0.92,
        maxBarThickness: 10,
      },
    ],
  }));
  protected readonly aoiBiodiversityChartOptions = computed<ChartOptions<'bar'>>(() => {
    const axisMax = this.aoiBiodiversityAxisMax();
    const ticks = this.aoiBiodiversityAxisTicks();
    const stepSize = ticks.length > 1 ? ticks[1] - ticks[0] : 1;

    return {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 250,
      },
      layout: {
        padding: {
          left: 4,
          right: 26,
          top: 2,
          bottom: 0,
        },
      },
      scales: {
        x: {
          min: 0,
          max: axisMax,
          position: 'top',
          offset: false,
          grid: {
            drawOnChartArea: false,
            drawTicks: true,
            tickLength: 5,
            color: '#94a3b8',
          },
          border: {
            display: true,
            color: '#94a3b8',
          },
          ticks: {
            stepSize,
            color: '#64748b',
            font: {
              size: 9,
            },
            padding: 2,
          },
        },
        y: {
          offset: true,
          afterFit: (axis: Scale) => {
            axis.paddingBottom = 4;
          },
          grid: {
            display: false,
            drawTicks: false,
          },
          border: {
            display: false,
          },
          ticks: {
            color: '#475569',
            font: {
              size: 11,
              family: "'Inter', sans-serif",
            },
            padding: 10,
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          enabled: true,
          callbacks: {
            label: (context) => `${context.parsed.x} species`,
          },
        },
        datalabels: {
          anchor: 'end',
          align: 'right',
          color: '#334155',
          offset: 1,
          formatter: (value: unknown) => {
            if (typeof value !== 'number') {
              return '--';
            }
            return `${Math.round(value)}`;
          },
          font: {
            weight: 600,
            size: 11,
            family: "'Inter', sans-serif",
          },
          clip: false,
          clamp: false,
        },
      },
    };
  });

  protected readonly comparisonSectionExpanded = signal<Record<ComparisonSectionId, boolean>>({
    general: true,
    biodiversity: true,
    ecosystems: true,
    socio: false,
    protection: false,
  });
  protected readonly comparisonSections = computed<ComparisonMetricSection[]>(() =>
    this.buildComparisonSections(),
  );

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

  /** AOI and comparison require an active solution; overview is always available. */
  protected isSidebarTabDisabled(tab: SidebarTab): boolean {
    if (tab === 'overview') {
      return false;
    }
    return this.activeSolution() === null;
  }

  protected selectTab(tab: SidebarTab): void {
    if (this.isSidebarTabDisabled(tab)) {
      return;
    }

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

  protected toggleAoiSection(sectionId: AoiSectionId): void {
    this.aoiSectionExpanded.update((state) => ({
      ...state,
      [sectionId]: !state[sectionId],
    }));
  }

  protected isAoiSectionExpanded(sectionId: AoiSectionId): boolean {
    return this.aoiSectionExpanded()[sectionId];
  }

  protected aoiVal(dummyValue: string): string {
    return this.fillDummyAoiMetrics() ? dummyValue : '--';
  }

  protected aoiBarWidth(dummyPercent: number): number {
    return this.fillDummyAoiMetrics() ? dummyPercent : 0;
  }

  protected isComparisonSectionExpanded(sectionId: ComparisonSectionId): boolean {
    return this.comparisonSectionExpanded()[sectionId];
  }

  protected toggleComparisonSection(sectionId: ComparisonSectionId): void {
    this.comparisonSectionExpanded.update((state) => ({
      ...state,
      [sectionId]: !state[sectionId],
    }));
  }

  protected openComparisonSolutionFinder(): void {
    this.appState.openSolutionFinder('comparison-candidate');
    this.appState.setRightSidebarMode('comparison');
  }

  protected getComparisonActionLabel(): string {
    return this.comparisonSolution() ? 'Change' : 'Select';
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

  private getAoiBiodiversityScale(aoiId: string): number {
    const mod = aoiId.length % 4;
    return [0.9, 1, 1.1, 1.2][mod] ?? 1;
  }

  private getAoiBiodiversityMaxCount(): number {
    return this.aoiBiodiversityBars().reduce((maxValue, item) => {
      if (item.count === null) {
        return maxValue;
      }
      return Math.max(maxValue, item.count);
    }, 0);
  }

  private getNiceTickStep(rawStep: number): number {
    if (rawStep <= 0 || !Number.isFinite(rawStep)) {
      return 1;
    }

    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / magnitude;

    if (normalized <= 1) return magnitude;
    if (normalized <= 2) return 2 * magnitude;
    if (normalized <= 2.5) return 2.5 * magnitude;
    if (normalized <= 5) return 5 * magnitude;
    return 10 * magnitude;
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

  private buildComparisonSections(): ComparisonMetricSection[] {
    const metricsById = new Map(
      this.comparisonMetrics().map((metric) => [metric.metricId, metric] as const),
    );
    const shouldFillDummy = this.fillDummyComparisonMetrics();

    return this.comparisonSectionOrder.map((sectionId) => {
      const sectionMeta = this.comparisonSectionMeta[sectionId];
      const metrics = this.comparisonMetricBlueprints
        .filter((metric) => metric.section === sectionId)
        .map((metric) =>
          this.buildComparisonMetricDisplayEntry(metric, metricsById, shouldFillDummy),
        );

      return {
        id: sectionId,
        title: sectionMeta.title,
        toneClass: sectionMeta.toneClass,
        insight: sectionMeta.insight,
        metrics,
      };
    });
  }

  private buildComparisonMetricDisplayEntry(
    blueprint: ComparisonMetricBlueprint,
    metricsById: Map<string, MetricComparisonValue>,
    shouldFillDummy: boolean,
  ): ComparisonMetricDisplayEntry {
    const realMetric = blueprint.metricId ? metricsById.get(blueprint.metricId) : undefined;

    if (realMetric && this.isComparisonMetricReady(realMetric)) {
      return {
        id: blueprint.id,
        label: blueprint.label,
        description: blueprint.description,
        baseline: this.formatMetricValue(realMetric.baseline),
        candidate: this.formatMetricValue(realMetric.candidate),
        delta: this.formatDelta(realMetric),
        conditional: Boolean(blueprint.conditional),
        unavailable: false,
        deltaTone:
          realMetric.delta === null || realMetric.delta === 0
            ? 'neutral'
            : realMetric.delta > 0
              ? 'positive'
              : 'negative',
      };
    }

    if (shouldFillDummy) {
      return {
        id: blueprint.id,
        label: blueprint.label,
        description: blueprint.description,
        baseline: blueprint.dummyBaseline,
        candidate: blueprint.dummyCandidate,
        delta: blueprint.dummyDelta,
        conditional: Boolean(blueprint.conditional),
        unavailable: false,
        deltaTone: blueprint.deltaTone ?? 'positive',
      };
    }

    if (realMetric) {
      return {
        id: blueprint.id,
        label: blueprint.label,
        description: blueprint.description,
        baseline: this.formatMetricValue(realMetric.baseline),
        candidate: this.formatMetricValue(realMetric.candidate),
        delta: this.formatDelta(realMetric),
        conditional: Boolean(blueprint.conditional),
        unavailable: true,
        deltaTone: 'neutral',
      };
    }

    return {
      id: blueprint.id,
      label: blueprint.label,
      description: blueprint.description,
      baseline: '--',
      candidate: '--',
      delta: '--',
      conditional: Boolean(blueprint.conditional),
      unavailable: true,
      deltaTone: 'neutral',
    };
  }

  private isComparisonMetricReady(metric: MetricComparisonValue): boolean {
    return (
      metric.baseline.status === 'ready' &&
      metric.candidate.status === 'ready' &&
      metric.baseline.value !== null &&
      metric.candidate.value !== null &&
      metric.delta !== null
    );
  }
}
