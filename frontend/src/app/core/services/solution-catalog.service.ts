import { computed, inject, Injectable, signal } from '@angular/core';
import type {
  RuntimeLayerManifestLayer,
  RuntimeSolutionManifestEntry,
} from '@core/models/layer-manifest.model';
import type { CatalogSolution } from '@core/models/solution-catalog.model';
import {
  getSolutionCostLabel,
  getSolutionIncludeFlags,
  inferSolutionTargetPercent,
  isConflictCostSolution,
} from '@core/models/solution-matching.utils';
import { LayerManifestService } from './layer-manifest.service';

/**
 * Catalog of real prioritizr solutions from the generated layer manifest.
 * The manifest points at public Vercel Blob URLs; local /data/solutions assets are not used.
 */
@Injectable({ providedIn: 'root' })
export class SolutionCatalogService {
  private readonly manifest = inject(LayerManifestService);
  private readonly solutionsState = signal<CatalogSolution[]>([]);
  private readonly layersState = signal<RuntimeLayerManifestLayer[]>([]);
  private readonly loadErrorState = signal<string | null>(null);
  private readonly hasLoadedState = signal(false);

  readonly solutions = this.solutionsState.asReadonly();
  readonly loadError = this.loadErrorState.asReadonly();
  readonly isLoading = computed(() => !this.hasLoadedState() && !this.loadErrorState());

  constructor() {
    this.manifest.getManifest().subscribe({
      next: (manifest) => {
        this.layersState.set(manifest.layers ?? []);
        this.solutionsState.set(
          (manifest.solutions ?? [])
            .filter((solution) => !isConflictCostSolution(solution))
            .map((solution) => this.toSolution(solution)),
        );
        this.hasLoadedState.set(true);
        this.loadErrorState.set(null);
      },
      error: (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.layersState.set([]);
        this.solutionsState.set([]);
        this.hasLoadedState.set(true);
        this.loadErrorState.set(message);
      },
    });
  }

  getAll(): CatalogSolution[] {
    return this.solutionsState();
  }

  getById(id: string): CatalogSolution | null {
    return this.solutionsState().find((s) => s.id === id) ?? null;
  }

  getLayerById(id: string | null | undefined): RuntimeLayerManifestLayer | null {
    if (!id) {
      return null;
    }
    return this.layersState().find((layer) => layer.id === id) ?? null;
  }

  getTifUrl(solution: CatalogSolution): string {
    return solution.displayUrl;
  }

  private toSolution(solution: RuntimeSolutionManifestEntry): CatalogSolution {
    const targetPercent =
      solution.finderInputs.targetPercent ?? inferSolutionTargetPercent(solution);
    const constraints = this.getConstraintLabels(solution);
    const costLayer = getSolutionCostLabel(solution);
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
      domain: solution.domain ?? solution.finderInputs.domain ?? 'land',
      scope: solution.scope,
      sirapId: solution.sirapId ?? null,
      displayUrl: solution.displayUrl,
      displayCogUrl: solution.displayCogUrl ?? null,
      metadataUrl: solution.metadataUrl,
      precomputedMetricUrls: solution.precomputedMetricUrls,
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
    const includes = getSolutionIncludeFlags(solution);
    const constraints = ['RUNAP'];
    if (includes.omecs) {
      constraints.push('OMECs');
    }
    if (includes.comunidades) {
      constraints.push('Com');
    }
    if (includes.resguardos) {
      constraints.push('Res');
    }

    return constraints;
  }
}
