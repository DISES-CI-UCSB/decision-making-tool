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
  let catalog: { getAll: ReturnType<typeof vi.fn>; getById: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    localStorage.clear();
    catalog = {
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

    expect(compiled.querySelector('#solution-finder-modal-targets-column')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-step2a-column')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-step2a-row-comunidades')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-step2a-row-resguardos')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-step2b-column')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-results-column')).toBeNull();
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
      includeResguardos: boolean;
      selectedCostLayerId: string | null;
    };

    expect(fixture.nativeElement.querySelector('#solution-finder-modal-memory-panel')).toBeNull();
    expect(component.selectedTargetTypeIds).toEqual(['ecosystems']);
    expect(component.targetLevelByType).toEqual({ ecosystems: 30 });
    expect(component.includeOmecs).toBe(true);
    expect(component.includeResguardos).toBe(true);
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
    expect(component.selectedTargetTypeIds).toEqual([]);
    expect(component.selectedCostLayerId).toBeNull();
  });

  it('toggles the selected Step 2 cost layer off when clicked again', () => {
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
    expect(component.selectedCostLayerId).toBeNull();
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
        id: 'solution-finder-modal-step2a-row-comunidades-source-link',
        labelKey: 'solutionControls.finder.step2a.includeComunidadesSourceLabel',
      },
      {
        id: 'solution-finder-modal-step2a-row-resguardos-source-link',
        labelKey: 'solutionControls.finder.step2a.includeResguardosSourceLabel',
      },
      {
        id: 'solution-finder-modal-step2a-always-runap-source-link',
        labelKey: 'solutionControls.finder.step2a.alwaysRunapSourceLabel',
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

  it('renders expandable definitions for cost choices', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const expectedDefinitions = [
      {
        id: 'solution-finder-modal-step2b-option-hf-definition',
        toggleKey: 'solutionControls.finder.step2b.humanFootprintDefinitionToggle',
        definitionKey: 'solutionControls.finder.step2b.humanFootprintDefinition',
      },
      {
        id: 'solution-finder-modal-step2b-option-carbon-definition',
        toggleKey: 'solutionControls.finder.step2b.carbonOpportunityDefinitionToggle',
        definitionKey: 'solutionControls.finder.step2b.carbonOpportunityDefinition',
      },
    ];

    for (const { id, toggleKey, definitionKey } of expectedDefinitions) {
      const definition = compiled.querySelector(`#${id}`);

      expect(definition).not.toBeNull();
      expect(definition?.textContent).toContain(toggleKey);
      expect(definition?.textContent).toContain(definitionKey);
    }
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
    component.selectedMatch = {
      id: 'solution-ecos30-runap-hf',
      solutionId: 'ecos30_runap_hf',
    };
    component.selectedMatchId = 'solution-ecos30-runap-hf';
    component.matchState = 'ready';
    fixture.detectChanges();

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

  it.each([
    {
      description: 'neither cultural territory layer',
      includeComunidades: false,
      includeResguardos: false,
      expectedSolutionId: 'ecos30_runap_hf',
    },
    {
      description: 'community councils for Black communities only',
      includeComunidades: true,
      includeResguardos: false,
      expectedSolutionId: 'ecos30_runap_com_hf',
    },
    {
      description: 'Indigenous reserves only',
      includeComunidades: false,
      includeResguardos: true,
      expectedSolutionId: 'ecos30_runap_res_hf',
    },
    {
      description: 'both cultural territory layers',
      includeComunidades: true,
      includeResguardos: true,
      expectedSolutionId: 'ecos30_runap_com_res_hf',
    },
  ])(
    'matches $description independently',
    ({ includeComunidades, includeResguardos, expectedSolutionId }) => {
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
        buildSolution({
          id: 'ecos30_runap_com_res_hf',
          name: 'Ecos30+RUNAP+Com+Res_HF',
          targetFeatureSet: 'ecosystems',
          targetFeatureIds: ['ecosistemas'],
          targetPercent: null,
          costLayerId: 'human_footprint_2022',
          includeLayerIds: ['runap', 'comunidades', 'resguardos'],
        }),
      ]);
      const fixture = TestBed.createComponent(FinderModalComponent);
      const component = fixture.componentInstance as unknown as {
        selectedTargetTypeIds: string[];
        targetLevelByType: Record<string, 17 | 30>;
        selectedCostLayerId: string;
        includeComunidades: boolean;
        includeResguardos: boolean;
        runMatching: () => void;
        matchResults: { solutionId: string }[];
      };

      component.selectedTargetTypeIds = ['ecosystems'];
      component.targetLevelByType = { ecosystems: 30 };
      component.selectedCostLayerId = 'human-footprint';
      component.includeComunidades = includeComunidades;
      component.includeResguardos = includeResguardos;
      component.runMatching();
      vi.advanceTimersByTime(350);

      expect(component.matchResults.map((match) => match.solutionId)).toEqual([expectedSolutionId]);
    },
  );

  it('matches net benefit solutions when the net benefit cost layer is selected', () => {
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
    component.selectedCostLayerId = 'carbon-opportunity';
    component.runMatching();
    vi.advanceTimersByTime(350);

    expect(component.matchResults.map((match) => match.solutionId)).toEqual(['ecos30_runap_co']);
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
      compiled.querySelector('#solution-finder-modal-targets-column')?.classList.contains('hidden'),
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
      compiled.querySelector('#solution-finder-modal-step2a-column')?.classList.contains('hidden'),
    ).toBe(true);
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
});

function buildSolution(
  overrides: Pick<CatalogSolution, 'id' | 'name'> & {
    domain?: 'land' | 'marine';
    scope?: string;
    targetFeatureSet: string;
    targetFeatureIds: string[];
    targetPercent: number | null;
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
      targetPercent: overrides.targetPercent,
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
