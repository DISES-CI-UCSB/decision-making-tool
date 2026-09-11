export type SpeciesCoverageSortColumnId =
  | 'name'
  | 'nationalRangeKm2'
  | 'rangeInAoiPercent'
  | 'preExistingRelativeHeld'
  | 'newRelativeHeld'
  | 'relativeHeld';

export type SpeciesCoverageSortDirection = 'asc' | 'desc';

export interface SpeciesCoverageSortState {
  columnId: SpeciesCoverageSortColumnId;
  direction: SpeciesCoverageSortDirection;
}

export const DEFAULT_SPECIES_COVERAGE_SORT: SpeciesCoverageSortState = {
  columnId: 'relativeHeld',
  direction: 'desc',
};

export const SPECIES_COVERAGE_SORT_SHORTCUT_IDS = [
  'coverage-desc',
  'coverage-asc',
  'name',
] as const;

export type SpeciesCoverageSortShortcutId = (typeof SPECIES_COVERAGE_SORT_SHORTCUT_IDS)[number];

const SPECIES_COVERAGE_SORT_COLUMN_IDS: readonly SpeciesCoverageSortColumnId[] = [
  'name',
  'nationalRangeKm2',
  'rangeInAoiPercent',
  'preExistingRelativeHeld',
  'newRelativeHeld',
  'relativeHeld',
];

const SORT_SHORTCUTS: Record<SpeciesCoverageSortShortcutId, SpeciesCoverageSortState> = {
  'coverage-desc': { columnId: 'relativeHeld', direction: 'desc' },
  'coverage-asc': { columnId: 'relativeHeld', direction: 'asc' },
  name: { columnId: 'name', direction: 'asc' },
};

export function nextSpeciesCoverageSortState(
  current: SpeciesCoverageSortState,
  columnId: SpeciesCoverageSortColumnId,
): SpeciesCoverageSortState {
  if (current.columnId === columnId) {
    return { columnId, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { columnId, direction: 'asc' };
}

export function speciesCoverageSortSelectValue(state: SpeciesCoverageSortState): string {
  if (state.columnId === 'relativeHeld' && state.direction === 'desc') {
    return 'coverage-desc';
  }
  if (state.columnId === 'relativeHeld' && state.direction === 'asc') {
    return 'coverage-asc';
  }
  if (state.columnId === 'name' && state.direction === 'asc') {
    return 'name';
  }
  return `${state.columnId}:${state.direction}`;
}

export function parseSpeciesCoverageSortSelectValue(value: string): SpeciesCoverageSortState {
  if (isSpeciesCoverageSortShortcutId(value)) {
    return { ...SORT_SHORTCUTS[value] };
  }
  const [columnId, direction] = value.split(':');
  if (
    isSpeciesCoverageSortColumnId(columnId) &&
    (direction === 'asc' || direction === 'desc')
  ) {
    return { columnId, direction };
  }
  return { ...DEFAULT_SPECIES_COVERAGE_SORT };
}

export function speciesCoverageSortColumnFromHeading(
  headingId: string,
): SpeciesCoverageSortColumnId | null {
  switch (headingId) {
    case 'name':
    case 'species':
    case 'feature':
      return 'name';
    case 'nationalRange':
    case 'range':
    case 'nationalRangeKm2':
      return 'nationalRangeKm2';
    case 'rangeInAoi':
    case 'range-in-aoi':
      return 'rangeInAoiPercent';
    case 'preExistingCoverage':
    case 'pre-existing-coverage':
      return 'preExistingRelativeHeld';
    case 'newCoverage':
    case 'new-coverage':
      return 'newRelativeHeld';
    case 'solutionCoverage':
    case 'total-coverage':
    case 'coverage':
      return 'relativeHeld';
    default:
      return null;
  }
}

export function speciesCoverageSortAria(
  state: SpeciesCoverageSortState,
  columnId: SpeciesCoverageSortColumnId,
): 'ascending' | 'descending' | 'none' {
  if (state.columnId !== columnId) {
    return 'none';
  }
  return state.direction === 'asc' ? 'ascending' : 'descending';
}

export function speciesCoverageSortIndicator(
  state: SpeciesCoverageSortState,
  columnId: SpeciesCoverageSortColumnId,
): SpeciesCoverageSortDirection | 'none' {
  if (state.columnId !== columnId) {
    return 'none';
  }
  return state.direction;
}

export function sortSpeciesCoverageRows<T>(
  rows: readonly T[],
  state: SpeciesCoverageSortState,
  locale: string,
  getValue: (row: T, columnId: SpeciesCoverageSortColumnId) => string | number | null,
  getRowId: (row: T) => string = speciesCoverageRowId,
): T[] {
  return [...rows].sort((left, right) => {
    const primary = compareSpeciesCoverageValues(
      getValue(left, state.columnId),
      getValue(right, state.columnId),
      state.direction,
      locale,
    );
    if (primary !== 0) {
      return primary;
    }
    if (state.columnId !== 'name') {
      const byName = compareSpeciesCoverageValues(
        getValue(left, 'name'),
        getValue(right, 'name'),
        state.direction,
        locale,
      );
      if (byName !== 0) {
        return byName;
      }
    }
    return compareSpeciesCoverageValues(getRowId(left), getRowId(right), state.direction, locale);
  });
}

export function compareSpeciesCoverageValues(
  left: string | number | null,
  right: string | number | null,
  direction: SpeciesCoverageSortDirection,
  locale: string,
): number {
  if (typeof left === 'string' || typeof right === 'string') {
    const compared = String(left ?? '').localeCompare(String(right ?? ''), locale);
    return direction === 'asc' ? compared : -compared;
  }

  const leftMissing = left === null || !Number.isFinite(left);
  const rightMissing = right === null || !Number.isFinite(right);
  if (leftMissing && rightMissing) {
    return 0;
  }
  if (leftMissing) {
    return 1;
  }
  if (rightMissing) {
    return -1;
  }

  const compared = left - right;
  return direction === 'asc' ? compared : -compared;
}

function speciesCoverageRowId<T>(row: T): string {
  if (row !== null && typeof row === 'object' && 'id' in row) {
    const id = (row as { id: unknown }).id;
    return id == null ? '' : String(id);
  }
  return '';
}

function isSpeciesCoverageSortShortcutId(value: string): value is SpeciesCoverageSortShortcutId {
  return SPECIES_COVERAGE_SORT_SHORTCUT_IDS.some((shortcutId) => shortcutId === value);
}

function isSpeciesCoverageSortColumnId(value: string): value is SpeciesCoverageSortColumnId {
  return SPECIES_COVERAGE_SORT_COLUMN_IDS.some((columnId) => columnId === value);
}
