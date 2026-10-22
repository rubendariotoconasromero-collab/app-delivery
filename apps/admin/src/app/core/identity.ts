import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, finalize, map, Observable, of, shareReplay, tap, throwError } from 'rxjs';

export type Role = 'client' | 'driver' | 'operator' | 'finance' | 'admin';
export interface User {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  roles: Role[];
  status: 'active' | 'suspended';
}
export interface Session {
  user: User;
  expiresAt: string;
  csrfToken?: string;
}
export const roleNames: Record<Role, string> = {
  client: 'Cliente',
  driver: 'Conductor',
  operator: 'Operaciones',
  finance: 'Finanzas',
  admin: 'Administrador',
};
export function apiError(error: unknown): string {
  if (!(error instanceof HttpErrorResponse))
    return error instanceof Error ? error.message : 'No se pudo completar la operación.';
  if (error.status === 0)
    return 'No se pudo conectar con el backend. Revisa la conexión y vuelve a intentar.';
  const message: unknown = error.error?.message;
  if (Array.isArray(message)) return message.filter((item) => typeof item === 'string').join(' · ');
  if (typeof message === 'string') return message;
  if (error.status === 403) return 'Tu cuenta no tiene permiso para realizar esta acción.';
  if (error.status === 401) return 'La sesión expiró. Vuelve a iniciar sesión.';
  return `No se pudo completar la operación (HTTP ${error.status}).`;
}

@Injectable({ providedIn: 'root' })
export class Identity {
  private readonly http = inject(HttpClient);
  readonly session = signal<Session | null>(null);
  readonly restored = signal(false);
  readonly user = computed(() => this.session()?.user ?? null);
  readonly staff = computed(
    () => this.hasRole('operator', 'finance', 'admin') && !!this.session()?.csrfToken,
  );
  readonly admin = computed(() => this.staff() && this.hasRole('admin'));
  private restoring?: Observable<Session | null>;

  hasRole(...roles: Role[]): boolean {
    return (
      this.user()?.status === 'active' && roles.some((role) => this.user()?.roles.includes(role))
    );
  }

  restore(): Observable<Session | null> {
    if (this.restored()) return of(this.session());
    if (!this.restoring) {
      this.restoring = this.http
        .get<Session>('/api/v1/auth/me', { withCredentials: true, timeout: 15000 })
        .pipe(
          tap((session) => {
            this.session.set(session);
            this.restored.set(true);
          }),
          catchError((error: unknown) => {
            if (error instanceof HttpErrorResponse && error.status === 401) {
              this.clear();
              return of(null);
            }
            return throwError(() => error);
          }),
          finalize(() => {
            this.restoring = undefined;
          }),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
    }
    return this.restoring;
  }

  login(email: string, password: string, totp: string): Observable<Session> {
    return this.http
      .post<Session>(
        '/api/v1/auth/admin/login',
        { email: email.trim(), password, totp: totp.trim() },
        { withCredentials: true, timeout: 15000 },
      )
      .pipe(
        map((session) => {
          if (
            !session.csrfToken ||
            session.user.status !== 'active' ||
            !session.user.roles.some((role) => ['operator', 'finance', 'admin'].includes(role))
          ) {
            throw new Error('Esta cuenta no tiene acceso al panel del personal.');
          }
          this.session.set(session);
          this.restored.set(true);
          return session;
        }),
      );
  }

  logout(): Observable<void> {
    return this.http
      .post<void>('/api/v1/auth/logout', {}, { withCredentials: true, timeout: 15000 })
      .pipe(tap(() => this.clear()));
  }

  clear(): void {
    this.session.set(null);
    this.restored.set(true);
  }
}
