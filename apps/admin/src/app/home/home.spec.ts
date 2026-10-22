import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Home } from './home';
import { PlatformInfo, Readiness } from '../core/platform-status';

const info: PlatformInfo = {
  name: 'AppDelivery',
  environment: 'development',
  market: {
    country: 'BO',
    city: 'Santa Cruz de la Sierra',
    currency: 'BOB',
    currencySymbol: 'Bs',
    timeZone: 'America/La_Paz',
  },
  services: ['passengers', 'parcels'],
};
const healthy: Readiness = {
  status: 'ok',
  dependencies: { postgres: { status: 'up' }, postgis: { status: 'up' }, redis: { status: 'up' } },
};

describe('Inicio del panel', () => {
  let fixture: ComponentFixture<Home>;
  let http: HttpTestingController;
  const content = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('muestra datos reales de la API y confirma todas las dependencias', () => {
    expect(content()).toContain('Consultando el backend');
    http.expectOne('/api/v1/info').flush(info);
    http.expectOne('/api/v1/health/ready').flush(healthy);
    fixture.detectChanges();

    expect(content()).toContain('La plataforma está lista');
    expect(content()).toContain('AppDelivery · development');
    expect(content()).toContain('America/La_Paz');
    expect(fixture.nativeElement.querySelectorAll('.dependency-state.up')).toHaveLength(3);
    expect(fixture.nativeElement.querySelector('button').disabled).toBe(false);
  });

  it('conserva el diagnóstico de HTTP 503 sin presentar el sistema como listo', () => {
    http.expectOne('/api/v1/info').flush(info);
    http.expectOne('/api/v1/health/ready').flush(
      {
        ...healthy,
        status: 'degraded',
        dependencies: { ...healthy.dependencies, redis: { status: 'down' } },
      },
      { status: 503, statusText: 'Service Unavailable' },
    );
    fixture.detectChanges();

    expect(content()).toContain('HTTP 503');
    expect(content()).toContain('La plataforma requiere atención');
    expect(content()).toContain('No disponible');
    expect(fixture.nativeElement.querySelectorAll('.dependency-state.up')).toHaveLength(2);
    expect(content()).not.toContain('La plataforma está lista');
  });

  it('informa backend desconectado sin inventar respuesta del servidor y permite reintentar', () => {
    http.expectOne('/api/v1/info').error(new ProgressEvent('error'));
    http.expectOne('/api/v1/health/ready').error(new ProgressEvent('error'));
    fixture.detectChanges();

    expect(content()).toContain('No se pudo conectar con el backend.');
    expect(content()).toContain('Sin verificar');
    expect(content()).not.toContain('Respuesta del servidor');
    expect(content()).not.toContain('La plataforma está lista');

    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button').disabled).toBe(true);
    http.expectOne('/api/v1/info').flush(info);
    http.expectOne('/api/v1/health/ready').flush(healthy);
    fixture.detectChanges();
    expect(content()).toContain('La plataforma está lista');
  });
});
