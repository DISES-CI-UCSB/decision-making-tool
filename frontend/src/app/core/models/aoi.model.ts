export type AoiType = 'municipality' | 'department' | 'sirap' | 'omec' | 'runap';

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
}
