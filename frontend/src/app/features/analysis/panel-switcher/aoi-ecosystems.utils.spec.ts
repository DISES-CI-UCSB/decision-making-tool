import type {
  AOI,
  CustomAoiAreaProfileResponse,
  MesaAoiCoverageRecord,
  MecCompactDocument,
  MecCompactV2Document,
} from '@core/models';

import {
  buildCustomMecData,
  buildDummyCoverageRows,
  buildMecCoverageRows,
  buildMecPreviewItems,
  calculateOverlapPercent,
  isWholeMetricCompatibleSirapAoi,
  isMecViewAvailable,
  MEC_IAVH_FEATURE_COUNT,
  MESA_IAVH_FEATURE_COUNT,
  resolveMecScopeSummary,
  resolveMecScopeIndex,
} from './aoi-ecosystems.utils';

describe('AOI ecosystems utilities', () => {
  it('locks the MEC metric inventory to 429 unique biome-region features', () => {
    expect(MEC_IAVH_FEATURE_COUNT).toBe(429);
  });

  it('locks active-solution Mesa coverage to the 417-row parity inventory', () => {
    expect(MESA_IAVH_FEATURE_COUNT).toBe(417);
  });

  it('calculates strategic overlap against candidate area and clamps the result', () => {
    expect(calculateOverlapPercent(2, 10)).toBe(20);
    expect(calculateOverlapPercent(15, 10)).toBe(100);
    expect(calculateOverlapPercent(-2, 10)).toBe(0);
  });

  it('returns unavailable strategic overlap when either input is missing or invalid', () => {
    expect(calculateOverlapPercent(null, 10)).toBeNull();
    expect(calculateOverlapPercent(2, null)).toBeNull();
    expect(calculateOverlapPercent(2, 0)).toBeNull();
  });

  it('only builds synthetic MEC coverage through the explicit dummy helper', () => {
    const rows = buildDummyCoverageRows(['Bosque', 'Sabana'], 100);

    expect(rows).toHaveLength(2);
    expect(rows[0].ecosystemAreaKm2).toBeGreaterThan(0);
    expect(rows[0].preExistingPercent).toBeGreaterThan(0);
    expect(rows[0].newPrioritizrPercent).toBeGreaterThan(0);
  });

  it('resolves scope by raw AOI id before normalized name fallback', () => {
    const document = buildMecDocument();
    expect(resolveMecScopeIndex(document, buildAoi('department:05', 'Wrong name'))).toBe(0);
    expect(resolveMecScopeIndex(document, buildAoi('department:missing', 'antióquia'))).toBe(0);
    expect(
      resolveMecScopeIndex(document, buildAoi('department:missing', 'Cundinamarca')),
    ).toBeNull();
  });

  it('maps only the selected scope and view with zero-preserving percentages', () => {
    const rows = buildMecCoverageRows(buildMecDocument(), 0, 'broadEcosystem');

    expect(rows).toEqual([
      {
        id: 'broadecosystem-forest',
        label: 'Forest',
        ecosystemAreaKm2: 10,
        ecosystemSharePercent: null,
        nationalClassPercent: null,
        sirapClassPercent: null,
        solutionCoverageKm2: 4,
        solutionCoveragePercent: 40,
        remainingCoverageKm2: 6,
        remainingCoveragePercent: 60,
        preExistingCoverageKm2: 0,
        newPrioritizrCoverageKm2: 4,
        preExistingPercent: 0,
        newPrioritizrPercent: 40,
      },
    ]);
  });

  it('keeps legacy candidate-share previews and respects unsupported views', () => {
    const document = buildMecDocument();
    const rows = buildMecCoverageRows(document, 0, 'broadEcosystem');

    expect(buildMecPreviewItems(document, 0, rows, 8)[0].percent).toBe(50);
    expect(buildMecPreviewItems(document, 0, rows, null)[0].percent).toBeNull();
    expect(isMecViewAvailable(document, 'detailedEcosystem')).toBe(false);
    expect(buildMecCoverageRows(document, 0, 'detailedEcosystem')).toEqual([]);
  });

  it('uses v2 ecosystem area over scope area and derives unclassified share', () => {
    const document = buildV2MecDocument();
    const rows = buildMecCoverageRows(document, 0, 'broadEcosystem');

    expect(buildMecPreviewItems(document, 0, rows, 999)[0].percent).toBe(50);
    expect(resolveMecScopeSummary(document, 0)).toEqual({
      scopeAreaKm2: 20,
      classifiedKm2: 16,
      unclassifiedKm2: 4,
      classifiedPercent: 80,
      unclassifiedPercent: 20,
      boundaryProvenanceRef: 'departments',
    });
  });

  it('derives expanded known-AOI metrics from v2 scope and national partitions', () => {
    const document = buildV2MecDocument();
    const nationalDocument: MecCompactV2Document = {
      ...buildV2MecDocument(),
      geographyLevel: 'national',
      scopeCatalog: [['colombia', 'Colombia']],
      scopeStats: {
        0: {
          scopeAreaKm2: 200,
          classifiedKm2: 160,
          unclassifiedKm2: 40,
          boundaryProvenanceRef: 'national',
        },
      },
      rows: [[0, 0, 50, 10, 15]],
    };

    expect(buildMecCoverageRows(document, 0, 'broadEcosystem', nationalDocument)[0]).toMatchObject({
      ecosystemAreaKm2: 10,
      ecosystemSharePercent: 50,
      nationalClassPercent: 20,
      solutionCoverageKm2: 5,
      solutionCoveragePercent: 50,
      remainingCoverageKm2: 5,
      remainingCoveragePercent: 50,
      preExistingPercent: 20,
      newPrioritizrPercent: 30,
    });
  });

  it('keeps national and SIRAP extent contexts separate for regional AOIs', () => {
    const document = buildV2MecDocument();
    const sirapDocument: MecCompactV2Document = {
      ...buildV2MecDocument(),
      geographyLevel: 'national',
      scopeCatalog: [['colombia', 'Colombia']],
      rows: [[0, 0, 40, 10, 15]],
    };
    const nationalAreas = new Map([['broadEcosystem\u0000Forest', 100]]);

    expect(
      buildMecCoverageRows(document, 0, 'broadEcosystem', sirapDocument, 'sirap', nationalAreas)[0],
    ).toMatchObject({
      nationalClassPercent: 10,
      sirapClassPercent: 25,
    });
  });

  it('uses the active SIRAP scope and excludes zero-extent MEC rows', () => {
    const document: MecCompactV2Document = {
      ...buildV2MecDocument(),
      classCatalog: [
        [0, 'broadEcosystem:forest', 'Forest'],
        [0, 'broadEcosystem:wetland', 'Wetland'],
      ],
      rows: [
        [0, 0, 10, 2, 3],
        [0, 1, 0, 0, 0],
      ],
    };
    const sirapDocument: MecCompactV2Document = {
      ...buildV2MecDocument(),
      geographyLevel: 'siraps',
      scopeCatalog: [
        ['sirap-a', 'SIRAP A'],
        ['sirap-b', 'SIRAP B'],
      ],
      rows: [
        [0, 0, 40, 10, 15],
        [1, 0, 25, 8, 10],
      ],
    };

    expect(
      buildMecCoverageRows(document, 0, 'broadEcosystem', sirapDocument, 'sirap', null, 1),
    ).toEqual([
      expect.objectContaining({
        label: 'Forest',
        sirapClassPercent: 40,
      }),
    ]);
  });

  it('uses Mesa rows exclusively when a custom AOI has an active solution', () => {
    const data = buildCustomMecData(buildCustomProfileResponse());
    const row = data.rowsByView.get('biomeRegion')?.[0];

    expect(data.status).toBe('complete');
    expect(data.mode).toBe('mesa-solution');
    expect(data.hasSolutionCoverage).toBe(true);
    expect(
      buildCustomMecData({ ...buildCustomProfileResponse(), solution_id: null })
        .hasSolutionCoverage,
    ).toBe(false);
    expect(data.previewByView.get('biomeRegion')?.[0]).toEqual({ label: 'forest', percent: 25 });
    expect([...data.rowsByView.keys()]).toEqual(['biomeRegion']);
    expect(data.rowsByView.get('biomeRegion')).toHaveLength(MESA_IAVH_FEATURE_COUNT);
    expect(row).toMatchObject({
      id: 'forest',
      ecosystemAreaKm2: null,
      ecosystemSharePercent: 66.66666666666666,
      nationalClassPercent: 20,
      solutionCoverageKm2: null,
      solutionCoveragePercent: 25,
      preExistingCoverageKm2: null,
      newPrioritizrCoverageKm2: null,
      preExistingPercent: 12.5,
      newPrioritizrPercent: 12.5,
      mesaTotalInAoi: 8,
      mesaHeldInAoi: 2,
      mesaNationalTotal: 40,
      mesaClassifiedTotalInAoi: 12,
      preExistingCellCountInAoi: 1,
      newPrioritizrCellCountInAoi: 1,
      contributionToNationalCoveragePercent: 5,
      preExistingContributionToNationalCoveragePercent: 2.5,
      newPrioritizrContributionToNationalCoveragePercent: 2.5,
      contributionToNationalTargetPercent: null,
    });
    expect(data.scopeSummary).toMatchObject({
      scopeAreaKm2: 12,
      classifiedKm2: 10,
      unclassifiedKm2: 2,
    });
  });

  it('preserves composition-only rows when no solution is active', () => {
    const data = buildCustomMecData({ ...buildCustomProfileResponse(), solution_id: null });
    const row = data.rowsByView.get('broadEcosystem')?.[0];

    expect(data.mode).toBe('composition');
    expect([...data.rowsByView.keys()]).toEqual(['broadEcosystem']);
    expect(data.previewByView.get('broadEcosystem')).toEqual([{ label: 'Forest', percent: 66.67 }]);
    expect(row).toMatchObject({
      ecosystemAreaKm2: 8,
      ecosystemSharePercent: 66.67,
      solutionCoverageKm2: null,
      solutionCoveragePercent: null,
    });
  });

  it('does not fall back to legacy coverage when active Mesa rows are absent', () => {
    const response = buildCustomProfileResponse();
    delete response.sections.ecosystems?.solution_coverage;

    expect(() => buildCustomMecData(response)).toThrowError(
      'Missing Mesa solution coverage for active custom AOI solution',
    );
  });

  it('returns an unavailable custom MEC state without throwing', () => {
    const response = buildCustomProfileResponse();
    response.sections.ecosystems = {
      ...response.sections.ecosystems!,
      status: 'unavailable',
      reason: 'ecosystem_artifact_not_packaged',
      solution_coverage: undefined,
    };

    const data = buildCustomMecData(response);

    expect(data.status).toBe('unavailable');
    expect(data.hasSolutionCoverage).toBe(true);
    expect(data.rowsByView.size).toBe(0);
  });

  it('rejects partial active-solution Mesa inventories', () => {
    const response = buildCustomProfileResponse();
    response.sections.ecosystems!.solution_coverage = buildMesaCoverageFixture().slice(0, -1);

    expect(() => buildCustomMecData(response)).toThrowError(
      'Invalid Mesa solution coverage: expected 417 rows, received 416',
    );
  });

  it('rejects duplicate features in active-solution Mesa inventories', () => {
    const response = buildCustomProfileResponse();
    const records = buildMesaCoverageFixture();
    records[records.length - 1] = { ...records[records.length - 1], feature: records[0].feature };
    response.sections.ecosystems!.solution_coverage = records;

    expect(() => buildCustomMecData(response)).toThrowError(
      'Invalid Mesa solution coverage: duplicate feature "forest" at row 417',
    );
  });

  it('accepts variable SIRAP Mesa row counts when configured', () => {
    const response = buildCustomProfileResponse();
    response.sections.ecosystems!.solution_coverage = buildMesaCoverageFixture().slice(0, 3);

    const data = buildCustomMecData(response, 'test-solution', { allowVariableMesaRowCount: true });

    expect(data.rowsByView.get('biomeRegion')).toHaveLength(3);
  });

  it('derives remaining coverage percent for Mesa custom rows', () => {
    const row = buildCustomMecData(buildCustomProfileResponse()).rowsByView.get('biomeRegion')?.[0];

    expect(row?.remainingCoveragePercent).toBe(75);
  });

  it.each([
    ['empty feature', { feature: '   ' }, 'has an empty feature'],
    ['non-finite total', { total_in_aoi: Number.NaN }, 'has invalid total_in_aoi'],
    ['fractional cell count', { total_in_aoi: 7.5 }, 'has invalid total_in_aoi'],
    ['negative held count', { held_in_aoi: -1 }, 'has invalid held_in_aoi'],
    [
      'held count above total',
      { total_in_aoi: 1, held_in_aoi: 2 },
      'held_in_aoi above total_in_aoi',
    ],
    [
      'category identity mismatch',
      { pre_existing_held_in_aoi: 2 },
      'violates held = pre-existing + new',
    ],
    [
      'incorrect national denominator',
      { share_of_national_total: 0.3 },
      'share_of_national_total inconsistent with its denominator',
    ],
    [
      'non-null zero-denominator ratio',
      {
        national_total: 0,
        total_in_aoi: 0,
        share_of_national_total: 0,
        share_of_classified_aoi: 0,
        held_in_aoi: 0,
        coverage_within_aoi: null,
        pre_existing_held_in_aoi: 0,
        pre_existing_coverage_within_aoi: null,
        new_prioritizr_held_in_aoi: 0,
        new_prioritizr_coverage_within_aoi: null,
        contribution_to_national_coverage: null,
        pre_existing_contribution_to_national_coverage: null,
        new_prioritizr_contribution_to_national_coverage: null,
      },
      'non-null share_of_national_total with a zero denominator',
    ],
    ['out-of-range AOI coverage', { coverage_within_aoi: 1.01 }, 'invalid coverage_within_aoi'],
    [
      'non-finite national coverage',
      { contribution_to_national_coverage: Number.POSITIVE_INFINITY },
      'invalid contribution_to_national_coverage',
    ],
    [
      'non-finite national target contribution',
      { contribution_to_national_target: Number.NaN },
      'invalid contribution_to_national_target',
    ],
  ])('rejects a malformed Mesa row with %s', (_case, replacement, expectedMessage) => {
    const response = buildCustomProfileResponse();
    const records = buildMesaCoverageFixture();
    records[0] = { ...records[0], ...replacement };
    response.sections.ecosystems!.solution_coverage = records;

    expect(() => buildCustomMecData(response)).toThrowError(expectedMessage);
  });

  it('rejects normalized duplicate feature identities', () => {
    const response = buildCustomProfileResponse();
    const records = buildMesaCoverageFixture();
    records[records.length - 1] = {
      ...records[records.length - 1],
      feature: ' FOREST ',
    };
    response.sections.ecosystems!.solution_coverage = records;

    expect(() => buildCustomMecData(response)).toThrowError('duplicate feature " FOREST "');
  });

  it('preserves null denominators and national target contributions above one', () => {
    const response = buildCustomProfileResponse();
    const records = buildMesaCoverageFixture();
    records[1] = { ...records[1], contribution_to_national_target: 1.4 };
    response.sections.ecosystems!.solution_coverage = records;

    const rows = buildCustomMecData(response).rowsByView.get('biomeRegion');

    expect(rows?.[2]).toMatchObject({
      solutionCoveragePercent: null,
      contributionToNationalCoveragePercent: null,
      contributionToNationalTargetPercent: null,
    });
    expect(rows?.[1].contributionToNationalTargetPercent).toBe(140);
  });

  it('does not fall back when the requested active solution is missing from the response', () => {
    const response = { ...buildCustomProfileResponse(), solution_id: null };

    expect(() => buildCustomMecData(response, 'test-solution')).toThrowError(
      'Missing or mismatched solution id in custom AOI ecosystem response',
    );
  });

  it('does not mislabel classified share when a legacy custom response lacks total share', () => {
    const response = buildCustomProfileResponse();
    response.solution_id = null;
    const record = response.sections.ecosystems?.views[0].records[0];
    if (record) {
      delete record.share_of_total_aoi_pct;
    }

    const data = buildCustomMecData(response);

    expect(data.previewByView.get('broadEcosystem')).toEqual([{ label: 'Forest', percent: null }]);
    expect(data.rowsByView.get('broadEcosystem')?.[0].ecosystemSharePercent).toBeNull();
    expect(record?.share_of_classified_pct).toBe(80);
  });

  it('resolves SIRAPs by stable ID and accepts whole metric-compatible provenance', () => {
    const document = buildV2MecDocument();
    document.geographyLevel = 'siraps';
    document.scopeCatalog = [['_7', 'SIRAP Orinoquia']];
    const mergedAoi: AOI = {
      id: 'sirap:_7',
      name: 'SIRAP Orinoquia',
      type: 'sirap',
      geometryUrl: 'https://example.com/inputs/boundaries/sirap/siraps_merged_polygon_v2.geojson',
      boundarySourceLayerKey: 'siraps',
      boundarySourceId: 'aoi-siraps-combined-colombia',
      boundaryGeometrySelection: 'whole-feature',
    };
    const componentAoi: AOI = {
      ...mergedAoi,
      boundaryGeometrySelection: 'component',
    };
    const territorialAoi: AOI = {
      ...mergedAoi,
      id: 'sirap:_5',
      boundarySourceLayerKey: 'siraps_territorial',
      boundarySourceId: 'aoi-siraps-territorial-colombia',
    };
    const thematicAoi: AOI = {
      ...territorialAoi,
      boundarySourceLayerKey: 'siraps_thematic',
      boundarySourceId: 'aoi-siraps-thematic-colombia',
    };
    const updatedTerritorialAoi: AOI = {
      ...territorialAoi,
      boundarySourceLayerKey: 'siraps_territorial_updated',
      boundarySourceId: 'aoi-siraps-territorial-updated-colombia',
      geometryUrl:
        'https://example.com/inputs/boundaries/sirap/siraps_territorial_authoritative_v3.geojson',
    };
    const legacyAoi: AOI = {
      id: mergedAoi.id,
      name: mergedAoi.name,
      type: 'sirap',
      geometryUrl: mergedAoi.geometryUrl,
    };

    expect(resolveMecScopeIndex(document, mergedAoi)).toBe(0);
    expect(resolveMecScopeIndex(document, { ...mergedAoi, id: 'sirap:missing' })).toBeNull();
    expect(isWholeMetricCompatibleSirapAoi(mergedAoi)).toBe(true);
    expect(isWholeMetricCompatibleSirapAoi(componentAoi)).toBe(false);
    expect(isWholeMetricCompatibleSirapAoi(territorialAoi)).toBe(false);
    expect(isWholeMetricCompatibleSirapAoi(thematicAoi)).toBe(true);
    expect(isWholeMetricCompatibleSirapAoi(updatedTerritorialAoi)).toBe(true);
    expect(isWholeMetricCompatibleSirapAoi(legacyAoi)).toBe(false);
  });
});

