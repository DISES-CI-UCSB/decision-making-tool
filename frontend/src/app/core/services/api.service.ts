import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  type CachedSolutionMetricsDocument,
  type CustomAoiAreaProfileRequest,
  type CustomAoiAreaProfileResponse,
  type CustomPolygonMetricsRequest,
  type CustomPolygonMetricsResponse,
  type DetailedSpeciesCoverageRequest,
  type DetailedSpeciesJobResponse,
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

  getCustomAoiAreaProfile(
    request: CustomAoiAreaProfileRequest,
  ): Observable<CustomAoiAreaProfileResponse> {
    return this.http.post<CustomAoiAreaProfileResponse>(
      `${this.metricsApiBaseUrl}/area-profile/custom-polygon`,
      request,
    );
  }

  createDetailedSpeciesCoverageJob(
    request: DetailedSpeciesCoverageRequest,
  ): Observable<DetailedSpeciesJobResponse> {
    return this.http.post<DetailedSpeciesJobResponse>(
      `${this.metricsApiBaseUrl}/area-profile/custom-polygon/species-coverage/jobs`,
      request,
    );
  }

  getDetailedSpeciesCoverageJob(jobId: string): Observable<DetailedSpeciesJobResponse> {
    return this.http.get<DetailedSpeciesJobResponse>(
      `${this.metricsApiBaseUrl}/area-profile/custom-polygon/species-coverage/jobs/${jobId}`,
    );
  }

  cancelDetailedSpeciesCoverageJob(jobId: string): Observable<DetailedSpeciesJobResponse> {
    return this.http.delete<DetailedSpeciesJobResponse>(
      `${this.metricsApiBaseUrl}/area-profile/custom-polygon/species-coverage/jobs/${jobId}`,
    );
  }
}
