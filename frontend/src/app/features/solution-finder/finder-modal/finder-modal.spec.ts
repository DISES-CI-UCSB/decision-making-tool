import { TestBed } from '@angular/core/testing';
import {
  TranslateNoOpLoader,
  provideTranslateLoader,
  provideTranslateService,
} from '@ngx-translate/core';
import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import type { CatalogSolution } from '@core/models/solution-catalog.model';
import { FinderModalComponent } from './finder-modal';

describe('FinderModalComponent', () => {
  let catalog: { getAll: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    catalog = {
      getAll: vi.fn(() => []),
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
});

function buildSolution(
  overrides: Pick<CatalogSolution, 'id' | 'name'> & {
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
    scope: 'nacional',
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
      scope: 'nacional',
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
