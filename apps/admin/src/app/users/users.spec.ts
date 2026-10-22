import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Identity, User } from '../core/identity';
import { Users } from './users';

const user: User = {
  id: 'user-1',
  displayName: 'Claudia',
  phone: '+59170000001',
  email: null,
  roles: ['client'],
  status: 'active',
};
describe('Administración de usuarios', () => {
  let fixture: ComponentFixture<Users>;
  let http: HttpTestingController;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Users],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Identity).session.set({
      user: { ...user, id: 'admin-1', roles: ['admin'] },
      expiresAt: '2030-01-01T00:00:00Z',
      csrfToken: 'csrf',
    });
    fixture = TestBed.createComponent(Users);
    fixture.detectChanges();
    const list = http.expectOne((request) => request.url === '/api/v1/admin/users');
    expect(list.request.params.get('limit')).toBe('50');
    expect(list.request.params.get('offset')).toBe('0');
    list.flush({ items: [user] });
    fixture.detectChanges();
  });
  afterEach(() => {
    fixture.destroy();
    http.verify();
  });
  it('guarda cambios efectivos de roles y estado y refleja la respuesta del servidor', () => {
    const component = fixture.componentInstance;
    component.edit(user);
    component.toggle('driver', true);
    component.selectedStatus = 'suspended';
    component.save();
    const request = http.expectOne('/api/v1/admin/users/user-1');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ roles: ['client', 'driver'], status: 'suspended' });
    request.flush({ ...user, roles: ['client', 'driver'], status: 'suspended' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Suspendida');
    expect(fixture.nativeElement.textContent).toContain('Conductor');
    expect(component.editing()).toBe(null);
  });
  it('muestra una denegación y conserva los datos originales para no simular cambios', () => {
    const component = fixture.componentInstance;
    component.edit(user);
    component.selectedStatus = 'suspended';
    component.save();
    http
      .expectOne('/api/v1/admin/users/user-1')
      .flush(
        { message: 'No puedes suspender esta cuenta' },
        { status: 403, statusText: 'Forbidden' },
      );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No puedes suspender esta cuenta');
    expect(component.users()[0].status).toBe('active');
    expect(component.editing()).toEqual(user);
    expect(component.busy()).toBe(false);
  });
});
