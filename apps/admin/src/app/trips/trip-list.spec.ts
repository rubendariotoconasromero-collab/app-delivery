import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TripList } from './trip-list';

describe('Listado de viajes', () => {
  let fixture: ComponentFixture<TripList>;
  let http: HttpTestingController;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TripList],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TripList);
    fixture.detectChanges();
  });
  afterEach(() => {
    fixture.destroy();
    http.verify();
  });
  it('filtra por estado en el servidor y reinicia la página cuando cambia el filtro', () => {
    const initial = http.expectOne(
      (request) =>
        request.url === '/api/v1/admin/trips' &&
        request.params.get('state') === 'searching' &&
        request.params.get('offset') === '0',
    );
    expect(initial.request.params.get('limit')).toBe('50');
    initial.flush({ items: [], total: 75, offset: 0, limit: 50 });
    fixture.componentInstance.page(1);
    http
      .expectOne(
        (request) => request.url === '/api/v1/admin/trips' && request.params.get('offset') === '50',
      )
      .flush({ items: [], total: 75, offset: 50, limit: 50 });
    fixture.componentInstance.filter('completed');
    http
      .expectOne(
        (request) =>
          request.url === '/api/v1/admin/trips' &&
          request.params.get('state') === 'completed' &&
          request.params.get('offset') === '0',
      )
      .flush({ items: [], total: 0, offset: 0, limit: 50 });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No hay viajes con este filtro');
    expect(fixture.componentInstance.offset()).toBe(0);
  });
  it('conserva la hora de la última respuesta confirmada cuando falla una actualización', () => {
    http
      .expectOne((request) => request.url === '/api/v1/admin/trips')
      .flush({ items: [], total: 0, offset: 0, limit: 50 });
    const confirmedAt = fixture.componentInstance.checkedAt();
    fixture.componentInstance.load();
    http
      .expectOne((request) => request.url === '/api/v1/admin/trips')
      .error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(fixture.componentInstance.checkedAt()).toBe(confirmedAt);
    expect(fixture.nativeElement.textContent).toContain(
      'Los datos anteriores pueden haber cambiado',
    );
  });
});
