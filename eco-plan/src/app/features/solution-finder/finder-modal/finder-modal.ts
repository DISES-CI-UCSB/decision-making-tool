import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  inject,
} from '@angular/core';
import type { SolutionScenario } from '@core/models/solution-scenario.model';
import type { SolutionFinderContext } from '@core/services/app-state.service';
import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import { TranslatePipe } from '@ngx-translate/core';

type FinderMatchState = 'empty' | 'loading' | 'ready';

interface TargetOption {
  id: string;
  label: string;
}

interface TargetGroup {
  id: string;
  labelKey: string;
  options: TargetOption[];
  selectedOptionId: string | null;
  badgeText: string;
}

interface ConstraintToggle {
  id: string;
  labelKey: string;
  mode: 'include' | 'exclude';
  enabled: boolean;
}

interface ScenarioMatch {
  id: string;
  solutionId: string;
  scenarioId: string;
  name: string;
  description: string;
  mapLabel: string;
  ecosystemTargets: number;
  selectedUnits: number;
  matchPercentage: number;
}

@Component({
  selector: 'app-finder-modal',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './finder-modal.html',
  styleUrl: './finder-modal.scss',
})
export class FinderModalComponent implements AfterViewInit, OnDestroy {
  private readonly solutionCatalog = inject(SolutionCatalogService);
  private readonly mockSolutionIds = ['sol-001', 'sol-002', 'sol-003'];
  @Input() mode: SolutionFinderContext = 'default';
  @Output() readonly closeRequested = new EventEmitter<void>();
  @Output() readonly scenarioApplied = new EventEmitter<ScenarioMatch>();

  protected readonly targetGroups: TargetGroup[] = [
    {
      id: 'mammal-species',
      labelKey: 'solutionControls.finder.targets.mammalSpecies',
      badgeText: '30x30',
      selectedOptionId: null,
      options: [
        { id: '17', label: '17%' },
        { id: '30', label: '30%' },
        { id: '34', label: '34%' },
        { id: 'custom', label: 'Custom' },
      ],
    },
    {
      id: 'cloud-forest',
      labelKey: 'solutionControls.finder.targets.cloudForest',
      badgeText: '30x30',
      selectedOptionId: null,
      options: [
        { id: '17', label: '17%' },
        { id: '30', label: '30%' },
        { id: '21', label: '21%' },
        { id: 'custom', label: 'Custom' },
      ],
    },
    {
      id: 'threatened-amphibians',
      labelKey: 'solutionControls.finder.targets.threatenedAmphibians',
      badgeText: '30x30',
      selectedOptionId: null,
      options: [
        { id: '17', label: '17%' },
        { id: '25', label: '25%' },
        { id: '30', label: '30%' },
        { id: 'custom', label: 'Custom' },
      ],
    },
    {
      id: 'paramo-ecosystems',
      labelKey: 'solutionControls.finder.targets.paramoEcosystems',
      badgeText: '30x30',
      selectedOptionId: null,
      options: [
        { id: '17', label: '17%' },
        { id: '30', label: '30%' },
        { id: '50', label: '50%' },
        { id: 'custom', label: 'Custom' },
      ],
    },
    {
      id: 'wetlands',
      labelKey: 'solutionControls.finder.targets.wetlands',
      badgeText: '30x30',
      selectedOptionId: null,
      options: [
        { id: '17', label: '17%' },
        { id: '30', label: '30%' },
        { id: 'custom', label: 'Custom' },
      ],
    },
  ];

  protected readonly constraintToggles: ConstraintToggle[] = [
    {
      id: 'include-national-parks',
      labelKey: 'solutionControls.finder.constraints.includeNationalParks',
      mode: 'include',
      enabled: false,
    },
    {
      id: 'exclude-urban-centers',
      labelKey: 'solutionControls.finder.constraints.excludeUrbanCenters',
      mode: 'exclude',
      enabled: false,
    },
    {
      id: 'connect-protected-areas',
      labelKey: 'solutionControls.finder.constraints.connectProtectedAreas',
      mode: 'include',
      enabled: false,
    },
    {
      id: 'exclude-mining',
      labelKey: 'solutionControls.finder.constraints.excludeMining',
      mode: 'exclude',
      enabled: false,
    },
    {
      id: 'include-indigenous-territories',
      labelKey: 'solutionControls.finder.constraints.includeIndigenousTerritories',
      mode: 'include',
      enabled: false,
    },
    {
      id: 'exclude-conflict-zones',
      labelKey: 'solutionControls.finder.constraints.excludeConflictZones',
      mode: 'exclude',
      enabled: false,
    },
  ];

