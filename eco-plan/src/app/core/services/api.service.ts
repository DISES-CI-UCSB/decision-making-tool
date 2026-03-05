import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type LayerConfig, type Metric, type Solution } from '@core/models';
import { Observable } from 'rxjs';
import {
  type LayerStats,
  type MatchingResult,
  type MatchingTarget,
  type SolutionComparison
} from './mock-data.service';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api';

  getSolution(id: string): Observable<Solution> {
    return this.http.get<Solution>(`${this.baseUrl}/solutions/${id}`);
  }

  getSolutionMetrics(id: string): Observable<Metric[]> {
    return this.http.get<Metric[]>(`${this.baseUrl}/solutions/${id}/metrics`);
  }

  getAOIMetrics(solutionId: string, aoiId: string): Observable<Metric[]> {
    return this.http.get<Metric[]>(
      `${this.baseUrl}/solutions/${solutionId}/aoi/${aoiId}/metrics`
    );
  }

  compareSolutions(id1: string, id2: string): Observable<SolutionComparison> {
    const params = new HttpParams().set('id1', id1).set('id2', id2);
    return this.http.get<SolutionComparison>(`${this.baseUrl}/solutions/compare`, {
      params
    });
  }

  getLayers(): Observable<LayerConfig[]> {
    return this.http.get<LayerConfig[]>(`${this.baseUrl}/layers`);
  }

  getLayerStats(id: string): Observable<LayerStats> {
    return this.http.get<LayerStats>(`${this.baseUrl}/layers/${id}/stats`);
  }

  findMatchingSolutions(targets: MatchingTarget[]): Observable<MatchingResult[]> {
    return this.http.post<MatchingResult[]>(
      `${this.baseUrl}/solutions/match`,
      targets
    );
  }
}
