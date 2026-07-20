import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  type CachedSolutionMetricsDocument,
  type CustomPolygonMetricsRequest,
  type CustomPolygonMetricsResponse,
} from '@core/models';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SolutionMetricsLoaderService } from './solution-metrics-loader.service';

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly metricsLoader = inject(SolutionMetricsLoaderService);
  private readonly metricsApiBaseUrl = environment.metricsApiBaseUrl.replace(/\/$/, '');

  getSolutionMetrics(id: string): Observable<CachedSolutionMetricsDocument | null> {
    return this.metricsLoader.loadCachedMetrics(id);
  }

  getCustomPolygonMetrics(
    request: CustomPolygonMetricsRequest,
  ): Observable<CustomPolygonMetricsResponse> {
    return this.http.post<CustomPolygonMetricsResponse>(
      `${this.metricsApiBaseUrl}/metrics/custom-polygon`,
      request,
    );
  }
}
