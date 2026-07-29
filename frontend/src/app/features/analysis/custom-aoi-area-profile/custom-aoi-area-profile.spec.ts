import { TestBed } from '@angular/core/testing';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import type {
  CustomAoiAreaProfileRequest,
  CustomAoiAreaProfileResponse,
  CustomAoiProfileSection,
  CustomPolygonMetricsGeometry,
} from '@core/models';
import { ApiService } from '@core/services/api.service';
import { finalize, Subject } from 'rxjs';
import { CustomAoiAreaProfileComponent } from './custom-aoi-area-profile';

describe('CustomAoiAreaProfileComponent', () => {
  let responses: Record<CustomAoiProfileSection, Subject<CustomAoiAreaProfileResponse>>;
  let api: { getCustomAoiAreaProfile: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    responses = { species: new Subject(), ecosystems: new Subject() };
    api = {
      getCustomAoiAreaProfile: vi.fn((request: CustomAoiAreaProfileRequest) =>
        responses[request.sections[0]].asObservable(),
      ),
    };
    await TestBed.configureTestingModule({
      imports: [CustomAoiAreaProfileComponent],
      providers: [
        { provide: ApiService, useValue: api },
        provideTranslateService({
          lang: 'en',
          fallbackLang: 'en',
          loader: provideTranslateLoader(TranslateNoOpLoader),
        }),
      ],
    }).compileComponents();
  });

  it('loads sections independently and filters the species inventory', async () => {
    const fixture = TestBed.createComponent(CustomAoiAreaProfileComponent);
    fixture.componentRef.setInput('geometry', geometry(0));
    fixture.componentRef.setInput('areaKm2', 12);
    fixture.detectChanges();

    expect(api.getCustomAoiAreaProfile).toHaveBeenCalledWith({
      geometry: geometry(0),
      sections: ['species'],
    });
    expect(api.getCustomAoiAreaProfile).toHaveBeenCalledWith({
      geometry: geometry(0),
      sections: ['ecosystems'],
    });

    responses.species.next(speciesResponse());
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#custom-aoi-profile-species-open-button')).not.toBeNull();
    expect(compiled.querySelector('#custom-aoi-profile-ecosystems-loading')).not.toBeNull();

    (
      compiled.querySelector('#custom-aoi-profile-species-open-button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const search = compiled.querySelector('#custom-aoi-profile-species-search') as HTMLInputElement;
    search.value = 'tremarctos';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(compiled.querySelectorAll('[id^="custom-aoi-profile-species-row-"]')).toHaveLength(1);
    expect(compiled.textContent).toContain('Tremarctos ornatus');
    expect(compiled.textContent).not.toContain('solution coverage');

    responses.ecosystems.next(ecosystemsResponse());
    fixture.detectChanges();
    const ecosystemSearch = compiled.querySelector(
      '#custom-aoi-profile-ecosystem-search',
    ) as HTMLInputElement;
    ecosystemSearch.value = 'forest';
    ecosystemSearch.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(compiled.querySelectorAll('[id^="custom-aoi-profile-ecosystem-row-"]')).toHaveLength(1);
    expect(compiled.textContent).toContain('Andean forest');
  });

  it('cancels stale section requests when the polygon changes', () => {
    const requests: Record<CustomAoiProfileSection, Subject<CustomAoiAreaProfileResponse>[]> = {
      species: [],
      ecosystems: [],
    };
    const teardowns: Record<CustomAoiProfileSection, number> = {
      species: 0,
      ecosystems: 0,
    };
    api.getCustomAoiAreaProfile.mockImplementation((request: CustomAoiAreaProfileRequest) => {
      const section = request.sections[0];
      const response = new Subject<CustomAoiAreaProfileResponse>();
      requests[section].push(response);
      return response.pipe(finalize(() => (teardowns[section] += 1)));
    });
    const fixture = TestBed.createComponent(CustomAoiAreaProfileComponent);
    fixture.componentRef.setInput('geometry', geometry(0));
    fixture.detectChanges();

    fixture.componentRef.setInput('geometry', geometry(1));
    fixture.detectChanges();

    expect(teardowns).toEqual({ species: 1, ecosystems: 1 });
    expect(api.getCustomAoiAreaProfile).toHaveBeenCalledTimes(4);
    requests.species[0].next(speciesResponse());
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '#custom-aoi-profile-species-open-button',
      ),
    ).toBeNull();

    requests.species[1].next(speciesResponse());
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '#custom-aoi-profile-species-open-button',
      ),
    ).not.toBeNull();
  });

  it('renders section-local zero-cell guidance without solution terminology', () => {
    const fixture = TestBed.createComponent(CustomAoiAreaProfileComponent);
    fixture.componentRef.setInput('geometry', geometry(0));
    fixture.detectChanges();

    responses.species.next(sectionResponse('species', 'zero_cells'));
    responses.ecosystems.next(sectionResponse('ecosystems', 'zero_cells'));
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('analysis.aoi.customProfile.states.zero_cells');
    expect(text.toLowerCase()).not.toContain('candidate area');
    expect(text.toLowerCase()).not.toContain('target attainment');
  });

  it('renders resolved empty inventories as zero summary values', () => {
    const fixture = TestBed.createComponent(CustomAoiAreaProfileComponent);
    fixture.componentRef.setInput('geometry', geometry(0));
    fixture.detectChanges();

    responses.species.next(sectionResponse('species', 'empty'));
    responses.ecosystems.next(sectionResponse('ecosystems', 'empty'));
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(
      compiled.querySelector('#custom-aoi-profile-summary-richness-value')?.textContent,
    ).toContain('0');
    expect(
      compiled.querySelector('#custom-aoi-profile-summary-threatened-value')?.textContent,
    ).toContain('0');
    expect(
      compiled.querySelector('#custom-aoi-profile-summary-ecosystems-value')?.textContent,
    ).toContain('0');
  });
});

