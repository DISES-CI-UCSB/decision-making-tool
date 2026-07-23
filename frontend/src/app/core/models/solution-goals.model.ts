export type SolutionGoalsFormat = 'conservation-goals-v1';

export interface GoalCountSummary {
  metCount: number;
  totalCount: number;
  pctMet: number | null;
}

export interface SpeciesGoalCountSummary {
  metSpeciesCount: number;
  totalSpeciesCount: number;
  pctMet: number | null;
}

export interface SpeciesGoalTaxaRollup extends SpeciesGoalCountSummary {
  label: string;
  iucnStatusBreakdown?: Record<string, SpeciesGoalCountSummary>;
}

export interface SolutionGoalsTargetContext {
  finderTargetPercent: number | null;
  targetFeatureSet: string | null;
  targetFeatureIds: string[];
  relativeTargetsByType: Record<string, number[]>;
}

export interface SolutionGoalsSummary extends GoalCountSummary {
  byType: {
    species: SpeciesGoalCountSummary;
    strategicEcosystems: GoalCountSummary;
    ecosystems: GoalCountSummary;
    other: GoalCountSummary;
  };
}

export interface SolutionGoalsRollups {
  species: SpeciesGoalCountSummary & {
    byTaxa: Record<string, SpeciesGoalTaxaRollup>;
    byIucnStatus: Record<string, SpeciesGoalCountSummary>;
    unmatchedSpeciesCount: number;
    ignoredSpeciesRowCount: number;
  };
  strategicEcosystems: GoalCountSummary;
  ecosystems: GoalCountSummary;
}

export type GoalFeatureType = 'species' | 'strategicEcosystems' | 'ecosystems' | 'other';

/**
 * One row per conservation feature from the prioritizr summary CSV. Present for every
 * feature the solution reported on - regardless of whether it was part of the target
 * set - so untargeted domains ("Additional outcomes") can report real incidental
 * coverage instead of a fabricated benchmark.
 */
export interface GoalFeatureRow {
  featureId: string;
  featureName: string;
  featureType: GoalFeatureType;
  /** Whether held >= target. Only meaningful when the feature was actually targeted. */
  met: boolean | null;
  totalAmount: number | null;
  absoluteTarget: number | null;
  absoluteHeld: number | null;
  absoluteShortfall: number | null;
  /** 0-1 fraction of the feature's target relative to its total amount. */
  relativeTarget: number | null;
  /** 0-1 fraction of the feature's total amount actually held by the solution. */
  relativeHeld: number | null;
  relativeShortfall: number | null;
  scenario: string | null;
  /** Friendly display label for strategic ecosystem features (e.g. "Páramos"). */
  label?: string;
  taxonClass?: string | null;
  taxonGroup?: string | null;
  iucnStatus?: string | null;
  rangeKm2?: number | null;
  threatened?: boolean | null;
}

export interface SolutionGoalsDocument {
  format: SolutionGoalsFormat;
  solutionId: string;
  solutionName: string;
  generatedAt: string;
  source: {
    summaryCsvUrl: string | null;
    summaryCsvRows: number;
    speciesLookupUrl: string;
  };
  targetContext: SolutionGoalsTargetContext;
  summary: SolutionGoalsSummary;
  rollups: SolutionGoalsRollups;
  features: {
    species: GoalFeatureRow[];
    strategicEcosystems: GoalFeatureRow[];
    ecosystems: GoalFeatureRow[];
    other: GoalFeatureRow[];
  };
  diagnostics: {
    rawTypeCounts: Record<string, number>;
    rowCounts: Record<string, number>;
  };
}
