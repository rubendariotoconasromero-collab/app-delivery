import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Identity } from '../core/identity';
import { pendingTripAction } from '../core/pending-trip-actions';
import { Trip, TripCandidate, TripConfiguration } from '../core/trips-api';
import { TripDetail } from './trip-detail';

const tripId = 'bfb58ea0-197d-418c-ab85-1dc64c14e73e';
const driverId = 'fcdfe406-5ead-4905-914c-c07af3d5c207';
const configuration: TripConfiguration = {
  enabled: true,
  isTest: true,
  currency: 'BOB',
  coverage: { south: -17.9, north: -17.65, west: -63.3, east: -63.02 },
  tariff: {
    version: 'scz-dev-v1',
    baseCents: 500,
    perKmCents: 200,
    perMinuteCents: 25,
    minimumCents: 800,
  },
  map: {
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    attributionUrl: 'https://www.openstreetmap.org/copyright',
  },
  quoteTtlSeconds: 180,
  searchTtlSeconds: 600,
  offerTtlSeconds: 60,
  gpsMaxAgeSeconds: 60,
  arrivalRadiusMeters: 200,
};
const trip: Trip = {
  id: tripId,
  clientId: 'client-1',
  driverId: null,
  vehicleId: null,
  state: 'searching',
  origin: {
    latitude: -17.7833,
    longitude: -63.1821,
    address: 'Plaza 24 de Septiembre',
    reference: 'Lado norte',
  },
  destination: { latitude: -17.802, longitude: -63.155, address: 'Destino de prueba' },
  passengerCount: 2,
  currency: 'BOB',
  totalCents: 1450,
  tariffVersion: 'scz-dev-v1',
  isTest: true,
  route: {
    distanceMeters: 3500,
    durationSeconds: 600,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-63.1821, -17.7833],
        [-63.155, -17.802],
      ],
    },
    provider: 'osrm',
  },
  createdAt: '2026-10-22T20:00:00Z',
  updatedAt: '2026-10-22T20:00:00Z',
  searchExpiresAt: '2026-10-22T20:10:00Z',
  assignedAt: null,
  arrivedAt: null,
  startedAt: null,
  completedAt: null,
  cash: { status: 'pending', receivedCents: null, declaredAt: null, declaredBy: null },
  client: { displayName: 'María' },
  driver: null,
  offer: null,
  version: 1,
};
const candidate: TripCandidate = {
  driverId,
  displayName: 'Ana Pérez',
  vehicle: {
    id: 'vehicle-1',
    plate: '123ABC',
    make: 'Toyota',
    model: 'Corolla',
    capacityPassengers: 4,
  },
  location: {
    latitude: -17.7833,
    longitude: -63.1821,
    accuracyMeters: 12,
    capturedAt: '2026-10-22T20:00:00Z',
  },
  distanceMeters: 250,
};

