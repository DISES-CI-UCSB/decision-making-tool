import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { toPublicFileUrl } from '../config/public-file-url';
import { PrivateFileRefusal, PrivateLayerFileService } from './private-layer-file.service';

/**
 * Rewrites a public Vercel Blob read onto the public file bucket, then sends a Private
 * Layer Bucket read, such as metrics or goals, through a signed link.
 */
export const privateLayerFileInterceptor: HttpInterceptorFn = (request, next) => {
  const privateFiles = inject(PrivateLayerFileService);
  const url = toPublicFileUrl(request.url);
  if (!privateFiles.isPrivateFile(url)) {
    return url === request.url ? next(request) : next(request.clone({ url }));
  }
  return from(privateFiles.readableUrl(url)).pipe(
    catchError((error: unknown) =>
      throwError(
        () =>
          new HttpErrorResponse({
            url: request.url,
            status: error instanceof PrivateFileRefusal ? (error.httpStatus ?? 0) : 0,
            error,
          }),
      ),
    ),
    switchMap((signedUrl) => next(request.clone({ url: signedUrl }))),
  );
};
