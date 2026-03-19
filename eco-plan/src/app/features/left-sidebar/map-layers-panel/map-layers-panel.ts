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
} from '@angular/core';

import { type AoiType } from '@core/models';
import { AppStateService } from '@core/services/app-state.service';
import { AdminBoundaryService } from '@features/map/services/admin-boundary.service';
import { SolutionLayerService } from '@features/map/services/solution-layer.service';

type AdminBoundaryOption = 'national' | AoiType;

interface LayerControlRow {
  id: string;
  name: string;
  countLabel?: string;
  visible: boolean;
  expanded: boolean;
  opacity: number;
  color: string;
  canReorder: boolean;
  hasStyleControls: boolean;
  hasColorControl: boolean;
  disabled?: boolean;
  mapSync?:
    | {
        type: 'solution';
      }
    | {
        type: 'app-state-layer';
        layerId: string;
      };
}

interface SpeciesSample {
  common: string;
  latin: string;
}

interface TaxonRow extends LayerControlRow {
  speciesCount: number;
  searchQuery: string;
  showAll: boolean;
  species: SpeciesSample[];
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

const SPECIES_VISIBLE_LIMIT = 6;

@Component({
  selector: 'app-map-layers-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './map-layers-panel.html',
  styleUrl: './map-layers-panel.scss',
})
export class MapLayersPanelComponent implements OnDestroy {
  @Output() readonly solutionFinderRequested = new EventEmitter<void>();

  private readonly appState = inject(AppStateService);
  private readonly adminBoundaryService = inject(AdminBoundaryService);
  private readonly solutionLayerService = inject(SolutionLayerService);
  private readonly opacitySyncTimers = new Map<string, ReturnType<typeof setTimeout>>();

  protected readonly activeScenarioName = signal('Ecos30 + RUNAP + OMEC (HF)');
  protected readonly hasActiveSolution = computed(() => this.appState.hasActiveSolution());
  protected readonly adminBoundary = signal<AdminBoundaryOption>('national');
  protected readonly customBoundaryRequested = signal(false);
  protected readonly overlays = signal<LayerControlRow[]>(this.createDefaultOverlays());
  protected readonly taxa = signal<TaxonRow[]>(this.createDefaultTaxa());
  protected readonly groups = signal<LayerGroup[]>(this.createDefaultGroups());

  constructor() {
    this.onAdminBoundaryChange('national');

    effect(() => {
      const solution = this.appState.activeSolution$();
      if (solution?.name) {
        this.activeScenarioName.set(solution.name);
      }
    });
  }

  ngOnDestroy(): void {
    for (const timer of this.opacitySyncTimers.values()) {
      clearTimeout(timer);
    }
    this.opacitySyncTimers.clear();
  }

  protected requestSolutionFinder(): void {
    this.solutionFinderRequested.emit();
  }

  protected onAdminBoundaryChange(value: string): void {
    if (!this.isAdminBoundaryOption(value)) {
      return;
    }

    this.adminBoundary.set(value);
    this.adminBoundaryService.setLayerVisibility('sirap', value === 'sirap');
    this.adminBoundaryService.setLayerVisibility('department', value === 'department');
    this.adminBoundaryService.setLayerVisibility('municipality', value === 'municipality');
  }

  protected requestCustomBoundary(): void {
    this.customBoundaryRequested.set(true);
  }

  protected dismissCustomBoundary(): void {
    this.customBoundaryRequested.set(false);
  }

  protected toggleGroup(groupId: string): void {
    this.groups.update((groups) =>
      groups.map((group) =>
        group.id === groupId && !group.disabled ? { ...group, collapsed: !group.collapsed } : group,
      ),
    );
  }

