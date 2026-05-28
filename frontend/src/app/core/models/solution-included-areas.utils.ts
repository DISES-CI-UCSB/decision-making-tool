import type { LayerLocale } from './layer-manifest.model';
import type { SolutionScenario } from './solution-scenario.model';

export type SolutionIncludedAreaKey = 'runap' | 'omecs' | 'afroIndigenous';

const INCLUDED_AREA_LABELS: Record<SolutionIncludedAreaKey, Record<LayerLocale, string>> = {
  runap: {
    en: 'RUNAP',
    es: 'RUNAP',
  },
  omecs: {
    en: 'OMECs',
    es: 'OMECs',
  },
  afroIndigenous: {
    en: 'Afro-Colombian and Indigenous territories',
    es: 'territorios afrocolombianos e indigenas',
  },
};

const LEGEND_PREFIX: Record<LayerLocale, string> = {
  en: 'Included areas in solution',
  es: 'Areas incluidas en la solucion',
};

export function getSolutionIncludedAreaKeys(scenario: SolutionScenario): SolutionIncludedAreaKey[] {
  const normalizedSource = [
    scenario.id,
    scenario.name,
    scenario.filename,
    ...scenario.constraints,
    ...scenario.finderInputs.includeLayerIds,
    ...scenario.inputLayerIds.includes,
  ]
    .join(' ')
    .toLowerCase();

  const keys: SolutionIncludedAreaKey[] = [];

  if (normalizedSource.includes('runap')) {
    keys.push('runap');
  }
  if (normalizedSource.includes('omec')) {
    keys.push('omecs');
  }
  if (
    normalizedSource.includes('comunidades') ||
    normalizedSource.includes('afro') ||
    normalizedSource.includes('resguardos') ||
    normalizedSource.includes('indigenous') ||
    normalizedSource.includes('indigena')
  ) {
    keys.push('afroIndigenous');
  }

  return keys;
}

export function getSolutionIncludedAreaLabels(
  scenario: SolutionScenario,
  locale: LayerLocale = 'en',
): string[] {
  return getSolutionIncludedAreaKeys(scenario).map((key) => INCLUDED_AREA_LABELS[key][locale]);
}

export function getSolutionIncludedAreasLegendLabel(
  scenario: SolutionScenario,
  locale: LayerLocale = 'en',
): string {
  const labels = getSolutionIncludedAreaLabels(scenario, locale);
  const prefix = LEGEND_PREFIX[locale];

  return labels.length > 0 ? `${prefix} (${labels.join(' + ')})` : prefix;
}