function buildCustomProfileResponse(): CustomAoiAreaProfileResponse {
  return {
    format: 'custom-aoi-area-profile-v1',
    status: 'complete',
    solution_id: 'test-solution',
    selection: {
      status: 'selected',
      selected_cell_count: 12,
      available_cell_count: 12,
      area_km2: 12,
      source: 'test-grid',
    },
    sections: {
      ecosystems: {
        status: 'complete',
        canonical_summary_view: 'broadEcosystem',
        classified_area_km2: 10,
        solution_coverage: buildMesaCoverageFixture(),
        views: [
          {
            id: 'broadEcosystem',
            label: 'Broad ecosystem',
            records: [
              {
                id: 'forest',
                label: 'Forest',
                area_km2: 8,
                national_area_km2: 40,
                share_of_classified_pct: 80,
                share_of_total_aoi_pct: 66.67,
                share_of_national_class_pct: 20,
                solution_covered_area_km2: 4,
                solution_covered_pct_of_aoi: 50,
                pre_existing_covered_area_km2: 1,
                pre_existing_covered_pct_of_aoi: 12.5,
                new_covered_area_km2: 3,
                new_covered_pct_of_aoi: 37.5,
              },
            ],
          },
        ],
      },
    },
  };
}

function buildMesaCoverageFixture(): MesaAoiCoverageRecord[] {
  return Array.from({ length: MESA_IAVH_FEATURE_COUNT }, (_, index) => ({
    feature: index === 0 ? 'forest' : `biome-region-${index + 1}`,
    total_in_aoi: index === 0 ? 8 : 0,
    national_total: index === 0 ? 40 : 0,
    classified_total_in_aoi: 12,
    share_of_national_total: index === 0 ? 0.2 : null,
    share_of_classified_aoi: index === 0 ? 8 / 12 : 0,
    held_in_aoi: index === 0 ? 2 : 0,
    coverage_within_aoi: index === 0 ? 0.25 : null,
    pre_existing_held_in_aoi: index === 0 ? 1 : 0,
    pre_existing_coverage_within_aoi: index === 0 ? 0.125 : null,
    new_prioritizr_held_in_aoi: index === 0 ? 1 : 0,
    new_prioritizr_coverage_within_aoi: index === 0 ? 0.125 : null,
    contribution_to_national_coverage: index === 0 ? 0.05 : null,
    pre_existing_contribution_to_national_coverage: index === 0 ? 0.025 : null,
    new_prioritizr_contribution_to_national_coverage: index === 0 ? 0.025 : null,
    contribution_to_national_target: null,
  }));
}

