import { describe, expect, it } from 'vitest';
import { classifyOverviewTargetDomains } from './overview-target-domains.utils';

describe('classifyOverviewTargetDomains', () => {
  it('does not infer general ecosystems from the strategic ecosystems token', () => {
    expect(
      classifyOverviewTargetDomains({
        targetFeatureSet: 'strategic_ecosystems+species_richness',
        targetFeatureIds: ['strategic_ecosystems', 'species_richness'],
      }),
    ).toEqual(new Set(['strategicEcosystems', 'species']));
  });

  it('classifies marine ecosystems and mangroves as both intended domains', () => {
    expect(
      classifyOverviewTargetDomains({
        targetFeatureSet: 'marine_ecosystems+mangroves',
        targetFeatureIds: ['marine_ecosystems', 'mangroves'],
      }),
    ).toEqual(new Set(['strategicEcosystems', 'ecosystems']));

    expect(
      classifyOverviewTargetDomains({
        targetFeatureSet: 'marine_ecosystems_and_mangroves',
        targetFeatureIds: [],
      }),
    ).toEqual(new Set(['strategicEcosystems', 'ecosystems']));
  });

  it.each([
    ['estr', 'strategicEcosystems'],
    ['ecos', 'ecosystems'],
    ['esp', 'species'],
    ['mangrove', 'strategicEcosystems'],
    ['mangroves', 'strategicEcosystems'],
    ['marine_ecosystems', 'ecosystems'],
  ] as const)('preserves the exact %s alias', (token, expectedDomain) => {
    expect(
      classifyOverviewTargetDomains({
        targetFeatureSet: token,
        targetFeatureIds: [],
      }),
    ).toEqual(new Set([expectedDomain]));
  });

  it.each(['strategic_ecosystems_extended', 'myecos', 'species_richness_backup'])(
    'does not allow containment match for %s',
    (token) => {
      expect(
        classifyOverviewTargetDomains({
          targetFeatureSet: token,
          targetFeatureIds: [],
        }),
      ).toEqual(new Set());
    },
  );

  it('keeps configured targets separate from additional outcomes', () => {
    const targetedDomains = classifyOverviewTargetDomains({
      targetFeatureSet: 'ecosystems',
      targetFeatureIds: ['ecosistemas'],
    });
    const allDomains = ['strategicEcosystems', 'ecosystems', 'species'] as const;

    expect(allDomains.filter((domain) => targetedDomains.has(domain))).toEqual(['ecosystems']);
    expect(allDomains.filter((domain) => !targetedDomains.has(domain))).toEqual([
      'strategicEcosystems',
      'species',
    ]);
  });

  it('falls back to catalog finderInputs when goals targetContext is blank', () => {
    expect(
      classifyOverviewTargetDomains(
        {
          targetFeatureSet: null,
          targetFeatureIds: [],
        },
        {
          targetFeatureSet: 'ecosystems',
          targetFeatureIds: ['ecosystems'],
        },
      ),
    ).toEqual(new Set(['ecosystems']));
  });

  it('falls back to relativeTargetsByType when goals tokens and catalog are blank', () => {
    expect(
      classifyOverviewTargetDomains({
        targetFeatureSet: null,
        targetFeatureIds: [],
        relativeTargetsByType: {
          ecosystems: [0.17],
        },
      }),
    ).toEqual(new Set(['ecosystems']));
  });

  it('falls back to structuredTargets when goals tokens and catalog are blank', () => {
    expect(
      classifyOverviewTargetDomains({
        targetFeatureSet: null,
        targetFeatureIds: [],
        structuredTargets: {
          ecosystems: [{ targetPercent: 17 }],
        },
      }),
    ).toEqual(new Set(['ecosystems']));
  });

  it('keeps the empty-target path when there is no catalog or goals evidence', () => {
    expect(
      classifyOverviewTargetDomains({
        targetFeatureSet: null,
        targetFeatureIds: [],
        relativeTargetsByType: {
          ecosystems: [],
          species: [0],
        },
        structuredTargets: {
          ecosystems: [],
          strategicEcosystems: [{ targetPercent: 0 }],
        },
      }),
    ).toEqual(new Set());
  });

  it('does not let blank-context fallbacks override an explicit goals target set', () => {
    expect(
      classifyOverviewTargetDomains(
        {
          targetFeatureSet: 'strategic_ecosystems',
          targetFeatureIds: ['strategic_ecosystems'],
          relativeTargetsByType: {
            ecosystems: [0.17],
            species: [0.3],
            strategicEcosystems: [0.17],
          },
        },
        {
          targetFeatureSet: 'ecosystems',
          targetFeatureIds: ['ecosystems'],
        },
      ),
    ).toEqual(new Set(['strategicEcosystems']));
  });
});
