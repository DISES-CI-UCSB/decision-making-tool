import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  QueryList,
  ViewChild,
  ViewChildren,
  inject,
} from '@angular/core';
import type { SolutionScenario } from '@core/models/solution-scenario.model';
import type { SolutionFinderContext } from '@core/services/app-state.service';
import { AppStateService } from '@core/services/app-state.service';
import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import { TranslatePipe } from '@ngx-translate/core';

type FinderMatchState = 'empty' | 'loading' | 'ready';

type FinderTargetType =
  | 'species-richness'
  | 'ecosystems'
  | 'strategic-ecosystems'
  | 'ecosystem-services'
  | 'other-natural-cultural-elements';

type CostLayerChoice = 'human-footprint' | 'carbon-opportunity' | 'conflict';

interface TargetTypeOption {
  id: FinderTargetType;
  labelKey: string;
  helpKey: string;
  isStrategic: boolean;
  isAvailable: boolean;
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

type TargetLevelsByType = Partial<Record<FinderTargetType, 17 | 30>>;

@Component({
  selector: 'app-finder-modal',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './finder-modal.html',
  styleUrl: './finder-modal.scss',
})
export class FinderModalComponent implements AfterViewInit, OnDestroy {
  private readonly appState = inject(AppStateService);
  private readonly solutionCatalog = inject(SolutionCatalogService);
  private readonly mockSolutionIds = ['sol-001', 'sol-002', 'sol-003'];
  protected readonly targetTypeOptions: readonly TargetTypeOption[] = [
    {
      id: 'ecosystems',
      labelKey: 'solutionControls.finder.step1.ecosystemsLabel',
      helpKey: 'solutionControls.finder.step1.ecosystemsHelp',
      isStrategic: false,
      isAvailable: true,
    },
    {
      id: 'strategic-ecosystems',
      labelKey: 'solutionControls.finder.step1.strategicEcosystemsLabel',
      helpKey: 'solutionControls.finder.step1.strategicEcosystemsHelp',
      isStrategic: true,
      isAvailable: true,
    },
    {
      id: 'species-richness',
      labelKey: 'solutionControls.finder.step1.speciesRichnessLabel',
      helpKey: 'solutionControls.finder.step1.speciesRichnessHelp',
      isStrategic: false,
      isAvailable: true,
    },
    {
      id: 'ecosystem-services',
      labelKey: 'solutionControls.finder.step1.ecosystemServicesLabel',
      helpKey: 'solutionControls.finder.step1.ecosystemServicesHelp',
      isStrategic: false,
      isAvailable: false,
    },
    {
      id: 'other-natural-cultural-elements',
      labelKey: 'solutionControls.finder.step1.otherNaturalCulturalElementsLabel',
      helpKey: 'solutionControls.finder.step1.otherNaturalCulturalElementsHelp',
      isStrategic: false,
      isAvailable: false,
    },
  ];

  @Input() mode: SolutionFinderContext = 'default';
  @Output() readonly closeRequested = new EventEmitter<void>();
  @Output() readonly scenarioApplied = new EventEmitter<ScenarioMatch>();

  protected readonly scenarioLibrary: SolutionScenario[] = this.solutionCatalog.getAll();
  protected readonly showScenarioFilenames = this.appState.showFinderScenarioFilenames$;

  /** Step 1 */
  protected selectedTargetTypeIds: FinderTargetType[] = [];
  protected targetLevelByType: TargetLevelsByType = {};

  /** Step 2A (variable) */
  protected includeOmecs = false;
  protected includeComunidades = false;

  /** Step 2B */
  protected selectedCostLayerId: CostLayerChoice | null = null;

  @ViewChild('resultsScrollContainer')
  private readonly resultsScrollRef?: ElementRef<HTMLElement>;

  @ViewChild('resultsScrollThumb')
  private readonly resultsThumbRef?: ElementRef<HTMLElement>;

  @ViewChildren('finderColumnHeader')
  private readonly columnHeaderRefs?: QueryList<ElementRef<HTMLElement>>;

  protected matchState: FinderMatchState = 'empty';
  protected matchResults: ScenarioMatch[] = [];
  protected selectedMatchId: string | null = null;
  protected selectedMatch: ScenarioMatch | null = null;

  private loadingTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollThumbHideTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnDestroy(): void {
    this.clearLoadingTimer();
    this.clearScrollThumbHideTimer();
  }

  ngAfterViewInit(): void {
    this.syncColumnHeaderHeights();
    setTimeout(() => this.syncColumnHeaderHeights());
  }

  @HostListener('window:resize')
  protected onWindowResize(): void {
    this.syncColumnHeaderHeights();
  }

