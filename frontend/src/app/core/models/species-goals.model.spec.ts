import { describe, expect, it } from 'vitest';

import {
  SPECIES_GOALS_FLAGS,
  hydrateSpeciesGoals,
  isSpeciesGoalsCatalog,
  isSpeciesGoalsCompactDocument,
  selectSpeciesTargetOverlay,
  type SpeciesGoalsCatalog,
  type SpeciesGoalsCompactDocument,
  type SpeciesTargetOverlayMap,
  type SpeciesTargetOverlaysDocument,
} from './species-goals.model';

const SHA = 'a'.repeat(64);
const catalog: SpeciesGoalsCatalog = {
  format: 'species-goals-catalog-v1',
  generatedAt: '2026-08-08T00:00:00Z',
  catalogSha256: SHA,
  provenance: {
    releaseId: 'fixture-release',
    speciesCsvSha256: SHA,
    exceptionSourceSha256: SHA,
    exceptionPolicySha256: SHA,
    exceptionBindingSha256: SHA,
    inventory: { catalogTotal: 3, unavailable: 1, zeroRange: 0 },
  },
  rowLayout: [
    'speciesId',
    'scientificName',
    'group',
    'iucnStatus',
    'nationalRangeKm2',
    'availability',
  ],
  rows: [
    ['present', 'Present species', 'birds', 'EN', 100, 'available'],
    ['absent', 'Absent species', 'mammals', 'LC', 50, 'available'],
    ['unavailable', 'Unavailable species', 'plants', null, null, 'unavailable'],
  ],
};

function compact(catalogSha256 = SHA): SpeciesGoalsCompactDocument {
  return {
    format: 'species-goals-compact-v1',
    generatedAt: '2026-08-08T00:00:00Z',
    solutionId: 'fixture',
    catalogSha256,
    geographyLevel: 'departments',
    encoding: 'sparse-no-range-omitted',
    provenance: {
      releaseId: 'fixture-release',
      speciesCsvSha256: SHA,
      exceptionSourceSha256: SHA,
      exceptionPolicySha256: SHA,
      exceptionBindingSha256: SHA,
      exactOverlapAlgorithmVersion: 'fixture-exact-v1',
      exactOverlapPolicySha256: SHA,
      targetGridSha256: SHA,
      speciesAlignmentInventorySha256: SHA,
      solutionRasterSha256: SHA,
      targetPolicySha256: SHA,
      boundaryProvenanceSha256: SHA,
      catalogSha256,
    },
    scopeCatalog: [['05', 'Antioquia']],
    rowLayout: [
      'scopeIndex',
      'speciesIndex',
      'rangeAreaKm2',
      'solutionCoveredAreaKm2',
      'preExistingCoveredAreaKm2',
      'newPrioritizrCoveredAreaKm2',
      'configuredTargetPercent',
      'flags',
    ],
    rows: [
      [
        0,
        0,
        20,
        8,
        3,
        5,
        30,
        SPECIES_GOALS_FLAGS.targetConfigured |
          SPECIES_GOALS_FLAGS.met17 |
          SPECIES_GOALS_FLAGS.met30 |
          SPECIES_GOALS_FLAGS.configuredTargetMet,
      ],
    ],
    completion: {
      format: 'species-goals-completion-v1',
      status: 'complete',
      rowCount: 1,
      payloadSha256: SHA,
    },
  };
}

describe('species goals contracts', () => {
  it('validates catalog and compact schema shapes', () => {
    expect(isSpeciesGoalsCatalog(catalog)).toBe(true);
    expect(isSpeciesGoalsCompactDocument(compact())).toBe(true);
  });

  it('hydrates sparse omissions as explicit no-range and unavailable rows', () => {
    const rows = hydrateSpeciesGoals(catalog, compact(), '05');

    expect(rows[0]).toMatchObject({
      range_in_aoi_pct: 20,
      solution_covered_in_aoi_pct: 40,
      pre_existing_covered_in_aoi_pct: 15,
      new_covered_in_aoi_pct: 25,
      configured_target_percent: 30,
      met_17_percent: true,
      met_30_percent: true,
      configured_target_met: true,
    });
    expect(rows[1]).toMatchObject({
      availability: 'available',
      no_range_in_scope: true,
      range_in_aoi_area_km2: 0,
    });
    expect(rows[2]).toMatchObject({
      availability: 'unavailable',
      no_range_in_scope: false,
    });
  });

  it('fails closed when catalog provenance differs', () => {
    expect(() => hydrateSpeciesGoals(catalog, compact('b'.repeat(64)), '05')).toThrow(/provenance/);
  });

  it('overrides legacy targets while preserving zero, absent, and unavailable semantics', () => {
    const overlay: SpeciesTargetOverlayMap = {
      canonicalSha256: SHA,
      sourceTargetCount: 1,
      applicableTargetCount: 1,
      unavailableTargetCount: 0,
      rows: [[0, 0]],
      unavailableRows: [],
    };

    const rows = hydrateSpeciesGoals(catalog, compact(), '05', overlay);

    expect(rows[0]).toMatchObject({
      configured_target_percent: 0,
      configured_target_met: true,
      solution_covered_in_aoi_area_km2: 8,
    });
    expect(rows[1].configured_target_percent).toBeNull();
    expect(rows[1].configured_target_met).toBeNull();
    expect(rows[2]).toMatchObject({
      availability: 'unavailable',
      configured_target_percent: null,
      configured_target_met: null,
    });
  });

  it('selects distinct OMEC target maps and null for untargeted solutions', () => {
    const map = (target: number): SpeciesTargetOverlayMap => ({
      canonicalSha256: SHA,
      sourceTargetCount: 1,
      applicableTargetCount: 1,
      unavailableTargetCount: 0,
      rows: [[0, target]],
      unavailableRows: [],
    });
    const overlay = {
      targetMaps: { off: map(17), on: map(30) },
      solutions: { esprn_off: 'off', esprn_on: 'on', untargeted: null },
    } as unknown as SpeciesTargetOverlaysDocument;

    expect(selectSpeciesTargetOverlay(overlay, 'esprn_off')?.rows).toEqual([[0, 17]]);
    expect(selectSpeciesTargetOverlay(overlay, 'esprn_on')?.rows).toEqual([[0, 30]]);
    expect(selectSpeciesTargetOverlay(overlay, 'untargeted')).toBeNull();
  });

  it('rejects semantic flag tamper and stale catalog binding', () => {
    const tampered = compact();
    tampered.rows[0][7] &= ~SPECIES_GOALS_FLAGS.met30;
    expect(isSpeciesGoalsCompactDocument(tampered)).toBe(false);

    const stale = compact();
    stale.provenance.catalogSha256 = 'b'.repeat(64);
    expect(() => hydrateSpeciesGoals(catalog, stale, '05')).toThrow(/stale/);
  });

  it('hydrates when catalog and compact provenance releaseIds differ', () => {
    const sharedCatalog = {
      ...catalog,
      provenance: { ...catalog.provenance, releaseId: 'prior-release' },
    };
    const currentCompact = compact();
    currentCompact.provenance.releaseId = 'current-release';

    expect(() => hydrateSpeciesGoals(sharedCatalog, currentCompact, '05')).not.toThrow();
  });
});
