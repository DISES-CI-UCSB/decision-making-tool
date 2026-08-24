import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  TranslateNoOpLoader,
  provideTranslateLoader,
  provideTranslateService,
} from '@ngx-translate/core';
import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import { AppStateService } from '@core/services/app-state.service';
import type { CatalogSolution } from '@core/models/solution-catalog.model';
import { FinderModalComponent } from './finder-modal';

describe('FinderModalComponent', () => {
  let catalog: {
    solutions: ReturnType<typeof signal<CatalogSolution[]>>;
    getAll: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    localStorage.clear();
    catalog = {
      solutions: signal<CatalogSolution[]>([]),
      getAll: vi.fn(() => []),
      getById: vi.fn(() => null),
    };

    await TestBed.configureTestingModule({
      imports: [FinderModalComponent],
      providers: [
        { provide: SolutionCatalogService, useValue: catalog },
        provideTranslateService({
          lang: 'en',
          fallbackLang: 'en',
          loader: provideTranslateLoader(TranslateNoOpLoader),
        }),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders step columns for targets, included areas, and costs', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('#solution-finder-modal-land-steps-grid')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-targets-column')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-step2a-column')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-step2a-row-comunidades')).toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-step2a-row-resguardos')).toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-step2b-column')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-results-column')).toBeNull();
  });

  it('keeps step headers and card stacks in semantic DOM order with shared desktop grid placement', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();

    const landGrid = fixture.nativeElement.querySelector(
      '#solution-finder-modal-land-steps-grid',
    ) as HTMLElement;
    const landChildIds = Array.from(landGrid.children).map((child) => child.id);

    expect(landChildIds).toEqual([
      'solution-finder-modal-step1-header-block',
      'solution-finder-modal-targets-column',
      'solution-finder-modal-step2b-header-block',
      'solution-finder-modal-step2b-column',
      'solution-finder-modal-step2a-header-block',
      'solution-finder-modal-step2a-column',
    ]);

    expect(landGrid.className).toContain('lg:grid-cols-3');
    expect(landGrid.className).toContain('lg:grid-rows-[auto_minmax(0,1fr)]');
    expect(
      landGrid.querySelector('#solution-finder-modal-step1-header-block')?.className,
    ).toContain('lg:col-start-1');
    expect(landGrid.querySelector('#solution-finder-modal-targets-column')?.className).toContain(
      'lg:row-start-2',
    );
    expect(
      landGrid.querySelector('#solution-finder-modal-step2b-header-block')?.className,
    ).toContain('lg:col-start-2');
    expect(landGrid.querySelector('#solution-finder-modal-step2a-column')?.className).toContain(
      'lg:col-start-3',
    );
  });

  it('does not render conflict as a trade-off option', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('#solution-finder-modal-step2b-option-conflict')).toBeNull();
    expect(compiled.textContent).not.toContain('solutionControls.finder.step2b.conflictLabel');
  });

  it('does not render other natural and cultural elements as a target option', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;

    expect(
      compiled.querySelector(
        '#solution-finder-modal-step1-target-type-card-other-natural-cultural-elements',
      ),
    ).toBeNull();
    expect(compiled.textContent).not.toContain(
      'solutionControls.finder.step1.otherNaturalCulturalElementsLabel',
    );
  });

  it('renders workflow action buttons in the footer', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('#solution-finder-modal-reset-button'),
    ).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'solutionControls.finder.actions.clearSelection',
    );
    expect(
      fixture.nativeElement.querySelector('#solution-finder-modal-cancel-button'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('#solution-finder-modal-apply-button'),
    ).not.toBeNull();
  });

  it('renders a BioModelos source link for the species target option', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();

    const sourceLink = fixture.nativeElement.querySelector(
      '#solution-finder-modal-step1-target-type-source-link-species-richness-0',
    );

    expect(sourceLink).not.toBeNull();
    expect(sourceLink.textContent).toContain(
      'solutionControls.finder.step1.speciesRichnessBioModelosSourceLabel',
    );
  });

  it('renders the approved species range help text with a technical-details tooltip only on the species card', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const speciesHelp = compiled.querySelector(
      '#solution-finder-modal-step1-target-type-help-species-richness',
    );
    const speciesHelpToggle = compiled.querySelector(
      '#solution-finder-modal-step1-target-type-help-tooltip-toggle-species-richness',
    );
    const speciesHelpTooltip = compiled.querySelector(
      '#solution-finder-modal-step1-target-type-help-tooltip-species-richness',
    );
    const ecosystemsHelpToggle = compiled.querySelector(
      '#solution-finder-modal-step1-target-type-help-tooltip-toggle-ecosystems',
    );
    const strategicHelpToggle = compiled.querySelector(
      '#solution-finder-modal-step1-target-type-help-tooltip-toggle-strategic-ecosystems',
    );
    const servicesHelpToggle = compiled.querySelector(
      '#solution-finder-modal-step1-target-type-help-tooltip-toggle-ecosystem-services',
    );

    expect(speciesHelp?.textContent).toContain('solutionControls.finder.step1.speciesRichnessHelp');
    expect(speciesHelp?.getAttribute('title')).toBeNull();
    expect(speciesHelpToggle).not.toBeNull();
    expect(speciesHelpToggle?.getAttribute('aria-label')).toContain(
      'solutionControls.finder.step1.speciesRichnessTechnicalHelpToggle',
    );
    expect(speciesHelpToggle?.getAttribute('aria-describedby')).toBe(
      'solution-finder-modal-step1-target-type-help-tooltip-species-richness',
    );
    expect(speciesHelpTooltip?.getAttribute('role')).toBe('tooltip');
    expect(speciesHelpTooltip?.textContent).toContain(
      'solutionControls.finder.step1.speciesRichnessTechnicalHelp',
    );
    expect(ecosystemsHelpToggle).toBeNull();
    expect(strategicHelpToggle).toBeNull();
    expect(servicesHelpToggle).toBeNull();
  });

  it('renders ecosystem services disabled until Species is selected', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector(
      '#solution-finder-modal-step1-target-type-card-ecosystem-services',
    );

    expect(card?.getAttribute('role')).toBeNull();
    expect(card?.getAttribute('aria-disabled')).toBe('true');
    expect(card?.getAttribute('aria-describedby')).toContain(
      'solution-finder-modal-step1-target-type-prerequisite-ecosystem-services',
    );
  });

  it('restores remembered finder selections from app state', () => {
    const appState = TestBed.inject(AppStateService);
    appState.setFinderSelectionMemory({
      planningDomain: 'land',
      selectedScope: 'nacional',
      selectedSirapRegion: null,
      selectedTargetTypeIds: ['ecosystems'],
      targetLevelByType: { ecosystems: 30 },
      includeOmecs: true,
      includeComunidades: false,
      includeResguardos: true,
      selectedCostLayerId: 'human-footprint',
      marineTargetPercent: 30,
      marineIncludeOmecs: false,
    });
    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      selectedTargetTypeIds: string[];
      targetLevelByType: Record<string, 17 | 30>;
      includeOmecs: boolean;
      selectedCostLayerId: string | null;
    };

    expect(fixture.nativeElement.querySelector('#solution-finder-modal-memory-panel')).toBeNull();
    expect(component.selectedTargetTypeIds).toEqual(['ecosystems']);
    expect(component.targetLevelByType).toEqual({ ecosystems: 30 });
    expect(component.includeOmecs).toBe(true);
    expect(component.selectedCostLayerId).toBe('human-footprint');
  });

  it('clears remembered selections when clear selections is used', () => {
    const appState = TestBed.inject(AppStateService);
    appState.setFinderSelectionMemory({
      planningDomain: 'land',
      selectedScope: 'nacional',
      selectedSirapRegion: null,
      selectedTargetTypeIds: ['ecosystems'],
      targetLevelByType: { ecosystems: 30 },
      includeOmecs: false,
      includeComunidades: false,
      includeResguardos: false,
      selectedCostLayerId: 'human-footprint',
      marineTargetPercent: 30,
      marineIncludeOmecs: false,
    });
    const fixture = TestBed.createComponent(FinderModalComponent);
    const component = fixture.componentInstance as unknown as {
      resetSelections: () => void;
      selectedTargetTypeIds: string[];
      selectedCostLayerId: string | null;
    };

    component.resetSelections();

    expect(appState.finderSelectionMemory$()).toBeNull();
    expect(component.selectedTargetTypeIds).toEqual(['ecosystems']);
    expect(component.selectedCostLayerId).toBe('human-footprint');
  });

  it('keeps Human Footprint selected because the cost basis is mandatory', () => {
    catalog.getAll.mockReturnValue([
      buildSolution({
        id: 'ecos30_runap_hf',
        name: 'Ecos30+RUNAP_HF',
        targetFeatureSet: 'ecosystems',
        targetFeatureIds: ['ecosistemas'],
        targetPercent: 30,
        costLayerId: 'human_footprint_2022',
        includeLayerIds: ['runap'],
      }),
    ]);
    const fixture = TestBed.createComponent(FinderModalComponent);
    const component = fixture.componentInstance as unknown as {
      selectedTargetTypeIds: string[];
      targetLevelByType: Record<string, 17 | 30>;
      selectedCostLayerId: string | null;
      selectCostLayer: (id: 'human-footprint') => void;
    };

    component.selectedTargetTypeIds = ['ecosystems'];
    component.targetLevelByType = { ecosystems: 30 };

    component.selectCostLayer('human-footprint');
    expect(component.selectedCostLayerId).toBe('human-footprint');

    component.selectCostLayer('human-footprint');
    expect(component.selectedCostLayerId).toBe('human-footprint');
  });

  it('matches the valid default state and enables Explore on open', () => {
    vi.useFakeTimers();
    const baseline = buildSolution({
      id: 'eco17_runap_iheh2022',
      name: 'Eco17+RUNAP_IHEH2022',
      targetFeatureSet: 'ecosystems',
      targetFeatureIds: ['ecosistemas'],
      targetPercent: 17,
      costLayerId: 'iheh_2022',
      includeLayerIds: ['runap'],
    });
    const fixture = TestBed.createComponent(FinderModalComponent);

    fixture.detectChanges();
    catalog.getAll.mockReturnValue([baseline]);
    catalog.solutions.set([baseline]);
    fixture.detectChanges();
    vi.advanceTimersByTime(350);
    fixture.componentRef.changeDetectorRef.detectChanges();

    expect(
      fixture.nativeElement.querySelector('#solution-finder-modal-apply-button')?.disabled,
    ).toBe(false);
  });

  it('updates the exact match when switching HF year and OMEC', () => {
    vi.useFakeTimers();
    catalog.getAll.mockReturnValue(
      ([2022, 2030] as const).flatMap((year) =>
        [false, true].map((includeOmecs) =>
          buildSolution({
            id: `eco17-${year}-${includeOmecs ? 'omec' : 'no-omec'}`,
            name: `Eco17 ${year}`,
            targetFeatureSet: 'ecosystems',
            targetFeatureIds: ['ecosistemas'],
            targetPercent: 17,
            costLayerId: `iheh_${year}`,
            includeLayerIds: includeOmecs ? ['runap', 'omecs'] : ['runap'],
          }),
        ),
      ),
    );
    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();
    vi.advanceTimersByTime(350);

    (
      fixture.nativeElement.querySelector(
        '#solution-finder-modal-step2b-human-footprint-year-2030',
      ) as HTMLButtonElement
    ).click();
    vi.advanceTimersByTime(350);
    expect(
      (fixture.componentInstance as unknown as { selectedMatch: { solutionId: string } })
        .selectedMatch.solutionId,
    ).toBe('eco17-2030-no-omec');

    (
      fixture.nativeElement.querySelector(
        '#solution-finder-modal-step2a-row-omec-toggle',
      ) as HTMLButtonElement
    ).click();
    vi.advanceTimersByTime(350);
    expect(
      (fixture.componentInstance as unknown as { selectedMatch: { solutionId: string } })
        .selectedMatch.solutionId,
    ).toBe('eco17-2030-omec');
  });

  it('renders and searches saved custom-labeled scenarios', () => {
    const appState = TestBed.inject(AppStateService);
    const savedSolution = buildSolution({
      id: 'ecos30_runap_hf',
      name: 'Ecos30+RUNAP_HF',
      targetFeatureSet: 'ecosystems',
      targetFeatureIds: ['ecosistemas'],
      targetPercent: 30,
      costLayerId: 'human_footprint_2022',
      includeLayerIds: ['runap'],
    });
    catalog.getById.mockReturnValue(savedSolution);
    appState.loadSolution({
      id: savedSolution.id,
      name: savedSolution.name,
      matchPercentage: savedSolution.pctTargetsMet,
      geometryUrl: savedSolution.displayUrl,
      metrics: [],
      metadata: { solutionId: savedSolution.id },
    });
    appState.labelActiveSolution('Coastal priority run');

    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#solution-finder-modal-saved-scenarios-panel')).not.toBeNull();
    expect(compiled.textContent).toContain('Coastal priority run');
    expect(compiled.textContent).not.toContain('Ecos30+RUNAP_HF');

    const input = compiled.querySelector(
      '#solution-finder-modal-saved-scenarios-search-input',
    ) as HTMLInputElement;
    input.value = 'missing';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(compiled.textContent).toContain('solutionControls.finder.savedScenarios.noResults');

    input.value = 'coastal';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(compiled.textContent).toContain('Coastal priority run');
  });

  it('restores finder selections from the selected saved custom-labeled scenario', () => {
    const appState = TestBed.inject(AppStateService);
    const savedSolution = buildSolution({
      id: 'ecos30_runap_hf',
      name: 'Ecos30+RUNAP_HF',
      targetFeatureSet: 'ecosystems',
      targetFeatureIds: ['ecosistemas'],
      targetPercent: 30,
      costLayerId: 'human_footprint_2022',
      includeLayerIds: ['runap'],
    });
    catalog.getById.mockReturnValue(savedSolution);
    appState.loadSolution({
      id: savedSolution.id,
      name: savedSolution.name,
      matchPercentage: savedSolution.pctTargetsMet,
      geometryUrl: savedSolution.displayUrl,
      metrics: [],
      metadata: { solutionId: savedSolution.id },
    });
    appState.labelActiveSolution('Coastal priority run');
    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      selectedTargetTypeIds: string[];
      targetLevelByType: Record<string, 17 | 30>;
      selectedCostLayerId: string | null;
      selectedMatch: { solutionId: string; customLabel?: string } | null;
      matchState: string;
      applySelectedSolution: () => void;
    };
    const solutionAppliedSpy = vi.spyOn(fixture.componentInstance.solutionApplied, 'emit');

    const savedScenarioButton = fixture.nativeElement.querySelector(
      '#solution-finder-modal-saved-scenario-saved-scenario-ecos30_runap_hf',
    ) as HTMLButtonElement;
    savedScenarioButton.click();

    expect(solutionAppliedSpy).not.toHaveBeenCalled();
    expect(component.selectedTargetTypeIds).toEqual(['ecosystems']);
    expect(component.targetLevelByType).toEqual({ ecosystems: 30 });
    expect(component.selectedCostLayerId).toBe('human-footprint');
    expect(component.matchState).toBe('ready');
    expect(component.selectedMatch).toEqual(
      expect.objectContaining({
        solutionId: savedSolution.id,
        customLabel: 'Coastal priority run',
      }),
    );

    component.applySelectedSolution();

    expect(solutionAppliedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        solutionId: savedSolution.id,
        customLabel: 'Coastal priority run',
      }),
    );
  });

  it('renders source links for cost and included-area choices', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const expectedSourceLinks = [
      {
        id: 'solution-finder-modal-step2b-option-hf-source-link',
        labelKey: 'solutionControls.finder.step2b.humanFootprintSourceLabel',
      },
      {
        id: 'solution-finder-modal-step2b-option-carbon-source-link',
        labelKey: 'solutionControls.finder.step2b.carbonOpportunitySourceLabel',
      },
      {
        id: 'solution-finder-modal-step2a-row-omec-source-link',
        labelKey: 'solutionControls.finder.step2a.includeOmecsSourceLabel',
      },
      {
        id: 'solution-finder-modal-step2a-always-runap-source-link',
        labelKey: 'solutionControls.finder.step2a.alwaysRunapSourceLabel',
      },
      {
        id: 'solution-finder-modal-step1-target-type-source-link-ecosystem-services-0',
        labelKey: 'solutionControls.finder.step1.ecosystemServicesCarbonSourceLabel',
      },
      {
        id: 'solution-finder-modal-step1-target-type-source-link-ecosystem-services-1',
        labelKey: 'solutionControls.finder.step1.ecosystemServicesWaterSourceLabel',
      },
    ];

    for (const { id, labelKey } of expectedSourceLinks) {
      const sourceLink = compiled.querySelector(`#${id}`);

      expect(sourceLink).not.toBeNull();
      expect(sourceLink?.textContent).toContain(labelKey);
    }
  });

  it('renders coverage target rationale with framework source links', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;

    const rationale = compiled.querySelector(
      '#solution-finder-modal-step1-target-level-rationale-ecosystems',
    );
    const rationaleToggle = compiled.querySelector(
      '#solution-finder-modal-step1-target-level-rationale-toggle-ecosystems',
    );
    const rationaleIcon = compiled.querySelector(
      '#solution-finder-modal-step1-target-level-rationale-icon-ecosystems',
    );
    const rationaleTooltip = compiled.querySelector(
      '#solution-finder-modal-step1-target-level-rationale-tooltip-ecosystems',
    );
    const aichiSource = compiled.querySelector(
      '#solution-finder-modal-step1-target-level-rationale-aichi-source-ecosystems',
    );
    const kunmingSource = compiled.querySelector(
      '#solution-finder-modal-step1-target-level-rationale-kunming-source-ecosystems',
    );

    expect(rationale).not.toBeNull();
    expect(rationaleToggle?.getAttribute('aria-label')).toContain(
      'solutionControls.finder.step1.targetLevelRationaleToggle',
    );
    expect(rationaleIcon?.classList.contains('finder-info-icon-glyph')).toBe(true);
    expect(rationaleIcon?.textContent?.trim()).toBe('i');
    expect(rationaleTooltip?.getAttribute('role')).toBe('tooltip');
    expect(rationale?.textContent).toContain('solutionControls.finder.step1.targetLevelRationale');
    expect(aichiSource?.textContent).toContain(
      'solutionControls.finder.step1.targetLevelAichiSourceLabel',
    );
    expect(kunmingSource?.textContent).toContain(
      'solutionControls.finder.step1.targetLevelKunmingSourceLabel',
    );
  });

  it('renders the expandable definition for the carbon cost choice only', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const humanFootprintDefinition = compiled.querySelector(
      '#solution-finder-modal-step2b-option-hf-definition',
    );
    const carbonDefinition = compiled.querySelector(
      '#solution-finder-modal-step2b-option-carbon-definition',
    );

    expect(humanFootprintDefinition).toBeNull();
    expect(carbonDefinition).not.toBeNull();
    expect(carbonDefinition?.textContent).toContain(
      'solutionControls.finder.step2b.carbonOpportunityDefinitionToggle',
    );
    expect(carbonDefinition?.textContent).toContain(
      'solutionControls.finder.step2b.carbonOpportunityDefinition',
    );
  });

  it('emits closeRequested when requestClose is called', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    const component = fixture.componentInstance;
    const closeRequestedSpy = vi.spyOn(component.closeRequested, 'emit');

    (component as unknown as { requestClose: () => void }).requestClose();

    expect(closeRequestedSpy).toHaveBeenCalled();
  });

  it('emits solutionApplied and closeRequested when apply is called with a selected match', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    const component = fixture.componentInstance;
    const solutionAppliedSpy = vi.spyOn(component.solutionApplied, 'emit');
    const closeRequestedSpy = vi.spyOn(component.closeRequested, 'emit');

    const selectedMatch = {
      id: 'solution-ecos30-runap-hf',
      solutionId: 'ecos30_runap_hf',
      name: 'Ecos30 RUNAP HF',
      description: 'Sample solution description',
      mapLabel: 'Human Footprint',
      ecosystemTargets: 30,
      selectedUnits: 387656,
      matchPercentage: 100,
    };
    (
      component as unknown as {
        selectedMatch: typeof selectedMatch;
        selectedMatchId: string;
        applySelectedSolution: () => void;
      }
    ).selectedMatch = selectedMatch;
    (component as unknown as { selectedMatchId: string }).selectedMatchId = selectedMatch.id;

    (component as unknown as { applySelectedSolution: () => void }).applySelectedSolution();

    expect(solutionAppliedSpy).toHaveBeenCalledWith(selectedMatch);
    expect(closeRequestedSpy).toHaveBeenCalled();
  });

  it('blocks applying the baseline solution as the comparison candidate', () => {
    const appState = TestBed.inject(AppStateService);
    appState.loadSolution({
      id: 'ecos30_runap_hf',
      name: 'Ecos30 RUNAP HF',
      description: 'Baseline solution',
      matchPercentage: 100,
      geometryUrl: 'https://example.test/ecos30_runap_hf.tif',
      metrics: [],
      metadata: { solutionId: 'ecos30_runap_hf' },
    });
    const fixture = TestBed.createComponent(FinderModalComponent);
    const component = fixture.componentInstance as unknown as {
      mode: string;
      selectedMatch: { id: string; solutionId: string };
      selectedMatchId: string;
      matchState: string;
      applySelectedSolution: () => void;
    };
    const solutionAppliedSpy = vi.spyOn(fixture.componentInstance.solutionApplied, 'emit');
    component.mode = 'comparison-candidate';
    fixture.detectChanges();
    component.selectedMatch = {
      id: 'solution-ecos30-runap-hf',
      solutionId: 'ecos30_runap_hf',
    };
    component.selectedMatchId = 'solution-ecos30-runap-hf';
    component.matchState = 'ready';
    fixture.componentRef.changeDetectorRef.detectChanges();

    component.applySelectedSolution();

    expect(solutionAppliedSpy).not.toHaveBeenCalled();
    expect(
      fixture.nativeElement.querySelector('#solution-finder-modal-comparison-duplicate-warning'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('#solution-finder-modal-apply-button')?.disabled,
    ).toBe(true);
  });

  it('matches manifest solutions by finderInputs and emits real solution ids', () => {
    vi.useFakeTimers();
    catalog.getAll.mockReturnValue([
      buildSolution({
        id: 'ecos30_runap_hf',
        name: 'Ecos30+RUNAP_HF',
        targetFeatureSet: 'ecosystems',
        targetFeatureIds: ['ecosistemas'],
        targetPercent: null,
        costLayerId: 'human_footprint_2022',
        includeLayerIds: ['runap'],
      }),
      buildSolution({
        id: 'ecos17_runap_omec_hf',
        name: 'Ecos17+RUNAP+OMEC_HF',
        targetFeatureSet: 'ecosystems',
        targetFeatureIds: ['ecosistemas'],
        targetPercent: 17,
        costLayerId: 'human_footprint_2022',
        includeLayerIds: ['runap', 'omecs'],
      }),
    ]);
    const fixture = TestBed.createComponent(FinderModalComponent);
    const component = fixture.componentInstance as unknown as {
      selectedTargetTypeIds: string[];
      targetLevelByType: Record<string, 17 | 30>;
      selectedCostLayerId: string;
      runMatching: () => void;
      matchResults: { solutionId: string; name: string }[];
      selectedMatch: { solutionId: string } | null;
    };

    component.selectedTargetTypeIds = ['ecosystems'];
    component.targetLevelByType = { ecosystems: 30 };
    component.selectedCostLayerId = 'human-footprint';
    component.runMatching();
    vi.advanceTimersByTime(350);

    expect(component.matchResults).toHaveLength(1);
    expect(component.matchResults[0]).toMatchObject({
      solutionId: 'ecos30_runap_hf',
      name: 'Ecos30+RUNAP_HF',
    });
    expect(component.selectedMatch?.solutionId).toBe('ecos30_runap_hf');
  });

  it.each([17, 30] as const)(
    'matches the representable %i%% ecosystem-services release solution only for IHEH 2022',
    (targetPercent) => {
      vi.useFakeTimers();
      const structuredTargets = buildReleaseServiceTargets(targetPercent);
      catalog.getAll.mockReturnValue([
        buildSolution({
          id: `eco17_estr30_serv${targetPercent}_esprep${targetPercent}_runap_iheh2022`,
          name: `Eco17+Estr30+Serv${targetPercent}+EspRep${targetPercent}+RUNAP_IHEH2022`,
          targetFeatureSet: 'species',
          targetFeatureIds: [
            'ecosystems',
            'strategic_ecosystems',
            'species_representation',
            'ecosystem_services',
          ],
          targetPercent: 17,
          structuredTargets,
          costLayerId: 'iheh_2022',
          includeLayerIds: ['runap'],
        }),
        buildSolution({
          id: `eco17_estr30_serv${targetPercent}_esprep${targetPercent}_runap_iheh2030`,
          name: `Eco17+Estr30+Serv${targetPercent}+EspRep${targetPercent}+RUNAP_IHEH2030`,
          targetFeatureSet: 'species',
          targetFeatureIds: [
            'ecosystems',
            'strategic_ecosystems',
            'species_representation',
            'ecosystem_services',
          ],
          targetPercent: 17,
          structuredTargets,
          costLayerId: 'iheh_2030',
          includeLayerIds: ['runap'],
        }),
      ]);
      const fixture = TestBed.createComponent(FinderModalComponent);
      const component = fixture.componentInstance as unknown as {
        selectedTargetTypeIds: string[];
        targetLevelByType: Record<string, 17 | 30>;
        selectedCostLayerId: string;
        runMatching: () => void;
        matchResults: { solutionId: string }[];
      };

      component.selectedTargetTypeIds = [
        'ecosystems',
        'strategic-ecosystems',
        'species-richness',
        'ecosystem-services',
      ];
      component.targetLevelByType = {
        ecosystems: 17,
        'strategic-ecosystems': 30,
        'species-richness': targetPercent,
        'ecosystem-services': targetPercent,
      };
      (component as unknown as { speciesTargetMethod: string }).speciesTargetMethod =
        targetPercent === 17 ? 'representation-17' : 'representation-30';
      component.selectedCostLayerId = 'human-footprint';
      component.runMatching();
      vi.advanceTimersByTime(350);

      expect(component.matchResults.map((match) => match.solutionId)).toEqual([
        `eco17_estr30_serv${targetPercent}_esprep${targetPercent}_runap_iheh2022`,
      ]);
    },
  );

  it('excludes retired cultural-territory variants from finder matches', () => {
    vi.useFakeTimers();
    catalog.getAll.mockReturnValue([
      buildSolution({
        id: 'ecos30_runap_hf',
        name: 'Ecos30+RUNAP_HF',
        targetFeatureSet: 'ecosystems',
        targetFeatureIds: ['ecosistemas'],
        targetPercent: null,
        costLayerId: 'human_footprint_2022',
        includeLayerIds: ['runap'],
      }),
      buildSolution({
        id: 'ecos30_runap_com_hf',
        name: 'Ecos30+RUNAP+Com_HF',
        targetFeatureSet: 'ecosystems',
        targetFeatureIds: ['ecosistemas'],
        targetPercent: null,
        costLayerId: 'human_footprint_2022',
        includeLayerIds: ['runap', 'comunidades'],
      }),
      buildSolution({
        id: 'ecos30_runap_res_hf',
        name: 'Ecos30+RUNAP+Res_HF',
        targetFeatureSet: 'ecosystems',
        targetFeatureIds: ['ecosistemas'],
        targetPercent: null,
        costLayerId: 'human_footprint_2022',
        includeLayerIds: ['runap', 'resguardos'],
      }),
    ]);
    const fixture = TestBed.createComponent(FinderModalComponent);
    const component = fixture.componentInstance as unknown as {
      selectedTargetTypeIds: string[];
      targetLevelByType: Record<string, 17 | 30>;
      selectedCostLayerId: string;
      runMatching: () => void;
      matchResults: { solutionId: string }[];
    };

    component.selectedTargetTypeIds = ['ecosystems'];
    component.targetLevelByType = { ecosystems: 30 };
    component.selectedCostLayerId = 'human-footprint';
    component.runMatching();
    vi.advanceTimersByTime(350);

    expect(component.matchResults.map((match) => match.solutionId)).toEqual(['ecos30_runap_hf']);
  });

  it('does not expose retired net-benefit solutions through the required HF selection', () => {
    vi.useFakeTimers();
    catalog.getAll.mockReturnValue([
      buildSolution({
        id: 'ecos30_runap_hf',
        name: 'Ecos30+RUNAP_HF',
        targetFeatureSet: 'ecosystems',
        targetFeatureIds: ['ecosistemas'],
        targetPercent: null,
        costLayerId: 'human_footprint_2022',
        includeLayerIds: ['runap'],
      }),
      buildSolution({
        id: 'ecos30_runap_co',
        name: 'Ecos30+RUNAP_CO',
        targetFeatureSet: 'ecosystems',
        targetFeatureIds: ['ecosistemas'],
        targetPercent: null,
        costLayerId: 'net_benefit',
        includeLayerIds: ['runap'],
      }),
    ]);
    const fixture = TestBed.createComponent(FinderModalComponent);
    const component = fixture.componentInstance as unknown as {
      selectedTargetTypeIds: string[];
      targetLevelByType: Record<string, 17 | 30>;
      selectedCostLayerId: string;
      runMatching: () => void;
      matchResults: { solutionId: string }[];
    };

    component.selectedTargetTypeIds = ['ecosystems'];
    component.targetLevelByType = { ecosystems: 30 };
    component.selectedCostLayerId = 'human-footprint';
    component.runMatching();
    vi.advanceTimersByTime(350);

    expect(component.matchResults.map((match) => match.solutionId)).toEqual(['ecos30_runap_hf']);
  });

  it('does not match conflict-cost solutions from stale selections', () => {
    vi.useFakeTimers();
    catalog.getAll.mockReturnValue([
      buildSolution({
        id: 'ecos30_runap_conflicto',
        name: 'Ecos30+RUNAP_CONFLICTO',
        targetFeatureSet: 'ecosystems',
        targetFeatureIds: ['ecosistemas'],
        targetPercent: null,
        costLayerId: 'conflict',
        includeLayerIds: ['runap'],
      }),
    ]);
    const fixture = TestBed.createComponent(FinderModalComponent);
    const component = fixture.componentInstance as unknown as {
      selectedTargetTypeIds: string[];
      targetLevelByType: Record<string, 17 | 30>;
      selectedCostLayerId: string;
      runMatching: () => void;
      matchResults: { solutionId: string }[];
      selectedMatch: { solutionId: string } | null;
    };

    component.selectedTargetTypeIds = ['ecosystems'];
    component.targetLevelByType = { ecosystems: 30 };
    component.selectedCostLayerId = 'conflict';
    component.runMatching();
    vi.advanceTimersByTime(350);

    expect(component.matchResults).toEqual([]);
    expect(component.selectedMatch).toBeNull();
  });

  it('renders a persistent planning-domain control and marine-only fixed settings', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('#solution-finder-modal-domain-bar')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-targets-column')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-marine-target-column')).toBeNull();

    (
      compiled.querySelector('#solution-finder-modal-domain-marine-button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(
      compiled
        .querySelector('#solution-finder-modal-land-steps-grid')
        ?.classList.contains('hidden'),
    ).toBe(true);
    const marineTargetBundle = compiled.querySelector(
      '#solution-finder-modal-marine-target-bundle',
    );
    expect(marineTargetBundle?.classList.contains('finder-selected-card-border')).toBe(true);
    expect(
      compiled.querySelector('#solution-finder-modal-marine-target-bundle-help')?.textContent,
    ).toContain('solutionControls.finder.marine.targetBundleHelp');
    expect(
      compiled
        .querySelector('#solution-finder-modal-marine-target-level-panel')
        ?.classList.contains('finder-target-level-panel'),
    ).toBe(true);
    expect(
      compiled
        .querySelector('#solution-finder-modal-marine-target-30-button')
        ?.classList.contains('finder-target-level-choice-button'),
    ).toBe(true);
    expect(
      compiled
        .querySelector('#solution-finder-modal-marine-target-50-button')
        ?.classList.contains('finder-target-level-choice-button'),
    ).toBe(true);
    expect(compiled.querySelector('#solution-finder-modal-marine-hhm-row')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-marine-hhm-help')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-marine-omec-row')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-marine-omec-toggle')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-marine-omec-source-link')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-marine-runap-row')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-marine-runap-help')).not.toBeNull();
    expect(
      compiled.querySelector('#solution-finder-modal-marine-runap-source-link'),
    ).not.toBeNull();
    expect(
      compiled
        .querySelector('#solution-finder-modal-land-steps-grid')
        ?.classList.contains('hidden'),
    ).toBe(true);
    expect(compiled.querySelector('#solution-finder-modal-marine-steps-grid')).not.toBeNull();
    expect(
      compiled.querySelector('#solution-finder-modal-marine-hhm-row')?.getAttribute('disabled'),
    ).toBeNull();
    expect(
      compiled.querySelector('#solution-finder-modal-marine-runap-row')?.getAttribute('disabled'),
    ).toBeNull();
  });

  it.each([
    { targetPercent: 30 as const, includeOmecs: false },
    { targetPercent: 30 as const, includeOmecs: true },
    { targetPercent: 50 as const, includeOmecs: false },
    { targetPercent: 50 as const, includeOmecs: true },
  ])(
    'matches exactly one marine $targetPercent% solution when OMEC is $includeOmecs',
    ({ targetPercent, includeOmecs }) => {
      vi.useFakeTimers();
      const marineSolutions = [
        buildMarineSolution(30, false),
        buildMarineSolution(30, true),
        buildMarineSolution(50, false),
        buildMarineSolution(50, true),
      ];
      catalog.getAll.mockReturnValue([
        buildSolution({
          id: 'ecos30_runap_hf',
          name: 'Land solution',
          targetFeatureSet: 'ecosystems',
          targetFeatureIds: ['ecosistemas'],
          targetPercent: 30,
          costLayerId: 'human_footprint_2022',
          includeLayerIds: ['runap'],
        }),
        ...marineSolutions,
      ]);
      const fixture = TestBed.createComponent(FinderModalComponent);
      const component = fixture.componentInstance as unknown as {
        selectedDomain: 'land' | 'marine';
        marineTargetPercent: 30 | 50;
        marineIncludeOmecs: boolean;
        runMatching: () => void;
        matchResults: { solutionId: string }[];
      };

      component.selectedDomain = 'marine';
      component.marineTargetPercent = targetPercent;
      component.marineIncludeOmecs = includeOmecs;
      component.runMatching();
      vi.advanceTimersByTime(350);

      expect(component.matchResults.map((match) => match.solutionId)).toEqual([
        `marine-${targetPercent}-${includeOmecs ? 'omec' : 'no-omec'}`,
      ]);
    },
  );

  it('uses explicit domain metadata to prevent mixed land and marine matches', () => {
    vi.useFakeTimers();
    const misleadingMarineInputs = buildMarineSolution(30, false, {
      id: 'explicit-land-with-marine-inputs',
      domain: 'land',
    });
    catalog.getAll.mockReturnValue([misleadingMarineInputs, buildMarineSolution(30, false)]);
    const fixture = TestBed.createComponent(FinderModalComponent);
    const component = fixture.componentInstance as unknown as {
      selectedDomain: 'marine';
      runMatching: () => void;
      matchResults: { solutionId: string }[];
    };

    component.selectedDomain = 'marine';
    component.runMatching();
    vi.advanceTimersByTime(350);

    expect(component.matchResults.map((match) => match.solutionId)).toEqual(['marine-30-no-omec']);
  });

  it('restores the marine domain, controls, and custom label from a saved scenario', () => {
    const appState = TestBed.inject(AppStateService);
    const savedSolution = buildMarineSolution(50, true);
    catalog.getById.mockReturnValue(savedSolution);
    appState.loadSolution({
      id: savedSolution.id,
      name: savedSolution.name,
      matchPercentage: savedSolution.pctTargetsMet,
      geometryUrl: savedSolution.displayUrl,
      metrics: [],
      metadata: { solutionId: savedSolution.id },
    });
    appState.labelActiveSolution('Marine priority');
    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      selectedDomain: 'land' | 'marine';
      marineTargetPercent: 30 | 50;
      marineIncludeOmecs: boolean;
      selectedMatch: { customLabel?: string } | null;
    };

    (
      fixture.nativeElement.querySelector(
        '#solution-finder-modal-saved-scenario-saved-scenario-marine-50-omec',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(component.selectedDomain).toBe('marine');
    expect(component.marineTargetPercent).toBe(50);
    expect(component.marineIncludeOmecs).toBe(true);
    expect(component.selectedMatch?.customLabel).toBe('Marine priority');
    expect(
      fixture.nativeElement.querySelector('#solution-finder-modal-marine-target-column'),
    ).not.toBeNull();
  });

  it('preserves separate land and marine drafts and restores the active domain on reopen', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    const component = fixture.componentInstance as unknown as {
      selectedDomain: 'land' | 'marine';
      selectedTargetTypeIds: string[];
      targetLevelByType: Record<string, 17 | 30>;
      selectedCostLayerId: string | null;
      marineTargetPercent: 30 | 50;
      marineIncludeOmecs: boolean;
      selectDomain: (domain: 'land' | 'marine') => void;
      selectMarineTargetPercent: (percent: 30 | 50) => void;
      toggleMarineIncludeOmecs: () => void;
    };
    component.selectedTargetTypeIds = ['ecosystems'];
    component.targetLevelByType = { ecosystems: 30 };
    component.selectedCostLayerId = 'human-footprint';

    component.selectDomain('marine');
    component.selectMarineTargetPercent(50);
    component.toggleMarineIncludeOmecs();
    component.selectDomain('land');

    expect(component.selectedTargetTypeIds).toEqual(['ecosystems']);
    expect(component.targetLevelByType).toEqual({ ecosystems: 30 });
    expect(component.selectedCostLayerId).toBe('human-footprint');

    component.selectDomain('marine');
    expect(component.marineTargetPercent).toBe(50);
    expect(component.marineIncludeOmecs).toBe(true);

    fixture.destroy();
    const reopenedFixture = TestBed.createComponent(FinderModalComponent);
    reopenedFixture.detectChanges();
    const reopened = reopenedFixture.componentInstance as unknown as {
      selectedDomain: 'land' | 'marine';
      marineTargetPercent: 30 | 50;
      marineIncludeOmecs: boolean;
    };
    expect(reopened.selectedDomain).toBe('marine');
    expect(reopened.marineTargetPercent).toBe(50);
    expect(reopened.marineIncludeOmecs).toBe(true);
  });

  it('enforces prerequisites and cascade-clears descendants', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    const component = fixture.componentInstance as unknown as {
      selectedTargetTypeIds: string[];
      targetLevelByType: Record<string, 17 | 30>;
      speciesTargetMethod: string | null;
      isTargetTypeAvailable: (id: string) => boolean;
      toggleTargetType: (id: string) => void;
      selectSpeciesTargetMethod: (method: string) => void;
      selectTargetLevel: (id: string, level: 17 | 30) => void;
    };

    expect(component.selectedTargetTypeIds).toEqual(['ecosystems']);
    expect(component.isTargetTypeAvailable('species-richness')).toBe(false);
    expect(component.isTargetTypeAvailable('ecosystem-services')).toBe(false);

    component.toggleTargetType('strategic-ecosystems');
    component.selectTargetLevel('strategic-ecosystems', 30);
    expect(component.isTargetTypeAvailable('species-richness')).toBe(true);
    component.toggleTargetType('species-richness');
    component.selectSpeciesTargetMethod('national-responsibility');
    expect(component.isTargetTypeAvailable('ecosystem-services')).toBe(true);
    component.toggleTargetType('ecosystem-services');
    component.selectTargetLevel('ecosystem-services', 17);

    component.toggleTargetType('strategic-ecosystems');

    expect(component.selectedTargetTypeIds).toEqual(['ecosystems']);
    expect(component.speciesTargetMethod).toBeNull();
    expect(component.targetLevelByType).toEqual({ ecosystems: 17 });
  });

  it('normalizes invalid remembered land state to mandatory safe defaults', () => {
    const appState = TestBed.inject(AppStateService);
    appState.setFinderSelectionMemory({
      planningDomain: 'land',
      selectedScope: 'sirap',
      selectedSirapRegion: 'caribe',
      selectedTargetTypeIds: ['species-richness', 'ecosystem-services'],
      targetLevelByType: { 'ecosystem-services': 30 },
      speciesTargetMethod: null,
      includeOmecs: true,
      includeComunidades: false,
      includeResguardos: false,
      selectedCostLayerId: null,
      humanFootprintYear: 999 as 2022,
      marineTargetPercent: 30,
      marineIncludeOmecs: false,
    });

    const fixture = TestBed.createComponent(FinderModalComponent);
    const component = fixture.componentInstance as unknown as {
      selectedScope: string;
      selectedSirapRegion: string | null;
      selectedTargetTypeIds: string[];
      targetLevelByType: Record<string, 17 | 30>;
      humanFootprintYear: number;
      selectedCostLayerId: string;
    };

    expect(component.selectedScope).toBe('nacional');
    expect(component.selectedSirapRegion).toBeNull();
    expect(component.selectedTargetTypeIds).toEqual(['ecosystems']);
    expect(component.targetLevelByType).toEqual({ ecosystems: 17 });
    expect(component.humanFootprintYear).toBe(2022);
    expect(component.selectedCostLayerId).toBe('human-footprint');
  });

  it('preserves an authorized remembered SIRAP and only lists accessible regions', () => {
    const appState = TestBed.inject(AppStateService);
    appState.allowedSirapIds$.set(['caribe']);
    appState.setFinderSelectionMemory({
      planningDomain: 'land',
      selectedScope: 'sirap',
      selectedSirapRegion: 'caribe',
      selectedTargetTypeIds: ['ecosystems'],
      targetLevelByType: { ecosystems: 17 },
      speciesTargetMethod: null,
      includeOmecs: false,
      includeComunidades: false,
      includeResguardos: false,
      selectedCostLayerId: 'human-footprint',
      humanFootprintYear: 2022,
      marineTargetPercent: 30,
      marineIncludeOmecs: false,
    });

    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      selectedScope: string;
      selectedSirapRegion: string | null;
    };
    const regionSelect = fixture.nativeElement.querySelector(
      '#solution-finder-modal-scope-bar-sirap-region-select',
    ) as HTMLSelectElement;

    expect(component.selectedScope).toBe('sirap');
    expect(component.selectedSirapRegion).toBe('caribe');
    expect(regionSelect).not.toBeNull();
    expect([...regionSelect.options].map((option) => option.value)).toEqual(['', 'caribe']);
  });

  it('renders mandatory Ecosystems and explicit required Human Footprint years', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(
      compiled.querySelector('#solution-finder-modal-step1-ecosystems-required-badge'),
    ).not.toBeNull();
    expect(
      compiled.querySelector('#solution-finder-modal-step2b-human-footprint-year-2022'),
    ).not.toBeNull();
    expect(
      compiled.querySelector('#solution-finder-modal-step2b-human-footprint-year-2030'),
    ).not.toBeNull();
    expect(
      compiled.querySelector('#solution-finder-modal-step2b-option-hf-unavailable-badge'),
    ).toBeNull();
    expect(
      compiled
        .querySelector('#solution-finder-modal-step2b-option-human-footprint-card')
        ?.classList.contains('opacity-60'),
    ).toBe(false);
    expect(
      (
        compiled.querySelector(
          '#solution-finder-modal-step2b-human-footprint-year-2022',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      (
        compiled.querySelector(
          '#solution-finder-modal-step2b-human-footprint-year-2030',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      compiled.querySelector('#solution-finder-modal-step2b-option-carbon-card')?.classList,
    ).toContain('hidden');
  });

  it('maps all 42 target configurations × 2 HF years × 2 OMEC states exactly once', () => {
    const configurations = buildLandTargetConfigurations();
    const solutions = buildExhaustiveLandCatalog(configurations);
    catalog.getAll.mockReturnValue(solutions);
    const fixture = TestBed.createComponent(FinderModalComponent);
    const component = fixture.componentInstance as unknown as {
      selectedDomain: 'land';
      selectedScope: 'nacional';
      selectedTargetTypeIds: string[];
      targetLevelByType: Record<string, 17 | 30>;
      speciesTargetMethod: string | null;
      humanFootprintYear: 2022 | 2030;
      includeOmecs: boolean;
      solutionMatchesSelection: (solution: CatalogSolution) => boolean;
    };

    expect(configurations).toHaveLength(42);
    expect(solutions).toHaveLength(168);

    let selectableStateCount = 0;
    for (const configuration of configurations) {
      for (const humanFootprintYear of [2022, 2030] as const) {
        for (const includeOmecs of [false, true]) {
          component.selectedDomain = 'land';
          component.selectedScope = 'nacional';
          component.selectedTargetTypeIds = selectedTypesForConfiguration(configuration);
          component.targetLevelByType = levelsForConfiguration(configuration);
          component.speciesTargetMethod = configuration.speciesMethod;
          component.humanFootprintYear = humanFootprintYear;
          component.includeOmecs = includeOmecs;

          const matches = solutions.filter((solution) =>
            component.solutionMatchesSelection(solution),
          );
          expect(
            matches,
            JSON.stringify({ configuration, humanFootprintYear, includeOmecs }),
          ).toHaveLength(1);
          selectableStateCount += 1;
        }
      }
    }

    expect(selectableStateCount).toBe(168);
  });
});

interface LandTargetConfiguration {
  ecosystems: 17 | 30;
  strategicEcosystems: 17 | 30 | null;
  speciesMethod: 'representation-17' | 'representation-30' | 'national-responsibility' | null;
  ecosystemServices: 17 | 30 | null;
}

function buildLandTargetConfigurations(): LandTargetConfiguration[] {
  const configurations: LandTargetConfiguration[] = [];
  for (const ecosystems of [17, 30] as const) {
    configurations.push({
      ecosystems,
      strategicEcosystems: null,
      speciesMethod: null,
      ecosystemServices: null,
    });
    for (const strategicEcosystems of [17, 30] as const) {
      configurations.push({
        ecosystems,
        strategicEcosystems,
        speciesMethod: null,
        ecosystemServices: null,
      });
      for (const speciesMethod of [
        'representation-17',
        'representation-30',
        'national-responsibility',
      ] as const) {
        for (const ecosystemServices of [null, 17, 30] as const) {
          configurations.push({
            ecosystems,
            strategicEcosystems,
            speciesMethod,
            ecosystemServices,
          });
        }
      }
    }
  }
  return configurations;
}

function buildExhaustiveLandCatalog(configurations: LandTargetConfiguration[]): CatalogSolution[] {
  return configurations.flatMap((configuration, configurationIndex) =>
    ([2022, 2030] as const).flatMap((humanFootprintYear) =>
      [false, true].map((includeOmecs) =>
        buildSolution({
          id: `land-${configurationIndex}-${humanFootprintYear}-${includeOmecs ? 'omec' : 'no-omec'}`,
          name: `Land ${configurationIndex} ${humanFootprintYear}`,
          targetFeatureSet: 'release-targets',
          targetFeatureIds: [],
          targetPercent: configuration.ecosystems,
          structuredTargets: {
            format: 'solution-target-metadata-v1',
            sourceEvaluation: 'prioritizr_model',
            ecosystems: [{ featureId: 'ecosystem', targetPercent: configuration.ecosystems }],
            strategicEcosystems:
              configuration.strategicEcosystems === null
                ? []
                : [
                    {
                      featureId: 'strategic-ecosystem',
                      targetPercent: configuration.strategicEcosystems,
                    },
                  ],
            ecosystemServices:
              configuration.ecosystemServices === null
                ? []
                : [
                    {
                      featureId: 'ecosystem-service',
                      targetPercent: configuration.ecosystemServices,
                    },
                  ],
            speciesRepresentation:
              configuration.speciesMethod === 'representation-17'
                ? [{ featureId: 'species', targetPercent: 17 }]
                : configuration.speciesMethod === 'representation-30'
                  ? [{ featureId: 'species', targetPercent: 30 }]
                  : [],
            espRn:
              configuration.speciesMethod === 'national-responsibility'
                ? [
                    { featureId: 'species-a', targetPercent: 12 },
                    { featureId: 'species-b', targetPercent: 27 },
                  ]
                : [],
          },
          costLayerId: `iheh_${humanFootprintYear}`,
          includeLayerIds: includeOmecs ? ['runap', 'omecs'] : ['runap'],
        }),
      ),
    ),
  );
}

function selectedTypesForConfiguration(configuration: LandTargetConfiguration): string[] {
  const selected = ['ecosystems'];
  if (configuration.strategicEcosystems !== null) selected.push('strategic-ecosystems');
  if (configuration.speciesMethod !== null) selected.push('species-richness');
  if (configuration.ecosystemServices !== null) selected.push('ecosystem-services');
  return selected;
}

function levelsForConfiguration(configuration: LandTargetConfiguration): Record<string, 17 | 30> {
  const levels: Record<string, 17 | 30> = { ecosystems: configuration.ecosystems };
  if (configuration.strategicEcosystems !== null) {
    levels['strategic-ecosystems'] = configuration.strategicEcosystems;
  }
  if (configuration.speciesMethod === 'representation-17') levels['species-richness'] = 17;
  if (configuration.speciesMethod === 'representation-30') levels['species-richness'] = 30;
  if (configuration.ecosystemServices !== null) {
    levels['ecosystem-services'] = configuration.ecosystemServices;
  }
  return levels;
}

function buildSolution(
  overrides: Pick<CatalogSolution, 'id' | 'name'> & {
    domain?: 'land' | 'marine';
    scope?: string;
    targetFeatureSet: string;
    targetFeatureIds: string[];
    targetPercent: number | null;
    structuredTargets?: NonNullable<CatalogSolution['finderInputs']['structuredTargets']>;
    costLayerId: string;
    includeLayerIds: string[];
  },
): CatalogSolution {
  return {
    id: overrides.id,
    filename: `${overrides.name}.tif`,
    name: overrides.name,
    description: `${overrides.name} solution`,
    domain: overrides.domain ?? 'land',
    scope: overrides.scope ?? 'nacional',
    sirapId: null,
    displayUrl: `https://example.test/${overrides.name}.tif`,
    metadataUrl: `https://example.test/${overrides.name}.json`,
    rendering: {
      valueType: 'categorical',
      renderMode: 'categorical',
      noDataValue: 255,
      classColors: [
        { value: 1, color: '#16a34a', label: 'New coverage' },
        { value: 2, color: '#2563eb', label: 'Existing protected areas' },
      ],
    },
    finderInputs: {
      domain: overrides.domain ?? 'land',
      scope: overrides.scope ?? 'nacional',
      targetFeatureSet: overrides.targetFeatureSet,
      targetFeatureIds: overrides.targetFeatureIds,
      targetPercent: overrides.targetPercent ?? 30,
      structuredTargets: overrides.structuredTargets,
      costLayerId: overrides.costLayerId,
      includeLayerIds: overrides.includeLayerIds,
      excludeLayerIds: [],
    },
    inputLayerIds: {
      features: overrides.targetFeatureIds,
      cost: overrides.costLayerId,
      includes: overrides.includeLayerIds,
      excludes: [],
    },
    ecosystemTargets: overrides.targetPercent ?? 0,
    constraints: [],
    costLayer: 'Human Footprint',
    nSelected: 123,
    totalCost: 0,
    pctTargetsMet: 100,
  };
}

function buildReleaseServiceTargets(targetPercent: 17 | 30) {
  return {
    format: 'solution-target-metadata-v1' as const,
    sourceEvaluation: 'prioritizr_model' as const,
    ecosystems: [{ featureId: 'helobioma_alto_caqueta', targetPercent: 17 }],
    strategicEcosystems: [
      { featureId: 'paramos', targetPercent: 30 },
      { featureId: 'bosque_seco', targetPercent: 30 },
      { featureId: 'wetlands', targetPercent: 30 },
      { featureId: 'mangroves', targetPercent: 30 },
    ],
    ecosystemServices: [
      { featureId: 'agua_dulce', targetPercent },
      { featureId: 'carbono', targetPercent },
    ],
    speciesRepresentation: [
      { featureId: 'species_1', targetPercent },
      { featureId: 'hemiphractus_fasciatus', targetPercent: 0 },
      { featureId: 'nymphargus_siren', targetPercent: 0 },
    ],
    espRn: [],
  };
}

function buildMarineSolution(
  targetPercent: 30 | 50,
  includeOmecs: boolean,
  overrides: Partial<Pick<CatalogSolution, 'id' | 'domain'>> = {},
): CatalogSolution {
  return buildSolution({
    id: overrides.id ?? `marine-${targetPercent}-${includeOmecs ? 'omec' : 'no-omec'}`,
    name: `Marine ${targetPercent}%${includeOmecs ? ' + OMEC' : ''}`,
    domain: overrides.domain ?? 'marine',
    scope: 'marine',
    targetFeatureSet: 'marine_ecosystems_and_mangroves',
    targetFeatureIds: ['FEAT_MARINE_ECOSYSTEMS', 'FEAT_MANGROVES'],
    targetPercent,
    costLayerId: 'hhm',
    includeLayerIds: includeOmecs ? ['INCL_RUNAP', 'INCL_OMEC'] : ['INCL_RUNAP'],
  });
}
