import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
import { PoolClient } from 'pg';
import { AuthenticatedUser } from '../auth';
import { AppConfig } from '../config/app-config';
import { WORKSPACE_ROOT } from '../config/environment';
import { DriverRepository } from './driver.repository';
import {
  assertReviewTransition,
  detectDocumentMime,
  documentInput,
  documentsValid,
  fullNameInput,
  pagination,
  parseInput,
  reviewInput,
  todayIn,
  validId,
  validateExpiration,
  vehicleInput,
} from './driver.rules';

type Row = Record<string, unknown>;
export type UploadFile = { buffer: Buffer; originalname: string; mimetype: string; size: number };
const str = (value: unknown) => (value == null ? null : String(value));
const stamp = (value: unknown) => (value instanceof Date ? value.toISOString() : str(value));

@Injectable()
export class DriverService {
  private readonly uploadRoot: string;
  constructor(
    @Inject(DriverRepository) private readonly db: DriverRepository,
    @Inject(AppConfig) private readonly config: AppConfig,
  ) {
    this.uploadRoot = resolve(WORKSPACE_ROOT, config.values.UPLOAD_DIR);
  }

  private get today() {
    return todayIn(this.config.values.MARKET_TIME_ZONE);
  }

  private async withDriver<T>(
    driverId: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.db.run(async (client) => {
      const users = await client.query('SELECT id FROM app_users WHERE id=$1 FOR UPDATE', [
        driverId,
      ]);
      const role = await client.query(
        "SELECT 1 FROM app_user_roles WHERE user_id=$1 AND role='driver'",
        [driverId],
      );
      if (!users.rowCount || !role.rowCount)
        throw new NotFoundException('Conductor no encontrado.');
      await client.query('INSERT INTO driver_profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING', [
        driverId,
      ]);
      await client.query('SELECT user_id FROM driver_profiles WHERE user_id=$1 FOR UPDATE', [
        driverId,
      ]);
      return operation(client);
    }, true);
  }

  private async audit(
    client: PoolClient,
    actorId: string,
    driverId: string,
    targetType: string,
    targetId: string,
    action: string,
    reason: string,
  ) {
    await client.query(
      'INSERT INTO onboarding_audit(actor_id,driver_id,target_type,target_id,action,reason) VALUES($1,$2,$3,$4,$5,$6)',
      [actorId, driverId, targetType, targetId, action, reason],
    );
  }

  private document(row: Row) {
    return {
      id: String(row.id),
      kind: String(row.kind),
      originalName: String(row.original_name),
      mimeType: String(row.mime_type),
      size: Number(row.byte_size),
      expiresOn: str(row.expires_on),
      createdAt: stamp(row.created_at),
      vehicleId: str(row.vehicle_id),
    };
  }

  private vehicle(row: Row, activeVehicleId?: unknown) {
    return {
      id: String(row.id),
      driverId: String(row.driver_id),
      plate: String(row.plate),
      make: String(row.make),
      model: String(row.model),
      year: Number(row.year),
      capacityPassengers: Number(row.capacity_passengers),
      serviceTypes: row.service_types as string[],
      reviewStatus: String(row.review_status),
      reviewReason: str(row.review_reason),
      submittedAt: stamp(row.submitted_at),
      reviewedAt: stamp(row.reviewed_at),
      active: row.id === activeVehicleId,
    };
  }

