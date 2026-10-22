import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { Login } from './login';

describe('Acceso del personal', () => {
  it('presenta errores reales y borra la contraseña y el TOTP después del intento', async () => {
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Login);
    const component = fixture.componentInstance;
    const http = TestBed.inject(HttpTestingController);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    component.form.setValue({
      email: 'admin@example.test',
      password: 'bad password',
      totp: '123456',
    });
    component.submit();
    http
      .expectOne('/api/v1/auth/admin/login')
      .flush(
        { message: 'Credenciales o código inválidos' },
        { status: 401, statusText: 'Unauthorized' },
      );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Credenciales o código inválidos');
    expect(component.form.controls.password.value).toBe('');
    expect(component.form.controls.totp.value).toBe('');
    expect(navigate).not.toHaveBeenCalled();
    expect(component.busy()).toBe(false);
    http.verify();
    fixture.destroy();
  });
});
