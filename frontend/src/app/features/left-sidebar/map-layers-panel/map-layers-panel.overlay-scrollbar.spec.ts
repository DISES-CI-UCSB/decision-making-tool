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
import type { OverlayScrollbarController } from '@core/shared/overlay-scrollbar/use-overlay-scrollbar';
import { AppStateService } from '@core/services/app-state.service';
import { LayerManifestService } from '@core/services/layer-manifest.service';
import { SolutionCatalogService } from '@core/services/solution-catalog.service';
import { AdminBoundaryService } from '@features/map/services/admin-boundary.service';
import { ManifestRasterLayerService } from '@features/map/services/manifest-raster-layer.service';
import { SolutionLayerService } from '@features/map/services/solution-layer.service';
import { MapLayersPanelComponent } from './map-layers-panel';

describe('MapLayersPanel overlay scrollbar', () => {
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

  it('shows an auto-hiding overlay thumb on the scrolling sidebar body', () => {
    const fixture = TestBed.createComponent(MapLayersPanelComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const frame = root.querySelector('#map-layers-sidebar-body-frame') as HTMLElement;
    const body = root.querySelector('#map-layers-sidebar-body') as HTMLElement;
    const thumb = root.querySelector('#map-layers-sidebar-overlay-scrollbar-thumb') as HTMLElement;
    const panel = fixture.componentInstance as unknown as {
      sidebarOverlayScrollbar: OverlayScrollbarController;
    };

    expect(frame).not.toBeNull();
    expect(body).not.toBeNull();
    expect(thumb).not.toBeNull();
    expect(root.querySelector('#map-layers-sidebar-overlay-scrollbar-track')).not.toBeNull();
    expect(panel.sidebarOverlayScrollbar.scrollRef()).toBe(body);
    expect(thumb.classList.contains('opacity-0')).toBe(true);

    mockOverflow(body, { scrollHeight: 800, clientHeight: 200, scrollTop: 40 });
    frame.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();

    expect(thumb.classList.contains('hidden')).toBe(false);
    expect(thumb.classList.contains('opacity-100')).toBe(true);
    expect(Number.parseFloat(thumb.style.height)).toBeGreaterThan(0);

    frame.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();

    expect(thumb.classList.contains('opacity-0')).toBe(true);
    expect(thumb.classList.contains('opacity-100')).toBe(false);
  });
});

function mockOverflow(
  element: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number; scrollTop: number },
): void {
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: metrics.clientHeight,
  });
  Object.defineProperty(element, 'scrollTop', { configurable: true, value: metrics.scrollTop });
}
