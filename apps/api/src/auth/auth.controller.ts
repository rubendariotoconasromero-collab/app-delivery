import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { AppConfig } from '../config/app-config';
import { CurrentUser, Public, Roles, ExistingTripAccess } from './auth.decorators';
import { AuthRequest } from './auth.guard';
import { AuthService } from './auth.service';
import { AuthenticatedUser } from './auth.types';
import {
  adminLoginSchema,
  paginationSchema,
  requestOtpSchema,
  userChangeSchema,
  validate,
  verifyOtpSchema,
} from './auth.validation';

interface CookieResponse {
  setHeader(name: string, value: string): void;
}
const userSchema = {
  type: 'object' as const,
  required: ['id', 'displayName', 'phone', 'email', 'roles', 'status'],
  properties: {
    id: { type: 'string' as const, format: 'uuid' },
    displayName: { type: 'string' as const },
    phone: { type: 'string' as const, nullable: true },
    email: { type: 'string' as const, nullable: true },
    roles: {
      type: 'array' as const,
      items: {
        type: 'string' as const,
        enum: ['client', 'driver', 'operator', 'finance', 'admin'],
      },
    },
    status: { type: 'string' as const, enum: ['active', 'suspended'] },
  },
};
const ipOf = (request: AuthRequest) => request.ip ?? request.socket?.remoteAddress ?? 'unknown';

@ApiTags('Identity')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AppConfig) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('otp/request')
  @Header('Cache-Control', 'no-store')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Request a phone OTP, explicitly bound to role and purpose; development only until SMS integration',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['phone', 'purpose', 'role'],
      additionalProperties: false,
      properties: {
        phone: { type: 'string', example: '+59170000000' },
        purpose: { type: 'string', enum: ['register', 'login', 'recover'] },
        role: { type: 'string', enum: ['client', 'driver'] },
        displayName: { type: 'string', description: 'Required for registration' },
      },
    },
  })
  @ApiResponse({
    status: 202,
    schema: {
      type: 'object',
      properties: {
        challengeId: { type: 'string', format: 'uuid' },
        expiresIn: { type: 'integer', example: 300 },
        retryAfter: { type: 'integer', example: 60 },
        developmentCode: {
          type: 'string',
          description: 'Only explicit development delivery, never production',
        },
      },
    },
  })
  requestOtp(@Body() body: unknown, @Req() request: AuthRequest) {
    return this.auth.requestOtp(validate(requestOtpSchema, body), ipOf(request));
  }

  @Public()
  @Post('otp/verify')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['challengeId', 'code'],
      additionalProperties: false,
      properties: {
        challengeId: { type: 'string', format: 'uuid' },
        code: { type: 'string', pattern: '^\\d{6}$' },
      },
    },
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        accessToken: { type: 'string' },
        expiresAt: { type: 'string', format: 'date-time' },
        user: userSchema,
      },
    },
  })
  verifyOtp(@Body() body: unknown, @Req() request: AuthRequest) {
    const value = validate(verifyOtpSchema, body);
    return this.auth.verifyOtp(value.challengeId, value.code, ipOf(request));
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  @ApiBearerAuth()
  @ApiCookieAuth()
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        user: userSchema,
        expiresAt: { type: 'string', format: 'date-time' },
        csrfToken: { type: 'string' },
      },
    },
  })
  @ExistingTripAccess()
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.sessionInfo(user);
  }

  @Post('logout')
  @ExistingTripAccess()
  @Header('Cache-Control', 'no-store')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Revoke the current session; cookie sessions require X-CSRF-Token' })
  @ApiResponse({ status: 204 })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    await this.auth.logout(user);
    if (user.sessionKind === 'admin') response.setHeader('Set-Cookie', this.cookie('', 0));
  }

  @Public()
  @Post('admin/login')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'password', 'totp'],
      additionalProperties: false,
      properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string', format: 'password' },
        totp: { type: 'string', pattern: '^\\d{6}$' },
      },
    },
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        user: userSchema,
        expiresAt: { type: 'string', format: 'date-time' },
        csrfToken: { type: 'string' },
      },
    },
  })
  async adminLogin(
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const origin = request.headers.origin;
    if (
      origin !== undefined &&
      (typeof origin !== 'string' || !this.config.values.CORS_ORIGINS.includes(origin))
    )
      throw new ForbiddenException('Origen no autorizado para iniciar sesión en el panel.');
    const value = validate(adminLoginSchema, body);
    const result = await this.auth.loginAdmin(
      value.email,
      value.password,
      value.totp,
      ipOf(request),
    );
    response.setHeader('Set-Cookie', this.cookie(result.token, 12 * 3600));
    return { user: result.user, expiresAt: result.expiresAt, csrfToken: result.csrfToken };
  }

  private cookie(value: string, maxAge: number): string {
    return `${this.config.values.AUTH_ADMIN_COOKIE_NAME}=${value}; Path=/api/v1; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${this.config.values.NODE_ENV === 'production' ? '; Secure' : ''}`;
  }
}

@ApiTags('User administration')
@ApiCookieAuth()
@Roles('admin')
@Controller('admin/users')
export class AdminUsersController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiQuery({ name: 'limit', required: false, type: Number, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: { type: 'array', items: userSchema },
        total: { type: 'integer' },
        limit: { type: 'integer' },
        offset: { type: 'integer' },
      },
    },
  })
  list(@Query() query: unknown) {
    const value = validate(paginationSchema, query);
    return this.auth.listUsers(value.limit, value.offset);
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary:
      'Change roles/status with immediate permission effects; requires CSRF, preserves last administrator',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        roles: {
          type: 'array',
          minItems: 1,
          uniqueItems: true,
          items: { type: 'string', enum: ['client', 'driver', 'operator', 'finance', 'admin'] },
        },
        status: { type: 'string', enum: ['active', 'suspended'] },
      },
    },
  })
  @ApiOkResponse({ schema: userSchema })
  update(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    return this.auth.updateUser(actor, validate(z.uuid(), id), validate(userChangeSchema, body));
  }
}
