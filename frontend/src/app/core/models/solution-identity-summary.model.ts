import type { Solution } from './solution.model';
import type { CatalogSolution } from './solution-catalog.model';

export interface SolutionIdentitySummary {
  title: string;
  chips: string[];
  targetSummary: string;
  costSummary: string;
  includeSummary: string;
  targetDetail: string;
  costDetail: string;
  includeDetail: string;
  targetItems: string[];
  costItems: string[];
  includeItems: string[];
}

export function buildSolutionIdentitySummary(
  activeSolution: Solution | null,
  catalogSolution: CatalogSolution | null,
): SolutionIdentitySummary | null {
  if (!activeSolution) {
    return null;
  }

  if (!catalogSolution) {
    return buildFallbackSolutionIdentitySummary(activeSolution.name);
  }

  const targetPercent =
    catalogSolution.finderInputs.targetPercent ?? catalogSolution.ecosystemTargets;
  const targetItems = buildTargetItems(catalogSolution).map((target) =>
    targetPercent ? `${target} at ${targetPercent}%` : target,
  );
  const targetSummary =
    targetPercent && targetItems.length > 0
      ? `${formatCount(targetItems.length, 'target')} at ${targetPercent}%`
      : formatCount(Math.max(targetItems.length, 1), 'target');

  const costItems = buildCostItems(catalogSolution);
  const costSummary = formatCount(Math.max(costItems.length, 1), 'cost');

  const includeItems = buildIncludeItems(catalogSolution);
  const includeSummary = formatCount(Math.max(includeItems.length, 1), 'include');

  const chips = [targetSummary, costSummary, includeSummary];

  return {
    title: chips.join(' + '),
    chips,
    targetSummary,
    costSummary,
    includeSummary,
    targetDetail: targetItems.length > 0 ? targetItems.join(', ') : catalogSolution.name,
    costDetail: costItems.join(' + '),
    includeDetail: includeItems.join(', '),
    targetItems,
    costItems,
    includeItems,
  };
}

function buildFallbackSolutionIdentitySummary(solutionName: string): SolutionIdentitySummary {
  return {
    title: solutionName,
    chips: [],
    targetSummary: solutionName,
    costSummary: '',
    includeSummary: '',
    targetDetail: solutionName,
    costDetail: '',
    includeDetail: '',
    targetItems: [],
    costItems: [],
    includeItems: [],
  };
}

function buildTargetItems(solution: CatalogSolution): string[] {
  const targetIds =
    solution.finderInputs.targetFeatureIds.length > 0
      ? solution.finderInputs.targetFeatureIds
      : splitTokenList(solution.finderInputs.targetFeatureSet);

  return unique(targetIds.map(labelTarget).filter(Boolean));
}

function buildCostItems(solution: CatalogSolution): string[] {
  const costIds = splitTokenList(solution.finderInputs.costLayerId ?? solution.inputLayerIds.cost);
  const labels = unique(costIds.map(labelCost).filter(Boolean));
  return labels.length > 0 ? labels : [solution.costLayer].filter(Boolean);
}

function buildIncludeItems(solution: CatalogSolution): string[] {
  const includeIds = unique([
    'runap',
    ...solution.finderInputs.includeLayerIds,
    ...solution.inputLayerIds.includes,
  ]);

  return unique(includeIds.map(labelInclude).filter(Boolean));
}

function splitTokenList(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[+,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function labelTarget(value: string): string {
  const normalized = normalizeToken(value);
  if (normalized.includes('strategic') || normalized.includes('estr')) {
    return 'Strategic ecosystems';
  }
  if (normalized.includes('species') || normalized.includes('esp')) {
    return 'Species';
  }
  if (
    normalized.includes('ecosystem') ||
    normalized.includes('ecosistema') ||
    normalized.includes('ecos')
  ) {
    return 'Ecosystems';
  }
  return titleCaseToken(value);
}

function labelCost(value: string): string {
  const normalized = normalizeToken(value);
  if (
    normalized.includes('carbon') ||
    normalized.includes('renta') ||
    normalized.includes('agropecuaria') ||
    normalized === 'co'
  ) {
    return 'Net benefit';
  }
  if (
    normalized.includes('human') ||
    normalized.includes('footprint') ||
    normalized.includes('iheh') ||
    normalized.includes('huella')
  ) {
    return 'Human Footprint 2022';
  }
  return titleCaseToken(value);
}

function labelInclude(value: string): string {
  const normalized = normalizeToken(value);
  if (normalized.includes('runap')) {
    return 'RUNAP protected areas';
  }
  if (normalized.includes('omec')) {
    return 'OMECs';
  }
  if (normalized.includes('comunidades') || normalized.includes('afro')) {
    return 'Afro-Colombian territories';
  }
  if (normalized.includes('resguardos') || normalized.includes('indigenous')) {
    return 'Indigenous reserves';
  }
  return titleCaseToken(value);
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, '-');
}

function titleCaseToken(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
