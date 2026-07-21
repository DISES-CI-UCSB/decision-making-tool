import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
  TranslateService,
} from '@ngx-translate/core';
import { of } from 'rxjs';

import type { RuntimeLayerManifest, Solution } from '@core/models';
import { AppStateService } from '@core/services/app-state.service';
import { LayerManifestService } from '@core/services/layer-manifest.service';
import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import { AdminBoundaryService } from '@features/map/services/admin-boundary.service';
import { ManifestRasterLayerService } from '@features/map/services/manifest-raster-layer.service';
import { SolutionLayerService } from '@features/map/services/solution-layer.service';
import { MapLayersPanelComponent } from './map-layers-panel';

const MAX_LABEL_RESPONSE_MS = 250;
const BLOCKING_REORDER_MS = 500;
const describeInBrowser = navigator.userAgent.includes('jsdom') ? describe.skip : describe;

describeInBrowser('MapLayersPanel Add responsiveness in Chromium', () => {
  const adminBoundaryStyleSync = vi.fn();
  const adminBoundaryVisibilitySync = vi.fn();
  const solutionLayerReorder = vi.fn(() => blockMainThread(BLOCKING_REORDER_MS));

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [MapLayersPanelComponent],
      providers: [
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
            preloadSpeciesManifest: vi.fn(),
          },
        },
        { provide: SolutionCatalogService, useValue: { getById: vi.fn(() => null) } },
        {
          provide: AdminBoundaryService,
          useValue: {
            getLayerIdsByBoundaryKey: vi.fn(() => ['loaded-admin-boundary']),
            setLayerStyle: adminBoundaryStyleSync,
            setLayerVisibility: adminBoundaryVisibilitySync,
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
            reorderLayersByIds: solutionLayerReorder,
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
  });

  it('updates the administrative-boundary label before slow map reordering begins', async () => {
    expect(navigator.userAgent).toContain('Chrome');
    TestBed.inject(TranslateService).setTranslation('en', {
      mapLayersPanel: { addButton: 'Add', addedButton: 'Added' },
    });
    TestBed.inject(AppStateService).activeSolution$.set({
      id: 'test-solution',
      name: 'Test solution',
    } as Solution);

    const fixture = TestBed.createComponent(MapLayersPanelComponent);
    fixture.detectChanges();
    await waitForPostPaintTask();
    vi.clearAllMocks();

    const button = fixture.nativeElement.querySelector(
      '#map-layers-boundary-selected-button-boundary-admin_departments',
    ) as HTMLButtonElement;
    const clickStartedAt = performance.now();
    const labelUpdatedAt = observeAddedLabel(button);

    button.click();
    fixture.detectChanges();

    const responseTime = (await labelUpdatedAt) - clickStartedAt;
    expect(button.textContent?.trim()).toBe('Added');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(responseTime).toBeLessThan(MAX_LABEL_RESPONSE_MS);
    expect(solutionLayerReorder).not.toHaveBeenCalled();
    expect(adminBoundaryVisibilitySync).not.toHaveBeenCalled();

    await waitForPostPaintTask();
    expect(solutionLayerReorder).toHaveBeenCalled();
    expect(adminBoundaryVisibilitySync).toHaveBeenCalledWith('admin_departments', true);
  });
});

function observeAddedLabel(button: HTMLButtonElement): Promise<number> {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (button.textContent?.trim() !== 'Added') {
        return;
      }
      observer.disconnect();
      resolve(performance.now());
    });
    observer.observe(button, {
      attributes: true,
      attributeFilter: ['aria-pressed'],
      characterData: true,
      childList: true,
      subtree: true,
    });
  });
}

function waitForPostPaintTask(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

function blockMainThread(durationMs: number): void {
  const startedAt = performance.now();
  while (performance.now() - startedAt < durationMs) {
    // Reproduce the synchronous cost of ArcGIS layer reordering.
  }
}