  protected toggleTargetType(type: FinderTargetType): void {
    const option = this.targetTypeOptions.find((item) => item.id === type);
    if (!option || !option.isAvailable) {
      return;
    }
    const currentIndex = this.selectedTargetTypeIds.indexOf(type);
    if (currentIndex >= 0) {
      this.selectedTargetTypeIds.splice(currentIndex, 1);
      delete this.targetLevelByType[type];
    } else {
      this.selectedTargetTypeIds.push(type);
    }

    this.clearResultsIfNeeded();
  }

  protected selectTargetLevel(type: FinderTargetType, pct: 17 | 30): void {
    if (!this.isTargetTypeSelected(type) || !this.isTargetTypeAvailable(type)) {
      return;
    }
    this.targetLevelByType[type] = pct;
    this.clearResultsIfNeeded();
  }

  protected getTargetLevel(type: FinderTargetType): 17 | 30 | null {
    return this.targetLevelByType[type] ?? null;
  }

  protected hasTargetLevel(type: FinderTargetType): boolean {
    return this.targetLevelByType[type] !== undefined;
  }

  protected hasAnyTargetTypeSelected(): boolean {
    return this.selectedTargetTypeIds.length > 0;
  }

  protected getIncompleteTargetLevelCount(): number {
    return this.selectedTargetTypeIds.reduce((count, type) => {
      return this.hasTargetLevel(type) ? count : count + 1;
    }, 0);
  }

  protected isTargetTypeReady(type: FinderTargetType): boolean {
    return this.isTargetTypeSelected(type) && this.hasTargetLevel(type);
  }

  protected isTargetTypeLevelMissing(type: FinderTargetType): boolean {
    return this.isTargetTypeSelected(type) && !this.hasTargetLevel(type);
  }

  protected getStep2LockReasonKey(): string {
    if (!this.hasAnyTargetTypeSelected()) {
      return 'solutionControls.finder.step1.lockReasonSelectTargetType';
    }

    if (this.getIncompleteTargetLevelCount() > 0) {
      return 'solutionControls.finder.step1.lockReasonSelectTargetLevel';
    }

    return 'solutionControls.finder.locked.constraints';
  }

  protected selectCostLayer(id: CostLayerChoice): void {
    this.selectedCostLayerId = id;
    this.clearResultsIfNeeded();
  }

  protected toggleIncludeOmecs(): void {
    if (!this.isStep2Unlocked()) {
      return;
    }
    this.includeOmecs = !this.includeOmecs;
    this.clearResultsIfNeeded();
  }

  protected toggleIncludeComunidades(): void {
    if (!this.isStep2Unlocked()) {
      return;
    }
    this.includeComunidades = !this.includeComunidades;
    this.clearResultsIfNeeded();
  }

