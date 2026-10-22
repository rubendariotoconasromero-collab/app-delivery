import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { AppConfig } from '../config/app-config';
import {
  csrfToken,
  decryptTotp,
  otpHash,
  tokenHash,
  verifyPassword,
  verifyTotp,
} from './auth.crypto';
import { AuthRepository } from './auth.repository';
import {
  AuthenticatedUser,
  NewSession,
  OtpRequest,
  PublicUser,
  STAFF_ROLES,
  UserRole,
  UserStatus,
  publicUser,
} from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    @Inject(AuthRepository) private readonly repository: AuthRepository,
    @Inject(AppConfig) private readonly config: AppConfig,
  ) {}

  private secret(): string {
    const secret = this.config.values.AUTH_SECRET;
    if (!secret || Buffer.from(secret, 'base64url').length < 32)
      throw new ServiceUnavailableException(
        'Configura AUTH_SECRET para habilitar la autenticación.',
      );
    return secret;
  }

  private async persistent<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'No se pudo acceder al servicio de identidad. Intenta nuevamente.',
      );
    }
  }

  private makeSession(kind: 'mobile' | 'admin'): NewSession & { token: string } {
    const token = randomBytes(32).toString('base64url');
    return {
      id: randomUUID(),
      kind,
      token,
      tokenHash: tokenHash(token),
      expiresAt: new Date(Date.now() + (kind === 'mobile' ? 7 * 24 : 12) * 3_600_000),
    };
  }

  async requestOtp(request: OtpRequest, ip: string) {
    const secret = this.secret();
    if (
      this.config.values.AUTH_OTP_DELIVERY !== 'development' ||
      this.config.values.NODE_ENV === 'production'
    )
      throw new ServiceUnavailableException(
        'La verificación por teléfono requiere configurar un proveedor de SMS.',
      );
    const id = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const created = await this.persistent(() =>
      this.repository.createChallenge(
        {
          ...request,
          id,
          codeHash: otpHash(secret, id, code),
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 300_000),
          attempts: 0,
          consumedAt: null,
        },
        `otp-request-ip:${tokenHash(ip)}`,
      ),
    );
    if (!created)
      throw new HttpException(
        'Espera antes de solicitar otro código. Límite de solicitudes alcanzado.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    return { challengeId: id, expiresIn: 300, retryAfter: 60, developmentCode: code };
  }

  async verifyOtp(id: string, code: string, ip: string) {
    const secret = this.secret();
    const allowed = await this.persistent(() =>
      this.repository.rateLimit(`otp-verify-ip:${tokenHash(ip)}`, 60, 900),
    );
    if (!allowed)
      throw new HttpException(
        'Demasiados intentos. Intenta más tarde.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const session = this.makeSession('mobile');
    const result = await this.persistent(() =>
      this.repository.completeOtp(id, otpHash(secret, id, code), session),
    );
    if ('error' in result)
      throw new UnauthorizedException(
        'Código inválido, vencido o cuenta no habilitada para esta modalidad.',
      );
    return {
      accessToken: session.token,
      expiresAt: session.expiresAt.toISOString(),
      user: result.user,
    };
  }

  async authenticate(token: string): Promise<AuthenticatedUser> {
    this.secret();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException('Sesión inválida o vencida.');
    const user = await this.persistent(() => this.repository.sessionByHash(tokenHash(token)));
    if (!user) throw new UnauthorizedException('Sesión inválida o vencida.');
    return user;
  }

  sessionInfo(user: AuthenticatedUser) {
    return {
      user: publicUser(user),
      expiresAt: user.sessionExpiresAt.toISOString(),
      ...(user.sessionKind === 'admin' ? { csrfToken: this.csrf(user) } : {}),
    };
  }

  csrf(user: AuthenticatedUser): string {
    return csrfToken(this.secret(), user.sessionId);
  }

  async logout(user: AuthenticatedUser): Promise<void> {
    await this.persistent(() => this.repository.revokeSession(user.sessionId));
  }

  async loginAdmin(email: string, password: string, totp: string, ip: string) {
    const secret = this.secret();
    for (const key of [`staff-email:${tokenHash(email)}`, `staff-ip:${tokenHash(ip)}`]) {
      const allowed = await this.persistent(() => this.repository.rateLimit(key, 10, 900));
      if (!allowed)
        throw new HttpException(
          'Demasiados intentos. Intenta más tarde.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
    }
    const credentials = await this.persistent(() => this.repository.credentialsByEmail(email));
    const passwordOk = await verifyPassword(password, credentials?.passwordHash ?? null);
    let step: number | null = null;
    if (credentials?.totpSecretCipher) {
      try {
        step = verifyTotp(decryptTotp(secret, credentials.totpSecretCipher), totp, new Date());
      } catch {
        // An unusable MFA enrollment fails closed without exposing the ciphertext.
      }
    }
    if (
      !passwordOk ||
      !credentials ||
      step === null ||
      credentials.status !== 'active' ||
      !credentials.roles.some((role) => STAFF_ROLES.includes(role))
    )
      throw new UnauthorizedException('Credenciales o código de autenticación inválidos.');
    const session = this.makeSession('admin');
    const user = await this.persistent(() =>
      this.repository.createAdminSession(credentials, step, session),
    );
    if (!user) throw new UnauthorizedException('Credenciales o código de autenticación inválidos.');
    return {
      token: session.token,
      user,
      expiresAt: session.expiresAt.toISOString(),
      csrfToken: csrfToken(secret, session.id),
    };
  }

  async listUsers(limit: number, offset: number) {
    return {
      ...(await this.persistent(() => this.repository.listUsers(limit, offset))),
      limit,
      offset,
    };
  }

  async updateUser(
    actor: AuthenticatedUser,
    id: string,
    change: { roles?: UserRole[]; status?: UserStatus },
  ): Promise<PublicUser> {
    if (actor.sessionKind !== 'admin' || !actor.roles.includes('admin'))
      throw new ForbiddenException();
    const result = await this.persistent(() => this.repository.updateUser(actor, id, change));
    if (!result) throw new NotFoundException('Usuario no encontrado.');
    return result;
  }
}