describe('Operación de un viaje', () => {
  let fixture: ComponentFixture<TripDetail>;
  let http: HttpTestingController;
  let identity: Identity;
  const content = () => fixture.nativeElement.textContent as string;
  function create(currentTrip = trip): void {
    fixture = TestBed.createComponent(TripDetail);
    fixture.detectChanges();
    http.expectOne('/api/v1/trips/config').flush(configuration);
    http.expectOne(`/api/v1/admin/trips/${tripId}`).flush({ trip: currentTrip, audit: [] });
    fixture.detectChanges();
  }
  function chooseCandidate(): void {
    fixture.componentInstance.loadCandidates();
    http.expectOne(`/api/v1/admin/trips/${tripId}/candidates`).flush({ items: [candidate] });
    fixture.componentInstance.driverId = driverId;
    fixture.componentInstance.assignmentReason = 'Candidato disponible cercano al origen';
  }
  beforeEach(async () => {
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [TripDetail],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: tripId })) } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    identity = TestBed.inject(Identity);
    identity.session.set({
      user: {
        id: 'staff-1',
        displayName: 'Operaciones',
        email: 'operations@example.test',
        phone: null,
        roles: ['operator'],
        status: 'active',
      },
      expiresAt: '2030-01-01T00:00:00Z',
      csrfToken: 'csrf',
    });
    create();
  });
  afterEach(() => {
    fixture.destroy();
    http.verify();
    sessionStorage.clear();
  });

  it('registra la propuesta real, mantiene búsqueda hasta aceptación y no confirma pago', () => {
    chooseCandidate();
    fixture.componentInstance.assign();
    const request = http.expectOne(`/api/v1/admin/trips/${tripId}/assign`);
    expect(request.request.body.driverId).toBe(driverId);
    expect(request.request.body.reason).toBe('Candidato disponible cercano al origen');
    expect(request.request.body.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
    const proposed: Trip = {
      ...trip,
      version: 2,
      offer: {
        id: 'offer-1',
        tripId,
        driverId,
        state: 'pending',
        expiresAt: '2026-10-22T20:01:00Z',
      },
    };
    request.flush({ trip: proposed });
    http.expectOne(`/api/v1/admin/trips/${tripId}`).flush({
      trip: proposed,
      audit: [
        {
          id: 'audit-1',
          actorId: 'staff-1',
          action: 'offer_created',
          reason: 'Candidato disponible cercano al origen',
          createdAt: '2026-10-22T20:00:01Z',
        },
      ],
    });
    fixture.detectChanges();
    expect(content()).toContain('Pendiente de aceptación');
    expect(content()).toContain('Buscando conductor');
    expect(content()).toContain('Bs 14,50');
    expect(content()).toContain('Sin declaración');
    expect(content()).toContain('Propuesta enviada');
    expect(fixture.componentInstance.canAssign()).toBe(false);
    expect(pendingTripAction('staff-1', tripId, 'assign')).toBeNull();
  });

  it('recupera un intento ambiguo tras recargar y reintenta con el mismo UUID y contenido', () => {
    chooseCandidate();
    fixture.componentInstance.assign();
    const original = http.expectOne(`/api/v1/admin/trips/${tripId}/assign`);
    const originalBody = original.request.body;
    original.error(new ProgressEvent('error'));
    expect(fixture.componentInstance.pendingAssignment()).toBe(true);
    fixture.destroy();
    create();
    expect(fixture.componentInstance.pendingAssignment()).toBe(true);
    expect(fixture.componentInstance.driverId).toBe(driverId);
    fixture.componentInstance.assign();
    const retry = http.expectOne(`/api/v1/admin/trips/${tripId}/assign`);
    expect(retry.request.body).toEqual(originalBody);
    const proposed: Trip = {
      ...trip,
      offer: {
        id: 'offer-1',
        tripId,
        driverId,
        state: 'pending',
        expiresAt: '2026-10-22T20:01:00Z',
      },
      version: 2,
    };
    retry.flush({ trip: proposed });
    http.expectOne(`/api/v1/admin/trips/${tripId}`).flush({ trip: proposed, audit: [] });
    expect(fixture.componentInstance.pendingAssignment()).toBe(false);
    expect(pendingTripAction('staff-1', tripId, 'assign')).toBeNull();
  });

  it('no simula asignación ante un conflicto y permite actualizar los candidatos', () => {
    chooseCandidate();
    fixture.componentInstance.assign();
    http
      .expectOne(`/api/v1/admin/trips/${tripId}/assign`)
      .flush(
        { message: 'El conductor ya no está disponible' },
        { status: 409, statusText: 'Conflict' },
      );
    fixture.detectChanges();
    expect(content()).toContain('El conductor ya no está disponible');
    expect(fixture.componentInstance.detail()?.trip.driverId).toBeNull();
    expect(fixture.componentInstance.pendingAssignment()).toBe(false);
    expect(fixture.componentInstance.success()).toBe('');
    expect(pendingTripAction('staff-1', tripId, 'assign')).toBeNull();
    fixture.componentInstance.loadCandidates();
    http.expectOne(`/api/v1/admin/trips/${tripId}/candidates`).flush({ items: [] });
    fixture.detectChanges();
    expect(content()).toContain('No hay conductores disponibles compatibles');
  });

  it('un rol de finanzas no puede proponer ni cancelar al instanciar la pantalla directamente', () => {
    identity.session.update((session) =>
      session ? { ...session, user: { ...session.user, roles: ['finance'] } } : null,
    );
    fixture.detectChanges();
    expect(content()).not.toContain('Proponer conductor');
    expect(content()).not.toContain('Confirmar cancelación');
    fixture.componentInstance.assign();
    fixture.componentInstance.cancel();
    fixture.componentInstance.loadCandidates();
    http.expectNone(`/api/v1/admin/trips/${tripId}/assign`);
    http.expectNone(`/api/v1/trips/${tripId}/cancel`);
    http.expectNone(`/api/v1/admin/trips/${tripId}/candidates`);
  });

  it('separa finalización y declaración parcial, y no presenta códigos del pasajero', () => {
    fixture.destroy();
    create({
      ...trip,
      state: 'completed',
      completedAt: '2026-10-22T20:20:00Z',
      cash: {
        status: 'partial',
        receivedCents: 1000,
        declaredAt: '2026-10-22T20:20:10Z',
        declaredBy: driverId,
      },
      ...({ startCode: '456789' } as object),
    });
    expect(content()).toContain('Finalizado');
    expect(content()).toContain('Cobro parcial');
    expect(content()).toContain('Bs 10,00');
    expect(content()).toContain('pendiente de conciliación');
    expect(content()).not.toContain('456789');
    expect(content()).not.toContain('Proponer conductor');
    expect(content()).not.toContain('Confirmar cancelación');
    fixture.componentInstance.cancellationReason = 'Sin posibilidad de continuar';
    fixture.componentInstance.cancel();
    http.expectNone(`/api/v1/trips/${tripId}/cancel`);
  });

  it('cancela antes del inicio con motivo auditado y solo muestra el resultado confirmado', () => {
    fixture.componentInstance.cancellationReason = 'Cancelación solicitada por el cliente';
    fixture.componentInstance.cancel();
    const request = http.expectOne(`/api/v1/trips/${tripId}/cancel`);
    expect(request.request.body.reason).toBe('Cancelación solicitada por el cliente');
    expect(fixture.componentInstance.detail()?.trip.state).toBe('searching');
    request.flush({ trip: { ...trip, state: 'cancelled', version: 2 } });
    http
      .expectOne(`/api/v1/admin/trips/${tripId}`)
      .flush({ trip: { ...trip, state: 'cancelled', version: 2 }, audit: [] });
    fixture.detectChanges();
    expect(content()).toContain('Cancelado');
    expect(content()).toContain('No se generó un cargo automático');
    expect(pendingTripAction('staff-1', tripId, 'cancel')).toBeNull();
  });
});
