import {
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { MockDataService } from '@core/services/mock-data.service';
import { wrapFlatMetricsResponse } from '@core/services/cached-metrics.utils';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';

const LATENCY_MS = 150;

export const mockApiInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  if (!req.url.startsWith('/api')) {
    return next(req);
  }

  const mockData = inject(MockDataService);
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (req.method === 'GET' && /^\/api\/solutions\/[^/]+$/.test(path)) {
    const solutionId = path.split('/').at(-1) ?? '';
    const solution = mockData.getSolutionById(solutionId);
    if (!solution) {
      return mockErrorResponse(404, 'Solution not found');
    }
    return mockSuccessResponse(solution);
  }

  if (req.method === 'GET' && /^\/api\/solutions\/[^/]+\/metrics$/.test(path)) {
    const solutionId = path.split('/')[3];
    const response = mockData.getSolutionMetrics(solutionId);
    if (!response) {
      return mockErrorResponse(404, 'Solution metrics not found');
    }
    return mockSuccessResponse(wrapFlatMetricsResponse(response));
  }

  if (req.method === 'GET' && /^\/api\/solutions\/[^/]+\/aoi\/[^/]+\/metrics$/.test(path)) {
    const [, , , solutionId, , aoiId] = path.split('/');
    const response = mockData.getAoiMetrics(solutionId, aoiId);
    if (!response) {
      return mockErrorResponse(404, 'AOI metrics not found');
    }
    return mockSuccessResponse(response);
  }

  if (req.method === 'GET' && path === '/api/solutions/compare') {
    const id1 = url.searchParams.get('id1');
    const id2 = url.searchParams.get('id2');
    if (!id1 || !id2) {
      return mockErrorResponse(400, 'Both id1 and id2 are required');
    }
    const comparison = mockData.compareSolutions(id1, id2);
    if (!comparison) {
      return mockErrorResponse(404, 'Comparison solutions not found');
    }
    return mockSuccessResponse(comparison);
  }

  if (req.method === 'GET' && path === '/api/layers') {
    return mockSuccessResponse(mockData.getLayers());
  }

  if (req.method === 'GET' && /^\/api\/layers\/[^/]+\/stats$/.test(path)) {
    const layerId = path.split('/')[3];
    const layerStats = mockData.getLayerStats(layerId);
    if (!layerStats) {
      return mockErrorResponse(404, 'Layer stats not found');
    }
    return mockSuccessResponse(layerStats);
  }

  if (req.method === 'POST' && path === '/api/solutions/match') {
    const targets = Array.isArray(req.body) ? req.body : [];
    return mockSuccessResponse(mockData.findMatchingSolutions(targets));
  }

  if (req.method === 'GET' && /^\/api\/solutions\/[^/]+\/metrics\/fixtures\/anl$/.test(path)) {
    const solutionId = path.split('/')[3];
    const fixtures = mockData.getAnalysisMetricFixtures(solutionId);
    if (!fixtures) {
      return mockErrorResponse(404, 'ANL metric fixtures not found');
    }
    return mockSuccessResponse(fixtures);
  }

  return mockErrorResponse(404, `No mock route for ${req.method} ${path}`);
};

function mockSuccessResponse<T>(body: T): Observable<HttpEvent<T>> {
  return of(new HttpResponse<T>({ status: 200, body })).pipe(delay(LATENCY_MS));
}

function mockErrorResponse(status: number, message: string): Observable<HttpEvent<unknown>> {
  return of(
    new HttpResponse({
      status,
      body: { message },
    }),
  ).pipe(delay(LATENCY_MS));
}
