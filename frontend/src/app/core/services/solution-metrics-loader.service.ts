import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { SolutionMetricsResponse } from '@core/models';
import { Observable, catchError, of } from 'rxjs';

import { SolutionCatalogService } from './solution-catalog.service';

/**
 * Fetches the Tier 1 metric sidecar JSON for a real prioritizr solution from
 * Vercel Blob using a deterministic path derived from the solution's
 * `displayUrl` (replacing the raster suffix with `.tier1-metrics.json`).
 *
 * Returns `null` (not an error) when the sidecar isn't published yet so the
 * analysis panel can fall back to its placeholder/dummy state instead of
 * showing an error.
 */
@Injectable({ providedIn: 'root' })
export class SolutionMetricsLoaderService {
  private readonly http = inject(HttpClient);
  private readonly catalog = inject(SolutionCatalogService);

  static readonly TIER1_SIDECAR_SUFFIX = '.tier1-metrics.json';

  /**
   * Returns the deterministic Blob URL for a solution's Tier 1 sidecar, or
   * `null` if we can't derive one from the catalog (e.g. unknown solution id
   * or a `displayUrl` that doesn't end in `.tif`).
   */
  buildSidecarUrl(solutionId: string): string | null {
    const scenario = this.catalog.getById(solutionId);
    if (!scenario?.displayUrl) {
      return null;
    }
    const lower = scenario.displayUrl.toLowerCase();
    if (!lower.endsWith('.tif') && !lower.endsWith('.tiff')) {
      return null;
    }
    return scenario.displayUrl.replace(
      /\.tiff?$/i,
      SolutionMetricsLoaderService.TIER1_SIDECAR_SUFFIX,
    );
  }

  loadMetrics(solutionId: string): Observable<SolutionMetricsResponse | null> {
    const sidecarUrl = this.buildSidecarUrl(solutionId);
    if (!sidecarUrl) {
      return of(null);
    }
    return this.http.get<SolutionMetricsResponse>(sidecarUrl).pipe(catchError(() => of(null)));
  }
}
