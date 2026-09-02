import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  MEC_COMPACT_V1_FORMAT,
  MEC_COMPACT_V2_FORMAT,
  isMecCompactDocument,
  isMecNationalDenominatorDocument,
  type GeographyLevel,
  type MecCompactDocument,
  type MecCompactFormat,
  type MecNationalDenominatorDocument,
} from '@core/models';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';

import { SolutionCatalogService } from './solution-catalog.service';

export type MecMetricsLoadResult =
  | { status: 'loaded'; document: MecCompactDocument; format: MecCompactFormat }
  | { status: 'unavailable'; document: null }
  | { status: 'error'; document: null; error: 'http' | 'invalid-document' };
export type MecNationalDenominatorLoadResult =
  | { status: 'loaded'; document: MecNationalDenominatorDocument }
  | { status: 'unavailable'; document: null }
  | { status: 'error'; document: null; error: 'http' | 'invalid-document' };

interface MecUrlCandidates {
  v2: string | null;
  v1: string | null;
}

@Injectable({ providedIn: 'root' })
export class MecMetricsLoaderService {
  private readonly http = inject(HttpClient);
  private readonly catalog = inject(SolutionCatalogService);
  private readonly cache = new Map<string, Observable<MecMetricsLoadResult>>();
  private readonly denominatorCache = new Map<string, Observable<MecNationalDenominatorLoadResult>>();

  resolveMecUrls(solutionId: string, geographyLevel: GeographyLevel): MecUrlCandidates {
    const urls = this.catalog.getById(solutionId)?.precomputedMetricUrls;
    return {
      v2: this.nonEmptyUrl(urls?.mecV2ByGeography?.[geographyLevel]),
      v1: this.nonEmptyUrl(urls?.mecByGeography?.[geographyLevel]),
    };
  }

  resolveMecUrl(solutionId: string, geographyLevel: GeographyLevel): string | null {
    const urls = this.resolveMecUrls(solutionId, geographyLevel);
    return urls.v2 ?? urls.v1;
  }

  loadMecMetrics(
    solutionId: string,
    geographyLevel: GeographyLevel,
  ): Observable<MecMetricsLoadResult> {
    const urls = this.resolveMecUrls(solutionId, geographyLevel);
    if (!urls.v2 && !urls.v1) {
      return of({ status: 'unavailable', document: null });
    }

    const cacheKey = `v2:${urls.v2 ?? ''}|v1:${urls.v1 ?? ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const request = (
      urls.v2
        ? this.requestDocument(urls.v2, solutionId, geographyLevel, MEC_COMPACT_V2_FORMAT).pipe(
            catchError((error: unknown) => {
              if (this.isExplicitlyAbsent(error) && urls.v1) {
                return this.requestDocument(
                  urls.v1,
                  solutionId,
                  geographyLevel,
                  MEC_COMPACT_V1_FORMAT,
                ).pipe(
                  catchError(() =>
                    of<MecMetricsLoadResult>({
                      status: 'error',
                      document: null,
                      error: 'http',
                    }),
                  ),
                );
              }
              return of<MecMetricsLoadResult>({
                status: 'error',
                document: null,
                error: 'http',
              });
            }),
          )
        : this.requestDocument(urls.v1!, solutionId, geographyLevel, MEC_COMPACT_V1_FORMAT).pipe(
            catchError(() =>
              of<MecMetricsLoadResult>({ status: 'error', document: null, error: 'http' }),
            ),
          )
    ).pipe(shareReplay({ bufferSize: 1, refCount: false }));
    this.cache.set(cacheKey, request);
    return request;
  }

  loadNationalDenominator(solutionId: string): Observable<MecNationalDenominatorLoadResult> {
    const url = this.nonEmptyUrl(
      this.catalog.getById(solutionId)?.precomputedMetricUrls?.mecNationalDenominator,
    );
    if (!url) return of({ status: 'unavailable', document: null });
    const cached = this.denominatorCache.get(url);
    if (cached) return cached;
    const request = this.http.get<unknown>(url).pipe(
      map((document): MecNationalDenominatorLoadResult => {
        if (!isMecNationalDenominatorDocument(document)) {
          return { status: 'error', document: null, error: 'invalid-document' };
        }
        return { status: 'loaded', document };
      }),
      catchError(() => of<MecNationalDenominatorLoadResult>({ status: 'error', document: null, error: 'http' })),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.denominatorCache.set(url, request);
    return request;
  }

  private requestDocument(
    url: string,
    solutionId: string,
    geographyLevel: GeographyLevel,
    expectedFormat: MecCompactFormat,
  ): Observable<MecMetricsLoadResult> {
    return this.http.get<unknown>(url).pipe(
      map((document): MecMetricsLoadResult => {
        if (
          !isMecCompactDocument(document) ||
          document.format !== expectedFormat ||
          document.solutionId !== solutionId ||
          document.geographyLevel !== geographyLevel
        ) {
          return { status: 'error', document: null, error: 'invalid-document' };
        }
        return { status: 'loaded', document, format: document.format };
      }),
    );
  }

  private nonEmptyUrl(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  }

  private isExplicitlyAbsent(error: unknown): boolean {
    return error instanceof HttpErrorResponse && (error.status === 404 || error.status === 410);
  }
}
