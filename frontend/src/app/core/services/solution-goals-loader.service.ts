import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { SolutionGoalsDocument } from '@core/models';
import { Observable, catchError, of } from 'rxjs';

import { deriveBlobHostFromUrl } from './cached-metrics.utils';
import { SolutionCatalogService } from './solution-catalog.service';

@Injectable({ providedIn: 'root' })
export class SolutionGoalsLoaderService {
  private readonly http = inject(HttpClient);
  private readonly catalog = inject(SolutionCatalogService);

  buildGoalsUrl(solutionId: string): string | null {
    const solution = this.catalog.getById(solutionId);
    if (!solution?.displayUrl) {
      return null;
    }

    const precomputedUrl = solution.precomputedMetricUrls?.['goals'];
    if (precomputedUrl) {
      return precomputedUrl;
    }

    const blobHost = deriveBlobHostFromUrl(solution.displayUrl);
    return blobHost ? `${blobHost}/metrics/goals/${solutionId}.goals.json` : null;
  }

  loadGoals(solutionId: string): Observable<SolutionGoalsDocument | null> {
    const goalsUrl = this.buildGoalsUrl(solutionId);
    if (!goalsUrl) {
      return of(null);
    }
    return this.http.get<SolutionGoalsDocument>(goalsUrl).pipe(catchError(() => of(null)));
  }
}
