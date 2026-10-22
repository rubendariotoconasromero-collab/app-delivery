import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { Identity } from './identity';

export const staffGuard: CanActivateFn = (_route, state) => {
  const identity = inject(Identity);
  const router = inject(Router);
  return identity.restore().pipe(
    map(() =>
      !identity.user()
        ? router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } })
        : identity.staff()
          ? true
          : router.createUrlTree(['/sin-permiso']),
    ),
    catchError(() =>
      of(
        router.createUrlTree(['/login'], {
          queryParams: { unavailable: '1', returnUrl: state.url },
        }),
      ),
    ),
  );
};

export const adminGuard: CanActivateFn = () => {
  const identity = inject(Identity);
  const router = inject(Router);
  return identity.restore().pipe(
    map(() => (identity.admin() ? true : router.createUrlTree(['/sin-permiso']))),
    catchError(() => of(router.createUrlTree(['/login'], { queryParams: { unavailable: '1' } }))),
  );
};

export const operationsGuard: CanActivateFn = () => {
  const identity = inject(Identity);
  const router = inject(Router);
  return identity.restore().pipe(
    map(() => (identity.operations() ? true : router.createUrlTree(['/sin-permiso']))),
    catchError(() => of(router.createUrlTree(['/login'], { queryParams: { unavailable: '1' } }))),
  );
};