function geometry(offset: number): CustomPolygonMetricsGeometry {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [offset, 0],
        [offset + 1, 0],
        [offset, 1],
        [offset, 0],
      ],
    ],
  };
}

function speciesResponse(): CustomAoiAreaProfileResponse {
  return {
    ...baseResponse(),
    sections: {
      species: {
        status: 'complete',
        records: [
          { id: '1', scientific_name: 'Tremarctos ornatus', group: 'Mammals', iucn_status: 'VU' },
          { id: '2', scientific_name: 'Rallus semiplumbeus', group: 'Birds', iucn_status: 'EN' },
        ],
      },
    },
  };
}

function ecosystemsResponse(): CustomAoiAreaProfileResponse {
  return {
    ...baseResponse(),
    sections: {
      ecosystems: {
        status: 'complete',
        views: [
          {
            id: 'broadEcosystem',
            label: 'Broad ecosystem',
            records: [
              {
                id: 'forest',
                label: 'Andean forest',
                area_km2: 8,
                share_of_classified_pct: 80,
              },
              {
                id: 'savanna',
                label: 'Savanna',
                area_km2: 2,
                share_of_classified_pct: 20,
              },
            ],
          },
        ],
      },
    },
  };
}

function sectionResponse(
  section: CustomAoiProfileSection,
  status: 'zero_cells' | 'empty',
): CustomAoiAreaProfileResponse {
  return {
    ...baseResponse(),
    sections:
      section === 'species'
        ? { species: { status, records: [] } }
        : {
            ecosystems: {
              status,
              views: [],
            },
          },
  };
}

function baseResponse(): CustomAoiAreaProfileResponse {
  return {
    format: 'custom-aoi-area-profile-v1',
    status: 'complete',
    selection: {
      status: 'selected',
      selected_cell_count: 2,
      available_cell_count: 4,
      area_km2: 12,
      source: 'test',
    },
    sections: {},
  };
}
