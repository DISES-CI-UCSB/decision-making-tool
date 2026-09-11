import {
  compareSpeciesCoverageValues,
  DEFAULT_SPECIES_COVERAGE_SORT,
  nextSpeciesCoverageSortState,
  parseSpeciesCoverageSortSelectValue,
  speciesCoverageSortColumnFromHeading,
  speciesCoverageSortSelectValue,
  sortSpeciesCoverageRows,
} from './species-coverage-sort.utils';

describe('species-coverage-sort.utils', () => {
  it('defaults to total scenario coverage descending', () => {
    expect(DEFAULT_SPECIES_COVERAGE_SORT).toEqual({
      columnId: 'relativeHeld',
      direction: 'desc',
    });
    expect(speciesCoverageSortSelectValue(DEFAULT_SPECIES_COVERAGE_SORT)).toBe('coverage-desc');
  });

  it('uses ascending on the first click and toggles the active column', () => {
    const firstRangeClick = nextSpeciesCoverageSortState(
      DEFAULT_SPECIES_COVERAGE_SORT,
      'rangeInAoiPercent',
    );
    expect(firstRangeClick).toEqual({ columnId: 'rangeInAoiPercent', direction: 'asc' });
    expect(nextSpeciesCoverageSortState(firstRangeClick, 'rangeInAoiPercent')).toEqual({
      columnId: 'rangeInAoiPercent',
      direction: 'desc',
    });
    expect(nextSpeciesCoverageSortState(DEFAULT_SPECIES_COVERAGE_SORT, 'name')).toEqual({
      columnId: 'name',
      direction: 'asc',
    });
  });

  it('keeps dropdown shortcuts in sync and generates other column options', () => {
    expect(
      parseSpeciesCoverageSortSelectValue('coverage-asc'),
    ).toEqual({ columnId: 'relativeHeld', direction: 'asc' });
    expect(parseSpeciesCoverageSortSelectValue('name')).toEqual({
      columnId: 'name',
      direction: 'asc',
    });
    expect(
      speciesCoverageSortSelectValue({ columnId: 'rangeInAoiPercent', direction: 'asc' }),
    ).toBe('rangeInAoiPercent:asc');
    expect(parseSpeciesCoverageSortSelectValue('preExistingRelativeHeld:desc')).toEqual({
      columnId: 'preExistingRelativeHeld',
      direction: 'desc',
    });
  });

  it('maps national and expanded heading ids onto the correct sort fields', () => {
    expect(speciesCoverageSortColumnFromHeading('rangeInAoi')).toBe('rangeInAoiPercent');
    expect(speciesCoverageSortColumnFromHeading('preExistingCoverage')).toBe(
      'preExistingRelativeHeld',
    );
    expect(speciesCoverageSortColumnFromHeading('newCoverage')).toBe('newRelativeHeld');
    expect(speciesCoverageSortColumnFromHeading('solutionCoverage')).toBe('relativeHeld');
    expect(speciesCoverageSortColumnFromHeading('nationalRange')).toBe('nationalRangeKm2');
    expect(speciesCoverageSortColumnFromHeading('total-coverage')).toBe('relativeHeld');
    expect(speciesCoverageSortColumnFromHeading('checkpoints')).toBeNull();
  });

  it('sorts missing numeric values last in both directions', () => {
    expect(compareSpeciesCoverageValues(null, 0, 'asc', 'en')).toBeGreaterThan(0);
    expect(compareSpeciesCoverageValues(null, 0, 'desc', 'en')).toBeGreaterThan(0);
    expect(compareSpeciesCoverageValues(0.1, 0.9, 'asc', 'en')).toBeLessThan(0);
  });

  it('sorts rows by the requested coverage field', () => {
    const rows = [
      { name: 'Zebra', relativeHeld: 0.9, rangeInAoiPercent: 0.1, nationalRangeKm2: 10 },
      { name: 'Asp', relativeHeld: 0.2, rangeInAoiPercent: 0.8, nationalRangeKm2: 200 },
    ];
    const getValue = (
      row: (typeof rows)[number],
      columnId: 'name' | 'nationalRangeKm2' | 'rangeInAoiPercent' | 'relativeHeld' | string,
    ) =>
      columnId === 'name' ||
      columnId === 'relativeHeld' ||
      columnId === 'rangeInAoiPercent' ||
      columnId === 'nationalRangeKm2'
        ? row[columnId]
        : null;

    expect(
      sortSpeciesCoverageRows(rows, DEFAULT_SPECIES_COVERAGE_SORT, 'en', getValue).map(
        (row) => row.name,
      ),
    ).toEqual(['Zebra', 'Asp']);
    expect(
      sortSpeciesCoverageRows(
        rows,
        { columnId: 'rangeInAoiPercent', direction: 'asc' },
        'en',
        getValue,
      ).map((row) => row.name),
    ).toEqual(['Zebra', 'Asp']);
    expect(
      sortSpeciesCoverageRows(rows, { columnId: 'name', direction: 'asc' }, 'en', getValue).map(
        (row) => row.name,
      ),
    ).toEqual(['Asp', 'Zebra']);
  });

  it('reverses tied 100% coverage rows when toggling coverage direction', () => {
    const rows = [
      { id: 'a', name: 'Abarema adenophora', relativeHeld: 1 },
      { id: 'b', name: 'Abarema auriculata', relativeHeld: 1 },
      { id: 'z', name: 'Zygia latifolia', relativeHeld: 1 },
    ];
    const names = (
      direction: 'asc' | 'desc',
    ) =>
      sortSpeciesCoverageRows(
        rows,
        { columnId: 'relativeHeld', direction },
        'en',
        (row, columnId) => (columnId === 'name' ? row.name : row.relativeHeld),
        (row) => row.id,
      ).map((row) => row.name);

    expect(names('desc')).toEqual([
      'Zygia latifolia',
      'Abarema auriculata',
      'Abarema adenophora',
    ]);
    expect(names('asc')).toEqual([
      'Abarema adenophora',
      'Abarema auriculata',
      'Zygia latifolia',
    ]);
    expect(names('desc')).not.toEqual(names('asc'));
  });

  it('puts the lowest coverage first on ascending even when most rows are 100%', () => {
    const rows = [
      { id: 'a', name: 'Abarema adenophora', relativeHeld: 1 },
      { id: 'low', name: 'Zygia latifolia', relativeHeld: 0.12 },
      { id: 'b', name: 'Abarema auriculata', relativeHeld: 1 },
    ];
    const getValue = (
      row: (typeof rows)[number],
      columnId: 'name' | 'relativeHeld' | string,
    ) => (columnId === 'name' ? row.name : row.relativeHeld);

    expect(
      sortSpeciesCoverageRows(
        rows,
        { columnId: 'relativeHeld', direction: 'asc' },
        'en',
        getValue,
      ).map((row) => row.name),
    ).toEqual(['Zygia latifolia', 'Abarema adenophora', 'Abarema auriculata']);
    expect(
      sortSpeciesCoverageRows(
        rows,
        { columnId: 'relativeHeld', direction: 'desc' },
        'en',
        getValue,
      ).map((row) => row.name),
    ).toEqual(['Abarema auriculata', 'Abarema adenophora', 'Zygia latifolia']);
  });
});
