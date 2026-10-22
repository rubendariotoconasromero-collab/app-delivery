import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AdminApi, Driver, statusNames } from '../core/admin-api';
import { apiError } from '../core/identity';

@Component({
  selector: 'app-driver-list',
  imports: [FormsModule, RouterLink],
  template: `
    <main class="page">
      <p class="eyebrow">HABILITACIÓN / CONDUCTORES Y VEHÍCULOS</p>
      <h1>Revisión de conductores</h1>
      <p class="muted">
        Revisa datos y documentos antes de habilitar la operación. Aprobar el conductor y su
        vehículo son decisiones separadas.
      </p>
      <div class="toolbar">
        <label for="review-filter">Estado de revisión</label>
        <select
          id="review-filter"
          [ngModel]="status()"
          (ngModelChange)="filter($event)"
          [disabled]="loading()"
        >
          <option value="">Todos</option>
          @for (entry of statuses; track entry[0]) {
            <option [value]="entry[0]">{{ entry[1] }}</option>
          }
        </select>
        <button type="button" (click)="load()" [disabled]="loading()">Actualizar</button>
      </div>
      @if (error()) {
        <p class="error-message" role="alert">{{ error() }}</p>
      }
      @if (loading()) {
        <p role="status">Cargando conductores…</p>
      } @else {
        <div class="table-wrap">
          <table>
            <caption class="sr-only">
              Conductores para revisión
            </caption>
            <thead>
              <tr>
                <th>Conductor</th>
                <th>Teléfono</th>
                <th>Revisión</th>
                <th>Habilitación</th>
                <th>Expediente</th>
              </tr>
            </thead>
            <tbody>
              @for (driver of drivers(); track driver.id) {
                <tr>
                  <td>
                    <strong>{{ driver.fullName || driver.displayName }}</strong
                    ><small>{{ driver.displayName }}</small>
                  </td>
                  <td>{{ driver.phone }}</td>
                  <td>
                    <span class="status-badge" [attr.data-status]="driver.reviewStatus">{{
                      names[driver.reviewStatus]
                    }}</span>
                  </td>
                  <td>{{ driver.eligible ? 'Habilitado' : 'No habilitado' }}</td>
                  <td>
                    <a class="record-link" [routerLink]="['/conductores', driver.id]"
                      >Revisar expediente →</a
                    >
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5">
                    {{
                      error()
                        ? 'No se pudo obtener el listado.'
                        : 'No hay conductores con este filtro.'
                    }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      <div class="pagination">
        <button type="button" (click)="page(-1)" [disabled]="loading() || offset() === 0">
          Anterior</button
        ><span>Página {{ offset() / 50 + 1 }} · Hasta 50 resultados</span
        ><button type="button" (click)="page(1)" [disabled]="loading() || drivers().length < 50">
          Siguiente
        </button>
      </div>
    </main>
  `,
})
export class DriverList implements OnInit {
  private readonly api = inject(AdminApi);
  readonly drivers = signal<Driver[]>([]);
  readonly status = signal('pending');
  readonly offset = signal(0);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly names = statusNames;
  readonly statuses = Object.entries(statusNames);
  ngOnInit(): void {
    this.load();
  }
  filter(status: string): void {
    this.status.set(status);
    this.offset.set(0);
    this.load();
  }
  page(direction: number): void {
    this.offset.update((value) => Math.max(0, value + direction * 50));
    this.load();
  }
  load(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.drivers.set([]);
    this.api
      .drivers(this.status(), this.offset())
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: ({ items }) => this.drivers.set(items),
        error: (error: unknown) => this.error.set(apiError(error)),
      });
  }
}
