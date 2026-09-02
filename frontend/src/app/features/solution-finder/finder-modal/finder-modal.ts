import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  effect,
  inject,
} from '@angular/core';
import type { CatalogSolution } from '@core/models/solution-catalog.model';
import {
  AVAILABLE_SIRAP_REGION_IDS,
  isSirapRegionId,
  type SirapRegionId,
} from '@core/models/sirap-access.model';
import {
  getSolutionIncludeFlags,
  getSolutionHumanFootprintYear,
  getSolutionSpeciesTargetMethod,
  getSolutionTargetLevel,
  getSolutionTargetTypes,
  normalizeSolutionToken,
  type SolutionCostChoice,
  type HumanFootprintYear,
  type SpeciesTargetMethod,
  type SolutionTargetType,
} from '@core/models/solution-matching.utils';
import type {
  FinderSelectionMemory,
  PlanningDomain,
  SavedSolutionScenario,
  SolutionFinderContext,
} from '@core/services/app-state.service';
import { AppStateService } from '@core/services/app-state.service';
import { SavedSolutionScenariosService } from '@core/services/saved-solution-scenarios.service';
import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

type FinderMatchState = 'empty' | 'loading' | 'ready';

type FinderTargetType = SolutionTargetType;
type CostLayerChoice = SolutionCostChoice;
type MarineTargetPercent = 30 | 50;

interface SirapRegionOption {
  id: SirapRegionId;
  labelKey: string;
  departments: string;
}

type SirapStrategicTarget = 17 | 30 | 50 | 100;
type SirapDryForestMode = 'inherit' | 'separate-100';
type SirapWetlandsTarget = 70 | 100;
type SirapSavannasTarget = 17 | 30;

interface SirapTargetTuple {
  id: string;
  strategic: SirapStrategicTarget;
  dryForest?: SirapDryForestMode;
  wetlands?: SirapWetlandsTarget;
  savannas?: SirapSavannasTarget;
}

interface SourceLinkOption {
  labelKey: string;
  urlKey: string;
}

interface TargetTypeOption {
  id: FinderTargetType;
  labelKey: string;
  helpKey: string;
  helpTooltipKey?: string;
  helpTooltipToggleKey?: string;
  sourceLabelKey?: string;
  sourceUrlKey?: string;
  sourceLinks?: readonly SourceLinkOption[];
  isStrategic: boolean;
  isAvailable: boolean;
}

interface SolutionMatch {
  id: string;
  solutionId: string;
  name: string;
  description: string;
  mapLabel: string;
  ecosystemTargets: number;
  selectedUnits: number;
  matchPercentage: number;
  customLabel?: string;
}

type TargetLevelsByType = Partial<Record<FinderTargetType, 17 | 30>>;

