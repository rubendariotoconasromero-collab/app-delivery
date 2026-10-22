import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { finalize } from 'rxjs';
import { apiError, Identity, roleNames } from '../core/identity';

@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <a class="skip-link" href="#main-content">Ir al contenido</a>
    <div class="admin-layout">
      <aside class="admin-sidebar">
        <a routerLink="/" class="wordmark">AppDelivery <span>ADMIN</span></a>
        <p class="sidebar-caption">MOVILIDAD Y ENCOMIENDAS</p>
        <nav aria-label="Navegación principal">
          <a
            routerLink="/"
            routerLinkActive="selected"
            [routerLinkActiveOptions]="{ exact: true }"
            ariaCurrentWhenActive="page"
            >Inicio y diagnóstico</a
          >
          @if (identity.operations()) {
            <a routerLink="/viajes" routerLinkActive="selected" ariaCurrentWhenActive="page"
              >Viajes de pasajeros</a
            >
          }
          @if (identity.admin()) {
            <a routerLink="/conductores" routerLinkActive="selected" ariaCurrentWhenActive="page"
              >Conductores y vehículos</a
            >
            <a routerLink="/usuarios" routerLinkActive="selected" ariaCurrentWhenActive="page"
              >Usuarios y permisos</a
            >
          }
        </nav>
        <div class="sidebar-foot">
          Santa Cruz de la Sierra<small>Bolivia · BOB · Loop 03</small>
        </div>
      </aside>
      <div class="admin-main">
        <header class="admin-topbar">
          <div>
            <strong>{{ identity.user()?.displayName }}</strong
            ><small>{{ roles() }}</small>
          </div>
          <button type="button" (click)="logout()" [disabled]="busy()">
            {{ busy() ? 'Cerrando…' : 'Cerrar sesión' }}
          </button>
        </header>
        @if (error()) {
          <p class="error-message shell-error" role="alert">{{ error() }}</p>
        }
        <div id="main-content" tabindex="-1"><router-outlet /></div>
      </div>
    </div>
  `,
})
export class Shell {
  readonly identity = inject(Identity);
  private readonly router = inject(Router);
  readonly busy = signal(false);
  readonly error = signal('');
  roles(): string {
    return (
      this.identity
        .user()
        ?.roles.map((role) => roleNames[role])
        .join(' · ') ?? ''
    );
  }
  logout(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.identity
      .logout()
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => {
          void this.router.navigate(['/login']);
        },
        error: (error: unknown) => this.error.set(apiError(error)),
      });
  }
}

@Component({
  selector: 'app-forbidden',
  imports: [RouterLink],
  template: `<main class="login-page">
    <section class="login-card">
      <h1>Acceso restringido</h1>
      <p>Tu sesión no tiene los permisos del personal necesarios para abrir esta página.</p>
      @if (identity.staff()) {
        <a routerLink="/">Volver al inicio</a>
      }
      <button type="button" (click)="logout()" [disabled]="busy()">
        Cerrar sesión y cambiar de cuenta
      </button>
      @if (error()) {
        <p class="error-message" role="alert">{{ error() }}</p>
      }
    </section>
  </main>`,
})
export class Forbidden extends Shell {}
