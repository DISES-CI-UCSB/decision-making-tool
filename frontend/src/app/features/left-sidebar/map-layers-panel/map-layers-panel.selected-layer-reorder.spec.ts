import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { of } from 'rxjs';

import type { RuntimeLayerManifest, Solution } from '@core/models';
import { AppStateService } from '@core/services/app-state.service';
import { LayerManifestService } from '@core/services/layer-manifest.service';
import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import { AdminBoundaryService } from '@features/map/services/admin-boundary.service';
import { ManifestRasterLayerService } from '@features/map/services/manifest-raster-layer.service';
import { SolutionLayerService } from '@features/map/services/solution-layer.service';
import { BASELINE_SOLUTION_OVERLAY_ID, COLOMBIA_OUTLINE_ROW_ID } from './map-layers-panel.config';
import { MapLayersPanelComponent } from './map-layers-panel';

describe('MapLayersPanel selected layer reorder', () => {
  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [MapLayersPanelComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({
          lang: 'en',
          fallbackLang: 'en',
          loader: provideTranslateLoader(TranslateNoOpLoader),
        }),
        {
          provide: LayerManifestService,
          useValue: {
            stylePreviewManifest$: signal<RuntimeLayerManifest | null>(null),
            getManifest: () => of(null),
            getSpeciesManifest: () => of({ layers: [] }),
            preloadSpeciesManifest: vi.fn(),
          },
        },
        { provide: SolutionCatalogService, useValue: { getById: () => null } },
        {
          provide: AdminBoundaryService,
          useValue: {
            getLayerIdsByBoundaryKey: vi.fn(() => []),
            setLayerStyle: vi.fn(),
            setLayerVisibility: vi.fn(),
          },
        },
        {
          provide: ManifestRasterLayerService,
          useValue: {
            renderedLayerRevision$: signal(0),
            syncLayer: vi.fn(),
          },
        },
        {
          provide: SolutionLayerService,
          useValue: {
            existingProtectedColor$: signal('#15803d'),
            reorderLayersByIds: vi.fn(),
            resolveLayerForSidebarType: vi.fn(() => null),
            setBaselineColor: vi.fn(),
            setBaselineOpacity: vi.fn(),
            setBaselineVisibility: vi.fn(),
            setCandidateColor: vi.fn(),
            setCandidateOpacity: vi.fn(),
            setCandidateVisibility: vi.fn(),
            setExistingProtectedColor: vi.fn(),
            setOverlapColor: vi.fn(),
            setOverlapOpacity: vi.fn(),
            setOverlapVisibility: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    TestBed.inject(AppStateService).activeSolution$.set({
      id: 'active-scenario',
      name: 'Active scenario',
      matchPercentage: 100,
      geometryUrl: '',
      metrics: [],
    } as Solution);
  });

  it('moves the active scenario below another selected layer when that row is dragged', () => {
    const fixture = TestBed.createComponent(MapLayersPanelComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const before = selectedLayerIds(root);
    expect(before[0]).toBe(BASELINE_SOLUTION_OVERLAY_ID);
    expect(before).toContain(COLOMBIA_OUTLINE_ROW_ID);

    dragSelectedLayerBelow(
      root,
      fixture.componentInstance as unknown as SelectedLayerDragSurface,
      BASELINE_SOLUTION_OVERLAY_ID,
      COLOMBIA_OUTLINE_ROW_ID,
    );
    fixture.detectChanges();

    const after = selectedLayerIds(root);
    expect(after.indexOf(BASELINE_SOLUTION_OVERLAY_ID)).toBeGreaterThan(
      after.indexOf(COLOMBIA_OUTLINE_ROW_ID),
    );
  });
});

function selectedLayerIds(root: HTMLElement): string[] {
  return Array.from(
    root.querySelectorAll('[data-ui="selected-layer-row"]'),
    (row) => row.getAttribute('data-layer-id') ?? '',
  );
}

interface SelectedLayerDragSurface {
  selectedLayerDragId(): string | null;
  selectedLayerDropPosition(): 'before' | 'after';
}

function dragSelectedLayerBelow(
  root: HTMLElement,
  panel: SelectedLayerDragSurface,
  draggedId: string,
  targetId: string,
): void {
  const handle = root.querySelector<HTMLElement>(
    `#map-layers-selected-layer-row-drag-handle-${draggedId}`,
  );
  const target = root.querySelector<HTMLElement>(`#map-layers-selected-layer-row-${targetId}`);
  if (!handle || !target) {
    throw new Error(`Missing drag handle or drop target for ${draggedId} -> ${targetId}`);
  }

  const dataTransfer = createDragDataTransfer();
  handle.dispatchEvent(dragEvent('dragstart', dataTransfer));

  // jsdom has no layout, so place the pointer in the lower half of the target row.
  target.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 100,
      top: 100,
      left: 0,
      bottom: 140,
      right: 240,
      width: 240,
      height: 40,
      toJSON: () => ({}),
    }) as DOMRect;
  target.dispatchEvent(dragEvent('dragover', dataTransfer, 130));

  expect(panel.selectedLayerDragId()).toBe(draggedId);
  expect(panel.selectedLayerDropPosition()).toBe('after');

  target.dispatchEvent(dragEvent('drop', dataTransfer));
  handle.dispatchEvent(dragEvent('dragend', dataTransfer));
}

function dragEvent(type: string, dataTransfer: DataTransfer, clientY = 0): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clientY', { value: clientY });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return event as DragEvent;
}

function createDragDataTransfer(): DataTransfer {
  const data = new Map<string, string>();
  return {
    effectAllowed: 'move',
    dropEffect: 'move',
    setData: (type: string, value: string) => {
      data.set(type, value);
    },
    getData: (type: string) => data.get(type) ?? '',
  } as unknown as DataTransfer;
}
