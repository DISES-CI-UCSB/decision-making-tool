import { computed, inject, Injectable, signal } from '@angular/core';
import type { RuntimeSolutionManifestEntry } from '@core/models/layer-manifest.model';
import type { SolutionScenario } from '@core/models/solution-scenario.model';
import { LayerManifestService } from './layer-manifest.service';

/**
 * Catalog of real prioritizr solution scenarios from the generated layer manifest.
 * The manifest points at public Vercel Blob URLs; local /data/solutions assets are not used.
 */
@Injectable({ providedIn: 'root' })
export class SolutionCatalogService {
  private readonly manifest = inject(LayerManifestService);
  private readonly scenariosState = signal<SolutionScenario[]>([]);
  private readonly loadErrorState = signal<string | null>(null);
  private readonly hasLoadedState = signal(false);

  readonly scenarios = this.scenariosState.asReadonly();
  readonly loadError = this.loadErrorState.asReadonly();
  readonly isLoading = computed(() => !this.hasLoadedState() && !this.loadErrorState());

  constructor() {
    this.manifest.getManifest().subscribe({
      next: (manifest) => {
        this.scenariosState.set(
          (manifest.solutions ?? []).map((solution) => this.toScenario(solution)),
        );
        this.hasLoadedState.set(true);
        this.loadErrorState.set(null);
      },
      error: (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.scenariosState.set([]);
        this.hasLoadedState.set(true);
        this.loadErrorState.set(message);
      },
    });
  }

  getAll(): SolutionScenario[] {
    return this.scenariosState();
  }

  getById(id: string): SolutionScenario | null {
    return this.scenariosState().find((s) => s.id === id) ?? null;
  }

  getTifUrl(scenario: SolutionScenario): string {
    return scenario.displayUrl;
  }

  private toScenario(solution: RuntimeSolutionManifestEntry): SolutionScenario {
    const targetPercent = solution.finderInputs.targetPercent ?? this.inferTargetPercent(solution);
    const constraints = this.getConstraintLabels(solution);
    const costLayer = this.getCostLayerLabel(solution);
    const targetFeatureSet = solution.finderInputs.targetFeatureSet?.replace(/_/g, '-');
    const targetLabel = targetFeatureSet?.includes('strategic')
      ? 'strategic ecosystems'
      : 'ecosystem types';
    const constraintLabel = constraints.length > 0 ? constraints.join(' + ') : 'no locked-in areas';

    return {
      id: solution.id,
      filename: solution.rasterFile,
      name: solution.name,
      description:
        solution.description ||
        `${targetPercent}% target for ${targetLabel}, includes ${constraintLabel}, ${costLayer} cost`,
      scope: solution.scope,
      sirapId: solution.sirapId,
      displayUrl: solution.displayUrl,
      displayCogUrl: solution.displayCogUrl ?? null,
      metadataUrl: solution.metadataUrl,
      rendering: solution.rendering,
      finderInputs: solution.finderInputs,
      inputLayerIds: solution.inputLayerIds,
      ecosystemTargets: targetPercent,
      constraints,
      costLayer,
      nSelected: solution.summaryMetrics.nSelected ?? 0,
      totalCost: solution.summaryMetrics.totalCost ?? 0,
      pctTargetsMet: solution.summaryMetrics.pctTargetsMet ?? 100,
    };
  }

  private getConstraintLabels(solution: RuntimeSolutionManifestEntry): string[] {
    const includeIds = new Set(solution.finderInputs.includeLayerIds);
    const inputIncludeIds = new Set(solution.inputLayerIds.includes);
    const hasInclude = (idPart: string): boolean =>
      [...includeIds, ...inputIncludeIds].some((id) => id.toLowerCase().includes(idPart));

    const constraints = ['RUNAP'];
    if (hasInclude('omec')) {
      constraints.push('OMECs');
    }
    if (hasInclude('comunidades') || hasInclude('resguardos')) {
      constraints.push('Comunidades');
    }

    return constraints;
  }

  private inferTargetPercent(solution: RuntimeSolutionManifestEntry): number {
    const source = `${solution.id} ${solution.name}`.toLowerCase();
    const match = source.match(/(?:ecos|estr)(17|30)(?!\d)/);
    return match ? Number(match[1]) : 0;
  }

  private getCostLayerLabel(solution: RuntimeSolutionManifestEntry): string {
    const costLayerId = solution.finderInputs.costLayerId ?? solution.inputLayerIds.cost ?? '';
    const normalizedCostId = costLayerId.toLowerCase();

    if (normalizedCostId.includes('conflict') || normalizedCostId.includes('conflicto')) {
      return 'Conflict (Coca/Deaths)';
    }
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
}