function buildAoi(id: string, name: string): AOI {
  return {
    id,
    name,
    type: 'department',
    geometryUrl: '/departments.geojson',
  };
}

function buildV2MecDocument(): MecCompactV2Document {
  return {
    format: 'mec-compact-v2',
    solutionId: 'land-solution',
    geographyLevel: 'departments',
    generatedAt: '2026-07-24T00:00:00Z',
    sourceMode: 'composite',
    units: 'km2',
    rowLayout: [
      'scopeIndex',
      'classIndex',
      'ecosystemAreaKm2',
      'preExistingCoverageKm2',
      'newPrioritizrCoverageKm2',
    ],
    scopeStatsFields: ['scopeAreaKm2', 'classifiedKm2', 'unclassifiedKm2', 'boundaryProvenanceRef'],
    viewCatalog: [['broadEcosystem', 'Broad ecosystem']],
    classCatalog: [[0, 'broadEcosystem:forest', 'Forest']],
    scopeCatalog: [['05', 'Antioquia']],
    scopeStats: {
      0: {
        scopeAreaKm2: 20,
        classifiedKm2: 16,
        unclassifiedKm2: 4,
        boundaryProvenanceRef: 'departments',
      },
    },
    rows: [[0, 0, 10, 2, 3]],
    viewSupport: {
      supported: [{ view: 'broadEcosystem', mapping: 'authoritative', rule: 'Exact label.' }],
      unsupported: [],
    },
    semantics: {
      ecosystemAreaKm2: 'Ecosystem area.',
      preExistingCoverageKm2: 'Pre-existing coverage.',
      newPrioritizrCoverageKm2: 'New Prioritizr coverage.',
      derivedValues: 'Derived values.',
      scopeStats: 'Scope stats.',
      nationalBenchmark: 'National benchmark.',
      invariants: 'Disjoint.',
    },
  };
}

