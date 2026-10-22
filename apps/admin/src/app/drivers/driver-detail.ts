import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, finalize, of, switchMap, tap } from 'rxjs';
import {
  AdminApi,
  Decision,
  documentNames,
  DriverDetail as Detail,
  statusNames,
  Vehicle,
} from '../core/admin-api';
import { apiError, Identity } from '../core/identity';

interface ReviewTarget {
  type: 'drivers' | 'vehicles';
  id: string;
  label: string;
  decision: Decision;
}

@Component({
  selector: 'app-driver-detail',
  imports: [DatePipe, FormsModule, RouterLink],
  templateUrl: './driver-detail.html',
})
export class DriverDetail implements OnInit, OnDestroy {
  private readonly api = inject(AdminApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy = inject(DestroyRef);
  readonly identity = inject(Identity);
  readonly detail = signal<Detail | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly target = signal<ReviewTarget | null>(null);
  readonly preview = signal<{ id: string; url: string; name: string } | null>(null);
  readonly documentBusy = signal<string | null>(null);
  readonly names = statusNames;
  readonly documentNames = documentNames;
  readonly decisionNames: Record<Decision, string> = {
    approve: 'Aprobar',
    reject: 'Rechazar',
    suspend: 'Suspender',
  };
  reason = '';
  ngOnInit(): void {
    this.route.paramMap
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set('');
          this.detail.set(null);
          this.target.set(null);
          this.closePreview();
        }),
        switchMap((params) =>
          this.api.driver(params.get('id') ?? '').pipe(
            catchError((error: unknown) => {
              this.error.set(apiError(error));
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(this.destroy),
      )
      .subscribe((detail) => {
        this.detail.set(detail);
        this.loading.set(false);
      });
  }
  refresh(): void {
    const id = this.detail()?.driver.id;
    if (!id || this.busy()) return;
    this.loading.set(true);
    this.error.set('');
    this.closePreview();
    this.api
      .driver(id)
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroy),
      )
      .subscribe({
        next: (value) => {
          this.detail.set(value);
          this.target.set(null);
        },
        error: (error: unknown) => this.error.set(apiError(error)),
      });
  }
  selectReview(type: 'drivers' | 'vehicles', id: string, label: string, decision: Decision): void {
    if (!this.identity.admin() || this.busy()) return;
    this.reason = '';
    this.error.set('');
    this.success.set('');
    this.target.set({ type, id, label, decision });
  }
  review(): void {
    const target = this.target();
    if (!target || this.busy() || !this.identity.admin()) return;
    if (this.reason.trim().length < 3) {
      this.error.set('Escribe un motivo de al menos tres caracteres.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    this.api
      .review(target.type, target.id, target.decision, this.reason)
      .pipe(
        finalize(() => this.busy.set(false)),
        takeUntilDestroyed(this.destroy),
      )
      .subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.target.set(null);
          this.reason = '';
          this.success.set(
            'Revisión guardada. Los estados y la habilitación se actualizaron desde el servidor.',
          );
        },
        error: (error: unknown) => this.error.set(apiError(error)),
      });
  }
  openDocument(id: string, name: string): void {
    if (this.documentBusy()) return;
    this.documentBusy.set(id);
    this.error.set('');
    this.closePreview();
    this.api
      .document(id)
      .pipe(
        finalize(() => this.documentBusy.set(null)),
        takeUntilDestroyed(this.destroy),
      )
      .subscribe({
        next: (blob) => this.preview.set({ id, name, url: URL.createObjectURL(blob) }),
        error: (error: unknown) => this.error.set(apiError(error)),
      });
  }
  closePreview(): void {
    const preview = this.preview();
    if (preview) URL.revokeObjectURL(preview.url);
    this.preview.set(null);
  }
  ngOnDestroy(): void {
    this.closePreview();
  }
  serviceNames(vehicle: Vehicle): string {
    return vehicle.serviceTypes
      .map((type) => (type === 'passengers' ? 'Pasajeros' : 'Encomiendas'))
      .join(' · ');
  }
  documentOwner(vehicleId: string | null): string {
    if (!vehicleId) return 'Conductor';
    const vehicle = this.detail()?.vehicles.find((item) => item.id === vehicleId);
    return vehicle ? `Vehículo ${vehicle.plate}` : `Vehículo ${vehicleId}`;
  }
}
