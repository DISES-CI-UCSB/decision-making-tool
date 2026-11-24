import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { PrivateFileRefusal, PrivateLayerFileService } from './private-layer-file.service';

/** Sends HttpClient reads of Private Layer Bucket files, such as metrics and goals, through signed links. */
export const privateLayerFileInterceptor: HttpInterceptorFn = (request, next) => {
  const privateFiles = inject(PrivateLayerFileService);
  if (!privateFiles.isPrivateFile(request.url)) {
    return next(request);
  }
  return from(privateFiles.readableUrl(request.url)).pipe(
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
    switchMap((url) => next(request.clone({ url }))),
  );
};
