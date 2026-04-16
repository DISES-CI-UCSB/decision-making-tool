import { animate, style, transition, trigger } from '@angular/animations';
import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  OnDestroy,
  Output,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';

import { type AoiType } from '@core/models';
import { AppStateService, type MapLegendLayerEntry } from '@core/services/app-state.service';
import { AdminBoundaryService } from '@features/map/services/admin-boundary.service';
import { SolutionLayerService } from '@features/map/services/solution-layer.service';

interface LayerControlRow {
  id: string;
  name: string;
  countLabel?: string;
  selected: boolean;
  visible: boolean;
  expanded: boolean;
  opacity: number;
  color: string;
  canReorder: boolean;
  hasStyleControls: boolean;
  hasColorControl: boolean;
  disabled?: boolean;
  mapUnavailable?: boolean;
  hideAddButton?: boolean;
  mapSync?:
    | { type: 'solution-baseline' }
    | { type: 'solution-candidate' }
    | { type: 'solution-overlap' }
    | { type: 'app-state-layer'; layerId: string }
    | { type: 'admin-boundary'; boundaryType: AoiType };
}

interface SpeciesSample {
  common: string;
  latin: string;
}

interface SpeciesRow extends LayerControlRow {
  common: string;
  latin: string;
  taxonId: string;
  slug: string;
}

interface TaxonRow extends LayerControlRow {
  speciesCount: number;
  searchQuery: string;
  showAll: boolean;
  species: SpeciesRow[];
}

interface LayerGroup {
  id: string;
  title: string;
  countLabel?: string;
  collapsed: boolean;
  disabled?: boolean;
  comingSoon?: boolean;
  note?: string;
  rows: LayerControlRow[];
}

interface LayerSearchGroupMatch {
  groupId: string;
  rowMatches: number;
  taxonMatches: number;
}

interface SelectedLayerRow {
  id: string;
  name: string;
  sourceLabel: string;
  sourceType: 'overlay' | 'group';
  mapUnavailable: boolean;
}

const SPECIES_VISIBLE_LIMIT = 6;
type SelectedLayerDropPosition = 'before' | 'after';
const BASELINE_SOLUTION_OVERLAY_ID = 'overlay-conservation-solution';
const CANDIDATE_SOLUTION_OVERLAY_ID = 'overlay-conservation-solution-candidate';
const OVERLAP_SOLUTION_OVERLAY_ID = 'overlay-conservation-solution-overlap';
const SINGLE_SOLUTION_COLOR = '#16a34a';
const COMPARISON_BASELINE_COLOR = '#1e6fa8';
const COMPARISON_CANDIDATE_COLOR = '#7c3aed';
const COMPARISON_OVERLAP_COLOR = '#ec4899';
const LEGEND_BOUNDARY_STYLES: Record<
  AoiType,
  { lineStyle: 'solid' | 'dashed'; lineWidth: number; color: string }
> = {
  sirap: { lineStyle: 'dashed', lineWidth: 2, color: '#111827' },
  department: { lineStyle: 'solid', lineWidth: 1, color: '#111827' },
  municipality: { lineStyle: 'solid', lineWidth: 1, color: '#111827' },
};
type SidebarSolutionLayerType = 'solution-baseline' | 'solution-candidate' | 'solution-overlap';

@Component({
  selector: 'app-map-layers-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './map-layers-panel.html',
  styleUrl: './map-layers-panel.scss',
  animations: [
    trigger('selectedLayerRow', [
      transition(':enter', [
        style({ height: 0, opacity: 0, overflow: 'hidden' }),
        animate('220ms ease-out', style({ height: '*', opacity: 1 })),
      ]),
      transition(':leave', [
        style({ overflow: 'hidden' }),
        animate('180ms ease-in', style({ height: 0, opacity: 0 })),
      ]),
    ]),
  ],
})
export class MapLayersPanelComponent implements OnDestroy {
  @Output() readonly solutionFinderRequested = new EventEmitter<void>();

  private readonly appState = inject(AppStateService);
  private readonly adminBoundaryService = inject(AdminBoundaryService);
  private readonly solutionLayerService = inject(SolutionLayerService);
  private readonly opacitySyncFrames = new Map<string, number>();
  private readonly colorSyncFrames = new Map<string, number>();
  /** Stable bound reference so we can removeEventListener exactly. */
  private readonly rainforestProximityHandler = (e: PointerEvent): void =>
    this.onSidebarProximityMove(e);

  protected readonly activeScenarioName = signal('Ecos30 + RUNAP + OMEC (HF)');
  protected readonly hasActiveSolution = computed(() => this.appState.hasActiveSolution());
  protected readonly overlays = signal<LayerControlRow[]>(this.createDefaultOverlays());
  protected readonly availableOverlays = computed(() =>
    this.overlays().filter(
      (row) => row.id !== BASELINE_SOLUTION_OVERLAY_ID && row.id !== CANDIDATE_SOLUTION_OVERLAY_ID,
    ),
  );
  /** Management Figures card: expanded by default so RUNAP/OMEC are visible; category groups start collapsed (UCS-101). */
  protected readonly overlaysCollapsed = signal(false);
  protected readonly taxa = signal<TaxonRow[]>(this.createDefaultTaxa());
  protected readonly groups = signal<LayerGroup[]>(this.createDefaultGroups());
  protected readonly adminBoundaryGroup = computed(
    () => this.groups().find((g) => g.id === 'group-admin-boundaries') ?? null,
  );
  protected readonly layerSearchQuery = signal('');
  protected readonly normalizedLayerSearchQuery = computed(() =>
    this.layerSearchQuery().trim().toLowerCase(),
  );
  protected readonly hasLayerSearchQuery = computed(
    () => this.normalizedLayerSearchQuery().length > 0,
  );
  protected readonly filteredAvailableOverlays = computed(() => {
    const overlays = this.availableOverlays();
    const query = this.normalizedLayerSearchQuery();
    if (query.length === 0) {
      return overlays;
    }
    return overlays.filter((row) => this.nameMatchesSearch(row.name, query));
  });
  protected readonly filteredTaxa = computed(() => {
    const taxa = this.taxa();
    const query = this.normalizedLayerSearchQuery();
    if (query.length === 0) {
      return taxa;
    }
    return taxa.filter((taxon) => this.taxonMatchesSearch(taxon, query));
  });
  protected readonly searchMatchesByGroup = computed(() => {
    const groups = this.groups();
    const query = this.normalizedLayerSearchQuery();
    const taxa = this.filteredTaxa();
    const matches = new Map<string, LayerSearchGroupMatch>();
    for (const group of groups) {
      if (group.id === 'group-species-biodiversity') {
        matches.set(group.id, { groupId: group.id, rowMatches: 0, taxonMatches: taxa.length });
        continue;
      }
      const rowMatches =
        query.length === 0
          ? group.rows.length
          : group.rows.filter((row) => this.nameMatchesSearch(row.name, query)).length;
      matches.set(group.id, { groupId: group.id, rowMatches, taxonMatches: 0 });
    }
    return matches;
  });
  protected readonly hasAnyLayerSearchResults = computed(() => {
    const overlayMatches = this.filteredAvailableOverlays().length;
    const groupMatches = Array.from(this.searchMatchesByGroup().values()).reduce(
      (total, match) => total + match.rowMatches + match.taxonMatches,
      0,
    );
    return overlayMatches + groupMatches > 0;
  });
  protected readonly layerSearchResultCount = computed(() => {
    const overlayMatches = this.filteredAvailableOverlays().length;
    const groupMatches = Array.from(this.searchMatchesByGroup().values()).reduce(
      (total, match) => total + match.rowMatches + match.taxonMatches,
      0,
    );
    return overlayMatches + groupMatches;
  });
  protected readonly selectedLayerOrder = signal<string[]>([]);
  protected readonly selectedLayerDragId = signal<string | null>(null);
  protected readonly selectedLayerDropTargetId = signal<string | null>(null);
  protected readonly selectedLayerDropPosition = signal<SelectedLayerDropPosition>('before');
  protected readonly selectedLayers = computed<SelectedLayerRow[]>(() =>
    this.buildSelectedLayers(),
  );
  protected readonly selectSolutionHoverFx = this.appState.selectSolutionButtonHoverFx$;
  protected readonly canAccessTier2 = this.appState.canAccessTier2;

