export const USER_ROLES = ['client', 'driver', 'operator', 'finance', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];
export type MobileRole = 'client' | 'driver';
export type UserStatus = 'active' | 'suspended';
export type OtpPurpose = 'register' | 'login' | 'recover';
export const STAFF_ROLES: UserRole[] = ['operator', 'finance', 'admin'];

export interface PublicUser {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  roles: UserRole[];
  status: UserStatus;
}

export interface AuthenticatedUser extends PublicUser {
  sessionId: string;
  sessionKind: 'mobile' | 'admin';
  sessionExpiresAt: Date;
  mfaVerified: boolean;
  restricted?: boolean;
}

export interface OtpRequest {
  phone: string;
  purpose: OtpPurpose;
  role: MobileRole;
  displayName?: string;
}

export interface OtpChallenge extends OtpRequest {
  id: string;
  codeHash: string;
  expiresAt: Date;
  createdAt: Date;
  attempts: number;
  consumedAt: Date | null;
}

export interface NewSession {
  id: string;
  tokenHash: string;
  kind: 'mobile' | 'admin';
  expiresAt: Date;
}

export interface AdminCredentials extends PublicUser {
  passwordHash: string | null;
  totpSecretCipher: string | null;
}

export function publicUser(user: PublicUser): PublicUser {
  return {
    id: user.id,
    displayName: user.displayName,
    phone: user.phone,
    email: user.email,
    roles: [...user.roles],
    status: user.status,
  };
}
