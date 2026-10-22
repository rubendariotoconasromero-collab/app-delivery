import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { filter, firstValueFrom } from 'rxjs';
import { routes } from './app.routes';
import { authHttp } from './core/auth-http';
import { Identity } from './core/identity';

describe('Navegación real entre conductores y expediente', () => {
  it('abre el expediente al hacer clic en el enlace del listado sin recargar el documento', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideHttpClient(withInterceptors([authHttp])),
        provideHttpClientTesting(),
      ],
    });
    const identity = TestBed.inject(Identity);
    identity.session.set({
      user: {
        id: 'staff',
        displayName: 'Admin',
        phone: null,
        email: 'admin@example.test',
        roles: ['admin'],
        status: 'active',
      },
      expiresAt: '2030-01-01T00:00:00Z',
      csrfToken: 'csrf',
    });
    identity.restored.set(true);
    const http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create('/conductores');
    const driver = {
      id: 'bfb58ea0-197d-418c-ab85-1dc64c14e73e',
      displayName: 'Ana',
      fullName: 'Ana Pérez',
      phone: '+59170000000',
      reviewStatus: 'pending',
      reviewReason: null,
      submittedAt: null,
      reviewedAt: null,
      activeVehicleId: null,
      eligible: false,
    };
    http.expectOne((request) => request.url === '/api/v1/admin/drivers').flush({ items: [driver] });
    harness.detectChanges();
    const anchor = harness.routeNativeElement?.querySelector<HTMLAnchorElement>(
      `a[href='/conductores/${driver.id}']`,
    );
    expect(anchor).not.toBeNull();
    const router = TestBed.inject(Router);
    const navigation = firstValueFrom(
      router.events.pipe(filter((event) => event instanceof NavigationEnd)),
    );
    anchor?.click();
    await navigation;
    expect(router.url).toBe(`/conductores/${driver.id}`);
    harness.detectChanges();
    http
      .expectOne(`/api/v1/admin/drivers/${driver.id}`)
      .flush({ driver, vehicles: [], documents: [], audit: [] });
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain(
      'Revisión del conductor y sus vehículos',
    );
    expect(harness.routeNativeElement?.textContent).toContain('Ana Pérez');
    http.verify();
  });
});
