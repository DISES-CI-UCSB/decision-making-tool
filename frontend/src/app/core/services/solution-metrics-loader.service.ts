import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CachedSolutionMetricsDocument, CompactSolutionMetricsDocument } from '@core/models';
import { Observable, catchError, map, of } from 'rxjs';

import {
  buildCachedMetricsUrl,
  buildStagingCompactMetricsUrl,
  deriveBlobHostFromUrl,
  getPrecomputedMetricUrl,
  normalizeMetricsDocument,
  PRECOMPUTED_METRIC_URL_KEYS,
} from './cached-metrics.utils';
import { SolutionCatalogService } from './solution-catalog.service';

/**
 * Loads the cached solution metrics document from Vercel Blob at
 * `metrics/cache/{solutionId}.metrics.json`.
 *
 * The document holds metrics for every supported geography level (national,
 * departments, municipalities, SIRAPs). Returns `null` when the blob is not
 * published yet.
 */
@Injectable({ providedIn: 'root' })
export class SolutionMetricsLoaderService {
  private readonly http = inject(HttpClient);
  private readonly catalog = inject(SolutionCatalogService);

  buildCacheUrl(solutionId: string): string | null {
    const solution = this.catalog.getById(solutionId);
    if (!solution?.displayUrl) {
      return null;
    }
    const precomputedUrl = getPrecomputedMetricUrl(
      solution.precomputedMetricUrls,
      PRECOMPUTED_METRIC_URL_KEYS.cache,
    );
    if (precomputedUrl) {
      return precomputedUrl;
    }
    const stagingUrl = buildStagingCompactMetricsUrl(solution.displayUrl, solutionId);
    if (stagingUrl) {
      return stagingUrl;
    }
    const blobHost = deriveBlobHostFromUrl(solution.displayUrl);
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
    return this.http
      .get<CachedSolutionMetricsDocument | CompactSolutionMetricsDocument>(cacheUrl)
      .pipe(
        map((document) => normalizeMetricsDocument(document)),
        catchError(() => of(null)),
      );
  }
}
