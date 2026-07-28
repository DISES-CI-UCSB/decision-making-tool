export type AoiType = 'municipality' | 'department' | 'sirap' | 'omec' | 'runap' | 'custom';
export type BoundaryGeometrySelection = 'whole-feature' | 'component';

export const PRODUCTION_SIRAP_BOUNDARY_SOURCE = {
  layerKey: 'siraps',
  sourceId: 'aoi-siraps-combined-colombia',
  pathname: 'inputs/boundaries/sirap/siraps_merged_polygon_v2.geojson',
  sha256: '2a44a7a4726448959432924a11703250a444fe9e06be3324563e7b89d14912de',
  featureCount: 10,
} as const;

export interface AOI {
  id: string;
  name: string;
  type: AoiType;
  /**
   * Optional secondary label (e.g. RUNAP management category like "Parque
   * Nacional Natural"). When present, the AOI panel surfaces this above the
   * name instead of the generic `type` label.
   */
  subtype?: string;
  geometryUrl: string;
  /** Canonical application layer key for a boundary-backed AOI. */
  boundarySourceLayerKey?: string;
  /** Canonical source/configuration ID for a boundary-backed AOI. */
  boundarySourceId?: string;
  /** Actual geometry selected from the source feature, independent of UI toggle state. */
  boundaryGeometrySelection?: BoundaryGeometrySelection;
  /** Browser-computed selected AOI area, used for local percentage metrics. */
  areaKm2?: number;
}
