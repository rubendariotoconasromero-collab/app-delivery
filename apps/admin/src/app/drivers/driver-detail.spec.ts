import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DriverDetail as Detail } from '../core/admin-api';
import { Identity } from '../core/identity';
import { DriverDetail } from './driver-detail';

const detail: Detail = {
  driver: {
    id: 'driver-1',
    displayName: 'Ana',
    fullName: 'Ana Pérez',
    phone: '+59170000000',
    reviewStatus: 'pending',
    reviewReason: null,
    submittedAt: '2026-10-22T10:00:00Z',
    reviewedAt: null,
    activeVehicleId: null,
    eligible: false,
  },
  vehicles: [
    {
      id: 'vehicle-1',
      driverId: 'driver-1',
      plate: '123ABC',
      make: 'Toyota',
      model: 'Corolla',
      year: 2022,
      capacityPassengers: 4,
      serviceTypes: ['passengers', 'parcels'],
      reviewStatus: 'pending',
      reviewReason: null,
      submittedAt: '2026-10-22T10:00:00Z',
      reviewedAt: null,
      active: false,
    },
  ],
  documents: [
    {
      id: 'document-1',
      kind: 'driver_license',
      originalName: 'licencia.pdf',
      mimeType: 'application/pdf',
      size: 1234,
      expiresOn: '2027-10-22',
      createdAt: '2026-10-22T10:00:00Z',
      vehicleId: null,
    },
  ],
  audit: [],
};

describe('Revisión administrativa', () => {
  let fixture: ComponentFixture<DriverDetail>;
  let http: HttpTestingController;
  let identity: Identity;
  const content = () => fixture.nativeElement.textContent as string;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DriverDetail],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: 'driver-1' })) },
        },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    identity = TestBed.inject(Identity);
    identity.session.set({
      user: {
        id: 'admin-1',
        displayName: 'Admin',
        email: 'admin@example.test',
        phone: null,
        roles: ['admin'],
        status: 'active',
      },
      expiresAt: '2030-01-01T00:00:00Z',
      csrfToken: 'csrf',
    });
    fixture = TestBed.createComponent(DriverDetail);
    fixture.detectChanges();
    http.expectOne('/api/v1/admin/drivers/driver-1').flush(detail);
    fixture.detectChanges();
  });
  afterEach(() => {
    fixture.destroy();
    http.verify();
  });
  it('rechaza decisiones sin motivo y al aprobar muestra la respuesta real de habilitación', () => {
    const component = fixture.componentInstance;
    component.selectReview('drivers', 'driver-1', 'Ana', 'approve');
    component.reason = ' ';
    component.review();
    http.expectNone('/api/v1/admin/drivers/driver-1/review');
    component.reason = 'Documentos vigentes revisados';
    component.review();
    const request = http.expectOne('/api/v1/admin/drivers/driver-1/review');
    expect(request.request.body).toEqual({
      decision: 'approve',
      reason: 'Documentos vigentes revisados',
    });
    request.flush({
      ...detail,
      driver: {
        ...detail.driver,
        reviewStatus: 'approved',
        reviewReason: 'Documentos vigentes revisados',
      },
    });
    fixture.detectChanges();
    expect(content()).toContain('Aprobado');
    expect(content()).toContain('No habilitado');
    expect(content()).toContain('Revisión guardada');
    expect(component.target()).toBe(null);
  });
  it('revisa el vehículo solicitado y actualiza el expediente completo desde la API', () => {
    const component = fixture.componentInstance;
    component.selectReview('vehicles', 'vehicle-1', '123ABC', 'reject');
    component.reason = 'Registro ilegible';
    component.review();
    const request = http.expectOne('/api/v1/admin/vehicles/vehicle-1/review');
    expect(request.request.body.decision).toBe('reject');
    request.flush({
      ...detail,
      vehicles: [
        { ...detail.vehicles[0], reviewStatus: 'rejected', reviewReason: 'Registro ilegible' },
      ],
    });
    fixture.detectChanges();
    expect(content()).toContain('Rechazado');
    expect(content()).toContain('Registro ilegible');
    expect(component.detail()?.driver.reviewStatus).toBe('pending');
  });
  it('un conflicto de revisión conserva el motivo y no simula una aprobación', () => {
    const component = fixture.componentInstance;
    component.selectReview('drivers', 'driver-1', 'Ana', 'approve');
    component.reason = 'Revisión válida';
    component.review();
    http
      .expectOne('/api/v1/admin/drivers/driver-1/review')
      .flush(
        { message: 'El expediente cambió. Actualiza y vuelve a revisar.' },
        { status: 409, statusText: 'Conflict' },
      );
    fixture.detectChanges();
    expect(content()).toContain('El expediente cambió');
    expect(component.detail()?.driver.reviewStatus).toBe('pending');
    expect(component.reason).toBe('Revisión válida');
    expect(component.busy()).toBe(false);
    expect(component.success()).toBe('');
  });
  it('oculta decisiones a roles sin autorización incluso si se instancia la pantalla directamente', () => {
    identity.session.update((session) =>
      session ? { ...session, user: { ...session.user, roles: ['operator'] } } : null,
    );
    fixture.detectChanges();
    expect(content()).not.toContain('Aprobar conductor');
    expect(content()).not.toContain('Aprobar vehículo');
    fixture.componentInstance.selectReview('drivers', 'driver-1', 'Ana', 'approve');
    expect(fixture.componentInstance.target()).toBe(null);
  });
  it('obtiene documentos como Blob privados y revoca su acceso temporal al cerrar', () => {
    const create = vi.fn().mockReturnValue('blob:document-test');
    const revoke = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    try {
      fixture.componentInstance.openDocument('document-1', 'licencia.pdf');
      const request = http.expectOne('/api/v1/documents/document-1');
      expect(request.request.responseType).toBe('blob');
      request.flush(new Blob(['test'], { type: 'application/pdf' }));
      fixture.detectChanges();
      expect(content()).toContain('Abrir archivo');
      expect(create).toHaveBeenCalledOnce();
      fixture.componentInstance.closePreview();
      expect(revoke).toHaveBeenCalledWith('blob:document-test');
      expect(fixture.componentInstance.preview()).toBe(null);
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});
