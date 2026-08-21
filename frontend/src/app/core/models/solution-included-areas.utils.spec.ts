import type { CatalogSolution } from './solution-catalog.model';
import { getSolutionIncludedAreasLegendLabel } from './solution-included-areas.utils';

describe('solution included areas utils', () => {
  it('formats RUNAP-only solution labels', () => {
    const solution = buildSolution(['runap'], 'Ecos30+RUNAP_HF');

    expect(getSolutionIncludedAreasLegendLabel(solution)).toBe(
      'Existing conservation areas (RUNAP)',
    );
  });

  it('formats optional included areas from ids and solution names', () => {
    const solution = buildSolution(['runap', 'omecs'], 'Ecos30+RUNAP+OMEC_HF_comunidades');

    expect(getSolutionIncludedAreasLegendLabel(solution)).toBe(
      'Existing conservation areas (RUNAP + OMECs)',
    );
  });
});

function buildSolution(includeLayerIds: string[], name: string): CatalogSolution {
  return {
    id: name.toLowerCase(),
    filename: `${name}.tif`,
    name,
    description: `${name} solution`,
    scope: 'nacional',
    sirapId: null,
    displayUrl: `https://example.test/${name}.tif`,
    metadataUrl: `https://example.test/${name}.json`,
    rendering: {
      valueType: 'categorical',
      renderMode: 'categorical',
      noDataValue: 255,
      classColors: [],
    },
    finderInputs: {
      scope: 'nacional',
      targetFeatureSet: 'ecosystems',
      targetFeatureIds: ['ecosistemas'],
      targetPercent: 30,
      costLayerId: 'human_footprint_2022',
      includeLayerIds,
      excludeLayerIds: [],
    },
    inputLayerIds: {
      features: ['ecosistemas'],
      cost: 'human_footprint_2022',
      includes: includeLayerIds,
      excludes: [],
    },
    ecosystemTargets: 30,
    constraints: [],
    costLayer: 'Human Footprint',
    nSelected: 123,
    totalCost: 0,
    pctTargetsMet: 100,
  };
}
