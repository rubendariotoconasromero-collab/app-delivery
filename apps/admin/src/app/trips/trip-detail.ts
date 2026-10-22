import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, filter, finalize, interval, of, switchMap, tap } from 'rxjs';
import { apiError, Identity } from '../core/identity';
import {
  pendingTripAction,
  removePendingTripAction,
  savePendingTripAction,
} from '../core/pending-trip-actions';
import {
  bolivianos,
  cashNames,
  offerNames,
  TripCandidate,
  TripConfiguration,
  TripDetail as Detail,
  TripsApi,
  tripActionNames,
  tripStateNames,
} from '../core/trips-api';
import { RouteMap } from './route-map';

interface Attempt {
  key: string;
  payload: string;
}

@Component({
  selector: 'app-trip-detail',
  imports: [DatePipe, DecimalPipe, FormsModule, RouterLink, RouteMap],
  templateUrl: './trip-detail.html',
})
export class TripDetail implements OnInit {
  private readonly api = inject(TripsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy = inject(DestroyRef);
  readonly identity = inject(Identity);
  readonly detail = signal<Detail | null>(null);
  readonly config = signal<TripConfiguration | null>(null);
  readonly configError = signal('');
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly checkedAt = signal<Date | null>(null);
  readonly candidates = signal<TripCandidate[]>([]);
  readonly candidatesLoading = signal(false);
  readonly candidatesChecked = signal(false);
  readonly candidatesError = signal('');
  readonly names = tripStateNames;
  readonly cashNames = cashNames;
  readonly offerNames = offerNames;
  readonly actionNames = tripActionNames;
  readonly money = bolivianos;
  readonly pendingAssignment = signal(false);
  readonly pendingCancellation = signal(false);
  readonly canAssign = computed(
    () =>
      this.identity.operations() &&
      !this.pendingCancellation() &&
      this.detail()?.trip.state === 'searching' &&
      this.detail()?.trip.offer?.state !== 'pending',
  );
  readonly canCancel = computed(
    () =>
      this.identity.operations() &&
      !this.pendingAssignment() &&
      ['searching', 'assigned', 'arrived'].includes(this.detail()?.trip.state ?? ''),
  );
  driverId = '';
  assignmentReason = '';
  cancellationReason = '';
  private assignmentAttempt?: Attempt;
  private cancellationAttempt?: Attempt;
  private tripId = '';

  ngOnInit(): void {
    this.api
      .configuration()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (config) => this.config.set(config),
        error: (error: unknown) => this.configError.set(apiError(error)),
      });
    this.route.paramMap
      .pipe(
        tap((params) => {
          this.tripId = params.get('id') ?? '';
          this.detail.set(null);
          this.loading.set(true);
          this.error.set('');
          this.success.set('');
          this.clearCandidates();
          this.driverId = '';
          this.assignmentReason = '';
          this.cancellationReason = '';
          this.assignmentAttempt = undefined;
          this.cancellationAttempt = undefined;
          this.pendingAssignment.set(false);
          this.pendingCancellation.set(false);
          this.restoreAttempts();
        }),
        switchMap(() =>
          this.api.detail(this.tripId).pipe(
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
        if (detail) {
          this.checkedAt.set(new Date());
          this.reconcileAttempts(detail);
        }
      });
    interval(15000)
      .pipe(
        filter(() => document.visibilityState === 'visible'),
        takeUntilDestroyed(this.destroy),
      )
      .subscribe(() => this.refresh());
  }

