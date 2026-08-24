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

import type { CatalogSolution, RuntimeLayerManifest, Solution } from '@core/models';
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
  const catalogSolutionLookup = vi.fn<() => CatalogSolution | null>(() => null);
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
        { provide: SolutionCatalogService, useValue: { getById: catalogSolutionLookup } },
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
      mapLayersPanel: { addButton: 'Display', addedButton: 'Displayed' },
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
    expect(button.textContent?.trim()).toBe('Displayed');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(responseTime).toBeLessThan(MAX_LABEL_RESPONSE_MS);
    expect(solutionLayerReorder).not.toHaveBeenCalled();
    expect(adminBoundaryVisibilitySync).not.toHaveBeenCalled();

    await waitForPostPaintTask();
    expect(solutionLayerReorder).toHaveBeenCalled();
    expect(adminBoundaryVisibilitySync).toHaveBeenCalledWith('admin_departments', true);
  });

  it.each([
    [
      'en',
      'Following the Mesa Nacional model, this report includes the 417 ecosystem classes represented on Colombia’s 1 km IHEH planning grid. Twelve classes from the 429-class catalog are omitted because they do not contain a valid planning-grid cell.',
      'Three island classes fall outside the terrestrial grid, eight small classes contain no cell center, and one falls outside the valid IHEH footprint.',
    ],
    [
      'es',
      'Siguiendo el modelo de la Mesa Nacional, este informe incluye las 417 clases de ecosistemas representadas en la cuadrícula de planificación IHEH de 1 km de Colombia. Se omiten doce clases del catálogo de 429 porque no contienen una celda válida de la cuadrícula de planificación.',
      'Tres clases insulares quedan fuera de la cuadrícula terrestre, ocho clases pequeñas no contienen ningún centro de celda y una queda fuera de la huella válida del IHEH.',
    ],
  ])('renders the approved ecosystem parity copy in %s', (language, copy, detail) => {
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(language, {
      mapLayersPanel: {
        ecosystemInfoModal: {
          coverageParityCopy: copy,
          coverageParityDetail: detail,
        },
      },
    });
    translate.use(language);
    const fixture = TestBed.createComponent(MapLayersPanelComponent);

    (
      fixture.componentInstance as unknown as {
        openEcosystemInfoModal: () => void;
      }
    ).openEcosystemInfoModal();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('#map-layers-ecosystem-info-modal-coverage-parity-copy')
        ?.textContent,
    ).toContain(copy);
    expect(
      fixture.nativeElement.querySelector('#map-layers-ecosystem-info-modal-coverage-parity-detail')
        ?.textContent,
    ).toContain(detail);
  });

  it('filters the available catalog for a marine solution without clearing hidden selections', () => {
    TestBed.inject(TranslateService).setTranslation('en', {
      mapLayersPanel: {
        addButton: 'Display',
        addedButton: 'Displayed',
        layerScopeLabel: 'Available layer types',
        layerScopeLand: 'Terrestrial',
        layerScopeMarine: 'Marine',
        layerScopeBoth: 'Both',
        layerScopeHelp: 'Filters Available Layers only.',
      },
    });
    const appState = TestBed.inject(AppStateService);
    catalogSolutionLookup.mockReturnValue(catalogSolution('land'));
    appState.activeSolution$.set({
      id: 'land-solution',
      name: 'Land solution',
    } as Solution);
    const fixture = TestBed.createComponent(MapLayersPanelComponent);
    fixture.detectChanges();

    const landLayerButton = fixture.nativeElement.querySelector(
      '#map-layers-layer-row-selected-button-group-socio-economic-layer-soc-human-footprint',
    ) as HTMLButtonElement;
    landLayerButton.click();
    fixture.detectChanges();

    catalogSolutionLookup.mockReturnValue(catalogSolution('marine'));
    appState.activeSolution$.set({
      id: 'marine-solution',
      name: 'Marine solution',
    } as Solution);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#map-layers-admin-boundaries-card')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('#map-layers-group-card-group-species-biodiversity'),
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('#map-layers-layer-row-group-socio-economic-layer-hhm'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector(
        '#map-layers-selected-layer-row-layer-soc-human-footprint',
      ),
    ).not.toBeNull();

    const marineOption = fixture.nativeElement.querySelector(
      '#map-layers-domain-filter-option-marine',
    ) as HTMLButtonElement;
    expect(marineOption.getAttribute('aria-checked')).toBe('true');

    const landOption = fixture.nativeElement.querySelector(
      '#map-layers-domain-filter-option-land',
    ) as HTMLButtonElement;
    landOption.click();
    fixture.detectChanges();

    expect(landOption.getAttribute('aria-checked')).toBe('true');
    expect(
      fixture.nativeElement.querySelector('#map-layers-group-card-group-species-biodiversity'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('#map-layers-layer-row-group-socio-economic-layer-hhm'),
    ).toBeNull();

    const bothOption = fixture.nativeElement.querySelector(
      '#map-layers-domain-filter-option-both',
    ) as HTMLButtonElement;
    bothOption.click();
    fixture.detectChanges();

    expect(bothOption.getAttribute('aria-checked')).toBe('true');
    expect(
      fixture.nativeElement.querySelector(
        '#map-layers-layer-row-group-socio-economic-layer-soc-human-footprint',
      ),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('#map-layers-layer-row-group-socio-economic-layer-hhm'),
    ).not.toBeNull();
  });
});

function observeAddedLabel(button: HTMLButtonElement): Promise<number> {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (button.textContent?.trim() !== 'Displayed') {
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

function catalogSolution(domain: 'land' | 'marine'): CatalogSolution {
  const isMarine = domain === 'marine';
  return {
    id: `${domain}-solution`,
    filename: `${domain}.tif`,
    name: `${domain} solution`,
    description: `${domain} test solution`,
    domain,
    scope: domain,
    sirapId: null,
    displayUrl: `/${domain}.tif`,
    metadataUrl: `/${domain}.json`,
    rendering: { valueType: 'binary', renderMode: 'mask' },
    inputLayerIds: {
      features: isMarine ? ['FEAT_MARINE_ECOSYSTEMS', 'FEAT_MANGROVES'] : ['FEAT_ECOSYSTEMS'],
      cost: isMarine ? 'COST_HHM' : 'COST_HF_2030',
      includes: ['INCL_RUNAP'],
      excludes: [],
    },
    finderInputs: {
      domain,
      scope: domain,
      targetFeatureIds: isMarine
        ? ['FEAT_MARINE_ECOSYSTEMS', 'FEAT_MANGROVES']
        : ['FEAT_ECOSYSTEMS'],
      includeLayerIds: ['INCL_RUNAP'],
      excludeLayerIds: [],
      targetFeatureSet: isMarine ? 'marine_ecosystems_and_mangroves' : 'ecosystems',
      targetPercent: 30,
      costLayerId: isMarine ? 'COST_HHM' : 'COST_HF_2030',
    },
    ecosystemTargets: 30,
    constraints: ['RUNAP'],
    costLayer: isMarine ? 'HHM' : 'Human footprint',
    nSelected: 1,
    totalCost: 1,
    pctTargetsMet: 100,
  };
}