@Component({
  selector: 'app-finder-modal',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './finder-modal.html',
  styleUrl: './finder-modal.scss',
})
export class FinderModalComponent implements OnDestroy, OnInit {
  private readonly appState = inject(AppStateService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly savedSolutionScenariosService = inject(SavedSolutionScenariosService);
  private readonly solutionCatalog = inject(SolutionCatalogService);
  private readonly translate = inject(TranslateService);
  private initialized = false;

  constructor() {
    effect(() => {
      const solutions = this.solutionCatalog.solutions();
      if (this.initialized && solutions.length > 0) {
        this.clearLoadingTimer();
        this.loadingTimer = setTimeout(() => {
          this.loadingTimer = null;
          this.runMatching();
          this.changeDetector.detectChanges();
        });
      }
    });
  }
  protected readonly targetTypeOptions: readonly TargetTypeOption[] = [
    {
      id: 'ecosystems',
      labelKey: 'solutionControls.finder.step1.ecosystemsLabel',
      helpKey: 'solutionControls.finder.step1.ecosystemsHelp',
      sourceLinks: [
        {
          labelKey: 'solutionControls.finder.step1.ecosystemsOverviewSourceLabel',
          urlKey: 'solutionControls.finder.step1.ecosystemsOverviewSourceUrl',
        },
        {
          labelKey: 'solutionControls.finder.step1.ecosystemsDataSourceLabel',
          urlKey: 'solutionControls.finder.step1.ecosystemsDataSourceUrl',
        },
      ],
      isStrategic: false,
      isAvailable: true,
    },
    {
      id: 'strategic-ecosystems',
      labelKey: 'solutionControls.finder.step1.strategicEcosystemsLabel',
      helpKey: 'solutionControls.finder.step1.strategicEcosystemsHelp',
      sourceLinks: [
        {
          labelKey: 'solutionControls.finder.step1.strategicEcosystemsSiacSourceLabel',
          urlKey: 'solutionControls.finder.step1.strategicEcosystemsSiacSourceUrl',
        },
        {
          labelKey: 'solutionControls.finder.step1.strategicEcosystemsInvemarSourceLabel',
          urlKey: 'solutionControls.finder.step1.strategicEcosystemsInvemarSourceUrl',
        },
      ],
      isStrategic: true,
      isAvailable: true,
    },
    {
      id: 'species-richness',
      labelKey: 'solutionControls.finder.step1.speciesRichnessLabel',
      helpKey: 'solutionControls.finder.step1.speciesRichnessHelp',
      helpTooltipKey: 'solutionControls.finder.step1.speciesRichnessTechnicalHelp',
      helpTooltipToggleKey: 'solutionControls.finder.step1.speciesRichnessTechnicalHelpToggle',
      sourceLinks: [
        {
          labelKey: 'solutionControls.finder.step1.speciesRichnessBioModelosSourceLabel',
          urlKey: 'solutionControls.finder.step1.speciesRichnessBioModelosSourceUrl',
        },
      ],
      isStrategic: false,
      isAvailable: true,
    },
    {
      id: 'ecosystem-services',
      labelKey: 'solutionControls.finder.step1.ecosystemServicesLabel',
      helpKey: 'solutionControls.finder.step1.ecosystemServicesHelp',
      sourceLinks: [
        {
          labelKey: 'solutionControls.finder.step1.ecosystemServicesCarbonSourceLabel',
          urlKey: 'solutionControls.finder.step1.ecosystemServicesCarbonSourceUrl',
        },
        {
          labelKey: 'solutionControls.finder.step1.ecosystemServicesWaterSourceLabel',
          urlKey: 'solutionControls.finder.step1.ecosystemServicesWaterSourceUrl',
        },
      ],
      isStrategic: false,
      isAvailable: true,
    },
  ];

  @Input() mode: SolutionFinderContext = 'default';
  @Output() readonly closeRequested = new EventEmitter<void>();
  @Output() readonly solutionApplied = new EventEmitter<SolutionMatch>();

  protected readonly showScopeBar = this.appState.canAccessSirapScope;
  protected readonly activeSolution = this.appState.activeSolution$;
  protected readonly savedSolutionScenarios = this.appState.savedSolutionScenarios$;
  protected readonly finderSelectionMemory = this.appState.finderSelectionMemory$;
  protected savedScenarioSearchQuery = '';
  protected selectedDomain: PlanningDomain = 'land';
  protected selectedScope: 'nacional' | 'sirap' = 'nacional';
  protected selectedSirapRegion: SirapRegionId | null = null;
  protected sirapStrategicTarget: SirapStrategicTarget | null = null;
  protected sirapDryForestMode: SirapDryForestMode | null = null;
  protected sirapWetlandsTarget: SirapWetlandsTarget | null = null;
  protected sirapSavannasTarget: SirapSavannasTarget | null = null;
  protected sirapIncludeOmecs = false;
  protected sirapCostYear: HumanFootprintYear = 2022;

  protected readonly sirapRegions: readonly SirapRegionOption[] = [
    {
      id: 'eje-cafetero',
      labelKey: 'solutionControls.finder.scopeBar.regions.ejeCafetero',
      departments: 'Caldas, Quindío, Risaralda',
    },
    {
      id: 'orinoquia',
      labelKey: 'solutionControls.finder.scopeBar.regions.orinoquia',
      departments: 'Arauca, Meta, Vichada, Casanare',
    },
  ];

  protected accessibleSirapRegions(): readonly SirapRegionOption[] {
    const accessibleIds = this.appState.accessibleSirapIds();
    return this.sirapRegions.filter(
      (region) =>
        AVAILABLE_SIRAP_REGION_IDS.includes(region.id) && accessibleIds.includes(region.id),
    );
  }

  protected isSirapSelection(): boolean {
    return this.selectedDomain === 'land' && this.selectedScope === 'sirap';
  }

  protected certifiedSirapSolutions(): SolutionMatch[] {
    if (!this.selectedSirapRegion) {
      return [];
    }

    return this.solutionCatalog
      .getAll()
      .filter((solution) => this.userCanAccessSolution(solution))
      .filter(
        (solution) =>
          this.getSolutionDomain(solution) === 'land' &&
          normalizeSolutionToken(solution.finderInputs.scope || solution.scope) === 'sirap' &&
          solution.sirapId === this.selectedSirapRegion,
      )
      .map((solution) => this.toSolutionMatch(solution));
  }

  protected sirapTargetTuples(): SirapTargetTuple[] {
    const tuples = new Map<string, SirapTargetTuple>();
    for (const solution of this.certifiedSirapCatalogSolutions()) {
      const tuple = this.parseSirapTargetTuple(solution);
      if (tuple) {
        tuples.set(tuple.id, tuple);
      }
    }
    return [...tuples.values()];
  }

  protected selectSirapStrategicTarget(target: SirapStrategicTarget): void {
    const matchingTuples = this.sirapTargetTuples().filter((tuple) => tuple.strategic === target);
    if (matchingTuples.length === 0) {
      return;
    }
    this.sirapStrategicTarget = target;
    if (this.selectedSirapRegion === 'eje-cafetero') {
      const currentTuple = matchingTuples.find(
        (tuple) =>
          tuple.dryForest === this.sirapDryForestMode &&
          tuple.wetlands === this.sirapWetlandsTarget,
      );
      const nextTuple = currentTuple ?? matchingTuples[0];
      this.sirapDryForestMode = nextTuple.dryForest ?? null;
      this.sirapWetlandsTarget = nextTuple.wetlands ?? null;
    } else if (this.selectedSirapRegion === 'orinoquia') {
      const currentTuple = matchingTuples.find(
        (tuple) => tuple.savannas === this.sirapSavannasTarget,
      );
      this.sirapSavannasTarget = (currentTuple ?? matchingTuples[0]).savannas ?? null;
    }
    this.runMatching();
  }

  protected isSirapStrategicTargetAvailable(target: SirapStrategicTarget): boolean {
    return this.sirapTargetTuples().some((tuple) => tuple.strategic === target);
  }

  protected selectSirapDryForestMode(mode: SirapDryForestMode): void {
    if (
      this.selectedSirapRegion !== 'eje-cafetero' ||
      !this.sirapStrategicTarget ||
      !this.sirapTargetTuples().some(
        (tuple) => tuple.strategic === this.sirapStrategicTarget && tuple.dryForest === mode,
      )
    ) {
      return;
    }
    this.sirapDryForestMode = mode;
    const matchingTuples = this.sirapTargetTuples().filter(
      (tuple) => tuple.strategic === this.sirapStrategicTarget && tuple.dryForest === mode,
    );
    if (!matchingTuples.some((tuple) => tuple.wetlands === this.sirapWetlandsTarget)) {
      this.sirapWetlandsTarget = matchingTuples[0]?.wetlands ?? null;
    }
    this.runMatching();
  }

  protected selectSirapWetlandsTarget(target: SirapWetlandsTarget): void {
    if (
      this.selectedSirapRegion !== 'eje-cafetero' ||
      !this.sirapStrategicTarget ||
      !this.sirapDryForestMode ||
      !this.sirapTargetTuples().some(
        (tuple) =>
          tuple.strategic === this.sirapStrategicTarget &&
          tuple.dryForest === this.sirapDryForestMode &&
          tuple.wetlands === target,
      )
    ) {
      return;
    }
    this.sirapWetlandsTarget = target;
    this.runMatching();
  }

  protected selectSirapSavannasTarget(target: SirapSavannasTarget): void {
    if (
      this.selectedSirapRegion !== 'orinoquia' ||
      !this.sirapStrategicTarget ||
      !this.sirapTargetTuples().some(
        (tuple) => tuple.strategic === this.sirapStrategicTarget && tuple.savannas === target,
      )
    ) {
      return;
    }
    this.sirapSavannasTarget = target;
    this.runMatching();
  }

  protected toggleSirapIncludeOmecs(): void {
    this.sirapIncludeOmecs = !this.sirapIncludeOmecs;
    this.runMatching();
  }

  protected selectSirapCostYear(year: HumanFootprintYear): void {
    this.sirapCostYear = year;
    this.runMatching();
  }

  /** Step 1 */
  protected selectedTargetTypeIds: FinderTargetType[] = ['ecosystems'];
  protected targetLevelByType: TargetLevelsByType = { ecosystems: 17 };
  protected speciesTargetMethod: SpeciesTargetMethod | null = null;

  /** Step 2A (variable) */
  protected includeOmecs = false;

  /** Step 2B */
  protected selectedCostLayerId: CostLayerChoice | null = 'human-footprint';
  protected humanFootprintYear: HumanFootprintYear = 2022;

  /** Marine draft */
  protected marineTargetPercent: MarineTargetPercent = 30;
  protected marineIncludeOmecs = false;

  protected matchState: FinderMatchState = 'empty';
  protected matchResults: SolutionMatch[] = [];
  protected selectedMatchId: string | null = null;
  protected selectedMatch: SolutionMatch | null = null;

  private loadingTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.restoreRememberedSelections();
    this.initialized = true;
  }