  async overview(driverId: string, includeAudit = false) {
    validId(driverId);
    return this.db.run(async (client) => {
      const result = await client.query(
        `SELECT u.id,u.display_name,u.phone,u.status,p.full_name,p.review_status,p.review_reason,p.submitted_at,p.reviewed_at,p.active_vehicle_id,
        EXISTS(SELECT 1 FROM app_user_roles r WHERE r.user_id=u.id AND r.role='driver') AS has_role
        FROM app_users u LEFT JOIN driver_profiles p ON p.user_id=u.id WHERE u.id=$1`,
        [driverId],
      );
      const row = result.rows[0] as Row | undefined;
      if (!row || (!row.has_role && row.review_status == null))
        throw new NotFoundException('Conductor no encontrado.');
      const vehicleRows = (
        await client.query(
          'SELECT * FROM driver_vehicles WHERE driver_id=$1 ORDER BY created_at DESC',
          [driverId],
        )
      ).rows as Row[];
      const documentRows = (
        await client.query(
          'SELECT *,expires_on::text AS expires_on FROM driver_documents WHERE driver_id=$1 AND is_current ORDER BY kind,created_at DESC',
          [driverId],
        )
      ).rows as Row[];
      const documents = documentRows.map((item) => this.document(item));
      const active = vehicleRows.find((item) => item.id === row.active_vehicle_id);
      const eligible =
        row.status === 'active' &&
        row.has_role === true &&
        row.review_status === 'approved' &&
        active?.review_status === 'approved' &&
        documentsValid(
          documents.filter((doc) => !doc.vehicleId),
          ['identity_document', 'driver_license'],
          this.today,
        ) &&
        documentsValid(
          documents.filter((doc) => doc.vehicleId === active?.id),
          ['vehicle_registration'],
          this.today,
        );
      const driver = {
        id: String(row.id),
        displayName: String(row.display_name),
        fullName: str(row.full_name) ?? '',
        phone: str(row.phone),
        reviewStatus: str(row.review_status) ?? 'draft',
        reviewReason: str(row.review_reason),
        submittedAt: stamp(row.submitted_at),
        reviewedAt: stamp(row.reviewed_at),
        activeVehicleId: str(row.active_vehicle_id),
        eligible: Boolean(eligible),
      };
      const audit = includeAudit
        ? (
            await client.query(
              'SELECT id,actor_id,target_type,target_id,action,reason,created_at FROM onboarding_audit WHERE driver_id=$1 ORDER BY created_at DESC LIMIT 100',
              [driverId],
            )
          ).rows.map((item: Row) => ({
            id: item.id,
            actorId: item.actor_id,
            targetType: item.target_type,
            targetId: item.target_id,
            action: item.action,
            reason: item.reason,
            createdAt: stamp(item.created_at),
          }))
        : undefined;
      return {
        driver,
        vehicles: vehicleRows.map((item) => this.vehicle(item, row.active_vehicle_id)),
        documents,
        ...(includeAudit ? { audit } : {}),
      };
    }, 'snapshot');
  }

  async saveProfile(actor: AuthenticatedUser, body: unknown) {
    const input = parseInput(fullNameInput, body);
    await this.withDriver(actor.id, async (client) => {
      await client.query(
        "UPDATE driver_profiles SET full_name=$2,review_status='draft',review_reason=NULL,reviewed_at=NULL,reviewed_by=NULL,active_vehicle_id=NULL,updated_at=NOW() WHERE user_id=$1",
        [actor.id, input.fullName],
      );
      await this.audit(
        client,
        actor.id,
        actor.id,
        'driver',
        actor.id,
        'profile_updated',
        'Nombre revisado actualizado; requiere nueva revisión.',
      );
    });
    return this.overview(actor.id);
  }

