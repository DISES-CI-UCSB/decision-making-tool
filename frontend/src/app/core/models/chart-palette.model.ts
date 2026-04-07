export type ChartPaletteId =
  | 'okabeIto'
  | 'tolBright'
  | 'tolMuted'
  | 'viridisBalanced'
  | 'cividisBalanced';

export interface ChartPalette {
  id: ChartPaletteId;
  name: string;
  description: string;
  colors: readonly [string, string, string, string, string];
}

export interface AoiEcosystemSegment {
  id: string;
  label: string;
  percent: number;
}

export const CHART_PALETTE_IDS: readonly ChartPaletteId[] = [
  'okabeIto',
  'tolBright',
  'tolMuted',
  'viridisBalanced',
  'cividisBalanced',
] as const;

export const AOI_ECOSYSTEM_SEGMENTS: readonly AoiEcosystemSegment[] = [
  { id: 'cloud-forest', label: 'Cloud Forest', percent: 39 },
  { id: 'paramo', label: 'Páramo', percent: 23 },
  { id: 'dry-forest', label: 'Dry Forest', percent: 17 },
  { id: 'wetlands', label: 'Wetlands', percent: 12 },
  { id: 'other', label: 'Other', percent: 9 },
] as const;

/**
 * Palettes selected for color-vision deficiency resilience:
 * - Avoid red/green-only differentiation.
 * - Keep hue and lightness separation for adjacent slices.
 * - Keep all colors visible on light UI backgrounds.
 */
export const CHART_PALETTES: Record<ChartPaletteId, ChartPalette> = {
  okabeIto: {
    id: 'okabeIto',
    name: 'Okabe-Ito',
    description: 'High-clarity categorical palette for color-blind-safe comparisons.',
    colors: ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#D55E00'],
  },
  tolBright: {
    id: 'tolBright',
    name: 'Tol Bright',
    description: 'Balanced high-contrast palette with strong categorical distinction.',
    colors: ['#4477AA', '#EE6677', '#228833', '#CCBB44', '#66CCEE'],
  },
  tolMuted: {
    id: 'tolMuted',
    name: 'Tol Muted',
    description: 'Lower-saturation option with clear hue spacing for dense dashboards.',
    colors: ['#332288', '#88CCEE', '#44AA99', '#DDCC77', '#CC6677'],
  },
  viridisBalanced: {
    id: 'viridisBalanced',
    name: 'Viridis Balanced',
    description: 'Perceptually uniform palette useful when ordering matters visually.',
    colors: ['#443A83', '#31688E', '#21918C', '#35B779', '#90D743'],
  },
  cividisBalanced: {
    id: 'cividisBalanced',
    name: 'Cividis Balanced',
    description: 'Color-blind-aware palette with restrained contrast and stable luminance.',
    colors: ['#123570', '#3B4F8A', '#616D8A', '#8D8D74', '#B6AD57'],
  },
};

export const DEFAULT_CHART_PALETTE_ID: ChartPaletteId = 'okabeIto';
