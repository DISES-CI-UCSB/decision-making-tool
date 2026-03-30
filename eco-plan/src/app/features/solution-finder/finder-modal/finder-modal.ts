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

type FinderTargetType = 'species-richness' | 'strategic-ecosystems';

type CostLayerChoice = 'human-footprint' | 'carbon-opportunity' | 'conflict';

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

  protected readonly scenarioLibrary: SolutionScenario[] = this.solutionCatalog.getAll();

  /** Step 1 */
  protected targetTypeId: FinderTargetType | null = null;
  protected targetLevelPct: 17 | 30 | null = null;

  /** Step 2A (variable) */
  protected includeOmecs = false;
  protected includeComunidades = false;

  /** Step 2B */
  protected selectedCostLayerId: CostLayerChoice | null = null;

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

  protected selectTargetType(type: FinderTargetType): void {
    if (this.targetTypeId === type) {
      return;
    }
    this.targetTypeId = type;
    if (type === 'strategic-ecosystems') {
      this.targetLevelPct = 30;
    } else {
      this.targetLevelPct = null;
    }
    this.clearResultsIfNeeded();
  }

  protected selectTargetLevel(pct: 17 | 30): void {
    if (this.targetTypeId !== 'species-richness') {
      return;
    }
    this.targetLevelPct = pct;
    this.clearResultsIfNeeded();
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
    if (!this.canRunMatching()) {
      this.matchState = 'empty';
      return;
    }

    this.matchResults = [];
    this.selectedMatchId = null;
    this.selectedMatch = null;
    this.clearLoadingTimer();
    this.clearLoadingStartTimer();
    this.matchState = 'loading';
    const filtered = this.scenarioLibrary.filter((s) => this.scenarioMatchesSelection(s));
    this.matchResults = filtered.map((scenario, index) => this.toScenarioMatch(scenario, index));
    this.selectedMatchId = this.matchResults[0]?.id ?? null;
    this.selectedMatch = this.matchResults[0] ?? null;
    this.matchState = 'ready';
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
    this.targetTypeId = null;
    this.targetLevelPct = null;
    this.includeOmecs = false;
    this.includeComunidades = false;
    this.selectedCostLayerId = null;
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

  protected getTargetSelectionCount(): number {
    if (this.targetTypeId === null) {
      return 0;
    }
    if (this.targetTypeId === 'strategic-ecosystems') {
      return 2;
    }
    return this.targetLevelPct !== null ? 2 : 1;
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
      this.targetTypeId !== null &&
      this.targetLevelPct !== null &&
      this.selectedCostLayerId !== null &&
      this.matchState !== 'loading'
    );
  }

  protected canApplyScenario(): boolean {
    return this.matchState === 'ready' && this.selectedMatchId !== null;
  }

  protected isStep1Complete(): boolean {
    return this.targetTypeId !== null && this.targetLevelPct !== null;
  }

  protected isStep2Unlocked(): boolean {
    return this.isStep1Complete();
  }

  protected isStep3Locked(): boolean {
    return this.matchState === 'empty';
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

  private scenarioMatchesSelection(scenario: SolutionScenario): boolean {
    const strategic = scenario.id.startsWith('ESTR');
    if (this.targetTypeId === 'species-richness' && strategic) {
      return false;
    }
    if (this.targetTypeId === 'strategic-ecosystems' && !strategic) {
      return false;
    }

    if (scenario.ecosystemTargets !== this.targetLevelPct) {
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

  private mapCostChoiceToCatalog(id: CostLayerChoice): string {
    switch (id) {
      case 'human-footprint':
        return 'Human Footprint';
      case 'carbon-opportunity':
        return 'Carbon Opportunity';
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
