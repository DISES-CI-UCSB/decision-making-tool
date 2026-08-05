import {
  costTokenMatchesChoice,
  getSolutionCostLabel,
  getSolutionIncludeFlags,
  getSolutionTargetLevel,
  getSolutionTargetTypes,
  inferSolutionTargetPercent,
  isConflictCostSolution,
  normalizeSolutionToken,
  solutionCostMatchesChoice,
  type SolutionMatchingSource,
} from './solution-matching.utils';

describe('solution matching utils', () => {
  it('normalizes manifest tokens consistently', () => {
    expect(normalizeSolutionToken('  Human_Footprint 2022 ')).toBe('human-footprint-2022');
    expect(normalizeSolutionToken('Área Estratégica', { stripDiacritics: true })).toBe(
      'area-estrategica',
    );
  });

  it('classifies ecosystem, strategic ecosystem, and species targets', () => {
    const solution = buildSolution({
      targetFeatureSet: 'species_targets',
      targetFeatureIds: ['ecosistemas', 'bosque_seco'],
    });

    expect([...getSolutionTargetTypes(solution)]).toEqual([
      'strategic-ecosystems',
      'ecosystems',
      'species-richness',
    ]);
  });

  it('uses structured per-dimension targets before the scalar fallback', () => {
    const solution = buildSolution({
      id: 'ecos30_estr17_runap_hf',
      name: 'Ecos30+Estr17+RUNAP_HF',
      targetPercent: 17,
      structuredTargets: {
        format: 'solution-target-metadata-v1',
        sourceEvaluation: 'prioritizr_model',
        ecosystems: [{ featureId: 'ecosistemas', targetPercent: 30 }],
        strategicEcosystems: [{ featureId: 'paramos', targetPercent: 17 }],
        ecosystemServices: [],
        speciesRepresentation: [{ featureId: 'species', targetPercent: 17 }],
        espRn: [],
      },
    });

    expect(getSolutionTargetLevel(solution, 'ecosystems')).toBe(30);
    expect(getSolutionTargetLevel(solution, 'strategic-ecosystems')).toBe(17);
    expect(getSolutionTargetLevel(solution, 'species-richness')).toBe(17);
    expect(inferSolutionTargetPercent(solution)).toBe(30);
  });

  it('returns no inferred target percentage when names contain no supported token', () => {
    const solution = buildSolution({ id: 'species_runap_hf', name: 'Species+RUNAP_HF' });

    expect(inferSolutionTargetPercent(solution)).toBe(0);
    expect(getSolutionTargetLevel(solution, 'species-richness')).toBeNull();
  });

  it('does not infer target metadata from legacy solution names', () => {
    const solution = buildSolution({
      id: 'ecos30_estr17_esp30_runap_hf',
      targetFeatureSet: '',
      targetFeatureIds: [],
    });

    expect([...getSolutionTargetTypes(solution, { inferFromName: true })]).toEqual([]);
    expect(getSolutionTargetLevel(solution, 'species-richness')).toBeNull();
  });

  it('combines finder and input include ids into matching flags', () => {
    const solution = buildSolution({
      includeLayerIds: ['RUNAP', 'omecs'],
      inputIncludeIds: ['comunidades_negras', 'resguardos_indigenas'],
    });

    expect(getSolutionIncludeFlags(solution)).toEqual({
      runap: true,
      omecs: true,
      comunidades: true,
      resguardos: true,
    });
  });

  it('accepts abbreviated display constraints as additional include ids', () => {
    const solution = buildSolution({ includeLayerIds: [], inputIncludeIds: [] });

    expect(getSolutionIncludeFlags(solution, ['OMECs', 'Com', 'Res'])).toMatchObject({
      omecs: true,
      comunidades: true,
      resguardos: true,
    });
  });

  it('matches both supported cost classifications across solution fields', () => {
    const humanFootprint = buildSolution({ costLayerId: null, inputCostId: null });
    humanFootprint.costLayer = 'Human Footprint';
    const netBenefit = buildSolution({
      id: 'ecos30_runap_co',
      costLayerId: 'net_benefit',
    });

    expect(solutionCostMatchesChoice(humanFootprint, 'human-footprint')).toBe(true);
    expect(solutionCostMatchesChoice(netBenefit, 'carbon-opportunity')).toBe(true);
    expect(costTokenMatchesChoice('ecos30_runap_hf', 'human-footprint')).toBe(true);
    expect(getSolutionCostLabel(netBenefit)).toBe('Human Footprint');
  });

  it('preserves catalog cost labels based on the primary manifest cost id', () => {
    expect(getSolutionCostLabel(buildSolution({ costLayerId: 'renta_agropecuaria' }))).toBe(
      'Net Benefit (Renta agropecuaria)',
    );
    expect(getSolutionCostLabel(buildSolution({ costLayerId: 'human_footprint_2022' }))).toBe(
      'Human Footprint',
    );
  });

  it('detects conflict costs in cost ids, solution ids, and names', () => {
    expect(isConflictCostSolution(buildSolution({ costLayerId: 'conflict' }))).toBe(true);
    expect(isConflictCostSolution(buildSolution({ name: 'Ecos30+RUNAP_CONFLICTO' }))).toBe(true);
    expect(isConflictCostSolution(buildSolution())).toBe(false);
  });
});

function buildSolution(
  overrides: Partial<{
    id: string;
    name: string;
    targetFeatureSet: string | null;
    targetFeatureIds: string[];
    targetPercent: number | null;
    costLayerId: string | null;
    inputCostId: string | null;
    includeLayerIds: string[];
    inputIncludeIds: string[];
    structuredTargets: NonNullable<SolutionMatchingSource['finderInputs']['structuredTargets']>;
  }> = {},
): SolutionMatchingSource {
  return {
    id: overrides.id ?? 'ecos30_runap_hf',
    name: overrides.name ?? 'Ecos30+RUNAP_HF',
    finderInputs: {
      scope: 'nacional',
      targetFeatureSet: overrides.targetFeatureSet ?? 'ecosystems',
      targetFeatureIds: overrides.targetFeatureIds ?? ['ecosistemas'],
      targetPercent: overrides.targetPercent ?? null,
      structuredTargets: overrides.structuredTargets,
      costLayerId: overrides.costLayerId ?? 'human_footprint_2022',
      includeLayerIds: overrides.includeLayerIds ?? ['runap'],
      excludeLayerIds: [],
    },
    inputLayerIds: {
      features: overrides.targetFeatureIds ?? ['ecosistemas'],
      cost: overrides.inputCostId ?? overrides.costLayerId ?? 'human_footprint_2022',
      includes: overrides.inputIncludeIds ?? overrides.includeLayerIds ?? ['runap'],
      excludes: [],
    },
  };
}