  protected readonly scenarioLibrary: Omit<ScenarioMatch, 'matchPercentage'>[] =
    this.solutionCatalog.getAll().map((scenario, index) => this.toScenarioMatch(scenario, index));

  @ViewChild('targetsCardsGroup')
  private readonly targetsCardsGroupRef?: ElementRef<HTMLElement>;

  @ViewChild('resultsScrollContainer')
  private readonly resultsScrollRef?: ElementRef<HTMLElement>;

  @ViewChild('resultsScrollThumb')
  private readonly resultsThumbRef?: ElementRef<HTMLElement>;

  protected matchState: FinderMatchState = 'empty';
  protected matchResults: ScenarioMatch[] = [];
  protected selectedMatchId: string | null = null;
  protected selectedMatch: ScenarioMatch | null = null;
  protected targetsGroupHeight = 0;

  private loadingTimer: ReturnType<typeof setTimeout> | null = null;
  private loadingStartTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollThumbHideTimer: ReturnType<typeof setTimeout> | null = null;
  private targetsGroupResizeObserver: ResizeObserver | null = null;

  ngAfterViewInit(): void {
    this.updateTargetsGroupHeight();

    if (typeof ResizeObserver === 'undefined' || !this.targetsCardsGroupRef) {
      return;
    }

    this.targetsGroupResizeObserver = new ResizeObserver(() => {
      this.updateTargetsGroupHeight();
    });
    this.targetsGroupResizeObserver.observe(this.targetsCardsGroupRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.clearLoadingTimer();
    this.clearLoadingStartTimer();
    this.clearScrollThumbHideTimer();
    this.targetsGroupResizeObserver?.disconnect();
    this.targetsGroupResizeObserver = null;
  }

  protected selectTargetOption(groupId: string, optionId: string): void {
    const group = this.targetGroups.find((targetGroup) => targetGroup.id === groupId);
    if (!group) {
      return;
    }

    group.selectedOptionId = optionId;
    this.clearResultsIfNeeded();
  }

  protected toggleConstraint(toggleId: string): void {
    if (!this.isStep1Complete()) {
      return;
    }

    const toggle = this.constraintToggles.find(
      (constraintToggle) => constraintToggle.id === toggleId,
    );
    if (!toggle) {
      return;
    }

    toggle.enabled = !toggle.enabled;
    this.clearResultsIfNeeded();
  }

  protected runMatching(): void {
    if (!this.isStep1Complete()) {
      this.matchState = 'empty';
      return;
    }

    this.matchResults = [];
    this.selectedMatchId = null;
    this.selectedMatch = null;
    this.clearLoadingTimer();
    this.clearLoadingStartTimer();

    this.loadingStartTimer = setTimeout(() => {
      this.matchState = 'loading';
      this.loadingTimer = setTimeout(() => {
        this.matchResults = this.buildMockMatches();
        this.selectedMatchId = this.matchResults[0]?.id ?? null;
        this.selectedMatch = this.matchResults[0] ?? null;
        this.matchState = 'ready';
      }, 700);
    }, 0);
  }

  protected selectMatch(matchId: string): void {
    this.selectedMatchId = matchId;
    this.selectedMatch = this.matchResults.find((match) => match.id === matchId) ?? null;
  }

  protected onResultsScroll(): void {
    this.updateScrollThumb();
    this.showScrollThumb();
  }

  protected onResultsMouseEnter(): void {
    this.updateScrollThumb();
    this.showScrollThumb();
  }

  protected onResultsMouseLeave(): void {
    this.hideScrollThumbAfterDelay(400);
  }

  protected resetSelections(): void {
    for (const group of this.targetGroups) {
      group.selectedOptionId = null;
    }

    for (const toggle of this.constraintToggles) {
      toggle.enabled = false;
    }

    this.matchResults = [];
    this.selectedMatchId = null;
    this.selectedMatch = null;
    this.matchState = 'empty';
    this.clearLoadingTimer();
    this.clearLoadingStartTimer();
  }

  protected requestClose(): void {
    this.closeRequested.emit();
  }

  protected applySelectedScenario(): void {
    const selectedMatch = this.selectedMatch;
    if (!selectedMatch) {
      return;
    }

    this.scenarioApplied.emit(selectedMatch);
    this.closeRequested.emit();
  }

  protected getSelectedTargetCount(): number {
    return this.targetGroups.filter((group) => group.selectedOptionId !== null).length;
  }

  protected getEnabledConstraintCount(): number {
    return this.constraintToggles.filter((toggle) => toggle.enabled).length;
  }

  protected canRunMatching(): boolean {
    return this.isStep1Complete() && this.matchState !== 'loading';
  }

  protected canApplyScenario(): boolean {
    return this.matchState === 'ready' && this.selectedMatchId !== null;
  }

  protected isStep1Complete(): boolean {
    return this.getSelectedTargetCount() > 0;
  }

  protected isStep2Unlocked(): boolean {
    return this.isStep1Complete();
  }

  protected isStep3Unlocked(): boolean {
    return this.matchState === 'ready' && this.matchResults.length > 0;
  }

  protected isStep3Locked(): boolean {
    return this.matchState === 'empty';
  }

  protected getStep1StateKey(): string {
    return this.isStep1Complete()
      ? 'solutionControls.finder.stepState.complete'
      : 'solutionControls.finder.stepState.inProgress';
  }

  protected getStep2StateKey(): string {
    return this.isStep2Unlocked()
      ? 'solutionControls.finder.stepState.unlocked'
      : 'solutionControls.finder.stepState.locked';
  }

  protected getStep3StateKey(): string {
    if (this.isStep3Unlocked()) {
      return 'solutionControls.finder.stepState.ready';
    }

    if (this.matchState === 'loading') {
      return 'solutionControls.finder.stepState.inProgress';
    }

    return 'solutionControls.finder.stepState.locked';
  }

  protected isToggleEnabled(toggle: ConstraintToggle): boolean {
    return toggle.enabled;
  }

  protected getToggleModeLabelKey(toggle: ConstraintToggle): string {
    return toggle.mode === 'include'
      ? 'solutionControls.finder.labels.include'
      : 'solutionControls.finder.labels.exclude';
  }

  protected getKickerKey(): string {
    return this.mode === 'comparison-candidate'
      ? 'solutionControls.finder.comparison.kicker'
      : 'solutionControls.finder.kicker';
  }

  protected getTitleKey(): string {
    return this.mode === 'comparison-candidate'
      ? 'solutionControls.finder.comparison.title'
      : 'solutionControls.finder.title';
  }

  protected getDescriptionKey(): string {
    return this.mode === 'comparison-candidate'
      ? 'solutionControls.finder.comparison.description'
      : 'solutionControls.finder.description';
  }

  protected getApplyActionKey(): string {
    return this.mode === 'comparison-candidate'
      ? 'solutionControls.finder.actions.loadAsCandidateSolution'
      : 'solutionControls.finder.actions.apply';
  }

  private clearResultsIfNeeded(): void {
    this.clearLoadingTimer();
    this.clearLoadingStartTimer();
    this.matchResults = [];
    this.selectedMatchId = null;
    this.selectedMatch = null;
    this.matchState = 'empty';
  }

  private buildMockMatches(): ScenarioMatch[] {
    const selectedTargets = this.getSelectedTargetValues();
    const targetAverage =
      selectedTargets.length > 0
        ? selectedTargets.reduce((sum, value) => sum + value, 0) / selectedTargets.length
        : 30;
    const enabledConstraintCount = this.getEnabledConstraintCount();

    return this.scenarioLibrary
      .map((scenario, index) => {
        const targetDistance = Math.abs(scenario.ecosystemTargets - targetAverage);
        const targetScore = Math.max(0, 16 - targetDistance * 1.2);
        const constraintScore = Math.min(12, enabledConstraintCount * 2);
        const variationScore = Math.max(0, 8 - (index % 8));
        const coverageScore = Math.min(8, scenario.selectedUnits / 100000);

        return {
          ...scenario,
          matchPercentage: Math.round(
            Math.min(
              99,
              Math.max(58, 62 + targetScore + constraintScore + variationScore + coverageScore),
            ),
          ),
        };
      })
      .sort((a, b) => b.matchPercentage - a.matchPercentage);
  }

  private getSelectedTargetValues(): number[] {
    return this.targetGroups
      .map((group) => {
        const value = Number(group.selectedOptionId);
        return Number.isFinite(value) ? value : null;
      })
      .filter((value): value is number => value !== null);
  }

  private toScenarioMatch(
    scenario: SolutionScenario,
    index: number,
  ): Omit<ScenarioMatch, 'matchPercentage'> {
    return {
      id: this.toScenarioMatchId(scenario.id),
      solutionId: this.mockSolutionIds[index % this.mockSolutionIds.length],
      scenarioId: scenario.id,
      name: scenario.name,
      description: scenario.description,
      mapLabel: scenario.costLayer,
      ecosystemTargets: scenario.ecosystemTargets,
      selectedUnits: scenario.nSelected,
    };
  }

  private toScenarioMatchId(scenarioId: string): string {
    return `scenario-${scenarioId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  }

  private clearLoadingTimer(): void {
    if (!this.loadingTimer) {
      return;
    }

    clearTimeout(this.loadingTimer);
    this.loadingTimer = null;
  }

  private clearLoadingStartTimer(): void {
    if (!this.loadingStartTimer) {
      return;
    }

    clearTimeout(this.loadingStartTimer);
    this.loadingStartTimer = null;
  }

  private updateTargetsGroupHeight(): void {
    const targetsCardsGroupElement = this.targetsCardsGroupRef?.nativeElement;
    if (!targetsCardsGroupElement) {
      return;
    }

    this.targetsGroupHeight = Math.ceil(targetsCardsGroupElement.getBoundingClientRect().height);
  }

  private updateScrollThumb(): void {
    const container = this.resultsScrollRef?.nativeElement;
    const thumb = this.resultsThumbRef?.nativeElement;
    if (!container || !thumb) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = container;
    if (scrollHeight <= clientHeight) {
      thumb.style.opacity = '0';
      return;
    }

    const thumbHeight = Math.max(24, (clientHeight / scrollHeight) * clientHeight);
    const maxScroll = scrollHeight - clientHeight;
    const thumbTop = (scrollTop / maxScroll) * (clientHeight - thumbHeight);

    thumb.style.height = `${thumbHeight}px`;
    thumb.style.top = `${thumbTop}px`;
  }

  private showScrollThumb(): void {
    const container = this.resultsScrollRef?.nativeElement;
    const thumb = this.resultsThumbRef?.nativeElement;
    if (!container || !thumb || container.scrollHeight <= container.clientHeight) {
      return;
    }

    this.clearScrollThumbHideTimer();
    thumb.style.opacity = '1';
    this.hideScrollThumbAfterDelay(1200);
  }

  private hideScrollThumbAfterDelay(ms: number): void {
    this.clearScrollThumbHideTimer();
    this.scrollThumbHideTimer = setTimeout(() => {
      const thumb = this.resultsThumbRef?.nativeElement;
      if (thumb) {
        thumb.style.opacity = '0';
      }
    }, ms);
  }

  private clearScrollThumbHideTimer(): void {
    if (!this.scrollThumbHideTimer) {
      return;
    }

    clearTimeout(this.scrollThumbHideTimer);
    this.scrollThumbHideTimer = null;
  }
}
