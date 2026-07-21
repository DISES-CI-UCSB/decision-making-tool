import type {
  RuntimeSolutionManifestFinderInputs,
  RuntimeSolutionManifestInputLayerIds,
} from './layer-manifest.model';

export type SolutionTargetType =
  | 'species-richness'
  | 'ecosystems'
  | 'strategic-ecosystems'
  | 'ecosystem-services';

export type SolutionCostChoice = 'human-footprint' | 'carbon-opportunity';
export type SolutionTargetLevel = 17 | 30;

export interface SolutionMatchingSource {
  id: string;
  name: string;
  costLayer?: string;
  finderInputs: RuntimeSolutionManifestFinderInputs;
  inputLayerIds: RuntimeSolutionManifestInputLayerIds;
}

export interface SolutionIncludeFlags {
  runap: boolean;
  omecs: boolean;
  comunidades: boolean;
  resguardos: boolean;
}

const STRATEGIC_TARGET_IDS = ['paramos', 'bosque-seco', 'wetlands', 'mangroves'];

export function normalizeSolutionToken(
  value: string,
  options: { stripDiacritics?: boolean } = {},
): string {
  const normalized = options.stripDiacritics
    ? value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    : value;
  return normalized
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

export function getSolutionTargetTypes(
  solution: SolutionMatchingSource,
  options: { inferFromName?: boolean } = {},
): Set<SolutionTargetType> {
  const targetTypes = new Set<SolutionTargetType>();
  const targetFeatureSet = normalizeSolutionToken(solution.finderInputs.targetFeatureSet ?? '');
  const targetFeatureIds = solution.finderInputs.targetFeatureIds.map((id) =>
    normalizeSolutionToken(id),
  );
  const source = options.inferFromName ? `${solution.id} ${solution.name}`.toLowerCase() : '';

  if (
    targetFeatureSet.includes('strategic') ||
    targetFeatureIds.some((id) => STRATEGIC_TARGET_IDS.includes(id)) ||
    source.includes('estr')
  ) {
    targetTypes.add('strategic-ecosystems');
  }
  if (
    targetFeatureSet === 'ecosystems' ||
    targetFeatureIds.includes('ecosistemas') ||
    source.includes('ecos')
  ) {
    targetTypes.add('ecosystems');
  }
  if (
    targetFeatureSet.includes('species') ||
    (!targetFeatureSet && targetFeatureIds.includes('species-richness')) ||
    source.includes('esp')
  ) {
    targetTypes.add('species-richness');
  }

  return targetTypes;
}

export function getSolutionTargetLevel(
  solution: SolutionMatchingSource,
  targetType: SolutionTargetType,
): SolutionTargetLevel | null {
  const prefixByTargetType: Partial<Record<SolutionTargetType, string>> = {
    ecosystems: 'ecos',
    'strategic-ecosystems': 'estr',
    'species-richness': 'esp',
  };
  const prefix = prefixByTargetType[targetType];

  if (prefix) {
    const source = `${solution.id} ${solution.name}`.toLowerCase();
    const match = source.match(new RegExp(`${prefix}(17|30)(?!\\d)`));
    if (match) {
      return Number(match[1]) as SolutionTargetLevel;
    }
  }

  const manifestLevel = solution.finderInputs.targetPercent;
  return manifestLevel === 17 || manifestLevel === 30 ? manifestLevel : null;
}

export function inferSolutionTargetPercent(solution: SolutionMatchingSource): number {
  const source = `${solution.id} ${solution.name}`.toLowerCase();
  const match = source.match(/(?:ecos|estr)(17|30)(?!\d)/);
  return match ? Number(match[1]) : 0;
}

export function getSolutionIncludeIds(solution: SolutionMatchingSource): string[] {
  return [...solution.finderInputs.includeLayerIds, ...solution.inputLayerIds.includes].map((id) =>
    normalizeSolutionToken(id),
  );
}

export function getSolutionIncludeFlags(
  solution: SolutionMatchingSource,
  additionalIds: string[] = [],
): SolutionIncludeFlags {
  const includeIds = [
    ...getSolutionIncludeIds(solution),
    ...additionalIds.map((id) => normalizeSolutionToken(id)),
  ];
  const has = (token: string): boolean => includeIds.some((id) => id.includes(token));

  return {
    runap: has('runap'),
    omecs: has('omec'),
    comunidades: has('comunidades') || includeIds.includes('com'),
    resguardos: has('resguardos') || includeIds.includes('res'),
  };
}

export function solutionCostMatchesChoice(
  solution: SolutionMatchingSource,
  choice: SolutionCostChoice,
): boolean {
  const costIds = [
    solution.finderInputs.costLayerId,
    solution.inputLayerIds.cost,
    solution.costLayer,
    solution.id,
  ]
    .filter((id): id is string => Boolean(id))
    .map((id) => normalizeSolutionToken(id));

  return costIds.some((id) => costTokenMatchesChoice(id, choice));
}

export function costTokenMatchesChoice(costId: string, choice: SolutionCostChoice): boolean {
  const normalizedCostId = normalizeSolutionToken(costId);

  switch (choice) {
    case 'human-footprint':
      return normalizedCostId.includes('human-footprint') || normalizedCostId.endsWith('-hf');
    case 'carbon-opportunity':
      return (
        normalizedCostId.includes('carbon') ||
        normalizedCostId.includes('net-benefit') ||
        normalizedCostId.includes('renta') ||
        normalizedCostId.includes('agropecuaria') ||
        normalizedCostId.endsWith('-co')
      );
  }
}

export function getSolutionCostLabel(solution: SolutionMatchingSource): string {
  const costLayerId = solution.finderInputs.costLayerId ?? solution.inputLayerIds.cost ?? '';
  const normalizedCostId = costLayerId.toLowerCase();

  if (
    normalizedCostId.includes('carbon') ||
    normalizedCostId.includes('renta') ||
    normalizedCostId.includes('agropecuaria') ||
    normalizedCostId === 'co' ||
    normalizedCostId.endsWith('_co')
  ) {
    return 'Net Benefit (Renta agropecuaria)';
  }
  return 'Human Footprint';
}

export function isConflictCostSolution(solution: SolutionMatchingSource): boolean {
  const costLayerId = solution.finderInputs.costLayerId ?? solution.inputLayerIds.cost ?? '';
  const source = `${costLayerId} ${solution.id} ${solution.name}`.toLowerCase();
  return source.includes('conflict') || source.includes('conflicto');
}
