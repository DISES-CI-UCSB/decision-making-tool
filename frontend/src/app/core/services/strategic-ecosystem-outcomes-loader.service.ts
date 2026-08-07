import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { StrategicEcosystemOutcomesDocument } from '@core/models';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';

import { SolutionCatalogService } from './solution-catalog.service';
import { isStrategicEcosystemOutcomesDocument } from './strategic-ecosystem-outcomes.utils';

@Injectable({ providedIn: 'root' })
export class StrategicEcosystemOutcomesLoaderService {
  private readonly http = inject(HttpClient);
  private readonly catalog = inject(SolutionCatalogService);
  private readonly documentsByUrl = new Map<
    string,
    Observable<StrategicEcosystemOutcomesDocument | null>
  >();

  loadForSolution(solutionId: string): Observable<StrategicEcosystemOutcomesDocument | null> {
    const url = this.catalog.getById(solutionId)?.precomputedMetricUrls?.strategicOutcomes;
    if (!url) return of(null);

    const cached = this.documentsByUrl.get(url);
    if (cached) return cached;

    const request = this.http.get<unknown>(url).pipe(
      map((document) => (isStrategicEcosystemOutcomesDocument(document) ? document : null)),
      catchError(() => of(null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.documentsByUrl.set(url, request);
    return request;
  }
}
