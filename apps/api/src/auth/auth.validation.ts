import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { USER_ROLES } from './auth.types';

export const requestOtpSchema = z
  .object({
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
    purpose: z.enum(['register', 'login', 'recover']),
    role: z.enum(['client', 'driver']),
    displayName: z.string().trim().min(2).max(100).optional(),
  })
  .strict()
  .refine((value) => value.purpose !== 'register' || Boolean(value.displayName), {
    message: 'displayName es obligatorio al registrar.',
  });
export const verifyOtpSchema = z
  .object({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) })
  .strict();
export const adminLoginSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    password: z.string().min(1).max(1024),
    totp: z.string().regex(/^\d{6}$/),
  })
  .strict();
export const userChangeSchema = z
  .object({
    roles: z
      .array(z.enum(USER_ROLES))
      .min(1)
      .max(5)
      .refine((roles) => new Set(roles).size === roles.length)
      .optional(),
    status: z.enum(['active', 'suspended']).optional(),
  })
  .strict()
  .refine((value) => value.roles !== undefined || value.status !== undefined);
export const paginationSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict();

export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException('Datos inválidos. Revisa los campos requeridos y su formato.');
  return result.data;
}
