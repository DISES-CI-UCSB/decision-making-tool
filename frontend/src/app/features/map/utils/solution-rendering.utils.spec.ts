import type { LoadedSolution } from '@core/models/solution-catalog.model';
import { solutionClassColors, spatialReferenceForRaster } from './solution-rendering.utils';

const loaded = {
  solution: {
    id: 'solution-runap',
    name: 'Solution',
    filename: 'solution.tif',
    constraints: [],
    rendering: {
      renderMode: 'categorical',
      classColors: [
        { value: 1, color: '#16a34a', label: 'New coverage' },
        { value: 2, color: '#2563eb', label: 'Existing protected areas' },
      ],
    },
    finderInputs: { includeLayerIds: ['runap'] },
    inputLayerIds: { includes: ['runap'] },
  },
} as unknown as LoadedSolution;

describe('solution rendering utilities', () => {
  it('builds separate class colors when existing protected coverage is shown', () => {
    expect(
      solutionClassColors(loaded, '#ff0000', {
        existingProtectedColorHex: '#f97316',
        showExistingProtectedCoverage: true,
      }),
    ).toEqual([
      { value: 2, color: '#f97316', label: 'Included areas in solution (RUNAP)' },
      { value: 1, color: '#ff0000', label: 'New coverage' },
    ]);
  });

  it('collapses both selected classes when existing protected coverage is hidden', () => {
    expect(
      solutionClassColors(loaded, '#ff0000', {
        showExistingProtectedCoverage: false,
      }),
    ).toEqual([
      { value: 2, color: '#ff0000', label: 'Selected solution' },
      { value: 1, color: '#ff0000', label: 'Selected solution' },
    ]);
  });

  it('derives ArcGIS spatial references without Angular state', () => {
    expect(
      spatialReferenceForRaster({
        crs: 'EPSG:9377',
      } as LoadedSolution['rasterMeta']),
    ).toEqual({ wkid: 9377 });
    expect(
      spatialReferenceForRaster({
        crs: 'Unknown',
      } as LoadedSolution['rasterMeta']),
    ).toEqual({ wkid: 4326 });
  });
});
