import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, forkJoin, of } from 'rxjs';

export interface PlatformInfo {
  name: string;
  environment: string;
  market: {
    country: string;
    city: string;
    currency: string;
    currencySymbol: string;
    timeZone: string;
  };
  services: string[];
}

export type DependencyName = 'postgres' | 'postgis' | 'redis';
export interface Readiness {
  status: 'ok' | 'degraded';
  dependencies: Record<DependencyName, { status: 'up' | 'down' }>;
}

interface RequestResult<T> {
  data: T | null;
  error: string | null;
}

@Injectable({ providedIn: 'root' })
export class PlatformStatus {
  private readonly http = inject(HttpClient);
  readonly loading = signal(false);
  readonly info = signal<PlatformInfo | null>(null);
  readonly readiness = signal<Readiness | null>(null);
  readonly infoError = signal<string | null>(null);
  readonly readinessError = signal<string | null>(null);
  readonly checkedAt = signal<Date | null>(null);
  readonly connected = computed(
    () => this.info() !== null && this.readiness()?.status === 'ok' && !this.readinessError(),
  );

  refresh(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.info.set(null);
    this.readiness.set(null);
    this.infoError.set(null);
    this.readinessError.set(null);

    forkJoin({
      info: this.http
        .get<PlatformInfo>('/api/v1/info', { timeout: 8000 })
        .pipe(catchError((error: HttpErrorResponse) => of({ failed: this.describeError(error) }))),
      readiness: this.http
        .get<Readiness>('/api/v1/health/ready', { timeout: 8000 })
        .pipe(
          catchError((error: HttpErrorResponse) =>
            of({ failed: this.describeError(error), readiness: this.degradedReadiness(error) }),
          ),
        ),
    }).subscribe(({ info, readiness }) => {
      const information: RequestResult<PlatformInfo> =
        'failed' in info ? { data: null, error: info.failed } : { data: info, error: null };
      const health: RequestResult<Readiness> =
        'failed' in readiness
          ? { data: readiness.readiness, error: readiness.failed }
          : { data: readiness, error: null };
      this.info.set(information.data);
      this.infoError.set(information.error);
      this.readiness.set(health.data);
      this.readinessError.set(health.error);
      this.checkedAt.set(new Date());
      this.loading.set(false);
    });
  }

  private describeError(error: HttpErrorResponse): string {
    if (error.status === 0) return 'No se pudo conectar con el backend.';
    if (error.status === 503)
      return 'El backend respondió, pero una dependencia no está disponible (HTTP 503).';
    return `La consulta al backend falló (HTTP ${error.status}).`;
  }

  private degradedReadiness(error: HttpErrorResponse): Readiness | null {
    const body: unknown = error.error;
    if (error.status !== 503 || !body || typeof body !== 'object') return null;
    const readiness = body as Readiness;
    return readiness.status === 'degraded' &&
      ['postgres', 'postgis', 'redis'].every((key) =>
        ['up', 'down'].includes(readiness.dependencies?.[key as DependencyName]?.status),
      )
      ? readiness
      : null;
  }
}