  protected runMatching(): void {
    this.clearLoadingTimer();

    if (!this.canRunMatching()) {
      this.clearResults();
      return;
    }

    this.matchState = 'loading';
    this.loadingTimer = setTimeout(() => {
      this.loadingTimer = null;
      const filtered = this.scenarioLibrary.filter((scenario) =>
        this.scenarioMatchesSelection(scenario),
      );
      this.matchResults = filtered.map((scenario, index) => this.toScenarioMatch(scenario, index));
      this.selectedMatchId = this.matchResults[0]?.id ?? null;
      this.selectedMatch = this.matchResults[0] ?? null;
      this.matchState = 'ready';
    }, 350);
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
    this.selectedTargetTypeIds = [];
    this.targetLevelByType = {};
    this.includeOmecs = false;
    this.includeComunidades = false;
    this.selectedCostLayerId = null;
    this.matchResults = [];
    this.selectedMatchId = null;
    this.selectedMatch = null;
    this.matchState = 'empty';
    this.clearLoadingTimer();
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

  protected getTargetSelectionCount(): number {
    return this.selectedTargetTypeIds.length + this.getSelectedTargetLevelCount();
  }

  protected getVariableConstraintCount(): number {
    let n = 0;
    if (this.includeOmecs) {
      n += 1;
    }
    if (this.includeComunidades) {
      n += 1;
    }
    return n;
  }

  protected getTradeoffSelectionCount(): number {
    return this.selectedCostLayerId !== null ? 1 : 0;
  }

  protected canRunMatching(): boolean {
    return (
      this.selectedTargetTypeIds.length > 0 &&
      this.areAllSelectedTargetsLeveled() &&
      this.selectedCostLayerId !== null
    );
  }

  protected canApplyScenario(): boolean {
    return this.matchState === 'ready' && this.selectedMatchId !== null;
  }

  protected isStep1Complete(): boolean {
    return this.selectedTargetTypeIds.length > 0 && this.areAllSelectedTargetsLeveled();
  }

  protected isStep2Unlocked(): boolean {
    return this.isStep1Complete();
  }

  protected isStep3Locked(): boolean {
    return this.matchState === 'empty';
  }

  protected getApplyActionKey(): string {
    return this.mode === 'comparison-candidate'
      ? 'solutionControls.finder.actions.loadAsCandidateSolution'
      : 'solutionControls.finder.actions.apply';
  }

  private clearResultsIfNeeded(): void {
    this.runMatching();
  }

  private scenarioMatchesSelection(scenario: SolutionScenario): boolean {
    const strategic = scenario.id.startsWith('ESTR');
    if (strategic && !this.hasStrategicTargetSelected()) {
      return false;
    }
    if (!strategic && !this.hasNonStrategicTargetSelected()) {
      return false;
    }

    if (!this.getSelectedTargetLevels().includes(scenario.ecosystemTargets as 17 | 30)) {
      return false;
    }

    const hasOmec = scenario.constraints.includes('OMECs');
    if (hasOmec !== this.includeOmecs) {
      return false;
    }

    const hasComunidades = scenario.constraints.includes('Comunidades');
    if (hasComunidades !== this.includeComunidades) {
      return false;
    }

    const expectedCost = this.mapCostChoiceToCatalog(this.selectedCostLayerId!);
    if (scenario.costLayer !== expectedCost) {
      return false;
    }

    return true;
  }

  protected isTargetTypeSelected(id: FinderTargetType): boolean {
    return this.selectedTargetTypeIds.includes(id);
  }

  protected isTargetTypeAvailable(id: FinderTargetType): boolean {
    return this.targetTypeOptions.find((option) => option.id === id)?.isAvailable === true;
  }

  protected isStrategicOnlyTargetSelection(): boolean {
    return this.selectedTargetTypeIds.length > 0 && !this.hasNonStrategicTargetSelected();
  }

  private hasStrategicTargetSelected(): boolean {
    return this.selectedTargetTypeIds.some((id) => this.isStrategicTarget(id));
  }

  private hasNonStrategicTargetSelected(): boolean {
    return this.selectedTargetTypeIds.some((id) => !this.isStrategicTarget(id));
  }

  protected isStrategicTarget(id: FinderTargetType): boolean {
    return this.targetTypeOptions.find((option) => option.id === id)?.isStrategic === true;
  }

  private areAllSelectedTargetsLeveled(): boolean {
    return this.selectedTargetTypeIds.every((type) => this.hasTargetLevel(type));
  }

  private getSelectedTargetLevelCount(): number {
    return this.selectedTargetTypeIds.reduce((count, type) => {
      return this.hasTargetLevel(type) ? count + 1 : count;
    }, 0);
  }

  private getSelectedTargetLevels(): (17 | 30)[] {
    return this.selectedTargetTypeIds.reduce<(17 | 30)[]>((levels, type) => {
      const targetLevel = this.targetLevelByType[type];
      if (targetLevel !== undefined) {
        levels.push(targetLevel);
      }
      return levels;
    }, []);
  }

  private mapCostChoiceToCatalog(id: CostLayerChoice): string {
    switch (id) {
      case 'human-footprint':
        return 'Human Footprint';
      case 'carbon-opportunity':
        return 'Net Benefit (Renta agropecuaria)';
      case 'conflict':
        return 'Conflict (Coca/Deaths)';
    }
  }

  private toScenarioMatch(scenario: SolutionScenario, index: number): ScenarioMatch {
    return {
      id: this.toScenarioMatchId(scenario.id),
      solutionId: this.mockSolutionIds[index % this.mockSolutionIds.length],
      scenarioId: scenario.id,
      name: scenario.name,
      description: scenario.description,
      mapLabel: scenario.costLayer,
      ecosystemTargets: scenario.ecosystemTargets,
      selectedUnits: scenario.nSelected,
      matchPercentage: 100,
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

  private clearResults(): void {
    this.matchResults = [];
    this.selectedMatchId = null;
    this.selectedMatch = null;
    this.matchState = 'empty';
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

  private syncColumnHeaderHeights(): void {
    const headerElements = this.columnHeaderRefs?.toArray().map((ref) => ref.nativeElement) ?? [];
    if (headerElements.length === 0) {
      return;
    }

    for (const header of headerElements) {
      header.style.minHeight = '0px';
    }

    const maxHeaderHeight = Math.ceil(
      Math.max(...headerElements.map((header) => header.getBoundingClientRect().height)),
    );

    for (const header of headerElements) {
      header.style.minHeight = `${maxHeaderHeight}px`;
    }
  }
}
