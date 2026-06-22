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
import type { CatalogSolution } from '@core/models/solution-catalog.model';
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

type CostLayerChoice = 'human-footprint' | 'carbon-opportunity';

type SirapRegionId =
  | 'caribe'
  | 'pacifico'
  | 'andes-occidentales'
  | 'andes-nororientales'
  | 'orinoquia'
  | 'amazonia';

interface SirapRegionOption {
  id: SirapRegionId;
  labelKey: string;
  departments: string;
}

interface SourceLinkOption {
  labelKey: string;
  urlKey: string;
}

interface TargetTypeOption {
  id: FinderTargetType;
  labelKey: string;
  helpKey: string;
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
  @Output() readonly solutionApplied = new EventEmitter<SolutionMatch>();

  protected readonly showSolutionFilenames = this.appState.showFinderSolutionFilenames$;
  protected readonly showScopeBar = this.appState.showFinderScopeBar$;
  protected selectedScope: 'nacional' | 'sirap' = 'nacional';
  protected selectedSirapRegion: SirapRegionId | null = null;

  protected readonly sirapRegions: readonly SirapRegionOption[] = [
    {
      id: 'caribe',
      labelKey: 'solutionControls.finder.scopeBar.regions.caribe',
      departments:
        'La Guajira, Cesar, Magdalena, Atlántico, Córdoba, Sucre, Bolívar, San Andrés y Providencia',
    },
    {
      id: 'pacifico',
      labelKey: 'solutionControls.finder.scopeBar.regions.pacifico',
      departments: 'Chocó, Cauca, Nariño, Valle del Cauca',
    },
    {
      id: 'andes-occidentales',
      labelKey: 'solutionControls.finder.scopeBar.regions.andesOccidentales',
      departments:
        'Antioquia, Caldas, Cauca, Huila, Nariño, Quindío, Risaralda, Tolima, Valle del Cauca',
    },
    {
      id: 'andes-nororientales',
      labelKey: 'solutionControls.finder.scopeBar.regions.andesNororientales',
      departments: 'Santander, Norte de Santander, Boyacá, Cundinamarca',
    },
    {
      id: 'orinoquia',
      labelKey: 'solutionControls.finder.scopeBar.regions.orinoquia',
      departments: 'Arauca, Meta, Vichada, Casanare',
    },
    {
      id: 'amazonia',
      labelKey: 'solutionControls.finder.scopeBar.regions.amazonia',
      departments: 'Guainía, Guaviare, Vaupés, Putumayo, Amazonas, Caquetá',
    },
  ];

  /** Step 1 */
  protected selectedTargetTypeIds: FinderTargetType[] = [];
  protected targetLevelByType: TargetLevelsByType = {};

  /** Step 2A (variable) */
  protected includeOmecs = false;
  protected includeComunidades = false;
  protected includeResguardos = false;

  /** Step 2B */
  protected selectedCostLayerId: CostLayerChoice | null = null;

  @ViewChild('resultsScrollContainer')
  private readonly resultsScrollRef?: ElementRef<HTMLElement>;

  @ViewChild('resultsScrollThumb')
  private readonly resultsThumbRef?: ElementRef<HTMLElement>;

  @ViewChildren('finderColumnHeader')
  private readonly columnHeaderRefs?: QueryList<ElementRef<HTMLElement>>;

  protected matchState: FinderMatchState = 'empty';
  protected matchResults: SolutionMatch[] = [];
  protected selectedMatchId: string | null = null;
  protected selectedMatch: SolutionMatch | null = null;

  private loadingTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollThumbHideTimer: ReturnType<typeof setTimeout> | null = null;
  private columnHeaderResizeObserver: ResizeObserver | null = null;
  private columnHeaderSyncTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnDestroy(): void {
    this.clearLoadingTimer();
    this.clearScrollThumbHideTimer();
    this.clearColumnHeaderSyncTimer();
    this.columnHeaderResizeObserver?.disconnect();
  }

  ngAfterViewInit(): void {
    this.observeColumnHeaders();
    this.scheduleColumnHeaderHeightSync();
  }

