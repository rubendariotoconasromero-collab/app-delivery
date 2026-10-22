import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Role, User } from './identity';

export type ReviewStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'suspended';
export type Decision = 'approve' | 'reject' | 'suspend';
export const statusNames: Record<ReviewStatus, string> = {
  draft: 'Borrador',
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  suspended: 'Suspendido',
};
export interface Driver {
  id: string;
  displayName: string;
  fullName: string | null;
  phone: string;
  reviewStatus: ReviewStatus;
  reviewReason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  activeVehicleId: string | null;
  eligible: boolean;
}
export interface Vehicle {
  id: string;
  driverId: string;
  plate: string;
  make: string;
  model: string;
  year: number;
  capacityPassengers: number;
  serviceTypes: ('passengers' | 'parcels')[];
  reviewStatus: ReviewStatus;
  reviewReason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  active: boolean;
}
export interface PrivateDocument {
  id: string;
  kind: string;
  originalName: string;
  mimeType: string;
  size: number;
  expiresOn: string | null;
  createdAt: string;
  vehicleId: string | null;
}
export interface AuditEntry {
  id: string;
  actorId: string;
  action: string;
  reason: string;
  createdAt: string;
  targetType: string;
  targetId: string;
}
export interface DriverDetail {
  driver: Driver;
  vehicles: Vehicle[];
  documents: PrivateDocument[];
  audit: AuditEntry[];
}
export const documentNames: Record<string, string> = {
  identity_document: 'Documento de identidad',
  driver_license: 'Licencia de conducir',
  vehicle_registration: 'Documento del vehículo',
};

@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);
  drivers(status: string, offset = 0) {
    let params = new HttpParams().set('limit', 50).set('offset', offset);
    if (status) params = params.set('status', status);
    return this.http.get<{ items: Driver[] }>('/api/v1/admin/drivers', { params, timeout: 15000 });
  }
  driver(id: string) {
    return this.http.get<DriverDetail>(`/api/v1/admin/drivers/${encodeURIComponent(id)}`, {
      timeout: 15000,
    });
  }
  review(type: 'drivers' | 'vehicles', id: string, decision: Decision, reason: string) {
    return this.http.post<DriverDetail>(
      `/api/v1/admin/${type}/${encodeURIComponent(id)}/review`,
      {
        decision,
        reason: reason.trim(),
      },
      { timeout: 15000 },
    );
  }
  document(id: string) {
    return this.http.get(`/api/v1/documents/${encodeURIComponent(id)}`, {
      responseType: 'blob',
      timeout: 30000,
    });
  }
  users(offset = 0) {
    return this.http.get<{ items: User[] }>('/api/v1/admin/users', {
      params: { limit: 50, offset },
      timeout: 15000,
    });
  }
  updateUser(id: string, roles: Role[], status: User['status']) {
    return this.http.patch<User>(
      `/api/v1/admin/users/${encodeURIComponent(id)}`,
      {
        roles,
        status,
      },
      { timeout: 15000 },
    );
  }
}
