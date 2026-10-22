import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { z } from 'zod';

export const WORKSPACE_ROOT = resolve(__dirname, '../../../..');

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_BIND_HOST: z.string().min(1).default('0.0.0.0'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:4200')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .refine(
      (origins) =>
        origins.length > 0 &&
        origins.every((origin) => {
          try {
            const url = new URL(origin);
            return ['http:', 'https:'].includes(url.protocol) && url.origin === origin;
          } catch {
            return false;
          }
        }),
      'Use a comma-separated list of explicit HTTP(S) origins',
    ),
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => /^postgres(ql)?:\/\//.test(value)),
  REDIS_URL: z
    .string()
    .url()
    .refine((value) => /^rediss?:\/\//.test(value)),
  AUTH_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43,}$/)
    .optional(),
  AUTH_OTP_DELIVERY: z.enum(['disabled', 'development']).default('disabled'),
  AUTH_ADMIN_COOKIE_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,80}$/)
    .default('appdelivery_admin'),
  UPLOAD_DIR: z.string().min(1).default('.cache/uploads'),
  TRIP_DEVELOPMENT_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  TRIP_OSRM_URL: z
    .string()
    .url()
    .default('https://router.project-osrm.org')
    .refine((value) => /^https?:\/\//.test(value)),
  TRIP_MAP_TILE_URL: z
    .string()
    .default('https://tile.openstreetmap.org/{z}/{x}/{y}.png')
    .refine(
      (value) =>
        /^https:\/\//.test(value) && ['{z}', '{x}', '{y}'].every((part) => value.includes(part)),
    ),
  TRIP_COVERAGE_SOUTH: z.coerce.number().min(-90).max(90).default(-17.9),
  TRIP_COVERAGE_NORTH: z.coerce.number().min(-90).max(90).default(-17.65),
  TRIP_COVERAGE_WEST: z.coerce.number().min(-180).max(180).default(-63.3),
  TRIP_COVERAGE_EAST: z.coerce.number().min(-180).max(180).default(-63.02),
  TRIP_BASE_CENTS: z.coerce.number().int().min(0).max(100000).default(500),
  TRIP_PER_KM_CENTS: z.coerce.number().int().min(0).max(100000).default(200),
  TRIP_PER_MINUTE_CENTS: z.coerce.number().int().min(0).max(100000).default(25),
  TRIP_MINIMUM_CENTS: z.coerce.number().int().min(1).max(100000).default(800),
  TRIP_TARIFF_VERSION: z.string().trim().min(1).max(80).default('scz-dev-v1'),
  TRIP_QUOTE_TTL_SECONDS: z.coerce.number().int().min(30).max(900).default(180),
  TRIP_SEARCH_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  TRIP_OFFER_TTL_SECONDS: z.coerce.number().int().min(15).max(180).default(60),
  TRIP_GPS_MAX_AGE_SECONDS: z.coerce.number().int().min(15).max(180).default(60),
  TRIP_ARRIVAL_RADIUS_METERS: z.coerce.number().int().min(30).max(500).default(200),
  MARKET_COUNTRY: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default('BO'),
  MARKET_CITY: z.string().trim().min(1).default('Santa Cruz de la Sierra'),
  MARKET_CURRENCY: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('BOB'),
  MARKET_CURRENCY_SYMBOL: z.string().min(1).default('Bs'),
  MARKET_TIME_ZONE: z
    .string()
    .default('America/La_Paz')
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('es-BO', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(values: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(values);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    // Do not interpolate rejected values: connection URLs may contain credentials.
    throw new Error(`Invalid configuration fields: ${fields.join(', ')}`);
  }
  if (
    result.data.NODE_ENV === 'production' &&
    (!result.data.AUTH_SECRET ||
      Buffer.from(result.data.AUTH_SECRET, 'base64url').length < 32 ||
      result.data.AUTH_OTP_DELIVERY === 'development')
  ) {
    throw new Error('Invalid configuration fields: AUTH_SECRET, AUTH_OTP_DELIVERY');
  }
  if (
    result.data.TRIP_COVERAGE_SOUTH >= result.data.TRIP_COVERAGE_NORTH ||
    result.data.TRIP_COVERAGE_WEST >= result.data.TRIP_COVERAGE_EAST
  )
    throw new Error('Invalid configuration fields: TRIP_COVERAGE');
  if (result.data.NODE_ENV === 'production' && result.data.TRIP_DEVELOPMENT_ENABLED)
    throw new Error('Invalid configuration fields: TRIP_DEVELOPMENT_ENABLED');
  return result.data;
}

export function loadEnvironment(): Environment {
  const envPath = resolve(WORKSPACE_ROOT, process.env.ENV_FILE ?? '.env');
  const fileValues = existsSync(envPath) ? parse(readFileSync(envPath)) : {};
  // Environment variables from the shell/container deliberately override .env.
  return parseEnvironment({ ...fileValues, ...process.env });
}
