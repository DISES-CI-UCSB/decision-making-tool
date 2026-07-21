export type EcosystemClassificationView =
  | 'biomeFamily'
  | 'broadBiomeContext'
  | 'biomeRegion'
  | 'broadEcosystem'
  | 'detailedEcosystem';

export const IAVH_ECOSYSTEM_LAYER_ID = 'ecosistemas';
export const STRATEGIC_ECOSYSTEM_LAYER_IDS = new Set([
  'paramos',
  'wetlands',
  'bosque_seco',
  'mangroves',
]);

export const ECOSYSTEM_CLASSIFICATION_VIEW_OPTIONS: readonly {
  value: EcosystemClassificationView;
  labelKey: string;
}[] = [
  { value: 'biomeFamily', labelKey: 'mapLayersPanel.ecosystemClassification.biomeFamily' },
  {
    value: 'broadBiomeContext',
    labelKey: 'mapLayersPanel.ecosystemClassification.broadBiomeContext',
  },
  { value: 'biomeRegion', labelKey: 'mapLayersPanel.ecosystemClassification.biomeRegion' },
  { value: 'broadEcosystem', labelKey: 'mapLayersPanel.ecosystemClassification.broadEcosystem' },
  {
    value: 'detailedEcosystem',
    labelKey: 'mapLayersPanel.ecosystemClassification.detailedEcosystem',
  },
] as const;

export const ECOSYSTEM_CLASSIFICATION_VALUE_PREVIEW_LIMIT = 12;
export const IAVH_BIOME_REGION_CLASS_COUNT = 430;
export const IAVH_BIOME_REGION_LOOKUP_URL =
  'https://aagibolq28slyfof.public.blob.vercel-storage.com/inputs/features/ecosystems/ecosistemas_IDs_IAVH_2024.csv';
export const ECOSYSTEMS_COPY = {
  en: {
    groupTitle: 'Ecosystems',
    groupNote: '',
    iavhRowName: 'Ecosystems (Biome Family)',
    strategicGroupName: 'Strategic Ecosystems',
    otherBiomeFamily: 'Other / N.A.',
  },
  es: {
    groupTitle: 'Ecosistemas',
    groupNote: '',
    iavhRowName: 'Ecosistemas (Familia de bioma)',
    strategicGroupName: 'Ecosistemas estratégicos',
    otherBiomeFamily: 'Otro / N.A.',
  },
} as const;
export const IAVH_ECOSYSTEM_NO_DATA_VALUE = 4294967295;