  protected toggleOverlayVisibility(rowId: string): void {
    this.overlays.update((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, visible: !row.visible } : row)),
    );
    this.syncOverlayById(rowId);
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
  }

  protected moveOverlay(rowId: string, direction: 'up' | 'down'): void {
    this.overlays.update((rows) => this.reorderRows(rows, rowId, direction));
  }

  protected toggleLayerVisibility(groupId: string, rowId: string): void {
    this.groups.update((groups) =>
      groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }

        return {
          ...group,
          rows: group.rows.map((row) =>
            row.id === rowId ? { ...row, visible: !row.visible } : row,
          ),
        };
      }),
    );
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
    this.taxa.update((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, visible: !row.visible } : row)),
    );
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

  protected filteredSpecies(taxon: TaxonRow): SpeciesSample[] {
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

  protected shouldShowTaxonShowAll(taxon: TaxonRow): boolean {
    return (
      taxon.searchQuery.trim().length === 0 &&
      !taxon.showAll &&
      taxon.species.length > SPECIES_VISIBLE_LIMIT
    );
  }

  protected resetDefaults(): void {
    this.adminBoundary.set('national');
    this.customBoundaryRequested.set(false);
    this.overlays.set(this.createDefaultOverlays());
    this.taxa.set(this.createDefaultTaxa());
    this.groups.set(this.createDefaultGroups());
    this.adminBoundaryService.setLayerVisibility('sirap', false);
    this.adminBoundaryService.setLayerVisibility('department', false);
    this.adminBoundaryService.setLayerVisibility('municipality', false);
    this.syncAllRowsToMap();
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

  private scheduleOpacitySync(rowKey: string): void {
    const previousTimer = this.opacitySyncTimers.get(rowKey);
    if (previousTimer) {
      clearTimeout(previousTimer);
    }

    const timer = setTimeout(() => {
      if (rowKey.includes(':')) {
        const [groupId, rowId] = rowKey.split(':');
        this.syncGroupRowById(groupId, rowId);
      } else {
        this.syncOverlayById(rowKey);
      }
      this.opacitySyncTimers.delete(rowKey);
    }, 180);

    this.opacitySyncTimers.set(rowKey, timer);
  }

  private syncRowToMap(row: LayerControlRow): void {
    const mapSync = row.mapSync;
    if (!mapSync) {
      return;
    }

    if (mapSync.type === 'solution') {
      this.solutionLayerService.setVisibility(row.visible);
      this.solutionLayerService.setOpacity(row.opacity / 100);
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

  private parsePercent(rawValue: string): number {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round(parsed)));
  }

  private isAdminBoundaryOption(value: string): value is AdminBoundaryOption {
    return (
      value === 'national' ||
      value === 'sirap' ||
      value === 'department' ||
      value === 'municipality'
    );
  }

  private createDefaultOverlays(): LayerControlRow[] {
    return [
      {
        id: 'overlay-conservation-solution',
        name: 'Conservation Solution',
        visible: true,
        expanded: true,
        opacity: 70,
        color: '#16a34a',
        canReorder: true,
        hasStyleControls: true,
        hasColorControl: true,
        mapSync: { type: 'solution' },
      },
      {
        id: 'overlay-runap',
        name: 'Protected Areas (RUNAP)',
        visible: true,
        expanded: true,
        opacity: 80,
        color: '#2563eb',
        canReorder: true,
        hasStyleControls: true,
        hasColorControl: true,
      },
      {
        id: 'overlay-omecs',
        name: 'OMECs',
        visible: true,
        expanded: true,
        opacity: 75,
        color: '#7c3aed',
        canReorder: true,
        hasStyleControls: true,
        hasColorControl: true,
      },
    ];
  }

  private createDefaultTaxa(): TaxonRow[] {
    return [
      {
        id: 'taxon-mammals',
        name: 'Mammals',
        countLabel: '412 species',
        speciesCount: 412,
        visible: false,
        expanded: false,
        opacity: 60,
        color: '#64748b',
        canReorder: false,
        hasStyleControls: false,
        hasColorControl: false,
        searchQuery: '',
        showAll: false,
        species: [
          { common: 'Jaguar', latin: 'Panthera onca' },
          { common: 'Spectacled Bear', latin: 'Tremarctos ornatus' },
          { common: 'Mountain Tapir', latin: 'Tapirus pinchaque' },
          { common: 'Brown Spider Monkey', latin: 'Ateles hybridus' },
          { common: 'Puma', latin: 'Puma concolor' },
          { common: 'Giant Otter', latin: 'Pteronura brasiliensis' },
          { common: 'Woolly Monkey', latin: 'Lagothrix lagothricha' },
        ],
      },
      {
        id: 'taxon-birds',
        name: 'Birds',
        countLabel: '1,932 species',
        speciesCount: 1932,
        visible: false,
        expanded: false,
        opacity: 60,
        color: '#64748b',
        canReorder: false,
        hasStyleControls: false,
        hasColorControl: false,
        searchQuery: '',
        showAll: false,
        species: [
          { common: 'Andean Condor', latin: 'Vultur gryphus' },
          { common: 'Yellow-eared Parrot', latin: 'Ognorhynchus icterotis' },
          { common: 'Blue-billed Curassow', latin: 'Crax alberti' },
          { common: 'Multicolored Tanager', latin: 'Chlorochrysa nitidissima' },
          { common: 'Turquoise Dacnis', latin: 'Dacnis hartlaubi' },
          { common: 'Rusty-faced Parrot', latin: 'Hapalopsittaca amazonina' },
          { common: 'Tolima Dove', latin: 'Leptotila conoveri' },
        ],
      },
      {
        id: 'taxon-amphibians',
        name: 'Amphibians',
        countLabel: '803 species',
        speciesCount: 803,
        visible: false,
        expanded: false,
        opacity: 60,
        color: '#64748b',
        canReorder: false,
        hasStyleControls: false,
        hasColorControl: false,
        searchQuery: '',
        showAll: false,
        species: [
          { common: 'Golden Poison Frog', latin: 'Phyllobates terribilis' },
          { common: 'Harlequin Poison Frog', latin: 'Oophaga histrionica' },
          { common: "Lehmann's Poison Frog", latin: 'Oophaga lehmanni' },
          { common: 'Elegant Stubfoot Toad', latin: 'Atelopus elegans' },
          { common: "Buckley's Glass Frog", latin: 'Centrolene buckleyi' },
          { common: 'Cauca Poison Frog', latin: 'Andinobates bombetes' },
          { common: "Lynch's Robber Frog", latin: 'Pristimantis lynchi' },
        ],
      },
      {
        id: 'taxon-reptiles',
        name: 'Reptiles',
        countLabel: '590 species',
        speciesCount: 590,
        visible: false,
        expanded: false,
        opacity: 60,
        color: '#64748b',
        canReorder: false,
        hasStyleControls: false,
        hasColorControl: false,
        searchQuery: '',
        showAll: false,
        species: [
          { common: 'Orinoco Crocodile', latin: 'Crocodylus intermedius' },
          { common: 'Hawksbill Sea Turtle', latin: 'Eretmochelys imbricata' },
          { common: 'Green Iguana', latin: 'Iguana iguana' },
          { common: 'Bushmaster', latin: 'Lachesis muta' },
          { common: 'Leatherback Sea Turtle', latin: 'Dermochelys coriacea' },
          { common: 'Spectacled Caiman', latin: 'Caiman crocodilus' },
        ],
      },
      {
        id: 'taxon-plants',
        name: 'Plants',
        countLabel: '4,963 species',
        speciesCount: 4963,
        visible: false,
        expanded: false,
        opacity: 60,
        color: '#64748b',
        canReorder: false,
        hasStyleControls: false,
        hasColorControl: false,
        searchQuery: '',
        showAll: false,
        species: [
          { common: 'Quindio Wax Palm', latin: 'Ceroxylon quindiuense' },
          { common: 'Frailejon', latin: 'Espeletia grandiflora' },
          { common: 'May Flower Orchid', latin: 'Cattleya trianae' },
          { common: 'Guayacan', latin: 'Tabebuia chrysantha' },
          { common: 'Abarco', latin: 'Cariniana pyriformis' },
          { common: 'Heaven Lotus', latin: 'Gustavia superba' },
          { common: 'Lobster Claw', latin: 'Heliconia rostrata' },
        ],
      },
    ];
  }

  private createDefaultGroups(): LayerGroup[] {
    return [
      {
        id: 'group-species-biodiversity',
        title: 'Species & Biodiversity',
        countLabel: '5 taxon groups',
        collapsed: false,
        note: "Distributions shown are those included in this scenario's calculation. Drill down to individual species when the solution includes species-level rasters.",
        rows: [],
      },
      {
        id: 'group-ecosystems',
        title: 'Ecosystems',
        countLabel: '5 layers',
        collapsed: false,
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
      visible: false,
      expanded: false,
      opacity,
      color,
      canReorder: true,
      hasStyleControls: true,
      hasColorControl: true,
    };
  }
}
