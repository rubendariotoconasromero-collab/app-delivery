import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { firstValueFrom, Observable } from 'rxjs';
import { adminGuard, operationsGuard, staffGuard } from './auth-guards';
import { authHttp } from './auth-http';
import { Identity, Session } from './identity';
import { pendingTripAction, savePendingTripAction } from './pending-trip-actions';

const admin: Session = {
  user: {
    id: 'staff-1',
    displayName: 'Administración',
    phone: null,
    email: 'admin@example.test',
    roles: ['admin'],
    status: 'active',
  },
  expiresAt: '2030-01-01T00:00:00Z',
  csrfToken: 'csrf-in-memory',
};

describe('Identidad y protección del panel', () => {
  let identity: Identity;
  let http: HttpTestingController;
  let client: HttpClient;
  let router: Router;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authHttp])),
        provideHttpClientTesting(),
      ],
    });
    identity = TestBed.inject(Identity);
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
    router = TestBed.inject(Router);
  });
  afterEach(() => http.verify());
  it('restaura una única sesión concurrente desde la cookie sin token persistido en el navegador', () => {
    const restored: Session[] = [];
    identity.restore().subscribe((session) => {
      if (session) restored.push(session);
    });
    identity.restore().subscribe((session) => {
      if (session) restored.push(session);
    });
    const request = http.expectOne('/api/v1/auth/me');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush(admin);
    expect(restored).toEqual([admin, admin]);
    expect(identity.admin()).toBe(true);
    identity.restore().subscribe();
    http.expectNone('/api/v1/auth/me');
  });
  it('envía CSRF solo en mutaciones a la API y no filtra la sesión a otras URL', () => {
    identity.session.set(admin);
    client
      .post('/api/v1/admin/drivers/id/review', { decision: 'approve', reason: 'Revisado' })
      .subscribe();
    const review = http.expectOne('/api/v1/admin/drivers/id/review');
    expect(review.request.headers.get('X-CSRF-Token')).toBe(admin.csrfToken);
    expect(review.request.withCredentials).toBe(true);
    review.flush({});
    client.get('/api/v1/admin/users').subscribe();
    const get = http.expectOne('/api/v1/admin/users');
    expect(get.request.headers.has('X-CSRF-Token')).toBe(false);
    get.flush({ items: [] });
    client.post('https://other.example.test/endpoint', {}).subscribe();
    const other = http.expectOne('https://other.example.test/endpoint');
    expect(other.request.withCredentials).toBe(false);
    expect(other.request.headers.has('X-CSRF-Token')).toBe(false);
    other.flush({});
  });
  it('un 401 borra identidad y redirige al acceso sin convertir el error en éxito', () => {
    identity.session.set(admin);
    savePendingTripAction({
      actorId: admin.user.id,
      tripId: 'trip-1',
      operation: 'cancel',
      reason: 'Solicitud del cliente',
      idempotencyKey: '7c3c3edb-a575-4d7b-a6ae-b42c32f1e1d6',
    });
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const failure = vi.fn();
    client.get('/api/v1/admin/users').subscribe({ error: failure });
    http
      .expectOne('/api/v1/admin/users')
      .flush({ message: 'Session expired' }, { status: 401, statusText: 'Unauthorized' });
    expect(identity.user()).toBe(null);
    expect(pendingTripAction(admin.user.id, 'trip-1', 'cancel')).toBeNull();
    expect(failure).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { expired: '1', returnUrl: '/' },
    });
  });
  it('una sesión ausente es anónima y un fallo de red permite volver a consultar', () => {
    identity.restore().subscribe({ error: () => undefined });
    http.expectOne('/api/v1/auth/me').error(new ProgressEvent('error'));
    expect(identity.restored()).toBe(false);
    const restored = vi.fn();
    identity.restore().subscribe(restored);
    http.expectOne('/api/v1/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(restored).toHaveBeenCalledWith(null);
    expect(identity.restored()).toBe(true);
  });
  it('inicia y cierra sesión mediante backend sin almacenar contraseña o TOTP en el estado', () => {
    identity.login(' admin@example.test ', 'secret password', '123456').subscribe();
    const login = http.expectOne('/api/v1/auth/admin/login');
    expect(login.request.body).toEqual({
      email: 'admin@example.test',
      password: 'secret password',
      totp: '123456',
    });
    login.flush(admin);
    expect(identity.session()).toEqual(admin);
    identity.logout().subscribe();
    const logout = http.expectOne('/api/v1/auth/logout');
    expect(logout.request.headers.get('X-CSRF-Token')).toBe(admin.csrfToken);
    logout.flush(null, { status: 204, statusText: 'No Content' });
    expect(identity.user()).toBe(null);
  });
  it('credenciales incorrectas no se confunden con expiración de una sesión del panel', () => {
    const navigate = vi.spyOn(router, 'navigate');
    const failure = vi.fn();
    identity.login('wrong@example.test', 'wrong', '000000').subscribe({ error: failure });
    http
      .expectOne('/api/v1/auth/admin/login')
      .flush({ message: 'Credenciales inválidas' }, { status: 401, statusText: 'Unauthorized' });
    expect(failure).toHaveBeenCalledOnce();
    expect(identity.user()).toBe(null);
    expect(navigate).not.toHaveBeenCalled();
  });
  async function guard(kind: 'staff' | 'admin' | 'operations') {
    const result = TestBed.runInInjectionContext(() =>
      (kind === 'staff' ? staffGuard : kind === 'operations' ? operationsGuard : adminGuard)(
        {} as ActivatedRouteSnapshot,
        { url: '/conductores' } as RouterStateSnapshot,
      ),
    );
    return firstValueFrom(result as Observable<boolean | UrlTree>);
  }
  it('impide abrir el panel sin sesión y conserva el destino para después del login', async () => {
    identity.clear();
    const result = await guard('staff');
    expect(router.serializeUrl(result as UrlTree)).toBe('/login?returnUrl=%2Fconductores');
  });
  it('permite inicio al operador pero reserva la revisión al administrador con MFA', async () => {
    identity.restored.set(true);
    identity.session.set({ ...admin, user: { ...admin.user, roles: ['operator'] } });
    expect(await guard('staff')).toBe(true);
    expect(router.serializeUrl((await guard('admin')) as UrlTree)).toBe('/sin-permiso');
    identity.session.set(admin);
    expect(await guard('admin')).toBe(true);
  });
  it('un rol admin en una sesión móvil o una cuenta suspendida no habilita el panel', async () => {
    identity.restored.set(true);
    identity.session.set({ ...admin, csrfToken: undefined });
    expect(router.serializeUrl((await guard('staff')) as UrlTree)).toBe('/sin-permiso');
    identity.session.set({ ...admin, user: { ...admin.user, status: 'suspended' } });
    expect(router.serializeUrl((await guard('admin')) as UrlTree)).toBe('/sin-permiso');
  });
  it('reserva la operación de viajes al administrador y al operador con sesión del personal', async () => {
    identity.restored.set(true);
    for (const role of ['admin', 'operator'] as const) {
      identity.session.set({ ...admin, user: { ...admin.user, roles: [role] } });
      expect(await guard('operations')).toBe(true);
    }
    identity.session.set({ ...admin, user: { ...admin.user, roles: ['finance'] } });
    expect(router.serializeUrl((await guard('operations')) as UrlTree)).toBe('/sin-permiso');
    identity.session.set({ ...admin, csrfToken: undefined });
    expect(router.serializeUrl((await guard('operations')) as UrlTree)).toBe('/sin-permiso');
  });
});