export const IAVH_ECOSYSTEM_BIOME_GROUPS = [
  {
    label: { en: 'Orobioma', es: 'Orobioma' },
    color: '#4d7c0f',
    values: [
      14, 29, 33, 37, 38, 39, 41, 42, 43, 45, 46, 48, 49, 52, 53, 54, 55, 63, 64, 68, 74, 76, 77,
      80, 82, 84, 86, 87, 89, 90, 92, 93, 96, 97, 98, 99, 100, 101, 111, 112, 114, 116, 118, 122,
      124, 125, 126, 129, 132, 133, 134, 135, 136, 168, 176, 181, 182, 183, 184, 185, 187, 188, 189,
      197, 217, 218, 220, 221, 223, 224, 226, 227, 228, 231, 239, 241, 246, 248, 249, 250, 261, 264,
      265, 271, 278, 279, 280, 283, 292, 293, 312, 313, 314, 317, 318, 319, 320, 321, 322, 325, 327,
      328, 335, 336, 353, 355, 356, 357, 360, 361, 362, 363, 364, 365, 371, 373, 406, 409, 410, 411,
      413, 415, 416, 417, 419, 420, 421, 422, 423, 425, 426, 427, 428,
    ],
  },
  {
    label: { en: 'Zonobioma', es: 'Zonobioma' },
    color: '#15803d',
    values: [
      4, 5, 9, 15, 17, 21, 27, 34, 35, 47, 60, 78, 81, 83, 85, 91, 95, 102, 105, 106, 108, 110, 115,
      117, 120, 121, 123, 127, 139, 143, 147, 152, 154, 162, 165, 170, 177, 193, 196, 199, 206, 212,
      219, 230, 234, 240, 243, 245, 251, 252, 254, 263, 266, 272, 275, 277, 286, 288, 296, 297, 301,
      302, 305, 309, 323, 326, 332, 333, 334, 340, 342, 347, 350, 352, 359, 367, 368, 372, 379, 384,
      385, 386, 388, 389, 392, 393, 394, 398, 399, 404,
    ],
  },
  {
    label: { en: 'Hidrobioma', es: 'Hidrobioma' },
    color: '#0369a1',
    values: [
      1, 11, 13, 19, 23, 25, 26, 31, 40, 44, 57, 59, 62, 66, 73, 75, 88, 104, 107, 113, 131, 142,
      146, 150, 151, 160, 172, 174, 180, 194, 201, 204, 209, 211, 215, 216, 225, 233, 244, 247, 256,
      257, 258, 262, 274, 276, 285, 295, 298, 310, 316, 324, 331, 345, 351, 358, 374, 377, 382, 383,
      387, 396, 401, 405,
    ],
  },
  {
    label: { en: 'Helobioma', es: 'Helobioma' },
    color: '#0f766e',
    values: [
      2, 7, 8, 12, 16, 20, 24, 30, 32, 36, 50, 51, 56, 61, 65, 79, 94, 103, 109, 128, 130, 138, 141,
      145, 148, 149, 161, 164, 169, 179, 191, 198, 203, 210, 214, 232, 237, 238, 242, 253, 259, 260,
      267, 268, 282, 287, 294, 299, 311, 315, 330, 341, 344, 346, 349, 354, 376, 381, 390, 395, 402,
      407, 408,
    ],
  },
  {
    label: { en: 'Peinobioma', es: 'Peinobioma' },
    color: '#a16207',
    values: [
      3, 6, 10, 18, 28, 67, 69, 71, 119, 140, 144, 156, 157, 158, 163, 166, 171, 178, 186, 192, 202,
      207, 213, 229, 236, 269, 270, 281, 284, 289, 290, 303, 306, 308, 338, 339, 343, 369, 370, 380,
      391, 412, 430,
    ],
  },
  {
    label: { en: 'Litobioma', es: 'Litobioma' },
    color: '#78716c',
    values: [
      137, 153, 155, 159, 167, 173, 175, 190, 195, 200, 205, 208, 222, 235, 307, 329, 337, 348, 366,
      375, 378, 418, 424, 429,
    ],
  },
  {
    label: { en: 'Halobioma', es: 'Halobioma' },
    color: '#0e7490',
    values: [22, 58, 72, 255, 273, 291, 300, 304, 397, 400, 403, 414],
  },
  {
    label: { en: ECOSYSTEMS_COPY.en.otherBiomeFamily, es: ECOSYSTEMS_COPY.es.otherBiomeFamily },
    color: '#64748b',
    values: [70],
  },
] as const;

export const IAVH_BIOME_FAMILY_COLOR_RULES = [
  { prefix: 'Orobioma', hue: 92, saturation: 62 },
  { prefix: 'Zonobioma', hue: 138, saturation: 58 },
  { prefix: 'Hidrobioma', hue: 202, saturation: 70 },
  { prefix: 'Helobioma', hue: 174, saturation: 60 },
  { prefix: 'Peinobioma', hue: 38, saturation: 70 },
  { prefix: 'Litobioma', hue: 32, saturation: 18 },
  { prefix: 'Halobioma', hue: 190, saturation: 68 },
  { prefix: 'N.A.', hue: 215, saturation: 12 },
] as const;

export const IAVH_BIOME_REGION_SAMPLE_COLORS = [
  '#4d7c0f',
  '#15803d',
  '#0369a1',
  '#0f766e',
  '#a16207',
  '#78716c',
] as const;
