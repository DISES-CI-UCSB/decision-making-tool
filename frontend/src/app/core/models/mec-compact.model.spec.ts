import {
  deriveMecNationalClassBenchmark,
  isMecCompactDocument,
  type MecCompactDocument,
  type MecCompactV2Document,
} from './mec-compact.model';

describe('MEC compact model guard', () => {
  const validDocument: MecCompactDocument = {
    format: 'mec-compact-v1',
    solutionId: 'land-solution',
    geographyLevel: 'departments',
    generatedAt: '2026-07-24T00:00:00Z',
    sourceMode: 'composite',
    units: 'km2',
    rowLayout: ['scopeIndex', 'classIndex', 'availableKm2', 'existingKm2', 'additionalKm2'],
    viewCatalog: [['broadEcosystem', 'Broad ecosystem']],
    classCatalog: [[0, 'broadEcosystem:forest', 'Forest']],
    scopeCatalog: [['05', 'Antioquia']],
    rows: [[0, 0, 10, 0, 4]],
    viewSupport: {
      supported: [{ view: 'broadEcosystem', mapping: 'authoritative', rule: 'Exact label.' }],
      unsupported: [],
    },
    semantics: {
      availableKm2: 'Available area.',
      existingKm2: 'Existing area.',
      additionalKm2: 'Additional area.',
      percentages: 'Area divided by available area.',
      invariants: 'Coverage does not exceed available area.',
    },
  };

  it('accepts valid tuples and zero area values', () => {
    expect(isMecCompactDocument(validDocument)).toBe(true);
  });

  it('rejects malformed layouts, catalog indexes, and impossible areas', () => {
    expect(
      isMecCompactDocument({
        ...validDocument,
        rowLayout: ['classIndex', 'scopeIndex'],
      }),
    ).toBe(false);
    expect(
      isMecCompactDocument({
        ...validDocument,
        classCatalog: [[9, 'broadEcosystem:forest', 'Forest']],
      }),
    ).toBe(false);
    expect(
      isMecCompactDocument({
        ...validDocument,
        rows: [[0, 0, 10, 8, 3]],
      }),
    ).toBe(false);
  });

  it('accepts v2 AOI scope stats while rejecting target attainment outside national shards', () => {
    const document = buildV2Document('departments');

    expect(isMecCompactDocument(document)).toBe(true);
    expect(
      isMecCompactDocument({
        ...document,
        nationalCoverageBenchmark: { targetPercent: 17 },
      }),
    ).toBe(false);
    expect(
      isMecCompactDocument({
        ...document,
        scopeStats: {
          0: {
            ...document.scopeStats['0'],
            unclassifiedKm2: 3,
          },
        },
      }),
    ).toBe(false);
  });

  it('requires a 17/30 benchmark only for national v2 and derives row status from areas', () => {
    const national = buildV2Document('national');

    expect(isMecCompactDocument(national)).toBe(true);
    expect(
      isMecCompactDocument({
        ...national,
        nationalCoverageBenchmark: undefined,
      }),
    ).toBe(false);
    expect(
      isMecCompactDocument({
        ...national,
        nationalCoverageBenchmark: { targetPercent: 25 },
      }),
    ).toBe(false);
    expect(deriveMecNationalClassBenchmark(national, national.rows[0])).toEqual({
      targetPercent: 30,
      targetAreaKm2: 3,
      totalCoveredKm2: 4,
      coveragePercent: 40,
      status: 'met',
      shortfallKm2: 0,
    });
    expect(deriveMecNationalClassBenchmark(national, [0, 0, 0, 0, 0])).toEqual({
      targetPercent: 30,
      targetAreaKm2: 0,
      totalCoveredKm2: 0,
      coveragePercent: null,
      status: 'not-applicable',
      shortfallKm2: 0,
    });
  });
});

function buildV2Document(
  geographyLevel: MecCompactV2Document['geographyLevel'],
): MecCompactV2Document {
  return {
    format: 'mec-compact-v2',
    solutionId: 'land-solution',
    geographyLevel,
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
    scopeCatalog: [[geographyLevel === 'national' ? 'colombia' : '05', 'Scope']],
    scopeStats: {
      0: {
        scopeAreaKm2: 12,
        classifiedKm2: 10,
        unclassifiedKm2: 2,
        boundaryProvenanceRef: geographyLevel,
      },
    },
    rows: [[0, 0, 10, 0, 4]],
    viewSupport: {
      supported: [{ view: 'broadEcosystem', mapping: 'authoritative', rule: 'Exact label.' }],
      unsupported: [],
    },
    semantics: {
      ecosystemAreaKm2: 'Ecosystem area in scope.',
      preExistingCoverageKm2: 'Pre-existing coverage.',
      newPrioritizrCoverageKm2: 'New Prioritizr coverage.',
      derivedValues: 'Derived values.',
      scopeStats: 'Scope statistics.',
      nationalBenchmark: 'National benchmark.',
      invariants: 'Coverage does not exceed ecosystem area.',
    },
    ...(geographyLevel === 'national'
      ? { nationalCoverageBenchmark: { applicability: 'national-only', targetPercent: 30 } }
      : {}),
  };
}
