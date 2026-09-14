import type { LayerLocale } from './layer-manifest.model';
import type { CatalogSolution } from './solution-catalog.model';

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
    en: 'Community Councils for Black Communities and Indigenous Territories',
    es: 'Consejos Comunitarios de Comunidades Negras y Territorios Indígenas',
  },
};

const LEGEND_PREFIX: Record<LayerLocale, string> = {
  en: 'Existing conservation areas',
  es: 'Áreas de conservación existentes',
};

export interface SolutionOmecHintSource {
  id?: string | null;
  name?: string | null;
  filename?: string | null;
  rasterFile?: string | null;
  constraints?: readonly string[];
  finderInputs?: { includeLayerIds?: readonly string[] };
  inputLayerIds?: { includes?: readonly string[] };
}

function solutionIdentitySource(solution: SolutionOmecHintSource): string {
  return [
    solution.id,
    solution.name,
    solution.filename,
    solution.rasterFile,
    ...(solution.constraints ?? []),
    ...(solution.finderInputs?.includeLayerIds ?? []),
    ...(solution.inputLayerIds?.includes ?? []),
  ]
    .join(' ')
    .toLowerCase();
}

/** True when id/name/filename/include lists mention OMEC (finder `+OMEC_` / slug `-omec-`). */
export function solutionIndicatesOmec(solution: SolutionOmecHintSource): boolean {
  return solutionIdentitySource(solution).includes('omec');
}

export function getSolutionIncludedAreaKeys(solution: CatalogSolution): SolutionIncludedAreaKey[] {
  const normalizedSource = solutionIdentitySource(solution);

  const keys: SolutionIncludedAreaKey[] = [];

  if (normalizedSource.includes('runap')) {
    keys.push('runap');
  }
  if (solutionIndicatesOmec(solution)) {
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
  solution: CatalogSolution,
  locale: LayerLocale = 'en',
): string[] {
  return getSolutionIncludedAreaKeys(solution).map((key) => INCLUDED_AREA_LABELS[key][locale]);
}

export function getSolutionIncludedAreasLegendLabel(
  solution: CatalogSolution,
  locale: LayerLocale = 'en',
): string {
  const conservationAreaLabels = getSolutionIncludedAreaKeys(solution)
    .filter(
      (key): key is Exclude<SolutionIncludedAreaKey, 'afroIndigenous'> => key !== 'afroIndigenous',
    )
    .map((key) => INCLUDED_AREA_LABELS[key][locale]);
  const prefix = LEGEND_PREFIX[locale];

  return conservationAreaLabels.length > 0
    ? `${prefix} (${conservationAreaLabels.join(' + ')})`
    : prefix;
}
