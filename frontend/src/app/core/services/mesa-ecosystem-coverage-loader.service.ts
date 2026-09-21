import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  isMesaEcosystemCoverageCompactDocument,
  type GeographyLevel,
  type MesaEcosystemCoverageCompactDocument,
} from '@core/models';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';

import { SolutionCatalogService } from './solution-catalog.service';

export type MesaEcosystemCoverageLoadResult =
  | { status: 'loaded'; document: MesaEcosystemCoverageCompactDocument }
  | { status: 'unavailable'; document: null }
  | { status: 'error'; document: null };

@Injectable({ providedIn: 'root' })
export class MesaEcosystemCoverageLoaderService {
  private readonly http = inject(HttpClient);
  private readonly catalog = inject(SolutionCatalogService);
  private readonly cache = new Map<string, Observable<MesaEcosystemCoverageLoadResult>>();

  load(
    solutionId: string,
    geographyLevel: GeographyLevel,
  ): Observable<MesaEcosystemCoverageLoadResult> {
    const url = this.catalog
      .getById(solutionId)
      ?.precomputedMetricUrls?.mesaEcosystemByGeography?.[geographyLevel]?.trim();
    if (!url) {
      return of({ status: 'unavailable', document: null });
    }
    const cached = this.cache.get(url);
    if (cached) {
      return cached;
    }
    const request = this.http.get<unknown>(url).pipe(
      map((document): MesaEcosystemCoverageLoadResult => {
        if (
          !isMesaEcosystemCoverageCompactDocument(document) ||
          document.solutionId !== solutionId ||
          document.geographyLevel !== geographyLevel
        ) {
          return { status: 'error', document: null };
        }
        return { status: 'loaded', document };
      }),
      catchError(() => of<MesaEcosystemCoverageLoadResult>({ status: 'error', document: null })),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.cache.set(url, request);
    return request;
  }
}
