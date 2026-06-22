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
    species: unknown[];
    strategicEcosystems: unknown[];
    ecosystems: unknown[];
    other: unknown[];
  };
  diagnostics: {
    rawTypeCounts: Record<string, number>;
    rowCounts: Record<string, number>;
  };
}
