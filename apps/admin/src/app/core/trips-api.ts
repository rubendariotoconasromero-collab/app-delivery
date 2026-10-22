import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

export type TripState =
  'searching' | 'assigned' | 'arrived' | 'in_progress' | 'completed' | 'cancelled' | 'no_driver';
export const tripStateNames: Record<TripState, string> = {
  searching: 'Buscando conductor',
  assigned: 'Conductor asignado',
  arrived: 'En el origen',
  in_progress: 'En curso',
  completed: 'Finalizado',
  cancelled: 'Cancelado',
  no_driver: 'Sin conductor',
};
export const cashNames = {
  pending: 'Pendiente de declarar',
  declared_paid: 'Declarado cobrado',
  partial: 'Cobro parcial',
  unpaid: 'Impago',
};
export const offerNames = {
  pending: 'Pendiente de aceptación',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  expired: 'Vencida',
  withdrawn: 'Retirada',
};
export const tripActionNames: Record<string, string> = {
  requested: 'Solicitud creada',
  offer_created: 'Propuesta enviada',
  offered: 'Propuesta enviada',
  offer_accepted: 'Propuesta aceptada',
  offer_rejected: 'Propuesta rechazada',
  offer_expired: 'Propuesta vencida',
  search_expired: 'Búsqueda sin conductor',
  start_code_renewed: 'Código de inicio renovado',
  start_pin_failed: 'Intento de inicio rechazado',
  arrived: 'Llegada al origen',
  started: 'Viaje iniciado',
  completed: 'Viaje finalizado',
  cash_declared: 'Efectivo declarado',
  cancelled: 'Viaje cancelado',
};
export interface TripPoint {
  latitude: number;
  longitude: number;
  address: string;
  reference?: string;
}
export interface TripRoute {
  distanceMeters: number;
  durationSeconds: number;
  geometry: { type: 'LineString'; coordinates: number[][] };
  provider: 'osrm';
}
export interface TripOffer {
  id: string;
  tripId: string;
  driverId: string;
  state: keyof typeof offerNames;
  expiresAt: string;
}
export interface Trip {
  id: string;
  clientId: string;
  driverId: string | null;
  vehicleId: string | null;
  state: TripState;
  origin: TripPoint;
  destination: TripPoint;
  passengerCount: number;
  currency: 'BOB';
  totalCents: number;
  tariffVersion: string;
  isTest: true;
  route: TripRoute;
  createdAt: string;
  updatedAt: string;
  searchExpiresAt: string;
  assignedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cash: {
    status: keyof typeof cashNames;
    receivedCents: number | null;
    declaredAt: string | null;
    declaredBy: string | null;
  };
  client: { displayName: string; phone?: string };
  driver: {
    displayName: string;
    phone?: string;
    vehicle: { plate: string; make: string; model: string; capacityPassengers: number };
  } | null;
  offer?: TripOffer | null;
  version: number;
}
export interface TripAudit {
  id: string;
  actorId: string | null;
  action: string;
  reason: string | null;
  createdAt: string;
}
export interface TripDetail {
  trip: Trip;
  audit: TripAudit[];
}
export interface TripCandidate {
  driverId: string;
  displayName: string;
  vehicle: { id: string; plate: string; make: string; model: string; capacityPassengers: number };
  location: { latitude: number; longitude: number; accuracyMeters: number; capturedAt: string };
  distanceMeters: number;
}
export interface TripConfiguration {
  enabled: boolean;
  isTest: true;
  currency: 'BOB';
  map: { tileUrl: string; attribution: string; attributionUrl: string };
  coverage: { south: number; north: number; west: number; east: number };
  tariff: {
    version: string;
    baseCents: number;
    perKmCents: number;
    perMinuteCents: number;
    minimumCents: number;
  };
  quoteTtlSeconds: number;
  searchTtlSeconds: number;
  offerTtlSeconds: number;
  gpsMaxAgeSeconds: number;
  arrivalRadiusMeters: number;
}
export function bolivianos(cents: number): string {
  return `Bs ${(cents / 100).toFixed(2).replace('.', ',')}`;
}

@Injectable({ providedIn: 'root' })
export class TripsApi {
  private readonly http = inject(HttpClient);
  configuration() {
    return this.http.get<TripConfiguration>('/api/v1/trips/config', { timeout: 15000 });
  }
  list(state: string, offset = 0) {
    let params = new HttpParams().set('limit', 50).set('offset', offset);
    if (state) params = params.set('state', state);
    return this.http.get<{ items: Trip[]; total: number; limit: number; offset: number }>(
      '/api/v1/admin/trips',
      { params, timeout: 15000 },
    );
  }
  detail(id: string) {
    return this.http.get<TripDetail>(`/api/v1/admin/trips/${encodeURIComponent(id)}`, {
      timeout: 15000,
    });
  }
  candidates(id: string) {
    return this.http.get<{ items: TripCandidate[] }>(
      `/api/v1/admin/trips/${encodeURIComponent(id)}/candidates`,
      { timeout: 15000 },
    );
  }
  assign(id: string, driverId: string, reason: string, idempotencyKey: string) {
    return this.http.post<{ trip: Trip }>(
      `/api/v1/admin/trips/${encodeURIComponent(id)}/assign`,
      { driverId, reason: reason.trim(), idempotencyKey },
      { timeout: 15000 },
    );
  }
  cancel(id: string, reason: string, idempotencyKey: string) {
    return this.http.post<{ trip: Trip }>(
      `/api/v1/trips/${encodeURIComponent(id)}/cancel`,
      { reason: reason.trim(), idempotencyKey },
      { timeout: 15000 },
    );
  }
}
