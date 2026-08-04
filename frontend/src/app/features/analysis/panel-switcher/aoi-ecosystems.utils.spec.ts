import type {
  AOI,
  CustomAoiAreaProfileResponse,
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
  resolveMecScopeSummary,
  resolveMecScopeIndex,
} from './aoi-ecosystems.utils';

describe('AOI ecosystems utilities', () => {
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

  it('adapts live custom ecosystem composition and coverage without synthetic values', () => {
    const data = buildCustomMecData(buildCustomProfileResponse());
    const row = data.rowsByView.get('broadEcosystem')?.[0];

    expect(data.status).toBe('complete');
    expect(data.hasSolutionCoverage).toBe(true);
    expect(
      buildCustomMecData({ ...buildCustomProfileResponse(), solution_id: null })
        .hasSolutionCoverage,
    ).toBe(false);
    expect(data.previewByView.get('broadEcosystem')).toEqual([{ label: 'Forest', percent: 80 }]);
    expect(row).toMatchObject({
      id: 'forest',
      ecosystemAreaKm2: 8,
      ecosystemSharePercent: 80,
      nationalClassPercent: 20,
      solutionCoverageKm2: 4,
      solutionCoveragePercent: 50,
      preExistingCoverageKm2: 1,
      newPrioritizrCoverageKm2: 3,
    });
    expect(data.scopeSummary).toMatchObject({
      scopeAreaKm2: 12,
      classifiedKm2: 10,
      unclassifiedKm2: 2,
    });
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
    expect(isWholeMetricCompatibleSirapAoi(territorialAoi)).toBe(true);
    expect(isWholeMetricCompatibleSirapAoi(thematicAoi)).toBe(true);
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
