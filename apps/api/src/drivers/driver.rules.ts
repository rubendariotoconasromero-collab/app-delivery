import { BadRequestException, ConflictException } from '@nestjs/common';
import { z } from 'zod';

export const reviewStatus = z.enum(['draft', 'pending', 'approved', 'rejected', 'suspended']);
export const fullNameInput = z.object({ fullName: z.string().trim().min(3).max(150) }).strict();
export const vehicleInput = z
  .object({
    plate: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{3,15}$/),
    make: z.string().trim().min(2).max(80),
    model: z.string().trim().min(1).max(80),
    year: z
      .number()
      .int()
      .min(1900)
      .max(new Date().getUTCFullYear() + 1),
    capacityPassengers: z.number().int().min(1).max(8),
    serviceTypes: z
      .array(z.enum(['passengers', 'parcels']))
      .min(1)
      .max(2)
      .refine((items) => new Set(items).size === items.length),
  })
  .strict();
export const reviewInput = z
  .object({
    decision: z.enum(['approve', 'reject', 'suspend']),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();
export const documentInput = z
  .object({
    kind: z.enum(['identity_document', 'driver_license', 'vehicle_registration']),
    expiresOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new BadRequestException('Datos inválidos. Revisa los campos requeridos y sus límites.');
  return parsed.data;
}

export function validId(value: string): string {
  return parseInput(z.string().uuid(), value);
}

export function todayIn(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts();
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-');
}

export function validateExpiration(
  kind: string,
  value: string | undefined,
  today: string,
): string | null {
  if (!value && kind !== 'identity_document')
    throw new BadRequestException('La licencia y el registro del vehículo requieren vencimiento.');
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value ||
    value <= today
  ) {
    throw new BadRequestException('El vencimiento debe ser una fecha válida posterior a hoy.');
  }
  return value;
}

export function detectDocumentMime(buffer: Buffer): string {
  if (!buffer.length || buffer.length > 5 * 1024 * 1024)
    throw new BadRequestException('El archivo debe pesar entre 1 byte y 5 MiB.');
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return 'image/jpeg';
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  throw new BadRequestException('Formato no permitido. Usa PDF, JPEG o PNG.');
}

export type DocumentValidity = { kind: string; expiresOn: string | null };
export function documentsValid(
  documents: DocumentValidity[],
  required: string[],
  today: string,
): boolean {
  return required.every((kind) =>
    documents.some((doc) => doc.kind === kind && (!doc.expiresOn || doc.expiresOn >= today)),
  );
}

export function assertReviewTransition(current: string, decision: string): string {
  if (decision !== 'suspend' && current !== 'pending')
    throw new ConflictException('Solo se revisan solicitudes pendientes. Actualiza el expediente.');
  return decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'suspended';
}

export function pagination(query: { limit?: string; offset?: string; status?: string }) {
  const parsed = parseInput(
    z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(100000).default(0),
      status: reviewStatus.optional(),
    }),
    query,
  );
  return parsed;
}
