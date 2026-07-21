import type {
  RuntimeLayerManifestClassColor,
  RuntimeLayerManifestRenderingConfig,
} from '@core/models';
import {
  IAVH_BIOME_FAMILY_COLOR_RULES,
  IAVH_BIOME_REGION_CLASS_COUNT,
  IAVH_ECOSYSTEM_BIOME_GROUPS,
  IAVH_ECOSYSTEM_NO_DATA_VALUE,
  type EcosystemClassificationView,
} from './map-layers-panel-ecosystem.config';
import type { SupportedLanguage } from './map-layers-panel.utils';

export interface IavhBiomeRegionClass {
  value: number;
  label: string;
}

export function parseCsvLine(line: string): string[] {
  const columns: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && inQuotes && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      columns.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  columns.push(current);
  return columns;
}

export function parseIavhBiomeRegionCsv(csvText: string): IavhBiomeRegionClass[] {
  const [headerLine, ...rows] = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!headerLine) {
    return [];
  }

  const headers = parseCsvLine(headerLine).map((header) => header.trim());
  const biomeIndex = headers.indexOf('biome');
  const idIndex = headers.indexOf('biome_id');
  if (biomeIndex < 0 || idIndex < 0) {
    return [];
  }

  return rows
    .map((line) => {
      const columns = parseCsvLine(line);
      const value = Number(columns[idIndex]);
      const label = columns[biomeIndex]?.trim();
      return Number.isInteger(value) && label ? { value, label } : null;
    })
    .filter((item): item is IavhBiomeRegionClass => item !== null)
    .sort((left, right) => left.value - right.value);
}

export function fallbackIavhBiomeRegionClasses(): IavhBiomeRegionClass[] {
  return Array.from({ length: IAVH_BIOME_REGION_CLASS_COUNT }, (_, index) => ({
    value: index + 1,
    label: `IAvH class ${index + 1}`,
  }));
}

export function hslToHex(hue: number, saturationPercent: number, lightnessPercent: number): string {
  const saturation = saturationPercent / 100;
  const lightness = lightnessPercent / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const huePrime = hue / 60;
  const secondComponent = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const match = lightness - chroma / 2;
  const [red, green, blue] =
    huePrime < 1
      ? [chroma, secondComponent, 0]
      : huePrime < 2
        ? [secondComponent, chroma, 0]
        : huePrime < 3
          ? [0, chroma, secondComponent]
          : huePrime < 4
            ? [0, secondComponent, chroma]
            : huePrime < 5
              ? [secondComponent, 0, chroma]
              : [chroma, 0, secondComponent];

  return `#${[red, green, blue]
    .map((channel) =>
      Math.round((channel + match) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export function colorForIavhBiomeRegion(label: string, value: number): string {
  const familyRule =
    IAVH_BIOME_FAMILY_COLOR_RULES.find((rule) => label.startsWith(rule.prefix)) ??
    IAVH_BIOME_FAMILY_COLOR_RULES[IAVH_BIOME_FAMILY_COLOR_RULES.length - 1];
  const lightnessSteps = [34, 40, 46, 52, 58, 64, 70, 44, 50, 56, 62, 68];
  const lightness = lightnessSteps[value % lightnessSteps.length];
  const hue = (familyRule.hue + ((value * 7) % 18) - 9 + 360) % 360;
  return hslToHex(hue, familyRule.saturation, lightness);
}

export function buildIavhEcosystemGroupedRendering(
  language: SupportedLanguage,
): RuntimeLayerManifestRenderingConfig {
  return {
    valueType: 'categorical',
    renderMode: 'categorical',
    noDataValue: IAVH_ECOSYSTEM_NO_DATA_VALUE,
    classColors: IAVH_ECOSYSTEM_BIOME_GROUPS.flatMap((group) =>
      group.values.map((value) => ({
        value,
        color: group.color,
        label: group.label[language],
      })),
    ),
  };
}

export function buildIavhBiomeRegionClassColors(
  classes: IavhBiomeRegionClass[] | null,
): RuntimeLayerManifestClassColor[] {
  return (classes ?? fallbackIavhBiomeRegionClasses()).map(({ value, label }) => ({
    value,
    color: colorForIavhBiomeRegion(label, value),
    label,
    englishLabel: label,
    spanishLabel: label,
  }));
}

export function buildIavhBiomeRegionRendering(
  classes: IavhBiomeRegionClass[] | null,
): RuntimeLayerManifestRenderingConfig {
  return {
    valueType: 'categorical',
    renderMode: 'categorical',
    noDataValue: IAVH_ECOSYSTEM_NO_DATA_VALUE,
    classColors: buildIavhBiomeRegionClassColors(classes),
  };
}

export function buildIavhEcosystemRendering(
  view: EcosystemClassificationView,
  language: SupportedLanguage,
  classes: IavhBiomeRegionClass[] | null,
): RuntimeLayerManifestRenderingConfig {
  return view === 'biomeRegion'
    ? buildIavhBiomeRegionRendering(classes)
    : buildIavhEcosystemGroupedRendering(language);
}
