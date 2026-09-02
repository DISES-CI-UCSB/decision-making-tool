import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { SolutionGoalsDocument } from '@core/models';
import { Observable, catchError, of } from 'rxjs';

import {
  buildGoalsUrl as buildGoalsBlobUrl,
  deriveBlobHostFromUrl,
  getPrecomputedMetricUrl,
  PRECOMPUTED_METRIC_URL_KEYS,
} from './cached-metrics.utils';
import { SolutionCatalogService } from './solution-catalog.service';
import { normalizeSolutionToken } from '@core/models/solution-matching.utils';

@Injectable({ providedIn: 'root' })
export class SolutionGoalsLoaderService {
  private readonly http = inject(HttpClient);
  private readonly catalog = inject(SolutionCatalogService);

  buildGoalsUrl(solutionId: string): string | null {
    const solution = this.catalog.getById(solutionId);
    if (!solution?.displayUrl) {
      return null;
    }

    const precomputedUrl = getPrecomputedMetricUrl(
      solution.precomputedMetricUrls,
      PRECOMPUTED_METRIC_URL_KEYS.goals,
    );
    if (precomputedUrl) {
      return precomputedUrl;
    }
    // SIRAP releases must explicitly publish their regional goal summary.
    // Never infer the legacy national goals path for a SIRAP solution.
    if (
      normalizeSolutionToken(solution.scope) === 'sirap' ||
      normalizeSolutionToken(solution.finderInputs?.scope ?? '') === 'sirap'
    ) {
      return null;
    }

    const blobHost = deriveBlobHostFromUrl(solution.displayUrl);
    return blobHost ? buildGoalsBlobUrl(blobHost, solutionId) : null;
  }

  loadGoals(solutionId: string): Observable<SolutionGoalsDocument | null> {
    const goalsUrl = this.buildGoalsUrl(solutionId);
    if (!goalsUrl) {
      return of(null);
    }
    return this.http.get<SolutionGoalsDocument>(goalsUrl).pipe(catchError(() => of(null)));
  }
}
