import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CachedSolutionMetricsDocument } from '@core/models';
import { Observable, catchError, of } from 'rxjs';

import { buildCachedMetricsUrl, deriveBlobHostFromUrl } from './cached-metrics.utils';
import { SolutionCatalogService } from './solution-catalog.service';

/**
 * Loads the cached solution metrics document from Vercel Blob at
 * `metrics/cache/{solutionId}.metrics.json`.
 *
 * The document holds metrics for every supported geography level (national,
 * departments, municipalities, SIRAPs). Returns `null` when the blob is not
 * published yet so callers can fall back to mock data.
 */
@Injectable({ providedIn: 'root' })
export class SolutionMetricsLoaderService {
  private readonly http = inject(HttpClient);
  private readonly catalog = inject(SolutionCatalogService);

  buildCacheUrl(solutionId: string): string | null {
    const scenario = this.catalog.getById(solutionId);
    if (!scenario?.displayUrl) {
      return null;
    }
    const blobHost = deriveBlobHostFromUrl(scenario.displayUrl);
    if (!blobHost) {
      return null;
    }
    return buildCachedMetricsUrl(blobHost, solutionId);
  }

  loadCachedMetrics(solutionId: string): Observable<CachedSolutionMetricsDocument | null> {
    const cacheUrl = this.buildCacheUrl(solutionId);
    if (!cacheUrl) {
      return of(null);
    }
    return this.http.get<CachedSolutionMetricsDocument>(cacheUrl).pipe(catchError(() => of(null)));
  }
}
