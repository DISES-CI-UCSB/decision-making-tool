import { TestBed } from '@angular/core/testing';
import {
  TranslateNoOpLoader,
  provideTranslateLoader,
  provideTranslateService,
} from '@ngx-translate/core';
import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import type { SolutionScenario } from '@core/models/solution-scenario.model';
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

  it('renders step columns for targets, 2A, 2B, and results', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('#solution-finder-modal-targets-column')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-step2a-column')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-step2a-row-comunidades')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-step2a-row-resguardos')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-step2b-column')).not.toBeNull();
    expect(compiled.querySelector('#solution-finder-modal-results-column')).not.toBeNull();
  });

  it('does not render conflict as a trade-off option', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('#solution-finder-modal-step2b-option-conflict')).toBeNull();
    expect(compiled.textContent).not.toContain('solutionControls.finder.step2b.conflictLabel');
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

  it('emits closeRequested when requestClose is called', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    const component = fixture.componentInstance;
    const closeRequestedSpy = vi.spyOn(component.closeRequested, 'emit');

    (component as unknown as { requestClose: () => void }).requestClose();

    expect(closeRequestedSpy).toHaveBeenCalled();
  });

  it('emits scenarioApplied and closeRequested when apply is called with a selected match', () => {
    const fixture = TestBed.createComponent(FinderModalComponent);
    const component = fixture.componentInstance;
    const scenarioAppliedSpy = vi.spyOn(component.scenarioApplied, 'emit');
    const closeRequestedSpy = vi.spyOn(component.closeRequested, 'emit');

    const selectedMatch = {
      id: 'scenario-ecos30-runap-hf',
      solutionId: 'ecos30_runap_hf',
      scenarioId: 'ecos30_runap_hf',
      name: 'Ecos30 RUNAP HF',
      description: 'Sample scenario description',
      mapLabel: 'Human Footprint',
      ecosystemTargets: 30,
      selectedUnits: 387656,
      matchPercentage: 100,
    };
    (
      component as unknown as {
        selectedMatch: typeof selectedMatch;
        selectedMatchId: string;
        applySelectedScenario: () => void;
      }
    ).selectedMatch = selectedMatch;
    (component as unknown as { selectedMatchId: string }).selectedMatchId = selectedMatch.id;

    (component as unknown as { applySelectedScenario: () => void }).applySelectedScenario();

    expect(scenarioAppliedSpy).toHaveBeenCalledWith(selectedMatch);
    expect(closeRequestedSpy).toHaveBeenCalled();
  });

  it('matches manifest scenarios by finderInputs and emits real solution ids', () => {
    vi.useFakeTimers();
    catalog.getAll.mockReturnValue([
      buildScenario({
        id: 'ecos30_runap_hf',
        name: 'Ecos30+RUNAP_HF',
        targetFeatureSet: 'ecosystems',
        targetFeatureIds: ['ecosistemas'],
        targetPercent: null,
        costLayerId: 'human_footprint_2022',
        includeLayerIds: ['runap'],
      }),
      buildScenario({
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
      matchResults: { solutionId: string; scenarioId: string; name: string }[];
      selectedMatch: { solutionId: string; scenarioId: string } | null;
    };

    component.selectedTargetTypeIds = ['ecosystems'];
    component.targetLevelByType = { ecosystems: 30 };
    component.selectedCostLayerId = 'human-footprint';
    component.runMatching();
    vi.advanceTimersByTime(350);

    expect(component.matchResults).toHaveLength(1);
    expect(component.matchResults[0]).toMatchObject({
      solutionId: 'ecos30_runap_hf',
      scenarioId: 'ecos30_runap_hf',
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
      description: 'Afro-Colombian communities only',
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
        buildScenario({
          id: 'ecos30_runap_hf',
          name: 'Ecos30+RUNAP_HF',
          targetFeatureSet: 'ecosystems',
          targetFeatureIds: ['ecosistemas'],
          targetPercent: null,
          costLayerId: 'human_footprint_2022',
          includeLayerIds: ['runap'],
        }),
        buildScenario({
          id: 'ecos30_runap_com_hf',
          name: 'Ecos30+RUNAP+Com_HF',
          targetFeatureSet: 'ecosystems',
          targetFeatureIds: ['ecosistemas'],
          targetPercent: null,
          costLayerId: 'human_footprint_2022',
          includeLayerIds: ['runap', 'comunidades'],
        }),
        buildScenario({
          id: 'ecos30_runap_res_hf',
          name: 'Ecos30+RUNAP+Res_HF',
          targetFeatureSet: 'ecosystems',
          targetFeatureIds: ['ecosistemas'],
          targetPercent: null,
          costLayerId: 'human_footprint_2022',
          includeLayerIds: ['runap', 'resguardos'],
        }),
        buildScenario({
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

  it('does not match conflict-cost scenarios from stale selections', () => {
    vi.useFakeTimers();
    catalog.getAll.mockReturnValue([
      buildScenario({
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

function buildScenario(
  overrides: Pick<SolutionScenario, 'id' | 'name'> & {
    targetFeatureSet: string;
    targetFeatureIds: string[];
    targetPercent: number | null;
    costLayerId: string;
    includeLayerIds: string[];
  },
): SolutionScenario {
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
