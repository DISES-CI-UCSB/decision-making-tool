import type { RuntimeLayerManifestClassColor } from '@core/models/layer-manifest.model';
import type { LoadedSolution, RasterMetadata } from '@core/models/solution-catalog.model';
import { getSolutionIncludedAreasLegendLabel } from '@core/models/solution-included-areas.utils';
import { EXISTING_PROTECTED_VALUE, NEW_COVERAGE_VALUE } from './solution-raster.utils';

export const DEFAULT_SINGLE_SOLUTION_HEX = '#16a34a';
export const DEFAULT_EXISTING_PROTECTED_HEX = '#2563eb';
export const DEFAULT_COMPARISON_BASELINE_HEX = DEFAULT_SINGLE_SOLUTION_HEX;
export const DEFAULT_COMPARISON_CANDIDATE_HEX = '#7c3aed';
export const DEFAULT_COMPARISON_OVERLAP_HEX = '#ec4899';
export const DEFAULT_SOLUTION_LAYER_OPACITY = 0.8;

export const DEFAULT_RASTER_WKID = 4326;

export interface SolutionRenderOptions {
  collapseExistingProtectedCoverage?: boolean;
  existingProtectedColorHex?: string;
  showExistingProtectedCoverage?: boolean;
}

export function solutionClassColors(
  loaded: LoadedSolution,
  newCoverageColorHex: string,
  options: SolutionRenderOptions = {},
): RuntimeLayerManifestClassColor[] {
  const classColors =
    loaded.solution.rendering.renderMode === 'categorical'
      ? (loaded.solution.rendering.classColors ?? [])
      : [];
  const existingProtectedClass = classColors.find(
    (entry) => entry.value === EXISTING_PROTECTED_VALUE,
  );
  const newCoverageClass = classColors.find((entry) => entry.value === NEW_COVERAGE_VALUE);
  const selectedSolutionColor =
    newCoverageColorHex || newCoverageClass?.color || DEFAULT_SINGLE_SOLUTION_HEX;

  if (
    options.collapseExistingProtectedCoverage ||
    options.showExistingProtectedCoverage === false
  ) {
    return [
      {
        value: EXISTING_PROTECTED_VALUE,
        color: selectedSolutionColor,
        label: 'Selected scenario',
      },
      {
        value: NEW_COVERAGE_VALUE,
        color: selectedSolutionColor,
        label: 'Selected scenario',
      },
    ];
  }

  return [
    {
      value: EXISTING_PROTECTED_VALUE,
      color:
        options.existingProtectedColorHex ??
        existingProtectedClass?.color ??
        DEFAULT_EXISTING_PROTECTED_HEX,
      label: getSolutionIncludedAreasLegendLabel(loaded.solution),
    },
    {
      value: NEW_COVERAGE_VALUE,
      color: selectedSolutionColor,
      label: newCoverageClass?.label ?? 'Candidate conservation areas',
    },
  ];
}

export function defaultExistingProtectedColor(loaded: LoadedSolution): string {
  const classColors =
    loaded.solution.rendering.renderMode === 'categorical'
      ? (loaded.solution.rendering.classColors ?? [])
      : [];
  return (
    classColors.find((entry) => entry.value === EXISTING_PROTECTED_VALUE)?.color ??
    DEFAULT_EXISTING_PROTECTED_HEX
  );
}

export function defaultSolutionClassColors(
  newCoverageColorHex: string,
): RuntimeLayerManifestClassColor[] {
  return [
    {
      value: NEW_COVERAGE_VALUE,
      color: newCoverageColorHex || DEFAULT_SINGLE_SOLUTION_HEX,
      label: 'Candidate conservation areas',
    },
  ];
}

export function normalizeHexColor(color: string): string | null {
  const trimmed = color.trim();
  return /^#([0-9a-fA-F]{6})$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function hexToRgb(hexColor: string): [number, number, number] | null {
  const normalized = normalizeHexColor(hexColor);
  if (!normalized) return null;

  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
}

export function spatialReferenceForRaster(rasterMeta: RasterMetadata): { wkid: number } {
  return { wkid: wkidFromRasterCrs(rasterMeta.crs) ?? DEFAULT_RASTER_WKID };
}

function wkidFromRasterCrs(crs: string): number | null {
  const match = crs
    .trim()
    .toUpperCase()
    .match(/^EPSG:(\d+)$/);
  if (!match) return null;

  const wkid = Number(match[1]);
  return Number.isInteger(wkid) && wkid > 0 ? wkid : null;
}