  ngOnDestroy(): void {
    this.clearLoadingTimer();
  }

  protected toggleTargetType(type: FinderTargetType): void {
    const option = this.targetTypeOptions.find((item) => item.id === type);
    if (!option || !this.isTargetTypeAvailable(type) || type === 'ecosystems') {
      return;
    }
    const currentIndex = this.selectedTargetTypeIds.indexOf(type);
    if (currentIndex >= 0) {
      this.selectedTargetTypeIds.splice(currentIndex, 1);
      delete this.targetLevelByType[type];
      if (type === 'strategic-ecosystems') {
        this.clearTargetType('species-richness');
        this.clearTargetType('ecosystem-services');
      } else if (type === 'species-richness') {
        this.speciesTargetMethod = null;
        this.clearTargetType('ecosystem-services');
      }
    } else {
      this.selectedTargetTypeIds.push(type);
    }

    this.clearResultsIfNeeded();
    this.rememberCurrentSelections();
  }

  protected selectDomain(domain: PlanningDomain): void {
    if (domain === this.selectedDomain) {
      return;
    }

    this.selectedDomain = domain;
    this.clearResults();
    this.rememberCurrentSelections();
    this.runMatching();
  }

  protected selectMarineTargetPercent(percent: MarineTargetPercent): void {
    this.marineTargetPercent = percent;
    this.runMatching();
    this.rememberCurrentSelections();
  }

  protected toggleMarineIncludeOmecs(): void {
    this.marineIncludeOmecs = !this.marineIncludeOmecs;
    this.runMatching();
    this.rememberCurrentSelections();
  }

  protected selectTargetLevel(type: FinderTargetType, pct: 17 | 30): void {
    if (!this.isTargetTypeSelected(type) || !this.isTargetTypeAvailable(type)) {
      return;
    }
    this.targetLevelByType[type] = pct;
    if (type === 'species-richness') {
      this.speciesTargetMethod = pct === 17 ? 'representation-17' : 'representation-30';
    }
    this.clearResultsIfNeeded();
    this.rememberCurrentSelections();
  }

  protected getTargetLevel(type: FinderTargetType): 17 | 30 | null {
    return this.targetLevelByType[type] ?? null;
  }

  protected getTargetCoverageQuestion(type: FinderTargetType): string {
    if (this.translate.getCurrentLang() === 'es') {
      return this.translate.instant('solutionControls.finder.step1.coverageLevelLabel');
    }

    const questions: Record<FinderTargetType, string> = {
      ecosystems: 'What proportion of each type of ecosystem would you like to conserve?',
      'strategic-ecosystems':
        'What proportion of each strategic ecosystem would you like to conserve?',
      'species-richness': 'What proportion of each species’ range would you like to conserve?',
      'ecosystem-services':
        'What proportion of Colombia’s carbon storage and high-potential groundwater recharge areas would you like to conserve?',
    };
    return questions[type];
  }

  protected selectSpeciesTargetMethod(method: SpeciesTargetMethod): void {
    if (!this.isTargetTypeSelected('species-richness')) {
      return;
    }
    this.speciesTargetMethod = method;
    if (method === 'national-responsibility') {
      delete this.targetLevelByType['species-richness'];
    } else {
      this.targetLevelByType['species-richness'] = method === 'representation-17' ? 17 : 30;
    }
    this.clearResultsIfNeeded();
    this.rememberCurrentSelections();
  }

