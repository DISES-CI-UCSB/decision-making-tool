import type { CatalogSolution } from './solution-catalog.model';
import type { Solution } from './solution.model';
import { buildSolutionIdentitySummary } from './solution-identity-summary.model';

describe('buildSolutionIdentitySummary include chips', () => {
  it('adds OMEC chips for SIRAP packets that include OMEC in the name', () => {
    const summary = buildSolutionIdentitySummary(
      buildActiveSolution('ESTR17+CONG17+SAB17+RUNAP+OMEC_IHEH2022'),
      buildCatalogSolution({
        id: 'sirap-orinoquia-estr17-cong17-sab17-runap-omec-iheh2030',
        name: 'ESTR17+CONG17+SAB17+RUNAP+OMEC_IHEH2022',
        includeLayerIds: [],
      }),
    );

    expect(summary?.includeItems).toEqual(['RUNAP protected areas', 'OMECs']);
  });

  it('keeps RUNAP-only chips for SIRAP packets without OMEC', () => {
    const summary = buildSolutionIdentitySummary(
      buildActiveSolution('ESTR17+CONG17+SAB17+RUNAP_IHEH2022'),
      buildCatalogSolution({
        id: 'sirap-orinoquia-estr17-cong17-sab17-runap-iheh2022',
        name: 'ESTR17+CONG17+SAB17+RUNAP_IHEH2022',
        includeLayerIds: [],
      }),
    );

    expect(summary?.includeItems).toEqual(['RUNAP protected areas']);
  });
});

function buildActiveSolution(name: string): Solution {
  return {
    id: name.toLowerCase(),
    name,
    matchPercentage: 100,
    geometryUrl: `https://example.test/${name}.tif`,
    metrics: [],
  };
}

function buildCatalogSolution(overrides: {
  id: string;
  name: string;
  includeLayerIds: string[];
}): CatalogSolution {
  return {
    id: overrides.id,
    filename: `${overrides.name}.tif`,
    name: overrides.name,
    description: `${overrides.name} solution`,
    scope: 'sirap',
    sirapId: 'orinoquia',
    displayUrl: `https://example.test/${overrides.name}.tif`,
    metadataUrl: `https://example.test/${overrides.name}.json`,
    rendering: {
      valueType: 'categorical',
      renderMode: 'categorical',
      noDataValue: 255,
      classColors: [],
    },
    finderInputs: {
      scope: 'sirap',
      targetFeatureSet: 'strategic_ecosystems',
      targetFeatureIds: ['strategic_ecosystems'],
      targetPercent: 17,
      costLayerId: 'human_footprint_2022',
      includeLayerIds: overrides.includeLayerIds,
      excludeLayerIds: [],
    },
    inputLayerIds: {
      features: ['strategic_ecosystems'],
      cost: 'human_footprint_2022',
      includes: overrides.includeLayerIds,
      excludes: [],
    },
    ecosystemTargets: 17,
    constraints: [],
    costLayer: 'Human Footprint',
    nSelected: 123,
    totalCost: 0,
    pctTargetsMet: 100,
  };
}
