import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { Identity } from './identity';

export const authHttp: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/v1/')) return next(request);
  const identity = inject(Identity);
  const router = inject(Router);
  const token = identity.session()?.csrfToken;
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const outgoing = request.clone({
    withCredentials: true,
    ...(mutation && token ? { setHeaders: { 'X-CSRF-Token': token } } : {}),
  });
  return next(outgoing).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        !request.url.endsWith('/auth/admin/login')
      ) {
        identity.clear();
        if (request.url !== '/api/v1/auth/me' && !router.url.startsWith('/login')) {
          void router.navigate(['/login'], {
            queryParams: { expired: '1', returnUrl: router.url },
          });
        }
      }
      return throwError(() => error);
    }),
  );
};
