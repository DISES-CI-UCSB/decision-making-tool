import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  type AnalysisMetricFixturesResponse,
  type AoiMetricsResponse,
  type CompareSolutionsResponse,
  type LayerConfig,
  type Solution,
  type SolutionMetricsResponse,
} from '@core/models';
import { Observable, switchMap, of } from 'rxjs';
import { type LayerStats, type MatchingResult, type MatchingTarget } from './mock-data.service';
import { SolutionMetricsLoaderService } from './solution-metrics-loader.service';

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly metricsLoader = inject(SolutionMetricsLoaderService);
  private readonly baseUrl = '/api';

  getSolution(id: string): Observable<Solution> {
    return this.http.get<Solution>(`${this.baseUrl}/solutions/${id}`);
  }

  getSolutionMetrics(id: string): Observable<SolutionMetricsResponse> {
    // Real prioritizr solutions ship a Tier 1 sidecar at a deterministic
    // Vercel Blob URL derived from the solution's raster path. If the sidecar
    // exists, prefer it; otherwise fall back to the legacy mock route used by
    // the placeholder sol-001/002/003 scenarios so existing tests/dev flows
    // keep working.
    return this.metricsLoader.loadMetrics(id).pipe(
      switchMap((sidecar) => {
        if (sidecar) {
          return of(sidecar);
        }
        return this.http.get<SolutionMetricsResponse>(`${this.baseUrl}/solutions/${id}/metrics`);
      }),
    );
  }

  getAOIMetrics(solutionId: string, aoiId: string): Observable<AoiMetricsResponse> {
    return this.http.get<AoiMetricsResponse>(
      `${this.baseUrl}/solutions/${solutionId}/aoi/${aoiId}/metrics`,
    );
  }

  compareSolutions(id1: string, id2: string): Observable<CompareSolutionsResponse> {
    const params = new HttpParams().set('id1', id1).set('id2', id2);
    return this.http.get<CompareSolutionsResponse>(`${this.baseUrl}/solutions/compare`, {
      params,
    });
  }

  getLayers(): Observable<LayerConfig[]> {
    return this.http.get<LayerConfig[]>(`${this.baseUrl}/layers`);
  }

  getLayerStats(id: string): Observable<LayerStats> {
    return this.http.get<LayerStats>(`${this.baseUrl}/layers/${id}/stats`);
  }

  findMatchingSolutions(targets: MatchingTarget[]): Observable<MatchingResult[]> {
    return this.http.post<MatchingResult[]>(`${this.baseUrl}/solutions/match`, targets);
  }

  getAnalysisMetricFixtures(solutionId: string): Observable<AnalysisMetricFixturesResponse> {
    return this.http.get<AnalysisMetricFixturesResponse>(
      `${this.baseUrl}/solutions/${solutionId}/metrics/fixtures/anl`,
    );
  }
}