  constructor() {
    this.syncInitialBoundaryState();
    this.selectedLayerOrder.set(
      this.computeSelectedLayerOrder(this.overlays(), this.groups(), this.taxa()),
    );

    effect(() => {
      const solution = this.appState.activeSolution$();
      untracked(() => {
        if (solution?.name) {
          this.activeScenarioName.set(solution.name);
        }
        this.syncPrimarySolutionOverlay(solution?.name ?? null);
      });
    });

    effect(() => {
      const comparisonSolution = this.appState.comparisonSolution$();
      const vizMode = this.appState.comparisonVisualizationMode$();
      untracked(() => {
        const isComparing = !!comparisonSolution;
        this.syncBaselineOverlayColor(isComparing);
        this.syncComparisonSolutionOverlay(comparisonSolution?.name ?? null);
        this.syncComparisonOverlapOverlay(
          comparisonSolution?.name ?? null,
          vizMode === 'threeColorOverlay',
        );
      });
    });

    effect(() => {
      const order = this.selectedLayerOrder();
      const overlays = this.overlays();
      untracked(() => {
        this.syncSelectedLayerStackingToMap(order, overlays);
      });
    });

    effect(() => {
      const entries = this.buildMasterLegendLayerEntries();
      untracked(() => this.appState.setSelectedLegendLayers(entries));
    });

    // Register / unregister a viewport-wide pointer listener for the rainforest reveal mode.
    effect(() => {
      if (this.selectSolutionHoverFx() === 'rainforestReveal') {
        document.addEventListener('pointermove', this.rainforestProximityHandler, {
          passive: true,
        });
      } else {
        document.removeEventListener('pointermove', this.rainforestProximityHandler);
        this.resetRainforestProximity();
      }
    });
  }

  ngOnDestroy(): void {
    document.removeEventListener('pointermove', this.rainforestProximityHandler);
    for (const frameId of this.opacitySyncFrames.values()) {
      cancelAnimationFrame(frameId);
    }
    this.opacitySyncFrames.clear();
    for (const frameId of this.colorSyncFrames.values()) {
      cancelAnimationFrame(frameId);
    }
    this.colorSyncFrames.clear();
  }

  protected requestSolutionFinder(): void {
    this.solutionFinderRequested.emit();
  }

  /** Updates --select-solution-spotlight-* for cursor-follow green and rainforest mask. */
  protected onSelectSolutionSpotlightEnter(event: PointerEvent): void {
    if (!this.selectSolutionHoverUsesPointerTracking()) {
      return;
    }
    this.onSelectSolutionSpotlightMove(event);
  }

  protected onSelectSolutionSpotlightMove(event: PointerEvent): void {
    if (!this.selectSolutionHoverUsesPointerTracking()) {
      return;
    }
    const el = event.currentTarget;
    if (!(el instanceof HTMLButtonElement)) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    const x = ((event.clientX - rect.left) / w) * 100;
    const y = ((event.clientY - rect.top) / h) * 100;
    el.style.setProperty('--select-solution-spotlight-x', `${x}%`);
    el.style.setProperty('--select-solution-spotlight-y', `${y}%`);
  }

  /** Called by the viewport-wide document listener; drives ::before opacity for rainforest mode. */
  private onSidebarProximityMove(event: PointerEvent): void {
    if (this.selectSolutionHoverFx() !== 'rainforestReveal') return;
    const btn = document.getElementById('map-layers-select-solution-button');
    if (!(btn instanceof HTMLButtonElement)) return;

    const rect = btn.getBoundingClientRect();
    // Distance from pointer to the nearest point ON the button rect.
    const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
    const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const THRESHOLD = 80; // matches mask radius
    const opacity = dist >= THRESHOLD ? 0 : 1 - dist / THRESHOLD;

    // Position relative to button dimensions (can go outside 0-100% when cursor is outside button).
    const w = rect.width || 1;
    const h = rect.height || 1;
    const x = ((event.clientX - rect.left) / w) * 100;
    const y = ((event.clientY - rect.top) / h) * 100;

    btn.style.setProperty('--select-solution-spotlight-x', `${x}%`);
    btn.style.setProperty('--select-solution-spotlight-y', `${y}%`);
    btn.style.setProperty('--select-solution-proximity-opacity', `${opacity}`);
  }

  private resetRainforestProximity(): void {
    const btn = document.getElementById('map-layers-select-solution-button');
    if (btn instanceof HTMLButtonElement) {
      btn.style.setProperty('--select-solution-proximity-opacity', '0');
    }
  }

  private selectSolutionHoverUsesPointerTracking(): boolean {
    const m = this.selectSolutionHoverFx();
    return m === 'cursorFollowGreen' || m === 'rainforestReveal';
  }

  protected toggleGroup(groupId: string): void {
    this.groups.update((groups) =>
      groups.map((group) =>
        group.id === groupId && !group.disabled ? { ...group, collapsed: !group.collapsed } : group,
      ),
    );
  }

  protected toggleOverlayVisibility(rowId: string): void {
    let nextVisible = false;
    let nextSelected = false;
    this.overlays.update((rows) =>
      rows.map((row) => {
        if (row.id !== rowId || row.mapUnavailable) {
          return row;
        }
        nextVisible = !row.visible;
        nextSelected = row.selected || nextVisible;
        return { ...row, selected: nextSelected, visible: nextVisible };
      }),
    );
    this.updateSelectedLayerOrder(rowId, nextSelected);
    this.syncOverlayById(rowId);
  }

  protected toggleOverlaySelected(rowId: string): void {
    let nextSelected = false;
    this.overlays.update((rows) =>
      rows.map((row) => {
        if (row.id !== rowId) {
          return row;
        }
        nextSelected = !row.selected;
        return {
          ...row,
          selected: nextSelected,
          // Removing a layer from selected should also remove it from the map.
          visible: row.mapUnavailable ? false : nextSelected ? row.visible : false,
        };
      }),
    );
    this.updateSelectedLayerOrder(rowId, nextSelected);
    this.syncOverlayById(rowId);
  }

  protected toggleOverlaysCollapsed(): void {
    this.overlaysCollapsed.update((collapsed) => !collapsed);
  }