  protected selectHumanFootprintYear(year: HumanFootprintYear): void {
    this.humanFootprintYear = year;
    this.selectedCostLayerId = 'human-footprint';
    this.clearResultsIfNeeded();
    this.rememberCurrentSelections();
  }

  protected hasTargetLevel(type: FinderTargetType): boolean {
    return type === 'species-richness'
      ? this.speciesTargetMethod !== null
      : this.targetLevelByType[type] !== undefined;
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

  protected isCostLayerAvailable(id: CostLayerChoice): boolean {
    return id === 'human-footprint';
  }

  protected selectCostLayer(id: CostLayerChoice): void {
    if (id !== 'human-footprint' || !this.isCostLayerAvailable(id)) {
      return;
    }
    this.selectedCostLayerId = id;
    this.clearResultsIfNeeded();
    this.rememberCurrentSelections();
  }

  protected toggleIncludeOmecs(): void {
    if (!this.isStep2Unlocked()) {
      return;
    }
    this.includeOmecs = !this.includeOmecs;
    this.clearResultsIfNeeded();
    this.rememberCurrentSelections();
  }

  protected runMatching(): void {
    this.clearLoadingTimer();

    if (this.isSirapSelection()) {
      this.runCertifiedSirapSelection();
      return;
    }

    if (!this.canRunMatching()) {
      this.clearResults();
      return;
    }

    this.matchResults = [];
    this.selectedMatchId = null;
    this.selectedMatch = null;
    this.matchState = 'loading';
    const filtered = this.solutionCatalog
      .getAll()
      .filter((solution) => this.userCanAccessSolution(solution))
      .filter((solution) => this.solutionMatchesSelection(solution));
    this.matchResults = filtered.map((solution) => this.toSolutionMatch(solution));
    this.selectedMatchId = this.matchResults.length === 1 ? this.matchResults[0].id : null;
    this.selectedMatch = this.matchResults.length === 1 ? this.matchResults[0] : null;
    this.matchState = 'ready';
  }

  protected selectScope(scope: 'nacional' | 'sirap'): void {
    if (scope === 'sirap' && !this.appState.canAccessSirapScope()) {
      return;
    }
    if (scope === this.selectedScope) return;
    this.selectedScope = scope;
    this.selectedSirapRegion = null;
    this.clearSirapSelections();
    this.clearSelections({ remember: true });
    this.runMatching();
  }

  protected selectSirapRegion(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const accessibleIds = this.appState.accessibleSirapIds();
    this.selectedSirapRegion =
      this.isFinderSupportedSirapRegion(value) && accessibleIds.includes(value) ? value : null;
    this.clearSirapSelections();
    this.initializeSirapDefaults();
    this.clearSelections({ remember: true });
    this.runMatching();
  }

  protected updateSavedScenarioSearchQuery(query: string): void {
    this.savedScenarioSearchQuery = query;
  }

  protected clearSavedScenarioSearchQuery(): void {
    this.savedScenarioSearchQuery = '';
  }

  protected hasSavedSolutionScenarios(): boolean {
    return this.savedSolutionScenarios().length > 0;
  }

  protected filteredSavedSolutionScenarios(): SavedSolutionScenario[] {
    const query = this.savedScenarioSearchQuery.trim().toLowerCase();
    if (!query) {
      return this.savedSolutionScenarios();
    }

    return this.savedSolutionScenarios().filter((scenario) =>
      [scenario.label, scenario.solutionName, scenario.solutionId]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }

  protected applySavedSolutionScenario(scenario: SavedSolutionScenario): void {
    const solution = this.solutionCatalog.getById(scenario.solutionId);
    if (!solution || !this.userCanAccessSolution(solution)) {
      return;
    }

    this.clearLoadingTimer();
    this.restoreSelectionsFromSolution(solution);
    const match = {
      ...this.toSolutionMatch(solution),
      customLabel: scenario.label,
    };
    this.matchResults = [match];
    this.selectedMatchId = match.id;
    this.selectedMatch = match;
    this.matchState = 'ready';
    this.rememberCurrentSelections();
  }

  protected async removeSavedSolutionScenario(
    event: Event,
    scenario: SavedSolutionScenario,
  ): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    await this.savedSolutionScenariosService.removeScenario(scenario.solutionId);
  }

  protected resetSelections(): void {
    this.clearSelections({ remember: false });
    this.clearSirapSelections();
    this.marineTargetPercent = 30;
    this.marineIncludeOmecs = false;
    this.appState.clearFinderSelectionMemory();
    this.runMatching();
  }

  private clearSelections(options: { remember: boolean }): void {
    this.selectedTargetTypeIds = ['ecosystems'];
    this.targetLevelByType = { ecosystems: 17 };
    this.speciesTargetMethod = null;
    this.includeOmecs = false;
    this.selectedCostLayerId = 'human-footprint';
    this.humanFootprintYear = 2022;
    this.matchResults = [];
    this.selectedMatchId = null;
    this.selectedMatch = null;
    this.matchState = 'empty';
    this.clearLoadingTimer();
    if (options.remember) {
      this.rememberCurrentSelections();
    }
  }

  protected requestClose(): void {
    this.closeRequested.emit();
  }

  protected applySelectedSolution(): void {
    const selectedMatch = this.selectedMatch;
    if (!selectedMatch) {
      return;
    }
    if (this.isSelectedMatchBaselineSolution()) {
      return;
    }

    this.solutionApplied.emit(selectedMatch);
    this.closeRequested.emit();
  }

  protected getTargetSelectionCount(): number {
    if (this.selectedDomain === 'marine') {
      return 1;
    }
    return this.selectedTargetTypeIds.length + this.getSelectedTargetLevelCount();
  }

  protected getVariableConstraintCount(): number {
    if (this.selectedDomain === 'marine') {
      return this.marineIncludeOmecs ? 1 : 0;
    }
    return this.includeOmecs ? 1 : 0;
  }

  protected getTradeoffSelectionCount(): number {
    if (this.selectedDomain === 'marine') {
      return 1;
    }
    return this.selectedCostLayerId !== null ? 1 : 0;
  }

  protected canRunMatching(): boolean {
    if (this.selectedDomain === 'marine') {
      return true;
    }
    return (
      this.isTargetTypeSelected('ecosystems') &&
      this.areAllSelectedTargetsLeveled() &&
      this.selectedCostLayerId === 'human-footprint'
    );
  }

  protected canApplySolution(): boolean {
    return (
      this.matchState === 'ready' &&
      this.selectedMatchId !== null &&
      this.selectedMatch !== null &&
      this.isSelectedMatchCurrentAndAccessible() &&
      !this.isSelectedMatchBaselineSolution()
    );
  }

  protected isStep1Complete(): boolean {
    if (this.selectedDomain === 'marine') {
      return true;
    }
    return this.isTargetTypeSelected('ecosystems') && this.areAllSelectedTargetsLeveled();
  }

  protected isStep2Unlocked(): boolean {
    return this.isStep1Complete();
  }

  protected isStep3Locked(): boolean {
    return this.matchState === 'empty';
  }

  protected getApplyActionKey(): string {
    return this.mode === 'comparison-candidate'
      ? 'solutionControls.finder.actions.useAsSolutionB'
      : 'solutionControls.finder.actions.apply';
  }

  protected isSelectedMatchBaselineSolution(): boolean {
    const selectedMatch = this.selectedMatch;
    return (
      this.mode === 'comparison-candidate' &&
      selectedMatch !== null &&
      selectedMatch.solutionId === this.getComparisonBaselineSolutionId()
    );
  }

  private clearResultsIfNeeded(): void {
    this.runMatching();
  }

  private runCertifiedSirapSelection(): void {
    this.clearResults();
    if (!this.selectedSirapRegion || !this.isSirapStep1Complete()) {
      return;
    }

    this.matchResults = this.certifiedSirapCatalogSolutions()
      .filter((solution) => {
        const tuple = this.parseSirapTargetTuple(solution);
        const basename = this.sirapSolutionBasename(solution);
        return (
          tuple !== null &&
          this.sirapTupleMatchesSelection(tuple) &&
          this.solutionIncludesSirapOmecs(basename) === this.sirapIncludeOmecs &&
          this.solutionSirapCostYear(basename) === this.sirapCostYear
        );
      })
      .map((solution) => this.toSolutionMatch(solution));
    this.selectedMatchId = this.matchResults.length === 1 ? this.matchResults[0].id : null;
    this.selectedMatch = this.matchResults.length === 1 ? this.matchResults[0] : null;
    this.matchState = 'ready';
  }

  private clearSirapSelections(): void {
    this.sirapStrategicTarget = null;
    this.sirapDryForestMode = null;
    this.sirapWetlandsTarget = null;
    this.sirapSavannasTarget = null;
    this.sirapIncludeOmecs = false;
    this.sirapCostYear = 2022;
  }

  private initializeSirapDefaults(): void {
    if (this.selectedSirapRegion === 'eje-cafetero') {
      this.sirapStrategicTarget = 17;
      this.sirapDryForestMode = 'inherit';
      this.sirapWetlandsTarget = 70;
    } else if (this.selectedSirapRegion === 'orinoquia') {
      this.sirapStrategicTarget = 17;
      this.sirapSavannasTarget = 17;
    }
  }

  private solutionIncludesSirapOmecs(solutionName: string): boolean {
    return /(?:^|\+)OMEC(?:_|$)/.test(solutionName);
  }

  private solutionSirapCostYear(solutionName: string): HumanFootprintYear | null {
    const match = /_IHEH(2022|2030)(?:\.tif)?$/i.exec(solutionName);
    return match ? (Number(match[1]) as HumanFootprintYear) : null;
  }

  protected isSirapStep1Complete(): boolean {
    if (this.selectedSirapRegion === 'eje-cafetero') {
      return (
        this.sirapStrategicTarget !== null &&
        this.sirapDryForestMode !== null &&
        this.sirapWetlandsTarget !== null &&
        this.sirapTargetTuples().some((tuple) => this.sirapTupleMatchesSelection(tuple))
      );
    }
    if (this.selectedSirapRegion === 'orinoquia') {
      return (
        this.sirapStrategicTarget !== null &&
        this.sirapSavannasTarget !== null &&
        this.sirapTargetTuples().some((tuple) => this.sirapTupleMatchesSelection(tuple))
      );
    }
    return false;
  }

  protected isSirapDryForestModeAvailable(mode: SirapDryForestMode): boolean {
    return (
      this.sirapStrategicTarget !== null &&
      this.sirapTargetTuples().some(
        (tuple) => tuple.strategic === this.sirapStrategicTarget && tuple.dryForest === mode,
      )
    );
  }

  protected isSirapWetlandsTargetAvailable(target: SirapWetlandsTarget): boolean {
    return (
      this.sirapStrategicTarget !== null &&
      this.sirapDryForestMode !== null &&
      this.sirapTargetTuples().some(
        (tuple) =>
          tuple.strategic === this.sirapStrategicTarget &&
          tuple.dryForest === this.sirapDryForestMode &&
          tuple.wetlands === target,
      )
    );
  }

  private certifiedSirapCatalogSolutions(): CatalogSolution[] {
    if (!this.selectedSirapRegion) {
      return [];
    }
    return this.solutionCatalog
      .getAll()
      .filter((solution) => this.userCanAccessSolution(solution))
      .filter(
        (solution) =>
          this.getSolutionDomain(solution) === 'land' &&
          normalizeSolutionToken(solution.finderInputs.scope || solution.scope) === 'sirap' &&
          solution.sirapId === this.selectedSirapRegion,
      );
  }

  private parseSirapTargetTuple(solution: CatalogSolution): SirapTargetTuple | null {
    const basename = this.sirapSolutionBasename(solution);
    const targetPart = basename.split('_IHEH')[0];
    const strategic = this.sirapTokenValue(targetPart, 'Estr');
    if (![17, 30, 50, 100].includes(strategic ?? -1)) {
      return null;
    }

    if (solution.sirapId === 'eje-cafetero') {
      const dryForest = this.sirapTokenValue(targetPart, 'Bs');
      const wetlands = this.sirapTokenValue(targetPart, 'HuEC');
      const tuple: SirapTargetTuple = {
        id: [strategic, dryForest === 100 ? 'separate-100' : 'inherit', wetlands].join(':'),
        strategic: strategic as SirapStrategicTarget,
        dryForest: dryForest === 100 ? 'separate-100' : 'inherit',
        wetlands: wetlands as SirapWetlandsTarget,
      };
      return this.isCertifiedEjeTuple(tuple) ? tuple : null;
    }

    if (solution.sirapId === 'orinoquia') {
      const congriales = this.sirapTokenValue(targetPart, 'Cong');
      const savannas = this.sirapTokenValue(targetPart, 'Sab');
      const tuple: SirapTargetTuple = {
        id: [strategic, savannas].join(':'),
        strategic: strategic as SirapStrategicTarget,
        savannas: savannas as SirapSavannasTarget,
      };
      return congriales === strategic && this.isCertifiedOrinoquiaTuple(tuple) ? tuple : null;
    }
    return null;
  }

  private sirapSolutionBasename(solution: CatalogSolution): string {
    const candidate = solution.filename || solution.name;
    return (
      candidate
        .split('/')
        .pop()
        ?.replace(/\.tif$/i, '') ?? solution.name
    );
  }

  private sirapTokenValue(value: string, token: string): number | null {
    const match = new RegExp(`(?:^|\\+)${token}(\\d+)(?:\\+|_|$)`).exec(value);
    return match ? Number(match[1]) : null;
  }

  private isCertifiedEjeTuple(tuple: SirapTargetTuple): boolean {
    const allowed = new Set([
      '17:separate-100:70',
      '17:separate-100:100',
      '17:inherit:70',
      '17:inherit:100',
      '30:separate-100:70',
      '30:separate-100:100',
      '30:inherit:70',
      '30:inherit:100',
      '50:inherit:100',
      '100:inherit:70',
    ]);
    return allowed.has(tuple.id);
  }

  private isCertifiedOrinoquiaTuple(tuple: SirapTargetTuple): boolean {
    return new Set(['17:17', '17:30', '30:17', '30:30']).has(tuple.id);
  }

  private sirapTupleMatchesSelection(tuple: SirapTargetTuple): boolean {
    if (tuple.strategic !== this.sirapStrategicTarget) {
      return false;
    }
    return this.selectedSirapRegion === 'eje-cafetero'
      ? tuple.dryForest === this.sirapDryForestMode && tuple.wetlands === this.sirapWetlandsTarget
      : tuple.savannas === this.sirapSavannasTarget;
  }

  private restoreRememberedSelections(): void {
    const rememberedSelection = this.finderSelectionMemory();
    if (!rememberedSelection) {
      return;
    }

    this.selectedDomain = rememberedSelection.planningDomain;
    this.selectedScope = rememberedSelection.selectedScope;
    this.selectedSirapRegion = rememberedSelection.selectedSirapRegion as SirapRegionId | null;
    this.selectedTargetTypeIds = rememberedSelection.selectedTargetTypeIds.filter((id) =>
      this.isFinderTargetType(id),
    );
    this.targetLevelByType = this.toTargetLevelsByType(rememberedSelection.targetLevelByType);
    this.speciesTargetMethod = this.normalizeSpeciesTargetMethod(
      rememberedSelection.speciesTargetMethod,
      this.targetLevelByType['species-richness'],
    );
    this.includeOmecs = rememberedSelection.includeOmecs;
    this.selectedCostLayerId = 'human-footprint';
    this.humanFootprintYear = rememberedSelection.humanFootprintYear === 2030 ? 2030 : 2022;
    this.marineTargetPercent = rememberedSelection.marineTargetPercent;
    this.marineIncludeOmecs = rememberedSelection.marineIncludeOmecs;
    this.normalizeLandSelection();
  }

  private rememberCurrentSelections(): void {
    this.appState.setFinderSelectionMemory({
      planningDomain: this.selectedDomain,
      selectedScope: this.selectedScope,
      selectedSirapRegion: this.selectedSirapRegion,
      selectedTargetTypeIds: [...this.selectedTargetTypeIds],
      targetLevelByType: { ...this.targetLevelByType } as Record<string, 17 | 30>,
      speciesTargetMethod: this.speciesTargetMethod,
      includeOmecs: this.includeOmecs,
      includeComunidades: false,
      includeResguardos: false,
      selectedCostLayerId: this.selectedCostLayerId,
      humanFootprintYear: this.humanFootprintYear,
      marineTargetPercent: this.marineTargetPercent,
      marineIncludeOmecs: this.marineIncludeOmecs,
    });
  }

  private restoreSelectionsFromSolution(solution: CatalogSolution): void {
    this.selectedDomain = this.getSolutionDomain(solution);
    if (this.selectedDomain === 'marine') {
      const targetPercent = solution.finderInputs.targetPercent;
      this.marineTargetPercent = targetPercent === 50 ? 50 : 30;
      this.marineIncludeOmecs = getSolutionIncludeFlags(solution).omecs;
      return;
    }

    const normalizedScope = normalizeSolutionToken(solution.finderInputs.scope || solution.scope);
    this.selectedScope = normalizedScope === 'sirap' ? 'sirap' : 'nacional';
    this.selectedSirapRegion =
      this.selectedScope === 'sirap' && this.isFinderSupportedSirapRegion(solution.sirapId)
        ? solution.sirapId
        : null;

    if (this.selectedScope === 'sirap') {
      this.clearSirapSelections();
      this.selectedSirapRegion = this.isFinderSupportedSirapRegion(solution.sirapId)
        ? solution.sirapId
        : null;
      const tuple = this.parseSirapTargetTuple(solution);
      if (tuple) {
        this.sirapStrategicTarget = tuple.strategic;
        this.sirapDryForestMode = tuple.dryForest ?? null;
        this.sirapWetlandsTarget = tuple.wetlands ?? null;
        this.sirapSavannasTarget = tuple.savannas ?? null;
      }
      const basename = this.sirapSolutionBasename(solution);
      this.sirapIncludeOmecs = this.solutionIncludesSirapOmecs(basename);
      this.sirapCostYear = this.solutionSirapCostYear(basename) ?? 2022;
      return;
    }

    this.selectedTargetTypeIds = this.targetTypeOptions
      .map((option) => option.id)
      .filter((type) => getSolutionTargetTypes(solution).has(type));

    this.targetLevelByType = this.selectedTargetTypeIds.reduce<TargetLevelsByType>(
      (levels, type) => {
        const level = getSolutionTargetLevel(solution, type);
        if (level) {
          levels[type] = level;
        }
        return levels;
      },
      {},
    );
    this.speciesTargetMethod = getSolutionSpeciesTargetMethod(solution);

    const includes = getSolutionIncludeFlags(solution);
    this.includeOmecs = includes.omecs;

    this.selectedCostLayerId = 'human-footprint';
    this.humanFootprintYear = getSolutionHumanFootprintYear(solution) ?? 2022;
    this.normalizeLandSelection();
  }

  private isFinderTargetType(value: string): value is FinderTargetType {
    return this.targetTypeOptions.some((option) => option.id === value);
  }

  private normalizeSpeciesTargetMethod(
    method: FinderSelectionMemory['speciesTargetMethod'],
    legacyLevel: 17 | 30 | undefined,
  ): SpeciesTargetMethod | null {
    if (
      method === 'representation-17' ||
      method === 'representation-30' ||
      method === 'national-responsibility'
    ) {
      return method;
    }
    return legacyLevel === 17
      ? 'representation-17'
      : legacyLevel === 30
        ? 'representation-30'
        : null;
  }

  private normalizeLandSelection(): void {
    const accessibleIds = this.appState.accessibleSirapIds();
    if (
      this.selectedScope === 'sirap' &&
      (!this.selectedSirapRegion ||
        !accessibleIds.includes(this.selectedSirapRegion) ||
        !this.isFinderSupportedSirapRegion(this.selectedSirapRegion))
    ) {
      this.selectedScope = 'nacional';
      this.selectedSirapRegion = null;
    }
    if (this.selectedScope === 'sirap') {
      this.initializeSirapDefaults();
    }

    if (!this.selectedTargetTypeIds.includes('ecosystems')) {
      this.selectedTargetTypeIds.unshift('ecosystems');
    }
    if (this.targetLevelByType.ecosystems !== 17 && this.targetLevelByType.ecosystems !== 30) {
      this.targetLevelByType.ecosystems = 17;
    }

    if (!this.selectedTargetTypeIds.includes('strategic-ecosystems')) {
      this.clearTargetType('species-richness');
      this.clearTargetType('ecosystem-services');
    }
    if (!this.selectedTargetTypeIds.includes('species-richness') || !this.speciesTargetMethod) {
      this.clearTargetType('species-richness');
      this.clearTargetType('ecosystem-services');
    }
    if (
      this.selectedTargetTypeIds.includes('ecosystem-services') &&
      !this.targetLevelByType['ecosystem-services']
    ) {
      this.clearTargetType('ecosystem-services');
    }
  }

  private clearTargetType(type: FinderTargetType): void {
    this.selectedTargetTypeIds = this.selectedTargetTypeIds.filter((id) => id !== type);
    delete this.targetLevelByType[type];
    if (type === 'species-richness') {
      this.speciesTargetMethod = null;
    }
  }

  private isSirapRegionId(value: string | null): value is SirapRegionId {
    return isSirapRegionId(value);
  }

  private isFinderSupportedSirapRegion(value: unknown): value is SirapRegionId {
    return isSirapRegionId(value) && AVAILABLE_SIRAP_REGION_IDS.includes(value);
  }

  private toTargetLevelsByType(
    levels: FinderSelectionMemory['targetLevelByType'],
  ): TargetLevelsByType {
    return Object.entries(levels).reduce<TargetLevelsByType>((acc, [key, value]) => {
      if (this.isFinderTargetType(key) && (value === 17 || value === 30)) {
        acc[key] = value;
      }
      return acc;
    }, {});
  }

  private getComparisonBaselineSolutionId(): string | null {
    const activeSolution = this.activeSolution();
    if (!activeSolution) {
      return null;
    }
    const metadataSolutionId = activeSolution.metadata?.['solutionId'];
    return typeof metadataSolutionId === 'string' ? metadataSolutionId : activeSolution.id;
  }

  private solutionMatchesSelection(solution: CatalogSolution): boolean {
    if (this.getSolutionDomain(solution) !== this.selectedDomain) {
      return false;
    }

    if (this.selectedDomain === 'marine') {
      return this.marineSolutionMatchesSelection(solution);
    }

    if (this.isSirapSelection()) {
      return (
        normalizeSolutionToken(solution.finderInputs.scope || solution.scope) === 'sirap' &&
        solution.sirapId === this.selectedSirapRegion &&
        this.userCanAccessSolution(solution)
      );
    }

    if (!this.solutionScopeMatchesSelection(solution)) {
      return false;
    }

    if (!this.solutionTargetTypesMatchSelection(solution)) {
      return false;
    }

    if (!this.solutionTargetLevelsMatchSelection(solution)) {
      return false;
    }

    const includes = getSolutionIncludeFlags(solution);
    if (!includes.runap || includes.omecs !== this.includeOmecs) {
      return false;
    }

    if (includes.comunidades || includes.resguardos) {
      return false;
    }

    if (!this.solutionCostMatchesSelection(solution)) {
      return false;
    }

    return true;
  }

  private marineSolutionMatchesSelection(solution: CatalogSolution): boolean {
    const finderInputs = solution.finderInputs;
    const includes = getSolutionIncludeFlags(solution);
    const costLayerId = normalizeSolutionToken(
      finderInputs.costLayerId ?? solution.inputLayerIds.cost ?? '',
    );

    return (
      normalizeSolutionToken(finderInputs.scope || solution.scope) === 'marine' &&
      normalizeSolutionToken(finderInputs.targetFeatureSet ?? '') ===
        'marine-ecosystems-and-mangroves' &&
      finderInputs.targetPercent === this.marineTargetPercent &&
      (costLayerId === 'hhm' || costLayerId === 'cost-hhm') &&
      includes.runap &&
      includes.omecs === this.marineIncludeOmecs &&
      !includes.comunidades &&
      !includes.resguardos
    );
  }

  private getSolutionDomain(solution: CatalogSolution): PlanningDomain {
    return solution.domain ?? solution.finderInputs.domain ?? 'land';
  }

  protected isTargetTypeSelected(id: FinderTargetType): boolean {
    return this.selectedTargetTypeIds.includes(id);
  }

  protected isTargetTypeAvailable(id: FinderTargetType): boolean {
    const isCatalogAvailable =
      this.targetTypeOptions.find((option) => option.id === id)?.isAvailable === true;
    if (!isCatalogAvailable) {
      return false;
    }
    if (id === 'species-richness') {
      return this.isTargetTypeSelected('strategic-ecosystems');
    }
    if (id === 'ecosystem-services') {
      return this.isTargetTypeSelected('species-richness');
    }
    return true;
  }

  protected isStrategicOnlyTargetSelection(): boolean {
    return this.selectedTargetTypeIds.length > 0 && !this.hasNonStrategicTargetSelected();
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

  private solutionScopeMatchesSelection(solution: CatalogSolution): boolean {
    const solutionScope = normalizeSolutionToken(solution.finderInputs.scope || solution.scope);
    if (solutionScope !== this.selectedScope) {
      return false;
    }

    if (this.selectedScope !== 'sirap') {
      return true;
    }

    return !this.selectedSirapRegion || solution.sirapId === this.selectedSirapRegion;
  }

  private userCanAccessSolution(solution: CatalogSolution): boolean {
    const solutionScope = normalizeSolutionToken(solution.finderInputs.scope || solution.scope);
    if (solutionScope !== 'sirap') {
      return true;
    }
    return isSirapRegionId(solution.sirapId)
      ? this.appState.accessibleSirapIds().includes(solution.sirapId)
      : false;
  }

  private solutionTargetTypesMatchSelection(solution: CatalogSolution): boolean {
    const solutionTargetTypes = getSolutionTargetTypes(solution);
    const selectedTargetTypes = this.selectedTargetTypeIds.filter((type) =>
      this.isTargetTypeAvailable(type),
    );

    return (
      selectedTargetTypes.every((type) => solutionTargetTypes.has(type)) &&
      [...solutionTargetTypes].every((type) => selectedTargetTypes.includes(type))
    );
  }

  private solutionTargetLevelsMatchSelection(solution: CatalogSolution): boolean {
    return this.selectedTargetTypeIds.every((type) => {
      if (type === 'species-richness') {
        return getSolutionSpeciesTargetMethod(solution) === this.speciesTargetMethod;
      }
      const selectedLevel = this.targetLevelByType[type];
      if (selectedLevel === undefined) {
        return false;
      }

      return getSolutionTargetLevel(solution, type) === selectedLevel;
    });
  }

  private solutionCostMatchesSelection(solution: CatalogSolution): boolean {
    return getSolutionHumanFootprintYear(solution) === this.humanFootprintYear;
  }

  private toSolutionMatch(solution: CatalogSolution): SolutionMatch {
    return {
      id: this.toSolutionMatchId(solution.id),
      solutionId: solution.id,
      name: solution.name,
      description: solution.description,
      mapLabel: solution.costLayer,
      ecosystemTargets: solution.ecosystemTargets,
      selectedUnits: solution.nSelected,
      matchPercentage: 100,
    };
  }

  private toSolutionMatchId(solutionId: string): string {
    return `solution-${solutionId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  }

  private isSelectedMatchCurrentAndAccessible(): boolean {
    const selectedMatch = this.selectedMatch;
    if (!selectedMatch) {
      return false;
    }

    if (!this.isSirapSelection()) {
      return true;
    }

    return this.certifiedSirapSolutions().some(
      (candidate) => candidate.solutionId === selectedMatch.solutionId,
    );
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
}
