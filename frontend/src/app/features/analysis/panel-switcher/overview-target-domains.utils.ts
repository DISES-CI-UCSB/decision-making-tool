export type OverviewTargetDomain = 'strategicEcosystems' | 'ecosystems' | 'species';

export interface ConfiguredTargetContext {
  targetFeatureSet: string | null;
  targetFeatureIds: string[];
  relativeTargetsByType?: Record<string, number[]>;
  structuredTargets?: OverviewStructuredTargetsFallback | null;
}

export interface OverviewStructuredTargetsFallback {
  ecosystems?: readonly { targetPercent: number }[];
  strategicEcosystems?: readonly { targetPercent: number }[];
  speciesRepresentation?: readonly { targetPercent: number }[];
  espRn?: readonly { targetPercent: number }[];
}

const TARGET_SET_SEPARATOR = /(?:\+|_and_|-and-|\band\b)/i;

const TARGET_DOMAIN_ALIASES: Record<OverviewTargetDomain, ReadonlySet<string>> = {
  strategicEcosystems: new Set([
    'strategic-ecosystems',
    'strategic',
    'estr',
    'paramo',
    'paramos',
    'bosque-seco',
    'wetlands',
    'mangrove',
    'mangroves',
  ]),
  ecosystems: new Set(['ecosystems', 'ecosistemas', 'ecos', 'marine-ecosystems']),
  species: new Set(['species-richness', 'species', 'esp']),
};

const EMPTY_TARGET_CONTEXT: ConfiguredTargetContext = {
  targetFeatureSet: null,
  targetFeatureIds: [],
};

export function classifyOverviewTargetDomains(
  targetContext: ConfiguredTargetContext,
  catalogFinderInputs?: Pick<
    ConfiguredTargetContext,
    'targetFeatureSet' | 'targetFeatureIds'
  > | null,
): Set<OverviewTargetDomain> {
  const fromGoalsTokens = classifyFromFeatureTokens(targetContext);
  if (fromGoalsTokens.size > 0) {
    return fromGoalsTokens;
  }

  const fromCatalog = classifyFromFeatureTokens(catalogFinderInputs ?? EMPTY_TARGET_CONTEXT);
  if (fromCatalog.size > 0) {
    return fromCatalog;
  }

  return classifyFromGoalsEvidence(targetContext);
}

function classifyFromFeatureTokens(
  targetContext: ConfiguredTargetContext,
): Set<OverviewTargetDomain> {
  const configuredTokens = new Set([
    ...splitTargetFeatureSet(targetContext.targetFeatureSet),
    ...targetContext.targetFeatureIds.map(normalizeTargetToken).filter(Boolean),
  ]);

  return new Set(
    (Object.keys(TARGET_DOMAIN_ALIASES) as OverviewTargetDomain[]).filter((domain) =>
      [...TARGET_DOMAIN_ALIASES[domain]].some((alias) => configuredTokens.has(alias)),
    ),
  );
}

function classifyFromGoalsEvidence(
  targetContext: ConfiguredTargetContext,
): Set<OverviewTargetDomain> {
  const targeted = new Set<OverviewTargetDomain>();
  const relativeTargets = targetContext.relativeTargetsByType ?? {};
  const structured = targetContext.structuredTargets;

  if (
    hasPositiveRelativeTargets(relativeTargets['strategicEcosystems']) ||
    hasPositiveStructuredTargets(structured?.strategicEcosystems)
  ) {
    targeted.add('strategicEcosystems');
  }
  if (
    hasPositiveRelativeTargets(relativeTargets['ecosystems']) ||
    hasPositiveStructuredTargets(structured?.ecosystems)
  ) {
    targeted.add('ecosystems');
  }
  if (
    hasPositiveRelativeTargets(relativeTargets['species']) ||
    hasPositiveStructuredTargets(structured?.speciesRepresentation) ||
    hasPositiveStructuredTargets(structured?.espRn)
  ) {
    targeted.add('species');
  }

  return targeted;
}

function hasPositiveRelativeTargets(targets: number[] | undefined): boolean {
  return (targets ?? []).some((target) => Number.isFinite(target) && target > 0);
}

function hasPositiveStructuredTargets(
  entries: readonly { targetPercent: number }[] | undefined,
): boolean {
  return (entries ?? []).some(
    (entry) => Number.isFinite(entry.targetPercent) && entry.targetPercent > 0,
  );
}

function splitTargetFeatureSet(targetFeatureSet: string | null): string[] {
  return (targetFeatureSet ?? '')
    .split(TARGET_SET_SEPARATOR)
    .map(normalizeTargetToken)
    .filter(Boolean);
}

function normalizeTargetToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}
