export type AoiType = 'municipality' | 'department' | 'sirap';

export interface AOI {
  id: string;
  name: string;
  type: AoiType;
  geometryUrl: string;
}
