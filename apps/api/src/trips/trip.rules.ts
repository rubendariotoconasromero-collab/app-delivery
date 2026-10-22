import { BadRequestException, ConflictException } from '@nestjs/common';
import { z } from 'zod';

export const pointInput = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    address: z.string().trim().min(3).max(200),
    reference: z.string().trim().max(300).optional(),
  })
  .strict();
export type TripPoint = z.infer<typeof pointInput>;
export const positionInput = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().min(0).max(100),
    capturedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type Position = z.infer<typeof positionInput>;
export const quoteInput = z
  .object({
    origin: pointInput,
    destination: pointInput,
    passengerCount: z.number().int().min(1).max(8),
  })
  .strict();
export const commandInput = z.object({ idempotencyKey: z.string().uuid() });
export const requestTripInput = commandInput.extend({ quoteId: z.string().uuid() }).strict();
export const offerInput = commandInput
  .extend({ driverId: z.string().uuid(), reason: z.string().trim().min(3).max(1000) })
  .strict();
export const plainCommandInput = commandInput.strict();
export const pinInput = commandInput.extend({ pin: z.string().regex(/^\d{6}$/) }).strict();
export const respondInput = commandInput
  .extend({ decision: z.enum(['accept', 'reject']) })
  .strict();
export const cashInput = commandInput
  .extend({
    receivedCents: z.number().int().min(0).max(100000000),
    reason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict();
export const reasonInput = commandInput
  .extend({ reason: z.string().trim().min(3).max(1000) })
  .strict();
export const availabilityInput = z.object({ online: z.boolean() }).strict();

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException('Datos inválidos. Revisa los campos y sus límites.');
  return result.data;
}
export function uuid(value: string) {
  return parse(z.string().uuid(), value);
}
export function distanceMeters(
  a: Pick<TripPoint, 'latitude' | 'longitude'>,
  b: Pick<TripPoint, 'latitude' | 'longitude'>,
): number {
  const rad = (v: number) => (v * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude),
    dLon = rad(b.longitude - a.longitude);
  const term =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(term), Math.sqrt(Math.max(0, 1 - term))));
}
export function assertFresh(position: Position, now = Date.now(), maxAgeSeconds = 60) {
  const age = now - Date.parse(position.capturedAt);
  if (
    !Number.isFinite(age) ||
    age < -10000 ||
    age > maxAgeSeconds * 1000 ||
    position.accuracyMeters > 100
  )
    throw new ConflictException('La ubicación debe ser reciente y precisa. Actualiza el GPS.');
}
export function assertNear(position: Position, point: TripPoint, radiusMeters = 200) {
  if (distanceMeters(position, point) > radiusMeters)
    throw new ConflictException('Debes estar cerca del punto indicado para registrar este hito.');
}
export function parseList(query: { limit?: string; offset?: string; state?: string }) {
  return parse(
    z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).max(100000).default(0),
        state: z
          .enum([
            'searching',
            'assigned',
            'arrived',
            'in_progress',
            'completed',
            'cancelled',
            'no_driver',
          ])
          .optional(),
      })
      .strict(),
    query,
  );
}
export function cashStatus(expected: number, received: number, reason?: string) {
  if (received > expected)
    throw new BadRequestException('El importe declarado no puede superar el precio contratado.');
  return received === expected ? 'declared_paid' : received === 0 ? 'unpaid' : 'partial';
}
export function calculateFare(
  distance: number,
  duration: number,
  tariff = {
    baseCents: 500,
    perKmCents: 200,
    perMinuteCents: 25,
    minimumCents: 800,
    version: 'scz-dev-v1',
  },
) {
  const baseCents = tariff.baseCents,
    distanceCents = Math.round((distance * tariff.perKmCents) / 1000),
    timeCents = Math.round((duration * tariff.perMinuteCents) / 60),
    minimumCents = tariff.minimumCents;
  const amountCents = Math.max(minimumCents, baseCents + distanceCents + timeCents);
  if (!Number.isSafeInteger(amountCents) || amountCents > 100000000)
    throw new BadRequestException('El recorrido supera los límites de cotización.');
  return {
    currency: 'BOB' as const,
    totalCents: amountCents,
    breakdown: { baseCents, distanceCents, timeCents, minimumCents },
    tariffVersion: tariff.version,
    isTest: true as const,
  };
}
