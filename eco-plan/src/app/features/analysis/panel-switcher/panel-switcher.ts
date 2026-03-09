import { Component, computed, inject } from '@angular/core';
import {
  type MetricComparisonValue,
  type MetricReadinessStatus,
  type MetricValue,
} from '@core/models';
import { AppStateService, type RightSidebarMode } from '@core/services/app-state.service';
import { MockDataService } from '@core/services/mock-data.service';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

type SidebarTab = 'overview' | 'aoi' | 'comparison';

@Component({
  selector: 'app-panel-switcher',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './panel-switcher.html',
  styleUrl: './panel-switcher.scss',
})
export class PanelSwitcherComponent {
  private readonly appState = inject(AppStateService);
  private readonly mockData = inject(MockDataService);
  private readonly translate = inject(TranslateService);

  protected readonly rightSidebarMode = this.appState.rightSidebarMode$;
  protected readonly activeSolution = this.appState.activeSolution$;
  protected readonly selectedAoi = this.appState.selectedAOI$;
  protected readonly comparisonSolution = this.appState.comparisonSolution$;
  protected readonly sidebarTabs: SidebarTab[] = ['overview', 'aoi', 'comparison'];
  protected readonly overviewSections = computed(() => {
    const solution = this.activeSolution();
    if (!solution) {
      return [];
    }

    return this.mockData.getAnalysisMetricFixtures(solution.id)?.sections ?? [];
  });

  protected readonly aoiMetrics = computed(() => {
    const solution = this.activeSolution();
    const aoi = this.selectedAoi();
    if (!solution || !aoi) {
      return [];
    }

    return this.mockData.getAoiMetrics(solution.id, aoi.id)?.metrics ?? [];
  });

  protected readonly comparisonMetrics = computed(() => {
    const baselineSolution = this.activeSolution();
    const candidateSolution = this.comparisonSolution();
    if (!baselineSolution || !candidateSolution) {
      return [];
    }

    return this.mockData.compareSolutions(baselineSolution.id, candidateSolution.id)?.metrics ?? [];
  });

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

  protected isMetricReady(metric: MetricValue): boolean {
    return metric.status === 'ready' && metric.value !== null;
  }

  protected isPositiveDelta(delta: number | null): boolean {
    return delta !== null && delta > 0;
  }

  protected isNegativeDelta(delta: number | null): boolean {
    return delta !== null && delta < 0;
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
}
