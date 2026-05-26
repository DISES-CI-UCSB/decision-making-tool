export type AoiType = 'municipality' | 'department' | 'sirap' | 'omec';

export interface AOI {
  id: string;
  name: string;
  type: AoiType;
  geometryUrl: string;
}