  async createVehicle(actor: AuthenticatedUser, body: unknown) {
    const input = parseInput(vehicleInput, body);
    const row = await this.withDriver(actor.id, async (client) => {
      const count = await client.query(
        'SELECT COUNT(*)::int AS total FROM driver_vehicles WHERE driver_id=$1',
        [actor.id],
      );
      if (count.rows[0].total >= 20)
        throw new BadRequestException(
          'Se alcanzó el máximo de vehículos registrados. Contacta a soporte.',
        );
      const result = await client.query(
        'INSERT INTO driver_vehicles(driver_id,plate,make,model,year,capacity_passengers,service_types) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [
          actor.id,
          input.plate,
          input.make,
          input.model,
          input.year,
          input.capacityPassengers,
          input.serviceTypes,
        ],
      );
      await this.audit(
        client,
        actor.id,
        actor.id,
        'vehicle',
        result.rows[0].id,
        'vehicle_created',
        'Vehículo presentado por su propietario.',
      );
      return result.rows[0] as Row;
    });
    return this.vehicle(row);
  }

  private async ownedVehicle(
    client: PoolClient,
    driverId: string,
    vehicleId: string,
  ): Promise<Row> {
    const result = await client.query(
      'SELECT * FROM driver_vehicles WHERE id=$1 AND driver_id=$2 FOR UPDATE',
      [validId(vehicleId), driverId],
    );
    if (!result.rowCount) throw new NotFoundException('Vehículo no encontrado.');
    return result.rows[0] as Row;
  }

  async updateVehicle(actor: AuthenticatedUser, vehicleId: string, body: unknown) {
    const input = parseInput(vehicleInput, body);
    const row = await this.withDriver(actor.id, async (client) => {
      await this.ownedVehicle(client, actor.id, vehicleId);
      const result = await client.query(
        "UPDATE driver_vehicles SET plate=$3,make=$4,model=$5,year=$6,capacity_passengers=$7,service_types=$8,review_status='draft',review_reason=NULL,reviewed_at=NULL,reviewed_by=NULL,updated_at=NOW() WHERE id=$1 AND driver_id=$2 RETURNING *",
        [
          vehicleId,
          actor.id,
          input.plate,
          input.make,
          input.model,
          input.year,
          input.capacityPassengers,
          input.serviceTypes,
        ],
      );
      await client.query(
        'UPDATE driver_profiles SET active_vehicle_id=NULL,updated_at=NOW() WHERE user_id=$1 AND active_vehicle_id=$2',
        [actor.id, vehicleId],
      );
      await this.audit(
        client,
        actor.id,
        actor.id,
        'vehicle',
        vehicleId,
        'vehicle_updated',
        'Datos revisados modificados; requiere nueva revisión.',
      );
      return result.rows[0] as Row;
    });
    return this.vehicle(row);
  }

  async upload(
    actor: AuthenticatedUser,
    rawBody: unknown,
    file: UploadFile | undefined,
    vehicleId?: string,
  ) {
    const input = parseInput(documentInput, rawBody);
    if (!file?.buffer) throw new BadRequestException('Selecciona un archivo.');
    if (
      (vehicleId && input.kind !== 'vehicle_registration') ||
      (!vehicleId && input.kind === 'vehicle_registration')
    )
      throw new BadRequestException('El documento no corresponde al recurso.');
    const expiresOn = validateExpiration(input.kind, input.expiresOn, this.today);
    const mime = detectDocumentMime(file.buffer);
    const storageName = randomUUID();
    const path = resolve(this.uploadRoot, storageName);
    if (!path.startsWith(`${this.uploadRoot}${sep}`))
      throw new BadRequestException('Archivo inválido.');
    const originalName =
      basename(file.originalname.replace(/\\/g, '/'))
        .replace(/[\r\n\x00]/g, '')
        .slice(0, 150) || 'documento';
    let committed = false;
    try {
      const row = await this.withDriver(actor.id, async (client) => {
        if (vehicleId) await this.ownedVehicle(client, actor.id, vehicleId);
        const quota = (
          await client.query(
            'SELECT COUNT(*)::int AS count,COALESCE(SUM(byte_size),0)::bigint AS bytes FROM driver_documents WHERE driver_id=$1',
            [actor.id],
          )
        ).rows[0];
        if (
          Number(quota.count) >= 100 ||
          Number(quota.bytes) + file.buffer.length > 100 * 1024 * 1024
        ) {
          throw new BadRequestException(
            'Se alcanzó el límite de documentos o de 100 MiB por conductor. Contacta a soporte.',
          );
        }
        await mkdir(this.uploadRoot, { recursive: true });
        await writeFile(path, file.buffer, { flag: 'wx', mode: 0o600 });
        await client.query(
          'UPDATE driver_documents SET is_current=FALSE WHERE driver_id=$1 AND vehicle_id IS NOT DISTINCT FROM $2::uuid AND kind=$3 AND is_current',
          [actor.id, vehicleId ?? null, input.kind],
        );
        const result = await client.query(
          'INSERT INTO driver_documents(driver_id,vehicle_id,kind,original_name,mime_type,byte_size,storage_name,sha256,expires_on) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *,expires_on::text AS expires_on',
          [
            actor.id,
            vehicleId ?? null,
            input.kind,
            originalName,
            mime,
            file.buffer.length,
            storageName,
            createHash('sha256').update(file.buffer).digest('hex'),
            expiresOn,
          ],
        );
        if (vehicleId) {
          await client.query(
            "UPDATE driver_vehicles SET review_status='draft',review_reason=NULL,reviewed_at=NULL,reviewed_by=NULL,updated_at=NOW() WHERE id=$1",
            [vehicleId],
          );
          await client.query(
            'UPDATE driver_profiles SET active_vehicle_id=NULL,updated_at=NOW() WHERE user_id=$1 AND active_vehicle_id=$2',
            [actor.id, vehicleId],
          );
        } else {
          await client.query(
            "UPDATE driver_profiles SET review_status='draft',review_reason=NULL,reviewed_at=NULL,reviewed_by=NULL,active_vehicle_id=NULL,updated_at=NOW() WHERE user_id=$1",
            [actor.id],
          );
        }
        await this.audit(
          client,
          actor.id,
          actor.id,
          'document',
          result.rows[0].id,
          'document_uploaded',
          `Documento ${input.kind} presentado; requiere revisión.`,
        );
        return result.rows[0] as Row;
      });
      committed = true;
      return this.document(row);
    } finally {
      if (!committed) {
        // A failed COMMIT acknowledgement can hide a committed row. Keep the file
        // unless an independent query proves it is unreferenced.
        const referenced = await this.db
          .run(async (client) =>
            Boolean(
              (
                await client.query('SELECT 1 FROM driver_documents WHERE storage_name=$1', [
                  storageName,
                ])
              ).rowCount,
            ),
          )
          .catch(() => null);
        if (referenced === false) await unlink(path).catch(() => undefined);
      }
    }
  }

  private async requiredDocuments(client: PoolClient, driverId: string, vehicleId?: string) {
    const rows = (
      await client.query(
        'SELECT kind,expires_on::text AS expires_on FROM driver_documents WHERE driver_id=$1 AND vehicle_id IS NOT DISTINCT FROM $2::uuid AND is_current',
        [driverId, vehicleId ?? null],
      )
    ).rows;
    if (
      !documentsValid(
        rows.map((row) => ({
          kind: row.kind as string,
          expiresOn: row.expires_on as string | null,
        })),
        vehicleId ? ['vehicle_registration'] : ['identity_document', 'driver_license'],
        this.today,
      )
    ) {
      throw new BadRequestException('Faltan documentos requeridos o hay documentos vencidos.');
    }
  }

  async submit(actor: AuthenticatedUser, vehicleId?: string) {
    await this.withDriver(actor.id, async (client) => {
      if (vehicleId) {
        const vehicle = await this.ownedVehicle(client, actor.id, vehicleId);
        if (!['draft', 'rejected', 'suspended'].includes(String(vehicle.review_status)))
          throw new ConflictException('El vehículo ya está pendiente o aprobado.');
        await this.requiredDocuments(client, actor.id, vehicleId);
        await client.query(
          "UPDATE driver_vehicles SET review_status='pending',review_reason=NULL,submitted_at=NOW(),updated_at=NOW() WHERE id=$1",
          [vehicleId],
        );
      } else {
        const profile = (
          await client.query(
            'SELECT full_name,review_status FROM driver_profiles WHERE user_id=$1',
            [actor.id],
          )
        ).rows[0];
        if (String(profile.full_name).trim().length < 3)
          throw new BadRequestException('Completa el nombre del conductor.');
        if (!['draft', 'rejected', 'suspended'].includes(profile.review_status))
          throw new ConflictException('El conductor ya está pendiente o aprobado.');
        await this.requiredDocuments(client, actor.id);
        await client.query(
          "UPDATE driver_profiles SET review_status='pending',review_reason=NULL,submitted_at=NOW(),active_vehicle_id=NULL,updated_at=NOW() WHERE user_id=$1",
          [actor.id],
        );
      }
      await this.audit(
        client,
        actor.id,
        actor.id,
        vehicleId ? 'vehicle' : 'driver',
        vehicleId ?? actor.id,
        'submitted',
        'Solicitud enviada a revisión.',
      );
    });
    const result = await this.overview(actor.id);
    return vehicleId ? result.vehicles.find((vehicle) => vehicle.id === vehicleId)! : result;
  }

  async activate(actor: AuthenticatedUser, vehicleId: string) {
    await this.withDriver(actor.id, async (client) => {
      const profile = (
        await client.query(
          'SELECT p.review_status,u.status FROM driver_profiles p JOIN app_users u ON u.id=p.user_id WHERE p.user_id=$1',
          [actor.id],
        )
      ).rows[0];
      const vehicle = await this.ownedVehicle(client, actor.id, vehicleId);
      if (
        profile.status !== 'active' ||
        profile.review_status !== 'approved' ||
        vehicle.review_status !== 'approved'
      )
        throw new ForbiddenException('El conductor y el vehículo deben estar aprobados.');
      await this.requiredDocuments(client, actor.id);
      await this.requiredDocuments(client, actor.id, vehicleId);
      await client.query(
        'UPDATE driver_profiles SET active_vehicle_id=$2,updated_at=NOW() WHERE user_id=$1',
        [actor.id, vehicleId],
      );
      await this.audit(
        client,
        actor.id,
        actor.id,
        'vehicle',
        vehicleId,
        'vehicle_activated',
        'Vehículo aprobado seleccionado.',
      );
    });
    return this.overview(actor.id);
  }

  async list(query: { limit?: string; offset?: string; status?: string }) {
    const { limit, offset, status } = pagination(query);
    const ids = await this.db.run(async (client) => {
      const filter = `FROM app_users u LEFT JOIN driver_profiles p ON p.user_id=u.id WHERE (p.user_id IS NOT NULL OR EXISTS(SELECT 1 FROM app_user_roles r WHERE r.user_id=u.id AND r.role='driver')) AND ($1::text IS NULL OR COALESCE(p.review_status,'draft')=$1)`;
      const total = Number(
        (await client.query(`SELECT COUNT(*) ${filter}`, [status ?? null])).rows[0].count,
      );
      const result = await client.query(
        `SELECT u.id ${filter} ORDER BY COALESCE(p.submitted_at,u.created_at) DESC,u.id LIMIT $2 OFFSET $3`,
        [status ?? null, limit, offset],
      );
      return { total, ids: result.rows.map((row) => String(row.id)) };
    });
    const items = [];
    for (const id of ids.ids) items.push((await this.overview(id)).driver);
    return { items, total: ids.total, limit, offset };
  }

  async review(actor: AuthenticatedUser, targetId: string, body: unknown, isVehicle = false) {
    const input = parseInput(reviewInput, body);
    validId(targetId);
    const driverId = isVehicle
      ? await this.db.run(async (client) => {
          const row = (
            await client.query('SELECT driver_id FROM driver_vehicles WHERE id=$1', [targetId])
          ).rows[0];
          if (!row) throw new NotFoundException('Vehículo no encontrado.');
          return String(row.driver_id);
        })
      : targetId;
    await this.withDriver(driverId, async (client) => {
      const target = isVehicle
        ? await this.ownedVehicle(client, driverId, targetId)
        : (await client.query('SELECT * FROM driver_profiles WHERE user_id=$1', [driverId]))
            .rows[0];
      const state = assertReviewTransition(String(target.review_status), input.decision);
      if (input.decision === 'approve') {
        const user = (await client.query('SELECT status FROM app_users WHERE id=$1', [driverId]))
          .rows[0];
        if (user.status !== 'active')
          throw new ConflictException('La cuenta del conductor está suspendida.');
        if (!isVehicle && String(target.full_name).trim().length < 3)
          throw new BadRequestException('El nombre está incompleto.');
        await this.requiredDocuments(client, driverId, isVehicle ? targetId : undefined);
      }
      if (isVehicle) {
        await client.query(
          'UPDATE driver_vehicles SET review_status=$2,review_reason=$3,reviewed_at=NOW(),reviewed_by=$4,updated_at=NOW() WHERE id=$1',
          [targetId, state, input.reason, actor.id],
        );
        if (state !== 'approved')
          await client.query(
            'UPDATE driver_profiles SET active_vehicle_id=NULL,updated_at=NOW() WHERE user_id=$1 AND active_vehicle_id=$2',
            [driverId, targetId],
          );
      } else {
        await client.query(
          'UPDATE driver_profiles SET review_status=$2,review_reason=$3,reviewed_at=NOW(),reviewed_by=$4,active_vehicle_id=NULL,updated_at=NOW() WHERE user_id=$1',
          [driverId, state, input.reason, actor.id],
        );
      }
      await this.audit(
        client,
        actor.id,
        driverId,
        isVehicle ? 'vehicle' : 'driver',
        targetId,
        input.decision,
        input.reason,
      );
    });
    return this.overview(driverId, true);
  }

  async download(actor: AuthenticatedUser, documentId: string) {
    const row = await this.db.run(async (client) => {
      const result = await client.query(
        'SELECT *,expires_on::text AS expires_on FROM driver_documents WHERE id=$1',
        [validId(documentId)],
      );
      const document = result.rows[0] as Row | undefined;
      if (!document) throw new NotFoundException('Documento no encontrado.');
      if (
        document.driver_id !== actor.id &&
        !(actor.roles.includes('admin') && actor.sessionKind === 'admin')
      )
        throw new ForbiddenException('No puedes consultar este documento.');
      return document;
    });
    const path = resolve(this.uploadRoot, String(row.storage_name));
    if (
      !path.startsWith(`${this.uploadRoot}${sep}`) ||
      !/^[a-f0-9-]{36}$/.test(String(row.storage_name))
    )
      throw new NotFoundException('Documento no encontrado.');
    try {
      return { data: await readFile(path), document: this.document(row) };
    } catch {
      throw new ServiceUnavailableException('El archivo no está disponible. Contacta a soporte.');
    }
  }
}