  refresh(): void {
    if (!this.tripId || this.loading() || this.busy()) return;
    this.loading.set(true);
    this.error.set('');
    this.api
      .detail(this.tripId)
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroy),
      )
      .subscribe({
        next: (detail) => {
          const previous = this.detail()?.trip;
          if (
            previous?.version !== detail.trip.version ||
            previous?.offer?.id !== detail.trip.offer?.id ||
            previous?.offer?.state !== detail.trip.offer?.state
          )
            this.clearCandidates();
          this.detail.set(detail);
          this.checkedAt.set(new Date());
          this.reconcileAttempts(detail);
        },
        error: (error: unknown) => this.error.set(apiError(error)),
      });
  }

  loadCandidates(): void {
    if (!this.canAssign() || this.candidatesLoading() || this.busy() || this.pendingAssignment())
      return;
    this.candidatesLoading.set(true);
    this.candidatesError.set('');
    this.driverId = '';
    this.api
      .candidates(this.tripId)
      .pipe(
        finalize(() => this.candidatesLoading.set(false)),
        takeUntilDestroyed(this.destroy),
      )
      .subscribe({
        next: ({ items }) => {
          this.candidates.set(items);
          this.candidatesChecked.set(true);
        },
        error: (error: unknown) => {
          this.candidates.set([]);
          this.candidatesError.set(apiError(error));
        },
      });
  }

  assign(): void {
    if (!this.canAssign() || this.busy() || !this.identity.operations()) return;
    const reason = this.assignmentReason.trim();
    if (
      !this.driverId ||
      (!this.pendingAssignment() &&
        !this.candidates().some((candidate) => candidate.driverId === this.driverId))
    ) {
      this.error.set('Selecciona un conductor del listado disponible.');
      return;
    }
    if (reason.length < 3 || reason.length > 1000) {
      this.error.set('Escribe un motivo de entre 3 y 1000 caracteres.');
      return;
    }
    const payload = JSON.stringify({ tripId: this.tripId, driverId: this.driverId, reason });
    if (this.pendingAssignment() && this.assignmentAttempt?.payload !== payload) {
      this.error.set('Resuelve la propuesta pendiente con el mismo conductor y motivo.');
      return;
    }
    if (!this.assignmentAttempt || this.assignmentAttempt.payload !== payload)
      this.assignmentAttempt = { key: crypto.randomUUID(), payload };
    try {
      savePendingTripAction({
        actorId: this.identity.user()?.id ?? '',
        tripId: this.tripId,
        operation: 'assign',
        driverId: this.driverId,
        reason,
        idempotencyKey: this.assignmentAttempt.key,
      });
    } catch (error: unknown) {
      this.error.set(apiError(error));
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    const actionTripId = this.tripId;
    this.api
      .assign(actionTripId, this.driverId, reason, this.assignmentAttempt.key)
      .pipe(
        finalize(() => this.busy.set(false)),
        takeUntilDestroyed(this.destroy),
      )
      .subscribe({
        next: ({ trip }) => {
          if (actionTripId !== this.tripId) return;
          this.detail.update((detail) => (detail ? { ...detail, trip } : null));
          this.pendingAssignment.set(false);
          this.assignmentAttempt = undefined;
          this.assignmentReason = '';
          this.driverId = '';
          this.removeAttempt('assign');
          this.clearCandidates();
          this.success.set('Propuesta registrada. El viaje se asigna cuando el conductor acepta.');
          this.reloadAfterMutation();
        },
        error: (error: unknown) => {
          if (actionTripId !== this.tripId) return;
          const uncertain = this.uncertain(error);
          this.pendingAssignment.set(uncertain);
          if (!uncertain) {
            this.removeAttempt('assign');
            this.assignmentAttempt = undefined;
            this.clearCandidates();
          }
          this.error.set(
            `${apiError(error)} ${uncertain ? 'Puedes reintentar la misma propuesta para recuperar su resultado.' : 'Actualiza el viaje y consulta de nuevo los conductores disponibles.'}`,
          );
        },
      });
  }

  cancel(): void {
    if (!this.canCancel() || this.busy()) return;
    const reason = this.cancellationReason.trim();
    if (reason.length < 3 || reason.length > 1000) {
      this.error.set('Escribe un motivo de entre 3 y 1000 caracteres para cancelar.');
      return;
    }
    const payload = JSON.stringify({ tripId: this.tripId, reason });
    if (this.pendingCancellation() && this.cancellationAttempt?.payload !== payload) {
      this.error.set('Resuelve la cancelación pendiente con el mismo motivo.');
      return;
    }
    if (!this.cancellationAttempt || this.cancellationAttempt.payload !== payload)
      this.cancellationAttempt = { key: crypto.randomUUID(), payload };
    try {
      savePendingTripAction({
        actorId: this.identity.user()?.id ?? '',
        tripId: this.tripId,
        operation: 'cancel',
        reason,
        idempotencyKey: this.cancellationAttempt.key,
      });
    } catch (error: unknown) {
      this.error.set(apiError(error));
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    const actionTripId = this.tripId;
    this.api
      .cancel(actionTripId, reason, this.cancellationAttempt.key)
      .pipe(
        finalize(() => this.busy.set(false)),
        takeUntilDestroyed(this.destroy),
      )
      .subscribe({
        next: ({ trip }) => {
          if (actionTripId !== this.tripId) return;
          this.detail.update((detail) => (detail ? { ...detail, trip } : null));
          this.pendingCancellation.set(false);
          this.cancellationAttempt = undefined;
          this.cancellationReason = '';
          this.clearCandidates();
          this.removeAttempt('cancel');
          this.success.set('Viaje cancelado. No se generó un cargo automático.');
          this.reloadAfterMutation();
        },
        error: (error: unknown) => {
          if (actionTripId !== this.tripId) return;
          const uncertain = this.uncertain(error);
          this.pendingCancellation.set(uncertain);
          if (!uncertain) {
            this.removeAttempt('cancel');
            this.cancellationAttempt = undefined;
          }
          this.error.set(
            `${apiError(error)} ${uncertain ? 'Puedes reintentar la misma cancelación para recuperar su resultado.' : 'Actualiza el viaje para consultar su estado vigente.'}`,
          );
        },
      });
  }

  private reloadAfterMutation(): void {
    this.api
      .detail(this.tripId)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.checkedAt.set(new Date());
        },
        error: (error: unknown) =>
          this.error.set(
            `La operación fue confirmada, pero no se pudo actualizar el historial. ${apiError(error)}`,
          ),
      });
  }
  private clearCandidates(): void {
    this.candidates.set([]);
    this.candidatesChecked.set(false);
  }
  private uncertain(error: unknown): boolean {
    return !(error instanceof HttpErrorResponse) || error.status === 0 || error.status >= 500;
  }
  private removeAttempt(operation: 'assign' | 'cancel'): void {
    removePendingTripAction(this.identity.user()?.id ?? '', this.tripId, operation);
  }
  private restoreAttempts(): void {
    const actorId = this.identity.user()?.id ?? '';
    const assignment = pendingTripAction(actorId, this.tripId, 'assign');
    if (assignment) {
      this.driverId = assignment.driverId ?? '';
      this.assignmentReason = assignment.reason;
      this.assignmentAttempt = {
        key: assignment.idempotencyKey,
        payload: JSON.stringify({
          tripId: this.tripId,
          driverId: this.driverId,
          reason: assignment.reason,
        }),
      };
      this.pendingAssignment.set(true);
    }
    const cancellation = pendingTripAction(actorId, this.tripId, 'cancel');
    if (cancellation) {
      this.cancellationReason = cancellation.reason;
      this.cancellationAttempt = {
        key: cancellation.idempotencyKey,
        payload: JSON.stringify({ tripId: this.tripId, reason: cancellation.reason }),
      };
      this.pendingCancellation.set(true);
    }
  }
  private reconcileAttempts(detail: Detail): void {
    if (
      this.pendingAssignment() &&
      (detail.trip.offer?.driverId === this.driverId || detail.trip.state !== 'searching')
    ) {
      this.pendingAssignment.set(false);
      this.assignmentAttempt = undefined;
      this.removeAttempt('assign');
      this.success.set('Se recuperó el estado vigente del viaje. Revisa la propuesta y sus hitos.');
    }
    if (
      this.pendingCancellation() &&
      !['searching', 'assigned', 'arrived'].includes(detail.trip.state)
    ) {
      this.pendingCancellation.set(false);
      this.cancellationAttempt = undefined;
      this.removeAttempt('cancel');
      this.success.set('Se recuperó el estado vigente del viaje desde el servidor.');
    }
  }
}
