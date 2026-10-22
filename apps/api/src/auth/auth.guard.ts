import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppConfig } from '../config/app-config';
import { safeEqual } from './auth.crypto';
import { EXISTING_TRIP_ACCESS, PUBLIC_ROUTE, REQUIRED_ROLES } from './auth.decorators';
import { AuthService } from './auth.service';
import { AuthenticatedUser, STAFF_ROLES, UserRole } from './auth.types';

export interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  ip?: string;
  socket?: { remoteAddress?: string };
  user?: AuthenticatedUser;
}

function header(request: AuthRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AppConfig) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const authorization = header(request, 'authorization');
    let token: string | undefined;
    let source: 'mobile' | 'admin';
    if (authorization) {
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
      if (!match) throw new UnauthorizedException('Sesión inválida.');
      token = match[1];
      source = 'mobile';
    } else {
      source = 'admin';
      const name = this.config.values.AUTH_ADMIN_COOKIE_NAME;
      const matches = (header(request, 'cookie') ?? '')
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part.startsWith(`${name}=`));
      if (matches.length === 1) token = matches[0]!.slice(name.length + 1);
    }
    if (!token) throw new UnauthorizedException('Inicia sesión para continuar.');
    const existingTrip =
      this.reflector.getAllAndOverride<boolean>(EXISTING_TRIP_ACCESS, [
        context.getHandler(),
        context.getClass(),
      ]) === true;
    const user = await this.auth.authenticate(token, true);
    if (user.sessionKind !== source || (source === 'admin' && !user.mfaVerified))
      throw new UnauthorizedException('Tipo de sesión inválido.');
    if (user.restricted && !existingTrip)
      throw new ForbiddenException(
        'La cuenta tiene acceso limitado al servicio existente. Inicia una nueva sesión después de su reactivación.',
      );
    if (source === 'admin' && !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) {
      const csrf = header(request, 'x-csrf-token');
      if (!csrf || !safeEqual(this.auth.csrf(user), csrf))
        throw new ForbiddenException('Token CSRF inválido.');
    }
    const roles = this.reflector.getAllAndOverride<UserRole[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles?.length) {
      if (!roles.some((role) => user.roles.includes(role)))
        throw new ForbiddenException('No tienes permiso para esta acción.');
      if (
        roles.some((role) => STAFF_ROLES.includes(role)) &&
        (source !== 'admin' || !user.mfaVerified)
      )
        throw new ForbiddenException('Esta acción requiere una sesión del panel con MFA.');
    }
    request.user = user;
    return true;
  }
}
