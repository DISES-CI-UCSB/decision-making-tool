export type OverviewTargetDomain = 'strategicEcosystems' | 'ecosystems' | 'species';

export interface ConfiguredTargetContext {
  targetFeatureSet: string | null;
  targetFeatureIds: string[];
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

export function classifyOverviewTargetDomains(
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
