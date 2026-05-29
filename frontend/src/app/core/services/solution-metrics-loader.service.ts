import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CachedSolutionMetricsDocument, CompactSolutionMetricsDocument } from '@core/models';
import { Observable, catchError, map, of } from 'rxjs';

import {
  buildCachedMetricsUrl,
  deriveBlobHostFromUrl,
  normalizeMetricsDocument,
} from './cached-metrics.utils';
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
    const precomputedUrl =
      scenario.precomputedMetricUrls?.['compactCache'] ??
      scenario.precomputedMetricUrls?.['compact'] ??
      scenario.precomputedMetricUrls?.['cache'];
    if (precomputedUrl) {
      return precomputedUrl;
    }
    const nickRunCompactUrl = this.buildNickRunCompactCacheUrl(scenario.displayUrl, solutionId);
    if (nickRunCompactUrl) {
      return nickRunCompactUrl;
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
    return this.http
      .get<CachedSolutionMetricsDocument | CompactSolutionMetricsDocument>(cacheUrl)
      .pipe(
        map((document) => normalizeMetricsDocument(document)),
        catchError(() => of(null)),
      );
  }

  private buildNickRunCompactCacheUrl(displayUrl: string, solutionId: string): string | null {
    try {
      const url = new URL(displayUrl);
      const match = url.pathname.match(/^\/solutions\/nick-runs\/([^/]+)\//);
      if (!match?.[1]) {
        return null;
      }
      return `${url.origin}/metrics/nick-runs/${match[1]}/compact-cache/${solutionId}.metrics.compact.json`;
    } catch {
      return null;
    }
  }
}