function buildMecDocument(): MecCompactDocument {
  return {
    format: 'mec-compact-v1',
    solutionId: 'land-solution',
    geographyLevel: 'departments',
    generatedAt: '2026-07-24T00:00:00Z',
    sourceMode: 'composite',
    units: 'km2',
    rowLayout: ['scopeIndex', 'classIndex', 'availableKm2', 'existingKm2', 'additionalKm2'],
    viewCatalog: [
      ['broadEcosystem', 'Broad ecosystem'],
      ['detailedEcosystem', 'Detailed ecosystem'],
    ],
    classCatalog: [
      [0, 'broadEcosystem:forest', 'Forest'],
      [0, 'broadEcosystem:savanna', 'Savanna'],
      [1, 'detailedEcosystem:forest', 'Detailed forest'],
    ],
    scopeCatalog: [
      ['05', 'Antioquia'],
      ['08', 'Atlántico'],
    ],
    rows: [
      [0, 0, 10, 0, 4],
      [1, 1, 8, 1, 2],
      [0, 2, 5, 1, 1],
    ],
    viewSupport: {
      supported: [{ view: 'broadEcosystem', mapping: 'authoritative', rule: 'Exact label.' }],
      unsupported: [{ view: 'detailedEcosystem', reason: 'Unavailable in this source.' }],
    },
    semantics: {
      availableKm2: 'Available.',
      existingKm2: 'Existing.',
      additionalKm2: 'Additional.',
      percentages: 'Derived.',
      invariants: 'Disjoint.',
    },
  };
}