  protected toggleOverlayExpanded(rowId: string): void {
    this.overlays.update((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, expanded: !row.expanded } : row)),
    );
  }

  protected updateOverlayOpacity(rowId: string, opacityText: string): void {
    const opacity = this.parsePercent(opacityText);
    this.overlays.update((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, opacity } : row)),
    );
    this.scheduleOpacitySync(rowId);
  }

  protected updateOverlayColor(rowId: string, color: string): void {
    this.overlays.update((rows) => rows.map((row) => (row.id === rowId ? { ...row, color } : row)));
    this.scheduleColorSync(rowId);
  }

  protected moveOverlay(rowId: string, direction: 'up' | 'down'): void {
    this.overlays.update((rows) => this.reorderRows(rows, rowId, direction));
  }

  protected toggleLayerVisibility(groupId: string, rowId: string): void {
    let nextVisible = false;
    let nextSelected = false;
    let didToggle = false;
    this.groups.update((groups) =>
      groups.map((g) => {
        if (g.id !== groupId) {
          return g;
        }

        return {
          ...g,
          rows: g.rows.map((row) =>
            row.id === rowId
              ? (() => {
                  if (row.mapUnavailable || this.isAuthLockedRow(row)) {
                    return row;
                  }
                  nextVisible = !row.visible;
                  nextSelected = row.selected || nextVisible;
                  didToggle = true;
                  return { ...row, selected: nextSelected, visible: nextVisible };
                })()
              : row,
          ),
        };
      }),
    );
    if (!didToggle) {
      return;
    }
    this.updateSelectedLayerOrder(rowId, nextSelected);
    this.syncGroupRowById(groupId, rowId);
  }

  protected toggleLayerSelected(groupId: string, rowId: string): void {
    let nextSelected = false;
    let didToggle = false;
    this.groups.update((groups) =>
      groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }
        return {
          ...group,
          rows: group.rows.map((row) => {
            if (row.id !== rowId) {
              return row;
            }
            if (this.isAuthLockedRow(row)) {
              return row;
            }
            nextSelected = !row.selected;
            didToggle = true;
            return {
              ...row,
              selected: nextSelected,
              // Removing a layer from selected should also remove it from the map.
              visible: row.mapUnavailable ? false : nextSelected ? row.visible : false,
            };
          }),
        };
      }),
    );
    if (!didToggle) {
      return;
    }
    this.updateSelectedLayerOrder(rowId, nextSelected);
    this.syncGroupRowById(groupId, rowId);
  }

  protected toggleLayerExpanded(groupId: string, rowId: string): void {
    this.groups.update((groups) =>
      groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }

        return {
          ...group,
          rows: group.rows.map((row) =>
            row.id === rowId ? { ...row, expanded: !row.expanded } : row,
          ),
        };
      }),
    );
  }

  protected updateLayerOpacity(groupId: string, rowId: string, opacityText: string): void {
    const opacity = this.parsePercent(opacityText);
    this.groups.update((groups) =>
      groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }

        return {
          ...group,
          rows: group.rows.map((row) => (row.id === rowId ? { ...row, opacity } : row)),
        };
      }),
    );
    this.scheduleOpacitySync(`${groupId}:${rowId}`);
  }

  protected updateLayerColor(groupId: string, rowId: string, color: string): void {
    this.groups.update((groups) =>
      groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }

        return {
          ...group,
          rows: group.rows.map((row) => (row.id === rowId ? { ...row, color } : row)),
        };
      }),
    );
    this.scheduleColorSync(`${groupId}:${rowId}`);
  }

  protected moveLayer(groupId: string, rowId: string, direction: 'up' | 'down'): void {
    this.groups.update((groups) =>
      groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }

        return {
          ...group,
          rows: this.reorderRows(group.rows, rowId, direction),
        };
      }),
    );
  }

  protected toggleTaxonVisibility(rowId: string): void {
    let nextVisible = false;
    let nextSelected = false;
    this.taxa.update((rows) =>
      rows.map((row) => {
        if (row.id !== rowId || row.mapUnavailable) {
          return row;
        }
        nextVisible = !row.visible;
        nextSelected = row.selected || nextVisible;
        return { ...row, selected: nextSelected, visible: nextVisible };
      }),
    );
    this.updateSelectedLayerOrder(rowId, nextSelected);
  }

  protected toggleTaxonSelected(rowId: string): void {
    let nextSelected = false;
    this.taxa.update((rows) =>
      rows.map((row) => {
        if (row.id !== rowId) {
          return row;
        }
        nextSelected = !row.selected;
        return {
          ...row,
          selected: nextSelected,
          // If a row cannot be visualized on the map, keep visibility off.
          visible: row.mapUnavailable ? false : nextSelected ? row.visible : false,
        };
      }),
    );
    this.updateSelectedLayerOrder(rowId, nextSelected);
  }

  protected toggleTaxonExpanded(rowId: string): void {
    this.taxa.update((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, expanded: !row.expanded } : row)),
    );
  }

  protected updateTaxonSearch(rowId: string, query: string): void {
    this.taxa.update((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, searchQuery: query, showAll: false } : row)),
    );
  }

  protected showAllTaxonSpecies(rowId: string): void {
    this.taxa.update((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, showAll: true } : row)),
    );
  }

  protected toggleSpeciesVisibility(taxonId: string, speciesId: string): void {
    let nextVisible = false;
    let nextSelected = false;
    this.taxa.update((taxa) =>
      taxa.map((taxon) => {
        if (taxon.id !== taxonId) {
          return taxon;
        }
        return {
          ...taxon,
          species: taxon.species.map((species) =>
            species.id === speciesId
              ? (() => {
                  if (species.mapUnavailable) {
                    return species;
                  }
                  nextVisible = !species.visible;
                  nextSelected = species.selected || nextVisible;
                  return { ...species, selected: nextSelected, visible: nextVisible };
                })()
              : species,
          ),
        };
      }),
    );
    this.updateSelectedLayerOrder(speciesId, nextSelected);
    this.syncSpeciesById(taxonId, speciesId);
  }

  protected toggleSpeciesSelected(taxonId: string, speciesId: string): void {
    let nextSelected = false;
    this.taxa.update((taxa) =>
      taxa.map((taxon) => {
        if (taxon.id !== taxonId) {
          return taxon;
        }
        return {
          ...taxon,
          species: taxon.species.map((species) => {
            if (species.id !== speciesId) {
              return species;
            }
            nextSelected = !species.selected;
            return {
              ...species,
              selected: nextSelected,
              // Removing a layer from selected should also remove it from the map.
              visible: species.mapUnavailable ? false : nextSelected ? species.visible : false,
            };
          }),
        };
      }),
    );
    this.updateSelectedLayerOrder(speciesId, nextSelected);
    this.syncSpeciesById(taxonId, speciesId);
  }

  protected toggleSpeciesExpanded(taxonId: string, speciesId: string): void {
    this.taxa.update((taxa) =>
      taxa.map((taxon) => {
        if (taxon.id !== taxonId) {
          return taxon;
        }
        return {
          ...taxon,
          species: taxon.species.map((species) =>
            species.id === speciesId ? { ...species, expanded: !species.expanded } : species,
          ),
        };
      }),
    );
  }

  protected updateSpeciesOpacity(taxonId: string, speciesId: string, opacityText: string): void {
    const opacity = this.parsePercent(opacityText);
    this.taxa.update((taxa) =>
      taxa.map((taxon) => {
        if (taxon.id !== taxonId) {
          return taxon;
        }
        return {
          ...taxon,
          species: taxon.species.map((species) =>
            species.id === speciesId ? { ...species, opacity } : species,
          ),
        };
      }),
    );
    this.scheduleOpacitySync(`${taxonId}:${speciesId}`);
  }

  protected filteredSpecies(taxon: TaxonRow): SpeciesRow[] {
    const query = taxon.searchQuery.trim().toLowerCase();
    const candidates = taxon.species.filter((species) => {
      const fullName = `${species.common} ${species.latin}`.toLowerCase();
      return fullName.includes(query);
    });

    if (query.length > 0 || taxon.showAll) {
      return candidates;
    }

    return candidates.slice(0, SPECIES_VISIBLE_LIMIT);
  }

  protected updateLayerSearchQuery(query: string): void {
    this.layerSearchQuery.set(query);
  }

  protected clearLayerSearchQuery(): void {
    this.layerSearchQuery.set('');
  }

  protected shouldShowGroupInAvailableLayers(group: LayerGroup): boolean {
    if (!this.hasLayerSearchQuery()) {
      return true;
    }
    if (group.disabled) {
      return false;
    }
    const match = this.searchMatchesByGroup().get(group.id);
    return !!match && match.rowMatches + match.taxonMatches > 0;
  }

  protected visibleGroupRows(group: LayerGroup): LayerControlRow[] {
    if (!this.hasLayerSearchQuery()) {
      return group.rows;
    }
    if (group.id === 'group-species-biodiversity') {
      return [];
    }
    const query = this.normalizedLayerSearchQuery();
    return group.rows.filter((row) => this.nameMatchesSearch(row.name, query));
  }

  protected visibleSpeciesForTaxon(taxon: TaxonRow): SpeciesRow[] {
    const query = this.normalizedLayerSearchQuery();
    if (query.length === 0) {
      return this.filteredSpecies(taxon);
    }
    const speciesMatches = taxon.species.filter((species) =>
      this.speciesMatchesSearch(species, query),
    );
    if (speciesMatches.length > 0) {
      return speciesMatches;
    }
    if (this.nameMatchesSearch(taxon.name, query)) {
      return this.filteredSpecies(taxon);
    }
    return [];
  }

  protected visibleGroupCountLabel(group: LayerGroup): string | undefined {
    if (!this.hasLayerSearchQuery()) {
      return group.countLabel;
    }
    const match = this.searchMatchesByGroup().get(group.id);
    if (!match) {
      return undefined;
    }
    if (group.id === 'group-species-biodiversity') {
      return `${match.taxonMatches} ${match.taxonMatches === 1 ? 'taxon match' : 'taxon matches'}`;
    }
    return `${match.rowMatches} ${match.rowMatches === 1 ? 'layer match' : 'layer matches'}`;
  }

  protected shouldShowTaxonShowAll(taxon: TaxonRow): boolean {
    if (this.hasLayerSearchQuery()) {
      return false;
    }
    return (
      taxon.searchQuery.trim().length === 0 &&
      !taxon.showAll &&
      taxon.species.length > SPECIES_VISIBLE_LIMIT
    );
  }

  protected resetDefaults(): void {
    this.overlaysCollapsed.set(false);
    this.layerSearchQuery.set('');
    this.overlays.set(this.createDefaultOverlays());
    this.taxa.set(this.createDefaultTaxa());
    this.groups.set(this.createDefaultGroups());
    this.selectedLayerOrder.set(
      this.computeSelectedLayerOrder(this.overlays(), this.groups(), this.taxa()),
    );
    this.syncAllRowsToMap();
  }

  protected moveSelectedLayer(rowId: string, direction: 'up' | 'down'): void {
    this.selectedLayerOrder.update((order) => this.reorderRowsById(order, rowId, direction));
  }

  protected onSelectedLayerDragStart(event: DragEvent, rowId: string): void {
    event.stopPropagation();
    const transfer = event.dataTransfer;
    if (!transfer) {
      return;
    }
    transfer.effectAllowed = 'move';
    transfer.setData('text/plain', rowId);
    this.selectedLayerDragId.set(rowId);
    this.selectedLayerDropTargetId.set(null);
    this.selectedLayerDropPosition.set('before');
  }

  protected onSelectedLayerDragOver(event: DragEvent, targetRowId: string): void {
    event.preventDefault();
    if (!this.selectedLayerDragId() || this.selectedLayerDragId() === targetRowId) {
      this.selectedLayerDropTargetId.set(null);
      return;
    }

    const target = event.currentTarget;
    if (target instanceof HTMLElement) {
      const rect = target.getBoundingClientRect();
      const offsetY = event.clientY - rect.top;
      this.selectedLayerDropPosition.set(offsetY > rect.height / 2 ? 'after' : 'before');
    }

    this.selectedLayerDropTargetId.set(targetRowId);
  }

  protected onSelectedLayerDrop(event: DragEvent, targetRowId: string): void {
    event.preventDefault();
    const draggedRowId = this.selectedLayerDragId() ?? event.dataTransfer?.getData('text/plain');
    if (!draggedRowId || draggedRowId === targetRowId) {
      this.clearSelectedLayerDragState();
      return;
    }

    const dropPosition = this.selectedLayerDropPosition();
    this.selectedLayerOrder.update((order) =>
      this.reorderRowsByDropTarget(order, draggedRowId, targetRowId, dropPosition),
    );
    this.clearSelectedLayerDragState();
  }

  protected onSelectedLayerDragEnd(): void {
    this.clearSelectedLayerDragState();
  }

  protected removeSelectedLayer(rowId: string): void {
    if (rowId === BASELINE_SOLUTION_OVERLAY_ID) {
      return;
    }

    if (rowId.startsWith('overlay-')) {
      this.toggleOverlaySelected(rowId);
      return;
    }

    const taxon = this.findTaxonById(rowId);
    if (taxon) {
      this.toggleTaxonSelected(rowId);
      return;
    }

    const groupId = this.findGroupIdByRowId(rowId);
    if (groupId) {
      this.toggleLayerSelected(groupId, rowId);
      return;
    }

    const speciesMatch = this.findSpeciesById(rowId);
    if (speciesMatch) {
      this.toggleSpeciesSelected(speciesMatch.taxonId, rowId);
    }
  }

  protected isSelectedLayerVisible(rowId: string): boolean {
    const overlay = this.overlays().find((row) => row.id === rowId);
    if (overlay) {
      return overlay.visible;
    }

    const taxon = this.findTaxonById(rowId);
    if (taxon) {
      return taxon.visible;
    }

    const groupRowMatch = this.findGroupRowById(rowId);
    if (groupRowMatch) {
      return groupRowMatch.row.visible;
    }

    const speciesMatch = this.findSpeciesById(rowId);
    if (speciesMatch) {
      return speciesMatch.species.visible;
    }

    return false;
  }

  protected isSelectedLayerExpanded(rowId: string): boolean {
    const overlay = this.overlays().find((row) => row.id === rowId);
    if (overlay) {
      return overlay.expanded;
    }

    const taxon = this.findTaxonById(rowId);
    if (taxon) {
      return taxon.expanded;
    }

    const groupRowMatch = this.findGroupRowById(rowId);
    if (groupRowMatch) {
      return groupRowMatch.row.expanded;
    }

    const speciesMatch = this.findSpeciesById(rowId);
    if (speciesMatch) {
      return speciesMatch.species.expanded;
    }

    return false;
  }

  protected toggleSelectedLayerVisibility(rowId: string): void {
    if (rowId.startsWith('overlay-')) {
      this.toggleOverlayVisibility(rowId);
      return;
    }

    const taxon = this.findTaxonById(rowId);
    if (taxon) {
      this.toggleTaxonVisibility(rowId);
      return;
    }

    const groupId = this.findGroupIdByRowId(rowId);
    if (groupId) {
      this.toggleLayerVisibility(groupId, rowId);
      return;
    }

    const speciesMatch = this.findSpeciesById(rowId);
    if (speciesMatch) {
      this.toggleSpeciesVisibility(speciesMatch.taxonId, rowId);
    }
  }

  protected toggleSelectedLayerExpanded(rowId: string): void {
    if (rowId.startsWith('overlay-')) {
      this.toggleOverlayExpanded(rowId);
      return;
    }

    const taxon = this.findTaxonById(rowId);
    if (taxon) {
      this.toggleTaxonExpanded(rowId);
      return;
    }

    const groupId = this.findGroupIdByRowId(rowId);
    if (groupId) {
      this.toggleLayerExpanded(groupId, rowId);
      return;
    }

    const speciesMatch = this.findSpeciesById(rowId);
    if (speciesMatch) {
      this.toggleSpeciesExpanded(speciesMatch.taxonId, rowId);
    }
  }

  protected selectedLayerOpacity(rowId: string): number {
    const overlay = this.overlays().find((row) => row.id === rowId);
    if (overlay) {
      return overlay.opacity;
    }

    const taxon = this.findTaxonById(rowId);
    if (taxon) {
      return taxon.opacity;
    }

    const groupRowMatch = this.findGroupRowById(rowId);
    if (groupRowMatch) {
      return groupRowMatch.row.opacity;
    }

    const speciesMatch = this.findSpeciesById(rowId);
    if (speciesMatch) {
      return speciesMatch.species.opacity;
    }

    return 0;
  }

  protected updateSelectedLayerOpacity(rowId: string, opacityText: string): void {
    if (rowId.startsWith('overlay-')) {
      this.updateOverlayOpacity(rowId, opacityText);
      return;
    }

    const groupId = this.findGroupIdByRowId(rowId);
    if (groupId) {
      this.updateLayerOpacity(groupId, rowId, opacityText);
      return;
    }

    const speciesMatch = this.findSpeciesById(rowId);
    if (speciesMatch) {
      this.updateSpeciesOpacity(speciesMatch.taxonId, rowId, opacityText);
    }
  }

  protected selectedLayerHasColorControl(rowId: string): boolean {
    const overlay = this.overlays().find((row) => row.id === rowId);
    if (overlay) {
      return overlay.hasColorControl;
    }

    const taxon = this.findTaxonById(rowId);
    if (taxon) {
      return taxon.hasColorControl;
    }

    const groupRowMatch = this.findGroupRowById(rowId);
    if (groupRowMatch) {
      return groupRowMatch.row.hasColorControl;
    }

    const speciesMatch = this.findSpeciesById(rowId);
    if (speciesMatch) {
      return speciesMatch.species.hasColorControl;
    }

    return false;
  }

  protected selectedLayerColor(rowId: string): string {
    const overlay = this.overlays().find((row) => row.id === rowId);
    if (overlay) {
      return overlay.color;
    }

    const taxon = this.findTaxonById(rowId);
    if (taxon) {
      return taxon.color;
    }

    const groupRowMatch = this.findGroupRowById(rowId);
    if (groupRowMatch) {
      return groupRowMatch.row.color;
    }

    const speciesMatch = this.findSpeciesById(rowId);
    if (speciesMatch) {
      return speciesMatch.species.color;
    }

    return '#64748b';
  }

  protected updateSelectedLayerColor(rowId: string, color: string): void {
    if (rowId.startsWith('overlay-')) {
      this.updateOverlayColor(rowId, color);
      return;
    }

    const groupId = this.findGroupIdByRowId(rowId);
    if (groupId) {
      this.updateLayerColor(groupId, rowId, color);
      return;
    }
  }

  private syncAllRowsToMap(): void {
    for (const overlay of this.overlays()) {
      this.syncRowToMap(overlay);
    }
    for (const group of this.groups()) {
      for (const row of group.rows) {
        this.syncRowToMap(row);
      }
    }
    for (const taxon of this.taxa()) {
      for (const species of taxon.species) {
        this.syncRowToMap(species);
      }
    }
  }

  private syncOverlayById(rowId: string): void {
    const row = this.overlays().find((overlay) => overlay.id === rowId);
    if (row) {
      this.syncRowToMap(row);
    }
  }

  private syncGroupRowById(groupId: string, rowId: string): void {
    const group = this.groups().find((item) => item.id === groupId);
    const row = group?.rows.find((item) => item.id === rowId);
    if (row) {
      this.syncRowToMap(row);
    }
  }

  private syncSpeciesById(taxonId: string, speciesId: string): void {
    const taxon = this.taxa().find((item) => item.id === taxonId);
    const species = taxon?.species.find((item) => item.id === speciesId);
    if (species) {
      this.syncRowToMap(species);
    }
  }

  private scheduleOpacitySync(rowKey: string): void {
    const previousFrame = this.opacitySyncFrames.get(rowKey);
    if (previousFrame) {
      cancelAnimationFrame(previousFrame);
    }

    const frameId = requestAnimationFrame(() => {
      if (rowKey.includes(':')) {
        const [scopeId, rowId] = rowKey.split(':');
        if (scopeId.startsWith('taxon-')) {
          this.syncSpeciesById(scopeId, rowId);
        } else {
          this.syncGroupRowById(scopeId, rowId);
        }
      } else {
        this.syncOverlayById(rowKey);
      }
      this.opacitySyncFrames.delete(rowKey);
    });

    this.opacitySyncFrames.set(rowKey, frameId);
  }

  private scheduleColorSync(rowKey: string): void {
    const previous = this.colorSyncFrames.get(rowKey);
    if (previous) {
      cancelAnimationFrame(previous);
    }

    const frameId = requestAnimationFrame(() => {
      if (rowKey.includes(':')) {
        const [scopeId, rowId] = rowKey.split(':');
        if (scopeId.startsWith('taxon-')) {
          this.syncSpeciesById(scopeId, rowId);
        } else {
          this.syncGroupRowById(scopeId, rowId);
        }
      } else {
        this.syncOverlayById(rowKey);
      }
      this.colorSyncFrames.delete(rowKey);
    });

    this.colorSyncFrames.set(rowKey, frameId);
  }

  private syncSelectedLayerStackingToMap(order: string[], overlays: LayerControlRow[]): void {
    const overlaysById = new Map(overlays.map((overlay) => [overlay.id, overlay]));
    const layerOrderTopToBottom: SidebarSolutionLayerType[] = [];

    for (const rowId of order) {
      const overlay = overlaysById.get(rowId);
      const mapSync = overlay?.mapSync;
      if (!overlay?.selected || !mapSync) {
        continue;
      }
      if (
        mapSync.type === 'solution-baseline' ||
        mapSync.type === 'solution-candidate' ||
        mapSync.type === 'solution-overlap'
      ) {
        layerOrderTopToBottom.push(mapSync.type);
      }
    }

    if (layerOrderTopToBottom.length === 0) {
      return;
    }
    this.solutionLayerService.reorderSolutionLayersBySidebarOrder(layerOrderTopToBottom);
  }

  private syncRowToMap(row: LayerControlRow): void {
    const mapSync = row.mapSync;
    if (!mapSync) {
      return;
    }

    if (mapSync.type === 'solution-baseline') {
      this.solutionLayerService.setBaselineVisibility(row.visible);
      this.solutionLayerService.setBaselineOpacity(row.opacity / 100);
      this.solutionLayerService.setBaselineColor(row.color);
      return;
    }

    if (mapSync.type === 'solution-candidate') {
      this.solutionLayerService.setCandidateVisibility(row.visible);
      this.solutionLayerService.setCandidateOpacity(row.opacity / 100);
      this.solutionLayerService.setCandidateColor(row.color);
      return;
    }

    if (mapSync.type === 'solution-overlap') {
      this.solutionLayerService.setOverlapVisibility(row.visible);
      this.solutionLayerService.setOverlapOpacity(row.opacity / 100);
      this.solutionLayerService.setOverlapColor(row.color);
      return;
    }

    if (mapSync.type === 'admin-boundary') {
      this.adminBoundaryService.setLayerVisibility(mapSync.boundaryType, row.visible);
      return;
    }

    if (mapSync.type !== 'app-state-layer') {
      return;
    }

    const visibleLayers = this.appState.visibleLayers$();
    const index = visibleLayers.findIndex((layer) => layer.id === mapSync.layerId);
    if (index < 0) {
      return;
    }

    const nextLayer = {
      ...visibleLayers[index],
      visible: row.visible,
      opacity: row.opacity / 100,
    };
    const nextVisibleLayers = [...visibleLayers];
    nextVisibleLayers.splice(index, 1, nextLayer);
    this.appState.visibleLayers$.set(nextVisibleLayers);
  }

  private reorderRows<T extends { id: string; canReorder: boolean }>(
    rows: T[],
    rowId: string,
    direction: 'up' | 'down',
  ): T[] {
    const index = rows.findIndex((row) => row.id === rowId);
    if (index < 0 || !rows[index].canReorder) {
      return rows;
    }

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= rows.length) {
      return rows;
    }

    const nextRows = [...rows];
    const [row] = nextRows.splice(index, 1);
    nextRows.splice(targetIndex, 0, row);
    return nextRows;
  }

  private reorderRowsById(rows: string[], rowId: string, direction: 'up' | 'down'): string[] {
    const index = rows.findIndex((id) => id === rowId);
    if (index < 0) {
      return rows;
    }

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= rows.length) {
      return rows;
    }

    const nextRows = [...rows];
    const [row] = nextRows.splice(index, 1);
    nextRows.splice(targetIndex, 0, row);
    return nextRows;
  }

  private reorderRowsByDropTarget(
    rows: string[],
    draggedRowId: string,
    targetRowId: string,
    dropPosition: SelectedLayerDropPosition,
  ): string[] {
    const fromIndex = rows.findIndex((id) => id === draggedRowId);
    const targetIndex = rows.findIndex((id) => id === targetRowId);
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) {
      return rows;
    }

    const nextRows = [...rows];
    const [movedRowId] = nextRows.splice(fromIndex, 1);
    const nextTargetIndex = nextRows.findIndex((id) => id === targetRowId);
    if (nextTargetIndex < 0) {
      return rows;
    }
    const insertionIndex = dropPosition === 'before' ? nextTargetIndex : nextTargetIndex + 1;
    nextRows.splice(insertionIndex, 0, movedRowId);
    return nextRows;
  }

  private clearSelectedLayerDragState(): void {
    this.selectedLayerDragId.set(null);
    this.selectedLayerDropTargetId.set(null);
    this.selectedLayerDropPosition.set('before');
  }

  private parsePercent(rawValue: string): number {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round(parsed)));
  }

  private syncInitialBoundaryState(): void {
    const group = this.groups().find((g) => g.id === 'group-admin-boundaries');
    for (const row of group?.rows ?? []) {
      this.syncRowToMap(row);
    }
  }

  private updateSelectedLayerOrder(
    rowId: string,
    selected: boolean,
    position: 'start' | 'end' = 'end',
  ): void {
    this.selectedLayerOrder.update((order) => {
      const exists = order.includes(rowId);
      if (selected && !exists) {
        return position === 'start' ? [rowId, ...order] : [...order, rowId];
      }
      if (!selected && exists) {
        return order.filter((id) => id !== rowId);
      }
      return order;
    });
  }

  private computeSelectedLayerOrder(
    overlays: LayerControlRow[],
    groups: LayerGroup[],
    taxa: TaxonRow[],
  ): string[] {
    const selectedOverlayIds = overlays.filter((row) => row.selected).map((row) => row.id);
    const selectedGroupRowIds = groups
      .flatMap((group) => group.rows)
      .filter((row) => row.selected)
      .map((row) => row.id);
    const selectedTaxonIds = taxa.filter((taxon) => taxon.selected).map((taxon) => taxon.id);
    const selectedSpeciesIds = taxa
      .flatMap((taxon) => taxon.species)
      .filter((species) => species.selected)
      .map((species) => species.id);
    return [
      ...selectedOverlayIds,
      ...selectedGroupRowIds,
      ...selectedTaxonIds,
      ...selectedSpeciesIds,
    ];
  }

  private buildSelectedLayers(): SelectedLayerRow[] {
    const overlays = this.overlays();
    const groups = this.groups();
    const taxa = this.taxa();
    const order = this.selectedLayerOrder();
    const rowLookup = new Map<string, SelectedLayerRow>();

    for (const overlay of overlays) {
      if (!overlay.selected) {
        continue;
      }
      rowLookup.set(overlay.id, {
        id: overlay.id,
        name: overlay.name,
        sourceLabel:
          overlay.id === BASELINE_SOLUTION_OVERLAY_ID
            ? 'Selected Solution'
            : overlay.id === CANDIDATE_SOLUTION_OVERLAY_ID
              ? 'Comparison Solution'
              : overlay.id === OVERLAP_SOLUTION_OVERLAY_ID
                ? 'Comparison Overlay'
                : 'Available Layers',
        sourceType: 'overlay',
        mapUnavailable: !!overlay.mapUnavailable,
      });
    }

    for (const group of groups) {
      for (const row of group.rows) {
        if (!row.selected) {
          continue;
        }
        rowLookup.set(row.id, {
          id: row.id,
          name: row.name,
          sourceLabel: group.title,
          sourceType: 'group',
          mapUnavailable: !!row.mapUnavailable,
        });
      }
    }

    for (const taxon of taxa) {
      if (taxon.selected) {
        rowLookup.set(taxon.id, {
          id: taxon.id,
          name: taxon.name,
          sourceLabel: 'Species & Biodiversity',
          sourceType: 'group',
          mapUnavailable: !!taxon.mapUnavailable,
        });
      }
      for (const species of taxon.species) {
        if (!species.selected) {
          continue;
        }
        rowLookup.set(species.id, {
          id: species.id,
          name: species.common,
          sourceLabel: `Species & Biodiversity: ${taxon.name}`,
          sourceType: 'group',
          mapUnavailable: !!species.mapUnavailable,
        });
      }
    }

    const orderedSelectedRows: SelectedLayerRow[] = [];
    for (const rowId of order) {
      const row = rowLookup.get(rowId);
      if (!row) {
        continue;
      }
      orderedSelectedRows.push(row);
      rowLookup.delete(rowId);
    }

    for (const row of rowLookup.values()) {
      orderedSelectedRows.push(row);
    }

    return orderedSelectedRows;
  }

  private buildMasterLegendLayerEntries(): MapLegendLayerEntry[] {
    const overlays = this.overlays();
    const groups = this.groups();
    const taxa = this.taxa();
    const order = this.selectedLayerOrder();
    const entryLookup = new Map<string, MapLegendLayerEntry>();

    for (const row of overlays) {
      if (!row.selected || this.isSolutionLayerRow(row)) {
        continue;
      }
      entryLookup.set(row.id, this.toMasterLegendLayerEntry(row));
    }

    for (const group of groups) {
      for (const row of group.rows) {
        if (!row.selected || this.isSolutionLayerRow(row)) {
          continue;
        }
        entryLookup.set(row.id, this.toMasterLegendLayerEntry(row));
      }
    }

    for (const taxon of taxa) {
      if (taxon.selected) {
        entryLookup.set(taxon.id, this.toMasterLegendLayerEntry(taxon));
      }
      for (const species of taxon.species) {
        if (!species.selected) {
          continue;
        }
        entryLookup.set(species.id, this.toMasterLegendLayerEntry(species));
      }
    }

    const orderedEntries: MapLegendLayerEntry[] = [];
    for (const rowId of order) {
      const entry = entryLookup.get(rowId);
      if (!entry) {
        continue;
      }
      orderedEntries.push(entry);
      entryLookup.delete(rowId);
    }

    for (const entry of entryLookup.values()) {
      orderedEntries.push(entry);
    }

    return orderedEntries;
  }

  private toMasterLegendLayerEntry(row: LayerControlRow): MapLegendLayerEntry {
    if (row.mapSync?.type === 'admin-boundary') {
      const style = LEGEND_BOUNDARY_STYLES[row.mapSync.boundaryType];
      return {
        id: row.id,
        name: row.name,
        swatchType: 'line',
        color: style.color,
        lineStyle: style.lineStyle,
        lineWidth: style.lineWidth,
      };
    }

    if (this.isHumanFootprintLayerRow(row)) {
      return {
        id: row.id,
        name: row.name,
        swatchType: 'gradient',
        color: row.color,
        lineStyle: 'solid',
        lineWidth: 1,
      };
    }

    return {
      id: row.id,
      name: row.name,
      swatchType: 'fill',
      color: row.color || '#64748b',
      lineStyle: 'solid',
      lineWidth: 1,
    };
  }

  private isHumanFootprintLayerRow(row: LayerControlRow): boolean {
    const normalizedName = row.name.trim().toLowerCase();
    return normalizedName === 'human footprint';
  }

  private isSolutionLayerRow(row: LayerControlRow): boolean {
    const mapType = row.mapSync?.type;
    return (
      row.id === BASELINE_SOLUTION_OVERLAY_ID ||
      row.id === CANDIDATE_SOLUTION_OVERLAY_ID ||
      row.id === OVERLAP_SOLUTION_OVERLAY_ID ||
      mapType === 'solution-baseline' ||
      mapType === 'solution-candidate' ||
      mapType === 'solution-overlap'
    );
  }

  private findGroupIdByRowId(rowId: string): string | undefined {
    const group = this.groups().find((item) => item.rows.some((row) => row.id === rowId));
    return group?.id;
  }

  private findGroupRowById(rowId: string): { groupId: string; row: LayerControlRow } | undefined {
    for (const group of this.groups()) {
      const row = group.rows.find((candidate) => candidate.id === rowId);
      if (row) {
        return { groupId: group.id, row };
      }
    }
    return undefined;
  }

  private findSpeciesById(
    speciesId: string,
  ): { taxonId: string; taxonName: string; species: SpeciesRow } | undefined {
    for (const taxon of this.taxa()) {
      const species = taxon.species.find((candidate) => candidate.id === speciesId);
      if (species) {
        return { taxonId: taxon.id, taxonName: taxon.name, species };
      }
    }
    return undefined;
  }

  private findTaxonById(taxonId: string): TaxonRow | undefined {
    return this.taxa().find((taxon) => taxon.id === taxonId);
  }

  private createDefaultOverlays(): LayerControlRow[] {
    return [
      {
        id: BASELINE_SOLUTION_OVERLAY_ID,
        name: 'Conservation Solution',
        selected: true,
        visible: true,
        expanded: true,
        opacity: 70,
        color: SINGLE_SOLUTION_COLOR,
        canReorder: true,
        hasStyleControls: true,
        hasColorControl: true,
        mapSync: { type: 'solution-baseline' },
      },
      {
        id: 'overlay-runap',
        name: 'Protected Areas (RUNAP)',
        selected: false,
        visible: false,
        expanded: false,
        opacity: 80,
        color: '#2563eb',
        canReorder: true,
        hasStyleControls: true,
        hasColorControl: true,
        mapUnavailable: true,
      },
      {
        id: 'overlay-omecs',
        name: 'OMECs',
        selected: false,
        visible: false,
        expanded: false,
        opacity: 75,
        color: '#7c3aed',
        canReorder: true,
        hasStyleControls: true,
        hasColorControl: true,
        mapUnavailable: true,
      },
    ];
  }

  private syncPrimarySolutionOverlay(solutionName: string | null): void {
    this.overlays.update((rows) =>
      rows.map((row) =>
        row.id === BASELINE_SOLUTION_OVERLAY_ID && solutionName
          ? { ...row, name: solutionName }
          : row,
      ),
    );
  }

  private syncBaselineOverlayColor(isComparing: boolean): void {
    const targetColor = isComparing ? COMPARISON_BASELINE_COLOR : SINGLE_SOLUTION_COLOR;
    this.overlays.update((rows) =>
      rows.map((row) =>
        row.id === BASELINE_SOLUTION_OVERLAY_ID ? { ...row, color: targetColor } : row,
      ),
    );
    this.syncOverlayById(BASELINE_SOLUTION_OVERLAY_ID);
  }

  private syncComparisonSolutionOverlay(solutionName: string | null): void {
    if (!solutionName) {
      this.overlays.update((rows) =>
        rows.filter((row) => row.id !== CANDIDATE_SOLUTION_OVERLAY_ID),
      );
      this.updateSelectedLayerOrder(CANDIDATE_SOLUTION_OVERLAY_ID, false);
      return;
    }

    let hasCandidateOverlay = false;
    this.overlays.update((rows) => {
      const nextRows = rows.map((row) => {
        if (row.id !== CANDIDATE_SOLUTION_OVERLAY_ID) {
          return row;
        }
        hasCandidateOverlay = true;
        return {
          ...row,
          name: solutionName,
          selected: true,
          visible: true,
        };
      });

      if (hasCandidateOverlay) {
        return nextRows;
      }

      return [
        ...nextRows,
        {
          id: CANDIDATE_SOLUTION_OVERLAY_ID,
          name: solutionName,
          selected: true,
          visible: true,
          expanded: true,
          opacity: 70,
          color: COMPARISON_CANDIDATE_COLOR,
          canReorder: true,
          hasStyleControls: true,
          hasColorControl: true,
          mapSync: { type: 'solution-candidate' },
        },
      ];
    });

    this.updateSelectedLayerOrder(CANDIDATE_SOLUTION_OVERLAY_ID, true);
    this.syncOverlayById(CANDIDATE_SOLUTION_OVERLAY_ID);
  }

  private syncComparisonOverlapOverlay(
    solutionName: string | null,
    shouldShowOverlap: boolean,
  ): void {
    if (!solutionName || !shouldShowOverlap) {
      this.overlays.update((rows) => rows.filter((row) => row.id !== OVERLAP_SOLUTION_OVERLAY_ID));
      this.updateSelectedLayerOrder(OVERLAP_SOLUTION_OVERLAY_ID, false);
      return;
    }

    let hasOverlapOverlay = false;
    this.overlays.update((rows) => {
      const nextRows = rows.map((row) => {
        if (row.id !== OVERLAP_SOLUTION_OVERLAY_ID) {
          return row;
        }
        hasOverlapOverlay = true;
        return {
          ...row,
          selected: true,
          visible: true,
        };
      });

      if (hasOverlapOverlay) {
        return nextRows;
      }

      return [
        ...nextRows,
        {
          id: OVERLAP_SOLUTION_OVERLAY_ID,
          name: 'Agreement / Overlap',
          selected: true,
          visible: true,
          expanded: true,
          opacity: 100,
          color: COMPARISON_OVERLAP_COLOR,
          canReorder: true,
          hasStyleControls: true,
          hasColorControl: true,
          mapSync: { type: 'solution-overlap' },
        },
      ];
    });

    this.updateSelectedLayerOrder(OVERLAP_SOLUTION_OVERLAY_ID, true, 'start');
  }

  private createDefaultTaxa(): TaxonRow[] {
    return [
      {
        id: 'taxon-mammals',
        name: 'Mammals',
        countLabel: '412 species',
        speciesCount: 412,
        selected: false,
        visible: false,
        expanded: false,
        opacity: 60,
        color: '#64748b',
        canReorder: false,
        hasStyleControls: false,
        hasColorControl: false,
        mapUnavailable: true,
        searchQuery: '',
        showAll: false,
        species: this.createSpeciesRows('taxon-mammals', [
          { common: 'Jaguar', latin: 'Panthera onca' },
          { common: 'Spectacled Bear', latin: 'Tremarctos ornatus' },
          { common: 'Mountain Tapir', latin: 'Tapirus pinchaque' },
          { common: 'Brown Spider Monkey', latin: 'Ateles hybridus' },
          { common: 'Puma', latin: 'Puma concolor' },
          { common: 'Giant Otter', latin: 'Pteronura brasiliensis' },
          { common: 'Woolly Monkey', latin: 'Lagothrix lagothricha' },
        ]),
      },
      {
        id: 'taxon-birds',
        name: 'Birds',
        countLabel: '1,932 species',
        speciesCount: 1932,
        selected: false,
        visible: false,
        expanded: false,
        opacity: 60,
        color: '#64748b',
        canReorder: false,
        hasStyleControls: false,
        hasColorControl: false,
        mapUnavailable: true,
        searchQuery: '',
        showAll: false,
        species: this.createSpeciesRows('taxon-birds', [
          { common: 'Andean Condor', latin: 'Vultur gryphus' },
          { common: 'Yellow-eared Parrot', latin: 'Ognorhynchus icterotis' },
          { common: 'Blue-billed Curassow', latin: 'Crax alberti' },
          { common: 'Multicolored Tanager', latin: 'Chlorochrysa nitidissima' },
          { common: 'Turquoise Dacnis', latin: 'Dacnis hartlaubi' },
          { common: 'Rusty-faced Parrot', latin: 'Hapalopsittaca amazonina' },
          { common: 'Tolima Dove', latin: 'Leptotila conoveri' },
        ]),
      },
      {
        id: 'taxon-amphibians',
        name: 'Amphibians',
        countLabel: '803 species',
        speciesCount: 803,
        selected: false,
        visible: false,
        expanded: false,
        opacity: 60,
        color: '#64748b',
        canReorder: false,
        hasStyleControls: false,
        hasColorControl: false,
        mapUnavailable: true,
        searchQuery: '',
        showAll: false,
        species: this.createSpeciesRows('taxon-amphibians', [
          { common: 'Golden Poison Frog', latin: 'Phyllobates terribilis' },
          { common: 'Harlequin Poison Frog', latin: 'Oophaga histrionica' },
          { common: "Lehmann's Poison Frog", latin: 'Oophaga lehmanni' },
          { common: 'Elegant Stubfoot Toad', latin: 'Atelopus elegans' },
          { common: "Buckley's Glass Frog", latin: 'Centrolene buckleyi' },
          { common: 'Cauca Poison Frog', latin: 'Andinobates bombetes' },
          { common: "Lynch's Robber Frog", latin: 'Pristimantis lynchi' },
        ]),
      },
      {
        id: 'taxon-reptiles',
        name: 'Reptiles',
        countLabel: '590 species',
        speciesCount: 590,
        selected: false,
        visible: false,
        expanded: false,
        opacity: 60,
        color: '#64748b',
        canReorder: false,
        hasStyleControls: false,
        hasColorControl: false,
        mapUnavailable: true,
        searchQuery: '',
        showAll: false,
        species: this.createSpeciesRows('taxon-reptiles', [
          { common: 'Orinoco Crocodile', latin: 'Crocodylus intermedius' },
          { common: 'Hawksbill Sea Turtle', latin: 'Eretmochelys imbricata' },
          { common: 'Green Iguana', latin: 'Iguana iguana' },
          { common: 'Bushmaster', latin: 'Lachesis muta' },
          { common: 'Leatherback Sea Turtle', latin: 'Dermochelys coriacea' },
          { common: 'Spectacled Caiman', latin: 'Caiman crocodilus' },
        ]),
      },
      {
        id: 'taxon-plants',
        name: 'Plants',
        countLabel: '4,963 species',
        speciesCount: 4963,
        selected: false,
        visible: false,
        expanded: false,
        opacity: 60,
        color: '#64748b',
        canReorder: false,
        hasStyleControls: false,
        hasColorControl: false,
        mapUnavailable: true,
        searchQuery: '',
        showAll: false,
        species: this.createSpeciesRows('taxon-plants', [
          { common: 'Quindio Wax Palm', latin: 'Ceroxylon quindiuense' },
          { common: 'Frailejon', latin: 'Espeletia grandiflora' },
          { common: 'May Flower Orchid', latin: 'Cattleya trianae' },
          { common: 'Guayacan', latin: 'Tabebuia chrysantha' },
          { common: 'Abarco', latin: 'Cariniana pyriformis' },
          { common: 'Heaven Lotus', latin: 'Gustavia superba' },
          { common: 'Lobster Claw', latin: 'Heliconia rostrata' },
        ]),
      },
    ];
  }

  /**
   * Category cards below Management Figures — all start collapsed (UCS-101).
   * Management Figures itself uses `overlaysCollapsed` (default expanded).
   */
  private createDefaultGroups(): LayerGroup[] {
    return [
      {
        id: 'group-admin-boundaries',
        title: 'Administrative Boundaries',
        countLabel: '3 layers',
        collapsed: false,
        rows: [
          this.boundaryRow('sirap', 'SIRAP Regions', false, false),
          this.boundaryRow('department', 'Departments', false, false),
          this.boundaryRow('municipality', 'Municipalities', false, false),
        ],
      },
      {
        id: 'group-species-biodiversity',
        title: 'Species & Biodiversity',
        countLabel: '5 taxon groups',
        collapsed: true,
        note: "Distributions shown are those included in this scenario's calculation. Drill down to individual species when the solution includes species-level rasters.",
        rows: [],
      },
      {
        id: 'group-ecosystems',
        title: 'Ecosystems',
        countLabel: '5 layers',
        collapsed: true,
        rows: [
          this.layerRow('eco-types', 'Ecosystem Types', '#0d9488', 60),
          this.layerRow('eco-paramos', 'Paramos', '#6d8e7e', 55),
          this.layerRow('eco-wetlands', 'Wetlands', '#0284c7', 55),
          this.layerRow('eco-dry-forest', 'Dry Forest', '#a16207', 55),
          this.layerRow('eco-mangroves', 'Mangroves', '#15803d', 55),
        ],
      },
      {
        id: 'group-environmental-services',
        title: 'Environmental Services',
        countLabel: '2 layers',
        collapsed: true,
        rows: [
          this.layerRow('env-carbon', 'Carbon Storage', '#374151', 50),
          this.layerRow('env-water', 'Water Regulation', '#0369a1', 50),
        ],
      },
      {
        id: 'group-cultural-ethnic',
        title: 'Cultural & Ethnic Territories',
        countLabel: '2 layers',
        collapsed: true,
        rows: [
          this.layerRow('cult-indigenous', 'Indigenous Reserves', '#6366f1', 60),
          this.layerRow('cult-afro', 'Afro-Colombian Community Territories', '#a855f7', 60),
        ],
      },
      {
        id: 'group-socio-economic',
        title: 'Socio-economic',
        countLabel: '3 layers',
        collapsed: true,
        rows: [
          this.layerRow('soc-human-footprint', 'Human Footprint', '#d97706', 55),
          this.layerRow('soc-ag-opportunity-cost', 'Agricultural Opportunity Cost', '#ea580c', 55),
          this.layerRow('soc-land-use', 'Land Use', '#78716c', 50),
        ],
      },
      {
        id: 'group-conflict-security',
        title: 'Conflict & Security',
        countLabel: '1 layer',
        collapsed: true,
        rows: [this.layerRow('conflict-zones', 'Conflict Zones', '#dc2626', 50)],
      },
      {
        id: 'group-prospective-models',
        title: 'Prospective models',
        collapsed: true,
        disabled: true,
        comingSoon: true,
        rows: [],
      },
    ];
  }

  private layerRow(id: string, name: string, color: string, opacity: number): LayerControlRow {
    return {
      id: `layer-${id}`,
      name,
      selected: false,
      visible: false,
      expanded: false,
      opacity,
      color,
      canReorder: true,
      hasStyleControls: true,
      hasColorControl: true,
      mapUnavailable: true,
    };
  }

  private boundaryRow(
    boundaryType: AoiType,
    name: string,
    visible: boolean,
    selected: boolean,
  ): LayerControlRow {
    return {
      id: `boundary-${boundaryType}`,
      name,
      selected,
      visible,
      expanded: false,
      opacity: 100,
      color: '#000000',
      canReorder: false,
      hasStyleControls: false,
      hasColorControl: false,
      mapSync: { type: 'admin-boundary', boundaryType },
    };
  }

  private createSpeciesRows(taxonId: string, species: SpeciesSample[]): SpeciesRow[] {
    return species.map((sample) => this.speciesRow(taxonId, sample.common, sample.latin));
  }

  private speciesRow(taxonId: string, common: string, latin: string): SpeciesRow {
    const slug = this.toSlug(common);
    return {
      id: `species-${taxonId}-${slug}`,
      name: common,
      common,
      latin,
      taxonId,
      slug,
      selected: false,
      visible: false,
      expanded: false,
      opacity: 65,
      color: '#475569',
      canReorder: true,
      hasStyleControls: true,
      hasColorControl: false,
      mapUnavailable: true,
    };
  }

  private toSlug(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private nameMatchesSearch(name: string, normalizedQuery: string): boolean {
    return name.toLowerCase().includes(normalizedQuery);
  }

  protected isAuthLockedRow(row: LayerControlRow): boolean {
    return (
      row.mapSync?.type === 'admin-boundary' &&
      row.mapSync.boundaryType === 'sirap' &&
      !this.canAccessTier2()
    );
  }

  private speciesMatchesSearch(species: SpeciesRow, normalizedQuery: string): boolean {
    const combinedName = `${species.common} ${species.latin}`.toLowerCase();
    return combinedName.includes(normalizedQuery);
  }

  private taxonMatchesSearch(taxon: TaxonRow, normalizedQuery: string): boolean {
    return (
      this.nameMatchesSearch(taxon.name, normalizedQuery) ||
      taxon.species.some((species) => this.speciesMatchesSearch(species, normalizedQuery))
    );
  }
}
