import { computed, inject, Injectable, signal } from '@angular/core';
import type {
  RuntimeLayerManifestLayer,
  RuntimeSolutionCapabilities,
  RuntimeSolutionManifestEntry,
} from '@core/models/layer-manifest.model';
import type { CatalogSolution } from '@core/models/solution-catalog.model';
import { SIRAP_REGIONS } from '@core/models/sirap-access.model';
import {
  getSolutionCostLabel,
  getSolutionIncludeFlags,
  inferSolutionTargetPercent,
  isConflictCostSolution,
  normalizeSolutionToken,
} from '@core/models/solution-matching.utils';
import { isSirapRegionId } from '@core/models/sirap-access.model';
import { AppStateService } from './app-state.service';
import { LayerManifestService } from './layer-manifest.service';
import { environment } from '../../../environments/environment';

/**
 * Catalog of real prioritizr solutions from the generated layer manifest.
 * The manifest points at public Vercel Blob URLs; local /data/solutions assets are not used.
 */
@Injectable({ providedIn: 'root' })
export class SolutionCatalogService {
  private readonly manifest = inject(LayerManifestService);
  private readonly appState = inject(AppStateService);
  private readonly solutionsState = signal<CatalogSolution[]>([]);
  private readonly layersState = signal<RuntimeLayerManifestLayer[]>([]);
  private readonly loadErrorState = signal<string | null>(null);
  private readonly hasLoadedState = signal(false);

  readonly solutions = computed(() =>
    this.solutionsState().filter((solution) => this.canAccessSolution(solution)),
  );
  readonly loadError = this.loadErrorState.asReadonly();
  readonly isLoading = computed(() => !this.hasLoadedState() && !this.loadErrorState());

  constructor() {
    this.manifest.getManifest().subscribe({
      next: (manifest) => {
        this.layersState.set(manifest.layers ?? []);
        const nationalSolutions = (manifest.solutions ?? [])
          .filter((solution) => !isConflictCostSolution(solution))
          .map((solution) => this.toSolution(solution));
        this.solutionsState.set([
          ...nationalSolutions,
          ...this.createDummySirapSolutions(nationalSolutions),
        ]);
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
    return this.solutions();
  }

  getById(id: string): CatalogSolution | null {
    return this.solutions().find((solution) => solution.id === id) ?? null;
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
    const localCapabilities = (
      environment.solutionCapabilityOverrides as Record<string, RuntimeSolutionCapabilities>
    )[solution.id];

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
      capabilities: localCapabilities ?? solution.capabilities,
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

  private createDummySirapSolutions(solutions: readonly CatalogSolution[]): CatalogSolution[] {
    const landNationalSolutions = solutions.filter(
      (solution) => solution.domain === 'land' && solution.scope === 'nacional',
    );
    return SIRAP_REGIONS.flatMap((region) =>
      landNationalSolutions.map((solution) => ({
        ...solution,
        id: `demo-sirap-${region.id}-${solution.id}`,
        name: `[Demo ${region.label}] ${solution.name}`,
        description: `Dummy regional solution for authorization testing. ${solution.description}`,
        scope: 'sirap',
        sirapId: region.id,
        finderInputs: {
          ...solution.finderInputs,
          scope: 'sirap',
        },
      })),
    );
  }

  private canAccessSolution(solution: CatalogSolution): boolean {
    const scope = normalizeSolutionToken(solution.finderInputs.scope || solution.scope);
    if (scope !== 'sirap') {
      return true;
    }
    return isSirapRegionId(solution.sirapId)
      ? this.appState.accessibleSirapIds().includes(solution.sirapId)
      : false;
  }
}
