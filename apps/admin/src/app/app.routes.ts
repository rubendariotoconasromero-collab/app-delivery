import { Routes } from '@angular/router';
import { adminGuard, staffGuard } from './core/auth-guards';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./login/login').then((module) => module.Login),
    title: 'Acceso · AppDelivery Admin',
  },
  {
    path: 'sin-permiso',
    loadComponent: () => import('./shell/shell').then((module) => module.Forbidden),
    title: 'Acceso restringido · AppDelivery Admin',
  },
  {
    path: '',
    canActivate: [staffGuard],
    canActivateChild: [staffGuard],
    loadComponent: () => import('./shell/shell').then((module) => module.Shell),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./home/home').then((module) => module.Home),
        title: 'Inicio · AppDelivery Admin',
      },
      {
        path: 'conductores',
        canActivate: [adminGuard],
        loadComponent: () => import('./drivers/driver-list').then((module) => module.DriverList),
        title: 'Conductores · AppDelivery Admin',
      },
      {
        path: 'conductores/:id',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./drivers/driver-detail').then((module) => module.DriverDetail),
        title: 'Expediente · AppDelivery Admin',
      },
      {
        path: 'usuarios',
        canActivate: [adminGuard],
        loadComponent: () => import('./users/users').then((module) => module.Users),
        title: 'Usuarios · AppDelivery Admin',
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
