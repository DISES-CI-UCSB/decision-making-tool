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
  _options: { inferFromName?: boolean } = {},
): Set<SolutionTargetType> {
  void _options; // Retained for call-site compatibility; filename inference is disabled.
  const targetTypes = new Set<SolutionTargetType>();
  const structured = solution.finderInputs.structuredTargets;
  if (structured?.strategicEcosystems.length) targetTypes.add('strategic-ecosystems');
  if (structured?.ecosystems.length) targetTypes.add('ecosystems');
  if (structured?.ecosystemServices.length) targetTypes.add('ecosystem-services');
  if (structured?.speciesRepresentation.length || structured?.espRn.length) {
    targetTypes.add('species-richness');
  }
  const targetFeatureSet = normalizeSolutionToken(solution.finderInputs.targetFeatureSet ?? '');
  const targetFeatureIds = solution.finderInputs.targetFeatureIds.map((id) =>
    normalizeSolutionToken(id),
  );

  if (
    targetFeatureSet.includes('strategic') ||
    targetFeatureIds.some((id) => STRATEGIC_TARGET_IDS.includes(id))
  ) {
    targetTypes.add('strategic-ecosystems');
  }
  if (targetFeatureSet === 'ecosystems' || targetFeatureIds.includes('ecosistemas')) {
    targetTypes.add('ecosystems');
  }
  if (
    targetFeatureSet.includes('species') ||
    targetFeatureSet === 'esp-rn' ||
    (!targetFeatureSet && targetFeatureIds.includes('species-richness'))
  ) {
    targetTypes.add('species-richness');
  }

  return targetTypes;
}

export function getSolutionTargetLevel(
  solution: SolutionMatchingSource,
  targetType: SolutionTargetType,
): SolutionTargetLevel | null {
  const dimensionByTargetType = {
    ecosystems: 'ecosystems',
    'strategic-ecosystems': 'strategicEcosystems',
    'ecosystem-services': 'ecosystemServices',
    'species-richness': 'speciesRepresentation',
  } as const;
  const structured = solution.finderInputs.structuredTargets;
  const dimension = dimensionByTargetType[targetType];
  const targets = [
    ...(structured?.[dimension] ?? []),
    ...(targetType === 'species-richness' ? (structured?.espRn ?? []) : []),
  ];
  const levels = [...new Set(targets.map((target) => target.targetPercent))];
  if (levels.length === 1 && (levels[0] === 17 || levels[0] === 30)) {
    return levels[0];
  }
  if (levels.length > 0) {
    return null;
  }

  const explicitFeatureSetByTargetType: Partial<Record<SolutionTargetType, string[]>> = {
    ecosystems: ['ecosystems'],
    'strategic-ecosystems': ['strategic-ecosystems'],
    'ecosystem-services': ['ecosystem-services'],
    'species-richness': ['species', 'species-richness', 'esp-rn'],
  };
  const featureSet = normalizeSolutionToken(solution.finderInputs.targetFeatureSet ?? '');
  if (!explicitFeatureSetByTargetType[targetType]?.includes(featureSet)) {
    return null;
  }

  const manifestLevel = solution.finderInputs.targetPercent;
  return manifestLevel === 17 || manifestLevel === 30 ? manifestLevel : null;
}

export function inferSolutionTargetPercent(solution: SolutionMatchingSource): number {
  const ecosystemTargets = solution.finderInputs.structuredTargets?.ecosystems ?? [];
  const structuredLevels = [...new Set(ecosystemTargets.map((target) => target.targetPercent))];
  if (structuredLevels.length === 1 && (structuredLevels[0] === 17 || structuredLevels[0] === 30)) {
    return structuredLevels[0];
  }
  const manifestTarget = solution.finderInputs.targetPercent;
  return manifestTarget === 17 || manifestTarget === 30 ? manifestTarget : 0;
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