  @HostListener('window:resize')
  protected onWindowResize(): void {
    this.scheduleColumnHeaderHeightSync();
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

  protected isCostLayerAvailable(id: CostLayerChoice): boolean {
    return this.solutionCatalog
      .getAll()
      .some((solution) => this.solutionCostMatchesChoice(solution, id));
  }

  protected selectCostLayer(id: CostLayerChoice): void {
    if (!this.isCostLayerAvailable(id)) {
      return;
    }
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

  protected toggleIncludeResguardos(): void {
    if (!this.isStep2Unlocked()) {
      return;
    }
    this.includeResguardos = !this.includeResguardos;
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
      const filtered = this.solutionCatalog
        .getAll()
        .filter((solution) => this.solutionMatchesSelection(solution));
      this.matchResults = filtered.map((solution) => this.toSolutionMatch(solution));
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

  protected selectScope(scope: 'nacional' | 'sirap'): void {
    if (scope === this.selectedScope) return;
    this.selectedScope = scope;
    this.selectedSirapRegion = null;
    this.resetSelections();
  }

  protected selectSirapRegion(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedSirapRegion = (value || null) as SirapRegionId | null;
    this.resetSelections();
  }

  protected resetSelections(): void {
    this.selectedTargetTypeIds = [];
    this.targetLevelByType = {};
    this.includeOmecs = false;
    this.includeComunidades = false;
    this.includeResguardos = false;
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

  protected applySelectedSolution(): void {
    const selectedMatch = this.selectedMatch;
    if (!selectedMatch) {
      return;
    }

    this.solutionApplied.emit(selectedMatch);
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
    if (this.includeResguardos) {
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

  protected canApplySolution(): boolean {
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

  private solutionMatchesSelection(solution: CatalogSolution): boolean {
    if (!this.solutionScopeMatchesSelection(solution)) {
      return false;
    }

    if (!this.solutionTargetTypesMatchSelection(solution)) {
      return false;
    }

    if (!this.solutionTargetLevelsMatchSelection(solution)) {
      return false;
    }

    const includeIds = this.getSolutionIncludeIds(solution);
    const hasOmec = includeIds.some((id) => id.includes('omec'));
    if (hasOmec !== this.includeOmecs) {
      return false;
    }

    const hasComunidades = includeIds.some((id) => id.includes('comunidades'));
    if (hasComunidades !== this.includeComunidades) {
      return false;
    }

    const hasResguardos = includeIds.some((id) => id.includes('resguardos'));
    if (hasResguardos !== this.includeResguardos) {
      return false;
    }

    if (!this.solutionCostMatchesSelection(solution)) {
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
    const solutionScope = this.normalizeManifestToken(
      solution.finderInputs.scope || solution.scope,
    );
    if (solutionScope !== this.selectedScope) {
      return false;
    }

    if (this.selectedScope !== 'sirap') {
      return true;
    }

    return !this.selectedSirapRegion || solution.sirapId === this.selectedSirapRegion;
  }

  private solutionTargetTypesMatchSelection(solution: CatalogSolution): boolean {
    const solutionTargetTypes = this.getSolutionTargetTypes(solution);
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
      const selectedLevel = this.targetLevelByType[type];
      if (selectedLevel === undefined) {
        return false;
      }

      return this.getSolutionTargetLevel(solution, type) === selectedLevel;
    });
  }

  private getSolutionTargetTypes(solution: CatalogSolution): Set<FinderTargetType> {
    const targetTypes = new Set<FinderTargetType>();
    const targetFeatureSet = this.normalizeManifestToken(
      solution.finderInputs.targetFeatureSet ?? '',
    );
    const targetFeatureIds = solution.finderInputs.targetFeatureIds.map((id) =>
      this.normalizeManifestToken(id),
    );

    if (
      targetFeatureSet.includes('strategic') ||
      this.hasStrategicTargetFeatures(targetFeatureIds)
    ) {
      targetTypes.add('strategic-ecosystems');
    }
    if (targetFeatureSet === 'ecosystems' || targetFeatureIds.includes('ecosistemas')) {
      targetTypes.add('ecosystems');
    }
    if (
      targetFeatureSet.includes('species') ||
      (!targetFeatureSet && targetFeatureIds.includes('species-richness'))
    ) {
      targetTypes.add('species-richness');
    }

    return targetTypes;
  }

  private hasStrategicTargetFeatures(targetFeatureIds: string[]): boolean {
    return targetFeatureIds.some((id) =>
      ['paramos', 'bosque-seco', 'wetlands', 'mangroves'].includes(id),
    );
  }

  private getSolutionTargetLevel(
    solution: CatalogSolution,
    targetType: FinderTargetType,
  ): 17 | 30 | null {
    const parsedLevel = this.parseTargetLevelFromSolutionName(solution, targetType);
    if (parsedLevel !== null) {
      return parsedLevel;
    }

    const manifestLevel = solution.finderInputs.targetPercent;
    return manifestLevel === 17 || manifestLevel === 30 ? manifestLevel : null;
  }

  private parseTargetLevelFromSolutionName(
    solution: CatalogSolution,
    targetType: FinderTargetType,
  ): 17 | 30 | null {
    const prefixByTargetType: Partial<Record<FinderTargetType, string>> = {
      ecosystems: 'ecos',
      'strategic-ecosystems': 'estr',
    };
    const prefix = prefixByTargetType[targetType];
    if (!prefix) {
      return null;
    }

    const source = `${solution.id} ${solution.name}`.toLowerCase();
    const match = source.match(new RegExp(`${prefix}(17|30)(?!\\d)`));
    if (!match) {
      return null;
    }

    return Number(match[1]) as 17 | 30;
  }

  private getSolutionIncludeIds(solution: CatalogSolution): string[] {
    return [...solution.finderInputs.includeLayerIds, ...solution.inputLayerIds.includes].map(
      (id) => this.normalizeManifestToken(id),
    );
  }

  private solutionCostMatchesSelection(solution: CatalogSolution): boolean {
    const selectedCostLayerId = this.selectedCostLayerId;
    if (!selectedCostLayerId) {
      return false;
    }

    return this.solutionCostMatchesChoice(solution, selectedCostLayerId);
  }

  private solutionCostMatchesChoice(
    solution: CatalogSolution,
    selectedCostLayerId: CostLayerChoice,
  ): boolean {
    const costIds = [
      solution.finderInputs.costLayerId,
      solution.inputLayerIds.cost,
      solution.costLayer,
      solution.id,
    ]
      .filter((id): id is string => Boolean(id))
      .map((id) => this.normalizeManifestToken(id));

    return costIds.some((id) => this.costIdMatchesChoice(id, selectedCostLayerId));
  }

  private costIdMatchesChoice(costId: string, choice: CostLayerChoice): boolean {
    switch (choice) {
      case 'human-footprint':
        return costId.includes('human-footprint') || costId.endsWith('-hf');
      case 'carbon-opportunity':
        return (
          costId.includes('carbon') ||
          costId.includes('net-benefit') ||
          costId.includes('renta') ||
          costId.includes('agropecuaria') ||
          costId.endsWith('-co')
        );
    }
  }

  private normalizeManifestToken(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[_\s]+/g, '-');
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

  private observeColumnHeaders(): void {
    const headerElements = this.columnHeaderRefs?.toArray().map((ref) => ref.nativeElement) ?? [];
    if (headerElements.length === 0 || typeof ResizeObserver === 'undefined') {
      return;
    }

    this.columnHeaderResizeObserver?.disconnect();
    this.columnHeaderResizeObserver = new ResizeObserver(() => {
      this.scheduleColumnHeaderHeightSync();
    });

    for (const header of headerElements) {
      this.columnHeaderResizeObserver.observe(header);
    }
  }

  private scheduleColumnHeaderHeightSync(): void {
    if (this.columnHeaderSyncTimer) {
      return;
    }

    this.columnHeaderSyncTimer = setTimeout(() => {
      this.columnHeaderSyncTimer = null;
      this.syncColumnHeaderHeights();
    });
  }

  private clearColumnHeaderSyncTimer(): void {
    if (!this.columnHeaderSyncTimer) {
      return;
    }

    clearTimeout(this.columnHeaderSyncTimer);
    this.columnHeaderSyncTimer = null;
  }

  private syncColumnHeaderHeights(): void {
    const headerElements = this.columnHeaderRefs?.toArray().map((ref) => ref.nativeElement) ?? [];
    if (headerElements.length === 0) {
      return;
    }

    for (const header of headerElements) {
      header.style.height = 'auto';
      header.style.minHeight = '0px';
    }

    const maxHeaderHeight = Math.ceil(
      Math.max(...headerElements.map((header) => header.getBoundingClientRect().height)),
    );

    for (const header of headerElements) {
      header.style.height = `${maxHeaderHeight}px`;
      header.style.minHeight = `${maxHeaderHeight}px`;
    }
  }
}
