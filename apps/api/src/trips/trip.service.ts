import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
} from 'node:crypto';
import { PoolClient } from 'pg';
import { AuthenticatedUser } from '../auth';
import { AppConfig } from '../config/app-config';
import { todayIn } from '../drivers/driver.rules';
import { TripRepository } from './trip.repository';
import {
  availabilityInput,
  assertFresh,
  assertNear,
  calculateFare,
  cashInput,
  cashStatus,
  distanceMeters,
  offerInput,
  parse,
  parseList,
  pinInput,
  plainCommandInput,
  Position,
  positionInput,
  quoteInput,
  reasonInput,
  requestTripInput,
  respondInput,
  TripPoint,
  uuid,
} from './trip.rules';
import { TripRouting } from './trip.routing';

type Row = Record<string, any>;
const ACTIVE = ['searching', 'assigned', 'arrived', 'in_progress'];
const stamp = (value: unknown) =>
  value instanceof Date ? value.toISOString() : value == null ? null : String(value);
@Injectable()
export class TripService {
  constructor(
    @Inject(TripRepository) private readonly db: TripRepository,
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(TripRouting) private readonly routing: TripRouting,
  ) {}
  private get today() {
    return todayIn(this.config.values.MARKET_TIME_ZONE);
  }
  private setting(name: string, fallback: number) {
    return Number((this.config.values as unknown as Record<string, unknown>)[name] ?? fallback);
  }
  private enabled() {
    if (
      !(this.config.values as unknown as Record<string, unknown>).TRIP_DEVELOPMENT_ENABLED ||
      this.config.values.NODE_ENV === 'production'
    )
      throw new ServiceUnavailableException('Los viajes de prueba están deshabilitados.');
  }
  private activeAccount(actor: AuthenticatedUser) {
    if (actor.status !== 'active')
      throw new ForbiddenException('La cuenta no puede crear ni aceptar servicios nuevos.');
  }
  private mobile(actor: AuthenticatedUser, role: 'client' | 'driver') {
    if (actor.sessionKind !== 'mobile' || !actor.roles.includes(role))
      throw new ForbiddenException('Esta acción requiere la sesión de la app correspondiente.');
  }
  getConfig() {
    const v = this.config.values as unknown as Record<string, unknown>;
    return {
      enabled: Boolean(v.TRIP_DEVELOPMENT_ENABLED) && v.NODE_ENV !== 'production',
      isTest: true,
      currency: 'BOB',
      coverage: {
        south: this.setting('TRIP_COVERAGE_SOUTH', -17.9),
        north: this.setting('TRIP_COVERAGE_NORTH', -17.65),
        west: this.setting('TRIP_COVERAGE_WEST', -63.3),
        east: this.setting('TRIP_COVERAGE_EAST', -63.02),
      },
      tariff: {
        version: String(v.TRIP_TARIFF_VERSION ?? 'scz-dev-v1'),
        baseCents: this.setting('TRIP_BASE_CENTS', 500),
        perKmCents: this.setting('TRIP_PER_KM_CENTS', 200),
        perMinuteCents: this.setting('TRIP_PER_MINUTE_CENTS', 25),
        minimumCents: this.setting('TRIP_MINIMUM_CENTS', 800),
      },
      map: {
        tileUrl: String(v.TRIP_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
        attribution: '© OpenStreetMap contributors',
        attributionUrl: 'https://www.openstreetmap.org/copyright',
      },
      quoteTtlSeconds: this.setting('TRIP_QUOTE_TTL_SECONDS', 180),
      searchTtlSeconds: this.setting('TRIP_SEARCH_TTL_SECONDS', 600),
      offerTtlSeconds: this.setting('TRIP_OFFER_TTL_SECONDS', 60),
      gpsMaxAgeSeconds: this.setting('TRIP_GPS_MAX_AGE_SECONDS', 60),
      arrivalRadiusMeters: this.setting('TRIP_ARRIVAL_RADIUS_METERS', 200),
    };
  }
  private secret() {
    if (!this.config.values.AUTH_SECRET)
      throw new ServiceUnavailableException('Configura AUTH_SECRET para gestionar viajes.');
    return createHash('sha256').update(this.config.values.AUTH_SECRET).digest();
  }
  private pinHash(tripId: string, pin: string) {
    return createHmac('sha256', this.secret()).update(`trip-start:${tripId}:${pin}`).digest('hex');
  }
  private cipher(pin: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.secret(), iv);
    const encrypted = Buffer.concat([cipher.update(pin, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  }
  private decipher(value: string) {
    const bytes = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', this.secret(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  }
  private staff(actor: AuthenticatedUser) {
    return (
      actor.sessionKind === 'admin' &&
      actor.mfaVerified &&
      actor.roles.some((role) => ['operator', 'admin'].includes(role))
    );
  }
  private async audit(
    client: PoolClient,
    tripId: string,
    actorId: string | null,
    action: string,
    from: string | null,
    to: string | null,
    reason: string | null = null,
    details: unknown = {},
  ) {
    await client.query(
      'INSERT INTO passenger_trip_audit(trip_id,actor_id,action,from_state,to_state,reason,details) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [tripId, actorId, action, from, to, reason, JSON.stringify(details)],
    );
  }
  private async command<T>(
    actor: AuthenticatedUser,
    key: string,
    operation: string,
    payload: unknown,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    uuid(key);
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    // Deadlines are maintenance facts and must survive a rejected business command.
    await this.db.run((client) => this.expire(client));
    try {
      return await this.db.run(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `${actor.id}:${key}`,
        ]);
        const existing = (
          await client.query(
            'SELECT * FROM passenger_trip_commands WHERE actor_id=$1 AND idempotency_key=$2',
            [actor.id, key],
          )
        ).rows[0];
        if (existing) {
          if (existing.operation !== operation || existing.payload_hash !== hash)
            throw new ConflictException('La clave de reintento ya fue usada para otra operación.');
          const result = JSON.parse(this.decipher(existing.result.encrypted)) as Record<
            string,
            unknown
          >;
          if (typeof result.id === 'string') {
            const current = await this.trip(client, result.id);
            this.owner(actor, current);
            return (await this.serialize(client, current, actor)) as T;
          }
          return result as T;
        }
        const result = await work(client);
        await client.query(
          'INSERT INTO passenger_trip_commands(actor_id,idempotency_key,operation,payload_hash,result) VALUES($1,$2,$3,$4,$5)',
          [
            actor.id,
            key,
            operation,
            hash,
            JSON.stringify({ encrypted: this.cipher(JSON.stringify(result)) }),
          ],
        );
        return result;
      });
    } catch (error) {
      // A deadline may cross while validating a command. Its rollback must not revive it.
      await this.db.run((client) => this.expire(client));
      throw error;
    }
  }
  private async lockUsers(client: PoolClient, ids: string[]) {
    return client.query(
      'SELECT id FROM app_users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [ids],
    );
  }
  private async lockDriver(client: PoolClient, id: string, otherIds: string[] = []) {
    // Sorted participant locks also cover people who have both mobile roles.
    const user = await this.lockUsers(client, [id, ...otherIds]);
    const role = await client.query(
      "SELECT 1 FROM app_user_roles WHERE user_id=$1 AND role='driver'",
      [id],
    );
    if (!user.rows.some((row) => row.id === id) || !role.rowCount)
      throw new NotFoundException('Conductor no encontrado.');
    await client.query('INSERT INTO driver_profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING', [
      id,
    ]);
    await client.query('SELECT user_id FROM driver_profiles WHERE user_id=$1 FOR UPDATE', [id]);
  }
  private async trip(client: PoolClient, id: string, lock = false) {
    uuid(id);
    const row = (
      await client.query(`SELECT * FROM passenger_trips WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [
        id,
      ])
    ).rows[0];
    if (!row) throw new NotFoundException('Viaje no encontrado.');
    return row as Row;
  }
  private owner(actor: AuthenticatedUser, trip: Row) {
    if (actor.id !== trip.client_id && actor.id !== trip.driver_id && !this.staff(actor))
      throw new ForbiddenException('No tienes acceso a este viaje.');
  }
  private async expire(client: PoolClient) {
    // All transitions lock the trip before its offers, including lazy expirations.
    const trips = await client.query(`SELECT t.id,t.search_expires_at FROM passenger_trips t
      WHERE t.state='searching' AND (t.search_expires_at<=NOW() OR EXISTS(SELECT 1 FROM passenger_trip_offers o WHERE o.trip_id=t.id AND o.state='pending' AND o.expires_at<=NOW()))
      ORDER BY t.id FOR UPDATE OF t`);
    for (const trip of trips.rows) {
      const offers = await client.query(
        "UPDATE passenger_trip_offers SET state='expired',responded_at=NOW() WHERE trip_id=$1 AND state='pending' AND expires_at<=NOW() RETURNING id",
        [trip.id],
      );
      for (const offer of offers.rows)
        await this.audit(client, trip.id, null, 'offer_expired', 'searching', 'searching', null, {
          offerId: offer.id,
        });
      if (new Date(trip.search_expires_at).getTime() <= Date.now()) {
        await client.query(
          "UPDATE passenger_trips SET state='no_driver',version=version+1,updated_at=NOW() WHERE id=$1",
          [trip.id],
        );
        await client.query(
          "UPDATE passenger_trip_offers SET state='withdrawn',responded_at=NOW() WHERE trip_id=$1 AND state='pending'",
          [trip.id],
        );
        await this.audit(client, trip.id, null, 'search_expired', 'searching', 'no_driver');
      } else if (offers.rowCount) {
        await client.query(
          'UPDATE passenger_trips SET version=version+1,updated_at=NOW() WHERE id=$1',
          [trip.id],
        );
      }
    }
  }
  private async driverEligibility(
    client: PoolClient,
    driverId: string,
    passengers = 1,
    requireAvailable = false,
  ): Promise<Row> {
    const row = (
      await client.query(
        `SELECT u.status,u.display_name,u.phone,p.review_status,p.active_vehicle_id,v.id AS vehicle_id,v.plate,v.make,v.model,v.year,v.capacity_passengers,v.service_types,v.review_status AS vehicle_status,
      EXISTS(SELECT 1 FROM app_user_roles r WHERE r.user_id=u.id AND r.role='driver') AS driver_role,
      EXISTS(SELECT 1 FROM driver_documents d WHERE d.driver_id=u.id AND d.vehicle_id IS NULL AND d.kind='identity_document' AND d.is_current AND (d.expires_on IS NULL OR d.expires_on >= $2::date)) AS identity_valid,
      EXISTS(SELECT 1 FROM driver_documents d WHERE d.driver_id=u.id AND d.vehicle_id IS NULL AND d.kind='driver_license' AND d.is_current AND d.expires_on >= $2::date) AS license_valid,
      EXISTS(SELECT 1 FROM driver_documents d WHERE d.vehicle_id=v.id AND d.kind='vehicle_registration' AND d.is_current AND d.expires_on >= $2::date) AS registration_valid,
      a.available,a.position,a.captured_at,a.received_at,
      EXISTS(SELECT 1 FROM passenger_trips t WHERE t.driver_id=u.id AND t.state IN ('assigned','arrived','in_progress')) AS busy
      FROM app_users u JOIN driver_profiles p ON p.user_id=u.id LEFT JOIN driver_vehicles v ON v.id=p.active_vehicle_id LEFT JOIN driver_presence a ON a.driver_id=u.id WHERE u.id=$1`,
        [driverId, this.today],
      )
    ).rows[0] as Row | undefined;
    if (
      !row ||
      row.status !== 'active' ||
      !row.driver_role ||
      row.review_status !== 'approved' ||
      row.vehicle_status !== 'approved' ||
      !row.identity_valid ||
      !row.license_valid ||
      !row.registration_valid ||
      !row.service_types?.includes('passengers') ||
      row.capacity_passengers < passengers
    )
      throw new ConflictException(
        'El conductor y su vehículo deben estar habilitados para este viaje de pasajeros.',
      );
    if (requireAvailable) {
      if (!row.available || row.busy || !row.position)
        throw new ConflictException('El conductor no está disponible.');
      assertFresh(row.position, Date.now(), this.getConfig().gpsMaxAgeSeconds);
      if (
        Date.now() - new Date(row.received_at).getTime() >
        this.getConfig().gpsMaxAgeSeconds * 1000
      )
        throw new ConflictException('La ubicación del conductor ha vencido.');
    }
    return row;
  }
  private async serialize(
    client: PoolClient,
    row: Row,
    actor: AuthenticatedUser,
    withAudit = false,
  ) {
    const cash = (
      await client.query('SELECT * FROM passenger_cash_declarations WHERE trip_id=$1', [row.id])
    ).rows[0];
    const contact = row.driver_id
      ? (
          await client.query(
            'SELECT u.id,u.display_name,u.phone,v.plate,v.make,v.model,v.capacity_passengers FROM app_users u JOIN driver_vehicles v ON v.driver_id=u.id WHERE u.id=$1 AND v.id=$2',
            [row.driver_id, row.vehicle_id],
          )
        ).rows[0]
      : null;
    const customer = (
      await client.query('SELECT display_name,phone FROM app_users WHERE id=$1', [row.client_id])
    ).rows[0];
    const latestOffer = (
      await client.query(
        'SELECT * FROM passenger_trip_offers WHERE trip_id=$1 ORDER BY created_at DESC LIMIT 1',
        [row.id],
      )
    ).rows[0];
    const canSeePin =
      actor.sessionKind === 'mobile' &&
      actor.roles.includes('client') &&
      actor.id === row.client_id &&
      ['assigned', 'arrived'].includes(row.state) &&
      row.start_pin_cipher;
    return {
      id: row.id,
      clientId: row.client_id,
      driverId: row.driver_id,
      vehicleId: row.vehicle_id,
      state: row.state,
      origin: row.origin,
      destination: row.destination,
      passengerCount: row.passenger_count,
      route: row.route,
      currency: row.currency,
      totalCents: row.amount_cents,
      tariffVersion: row.fare.tariffVersion,
      isTest: true as const,
      searchExpiresAt: stamp(row.search_expires_at),
      createdAt: stamp(row.created_at),
      updatedAt: stamp(row.updated_at),
      assignedAt: stamp(row.assigned_at),
      arrivedAt: stamp(row.arrived_at),
      startedAt: stamp(row.started_at),
      completedAt: stamp(row.completed_at),
      client: {
        displayName: customer.display_name,
        ...(row.driver_id ? { phone: customer.phone } : {}),
      },
      driver: contact
        ? {
            displayName: contact.display_name,
            phone: contact.phone,
            vehicle: {
              plate: contact.plate,
              make: contact.make,
              model: contact.model,
              capacityPassengers: contact.capacity_passengers,
            },
          }
        : null,
      ...(canSeePin
        ? {
            startCode: this.decipher(row.start_pin_cipher),
            startCodeExpiresAt: stamp(row.pin_expires_at),
          }
        : {}),
      cash: cash
        ? {
            status: cash.status,
            receivedCents: cash.received_cents,
            declaredAt: stamp(cash.created_at),
            declaredBy: cash.actor_id,
          }
        : { status: 'pending', receivedCents: null, declaredAt: null, declaredBy: null },
      offer: latestOffer ? this.offer(latestOffer) : null,
      version: row.version,
    };
  }
  private offer(row: Row) {
    return {
      id: row.id,
      tripId: row.trip_id,
      driverId: row.driver_id,
      state: row.state,
      expiresAt: stamp(row.expires_at),
    };
  }
  private coverage(point: TripPoint) {
    const area = this.getConfig().coverage;
    if (
      point.latitude < area.south ||
      point.latitude > area.north ||
      point.longitude < area.west ||
      point.longitude > area.east
    )
      throw new BadRequestException(
        'El punto está fuera de la cobertura de desarrollo en Santa Cruz de la Sierra.',
      );
  }
  async createQuote(actor: AuthenticatedUser, body: unknown) {
    this.mobile(actor, 'client');
    this.enabled();
    const input = parse(quoteInput, body);
    this.coverage(input.origin);
    this.coverage(input.destination);
    if (actor.status !== 'active')
      throw new ForbiddenException('La cuenta no puede crear nuevos viajes.');
    if (!(await this.db.rateLimit(`trip-quotes:client:${actor.id}`, 10, 60)))
      throw new HttpException('Se alcanzó el límite de cotizaciones. Espera un minuto.', 429);
    const endpoint = new URL(this.config.values.TRIP_OSRM_URL);
    if (
      endpoint.hostname === 'router.project-osrm.org' &&
      !(await this.db.rateLimit('trip-quotes:osrm-demo:global', 1, 1))
    )
      throw new HttpException(
        'El proveedor de prueba permite una consulta por segundo. Espera un segundo.',
        429,
      );
    const route = await this.routing.calculate(input.origin, input.destination);
    const fare = calculateFare(
      route.distanceMeters,
      route.durationSeconds,
      this.getConfig().tariff,
    );
    return this.db.run(async (client) => {
      const account = (
        await client.query('SELECT status FROM app_users WHERE id=$1 FOR UPDATE', [actor.id])
      ).rows[0];
      if (account?.status !== 'active')
        throw new ForbiddenException('La cuenta no puede crear nuevas cotizaciones.');
      const row = (
        await client.query(
          'INSERT INTO passenger_quotes(client_id,origin,destination,passenger_count,route,fare,amount_cents,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,NOW()+make_interval(secs=>$8)) RETURNING *',
          [
            actor.id,
            input.origin,
            input.destination,
            input.passengerCount,
            route,
            fare,
            fare.totalCents,
            this.getConfig().quoteTtlSeconds,
          ],
        )
      ).rows[0];
      return {
        id: row.id,
        origin: row.origin,
        destination: row.destination,
        passengerCount: row.passenger_count,
        route: row.route,
        ...fare,
        expiresAt: stamp(row.expires_at),
      };
    });
  }
  async request(actor: AuthenticatedUser, body: unknown) {
    this.mobile(actor, 'client');
    this.enabled();
    this.activeAccount(actor);
    const input = parse(requestTripInput, body);
    return this.command(actor, input.idempotencyKey, 'request', input, async (client) => {
      await client.query('SELECT id FROM app_users WHERE id=$1 FOR UPDATE', [actor.id]);
      await this.expire(client);
      const quote = (
        await client.query(
          'SELECT * FROM passenger_quotes WHERE id=$1 AND client_id=$2 FOR UPDATE',
          [input.quoteId, actor.id],
        )
      ).rows[0];
      if (!quote) throw new NotFoundException('Cotización no encontrada.');
      if (new Date(quote.expires_at).getTime() <= Date.now())
        throw new ConflictException('La cotización venció. Solicita una nueva.');
      const user = (await client.query('SELECT status FROM app_users WHERE id=$1', [actor.id]))
        .rows[0];
      if (user.status !== 'active')
        throw new ForbiddenException('La cuenta no puede crear viajes.');
      const prior = (
        await client.query('SELECT * FROM passenger_trips WHERE quote_id=$1', [quote.id])
      ).rows[0];
      if (prior) {
        return this.serialize(client, prior, actor);
      }
      const trip = (
        await client.query(
          'INSERT INTO passenger_trips(quote_id,client_id,origin,destination,passenger_count,route,fare,amount_cents,search_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW()+make_interval(secs=>$9)) RETURNING *',
          [
            quote.id,
            actor.id,
            quote.origin,
            quote.destination,
            quote.passenger_count,
            quote.route,
            quote.fare,
            quote.amount_cents,
            this.getConfig().searchTtlSeconds,
          ],
        )
      ).rows[0];
      await this.audit(client, trip.id, actor.id, 'requested', null, 'searching');
      return this.serialize(client, trip, actor);
    });
  }
  async get(actor: AuthenticatedUser, id: string) {
    return this.db.run(async (client) => {
      await this.expire(client);
      const trip = await this.trip(client, id);
      this.owner(actor, trip);
      return this.serialize(client, trip, actor);
    });
  }
  async detail(actor: AuthenticatedUser, id: string) {
    return this.db.run(async (client) => {
      await this.expire(client);
      const row = await this.trip(client, id);
      const audit = (
        await client.query(
          'SELECT id,actor_id,action,reason,created_at FROM passenger_trip_audit WHERE trip_id=$1 ORDER BY created_at,id',
          [id],
        )
      ).rows.map((item) => ({
        id: item.id,
        actorId: item.actor_id,
        action: item.action,
        reason: item.reason,
        createdAt: stamp(item.created_at),
      }));
      return { trip: await this.serialize(client, row, actor), audit };
    });
  }
  private role(actor: AuthenticatedUser, role: unknown): 'client' | 'driver' {
    if ((role !== 'client' && role !== 'driver') || !actor.roles.includes(role))
      throw new ForbiddenException('Selecciona un rol móvil autorizado.');
    return role;
  }
  async active(actor: AuthenticatedUser, requestedRole: unknown) {
    const role = this.role(actor, requestedRole);
    return this.db.run(async (client) => {
      await this.expire(client);
      const column = role === 'client' ? 'client_id' : 'driver_id';
      const row = (
        await client.query(
          `SELECT * FROM passenger_trips WHERE ${column}=$1 AND state=ANY($2::text[]) ORDER BY created_at DESC LIMIT 1`,
          [actor.id, ACTIVE],
        )
      ).rows[0];
      return { trip: row ? await this.serialize(client, row, actor) : null };
    });
  }
  async history(
    actor: AuthenticatedUser,
    query: { role?: string; limit?: string; offset?: string },
  ) {
    const role = this.role(actor, query.role);
    const input = parseList({ limit: query.limit ?? '20', offset: query.offset });
    return this.db.run(async (client) => {
      await this.expire(client);
      const column = role === 'client' ? 'client_id' : 'driver_id';
      const rows = (
        await client.query(
          `SELECT * FROM passenger_trips WHERE ${column}=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
          [actor.id, input.limit, input.offset],
        )
      ).rows;
      const total = (
        await client.query(
          `SELECT COUNT(*)::int AS total FROM passenger_trips WHERE ${column}=$1`,
          [actor.id],
        )
      ).rows[0].total;
      const items = [];
      for (const row of rows) items.push(await this.serialize(client, row, actor));
      return { items, total, limit: input.limit, offset: input.offset };
    });
  }
  async list(actor: AuthenticatedUser, query: { limit?: string; offset?: string; state?: string }) {
    const input = parseList(query);
    return this.db.run(async (client) => {
      await this.expire(client);
      const filter = input.state ? 'WHERE state=$3' : '';
      const params: unknown[] = [input.limit, input.offset];
      if (input.state) params.push(input.state);
      const rows = await client.query(
        `SELECT * FROM passenger_trips ${filter} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        params,
      );
      const count = await client.query(
        `SELECT COUNT(*)::int AS total FROM passenger_trips ${input.state ? 'WHERE state=$1' : ''}`,
        input.state ? [input.state] : [],
      );
      const items = [];
      for (const row of rows.rows) items.push(await this.serialize(client, row, actor));
      return { items, total: count.rows[0].total, limit: input.limit, offset: input.offset };
    });
  }
  async presence(actor: AuthenticatedUser) {
    return this.db.run(async (client) => {
      const row = (
        await client.query('SELECT * FROM driver_presence WHERE driver_id=$1', [actor.id])
      ).rows[0];
      let reason: string | null = null;
      try {
        await this.driverEligibility(client, actor.id, 1, true);
        const offer = (
          await client.query(
            "SELECT 1 FROM passenger_trip_offers WHERE driver_id=$1 AND state='pending' AND expires_at>NOW()",
            [actor.id],
          )
        ).rowCount;
        if (offer) reason = 'Tienes una oferta pendiente.';
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        reason = error.message;
      }
      return {
        online: Boolean(row?.available),
        available: Boolean(row?.available) && !reason,
        reason,
        location: row?.position ? { ...row.position, receivedAt: stamp(row.received_at) } : null,
      };
    });
  }
  async updatePosition(actor: AuthenticatedUser, body: unknown) {
    this.mobile(actor, 'driver');
    const input = parse(positionInput, body);
    assertFresh(input, Date.now(), this.getConfig().gpsMaxAgeSeconds);
    await this.db.run(async (client) => {
      await this.lockDriver(client, actor.id);
      if (actor.status !== 'active') {
        const active = (
          await client.query(
            "SELECT 1 FROM passenger_trips WHERE driver_id=$1 AND state IN ('assigned','arrived','in_progress')",
            [actor.id],
          )
        ).rowCount;
        if (!active)
          throw new ForbiddenException(
            'La cuenta suspendida solo puede atender su viaje existente.',
          );
      }
      const row = (
        await client.query(
          'SELECT captured_at FROM driver_presence WHERE driver_id=$1 FOR UPDATE',
          [actor.id],
        )
      ).rows[0];
      if (row && new Date(row.captured_at).getTime() >= Date.parse(input.capturedAt))
        throw new ConflictException('La ubicación es anterior a la última recibida.');
      await client.query(
        'INSERT INTO driver_presence(driver_id,position,captured_at,received_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(driver_id) DO UPDATE SET position=$2,captured_at=$3,sequence=driver_presence.sequence+1,received_at=NOW(),updated_at=NOW()',
        [actor.id, input, input.capturedAt],
      );
    });
    return this.presence(actor);
  }
  async availability(actor: AuthenticatedUser, body: unknown) {
    this.mobile(actor, 'driver');
    this.enabled();
    const input = parse(availabilityInput, body);
    await this.db.run(async (client) => {
      await this.lockDriver(client, actor.id);
      if (input.online) {
        this.activeAccount(actor);
        await this.driverEligibility(client, actor.id);
        const row = (
          await client.query('SELECT position FROM driver_presence WHERE driver_id=$1', [actor.id])
        ).rows[0];
        if (!row?.position) throw new ConflictException('Envía tu ubicación antes de conectarte.');
        assertFresh(row.position, Date.now(), this.getConfig().gpsMaxAgeSeconds);
      }
      await client.query(
        'INSERT INTO driver_presence(driver_id,available) VALUES($1,$2) ON CONFLICT(driver_id) DO UPDATE SET available=$2,updated_at=NOW()',
        [actor.id, input.online],
      );
    });
    return this.presence(actor);
  }
  async candidates(actor: AuthenticatedUser, id: string) {
    this.enabled();
    return this.db.run(async (client) => {
      await this.expire(client);
      const trip = await this.trip(client, id);
      if (trip.state !== 'searching') return { items: [] };
      const rows = (
        await client.query(
          'SELECT driver_id FROM driver_presence WHERE available AND captured_at>NOW()-make_interval(secs=>$1) ORDER BY received_at DESC LIMIT 100',
          [this.getConfig().gpsMaxAgeSeconds],
        )
      ).rows;
      const items = [];
      for (const row of rows) {
        try {
          const driver = await this.driverEligibility(
            client,
            row.driver_id,
            trip.passenger_count,
            true,
          );
          if (row.driver_id === trip.client_id) continue;
          this.coverage(driver.position);
          const offered = (
            await client.query(
              "SELECT 1 FROM passenger_trip_offers WHERE driver_id=$1 AND state='pending'",
              [row.driver_id],
            )
          ).rowCount;
          if (offered) continue;
          items.push({
            driverId: row.driver_id,
            displayName: driver.display_name,
            vehicle: {
              id: driver.vehicle_id,
              plate: driver.plate,
              make: driver.make,
              model: driver.model,
              capacityPassengers: driver.capacity_passengers,
            },
            location: driver.position,
            distanceMeters: distanceMeters(driver.position, trip.origin),
          });
        } catch (error) {
          if (!(error instanceof ConflictException) && !(error instanceof BadRequestException))
            throw error;
        }
      }
      items.sort((a, b) => a.distanceMeters - b.distanceMeters);
      return { items: items.slice(0, 50) };
    });
  }
  async assign(actor: AuthenticatedUser, id: string, body: unknown) {
    this.enabled();
    this.activeAccount(actor);
    uuid(id);
    const input = parse(offerInput, body);
    return this.command(actor, input.idempotencyKey, `offer:${id}`, input, async (client) => {
      const initial = await this.trip(client, id);
      await this.lockDriver(client, input.driverId, [initial.client_id, actor.id]);
      await this.expire(client);
      const trip = await this.trip(client, id, true);
      if (trip.state !== 'searching')
        throw new ConflictException('El viaje ya no está buscando conductor.');
      const customer = (
        await client.query('SELECT status FROM app_users WHERE id=$1 FOR SHARE', [trip.client_id])
      ).rows[0];
      if (customer?.status !== 'active')
        throw new ConflictException('El cliente no está habilitado para una asignación nueva.');
      if (trip.client_id === input.driverId)
        throw new ConflictException('El cliente no puede conducir su propio viaje.');
      const driver = await this.driverEligibility(
        client,
        input.driverId,
        trip.passenger_count,
        true,
      );
      this.coverage(driver.position);
      const row = (
        await client.query(
          'INSERT INTO passenger_trip_offers(trip_id,driver_id,vehicle_id,expires_at,created_by,reason) VALUES($1,$2,$3,LEAST(NOW()+make_interval(secs=>$7),$4),$5,$6) RETURNING *',
          [
            id,
            input.driverId,
            driver.vehicle_id,
            trip.search_expires_at,
            actor.id,
            input.reason,
            this.getConfig().offerTtlSeconds,
          ],
        )
      ).rows[0];
      const updated = (
        await client.query(
          'UPDATE passenger_trips SET version=version+1,updated_at=NOW() WHERE id=$1 RETURNING *',
          [id],
        )
      ).rows[0];
      await this.audit(
        client,
        id,
        actor.id,
        'offer_created',
        'searching',
        'searching',
        input.reason,
        { offerId: row.id, driverId: input.driverId },
      );
      return this.serialize(client, updated, actor);
    });
  }
  async offers(actor: AuthenticatedUser) {
    this.mobile(actor, 'driver');
    return this.db.run(async (client) => {
      await this.expire(client);
      const rows = (
        await client.query(
          "SELECT o.* FROM passenger_trip_offers o JOIN passenger_trips t ON t.id=o.trip_id WHERE o.driver_id=$1 AND o.state='pending' AND t.state='searching' ORDER BY o.created_at DESC",
          [actor.id],
        )
      ).rows;
      const items = [];
      for (const row of rows) {
        const trip = await this.trip(client, row.trip_id);
        items.push({ ...this.offer(row), trip: await this.serialize(client, trip, actor) });
      }
      return { items };
    });
  }
  async respond(actor: AuthenticatedUser, id: string, body: unknown) {
    this.mobile(actor, 'driver');
    this.enabled();
    this.activeAccount(actor);
    uuid(id);
    const input = parse(respondInput, body);
    const accept = input.decision === 'accept';
    return this.command(
      actor,
      input.idempotencyKey,
      `${accept ? 'accept' : 'reject'}:${id}`,
      input,
      async (client) => {
        const initial = (
          await client.query('SELECT * FROM passenger_trip_offers WHERE id=$1', [id])
        ).rows[0];
        if (!initial) throw new NotFoundException('Oferta no encontrada.');
        if (initial.driver_id !== actor.id)
          throw new ForbiddenException('La oferta pertenece a otro conductor.');
        const initialTrip = await this.trip(client, initial.trip_id);
        await this.lockDriver(client, actor.id, [initialTrip.client_id]);
        await this.expire(client);
        const trip = await this.trip(client, initial.trip_id, true);
        const offer = (
          await client.query('SELECT * FROM passenger_trip_offers WHERE id=$1 FOR UPDATE', [id])
        ).rows[0];
        if (
          offer.state !== 'pending' ||
          trip.state !== 'searching' ||
          new Date(offer.expires_at).getTime() <= Date.now()
        )
          throw new ConflictException('La oferta ya no está vigente.');
        if (!accept) {
          await client.query(
            "UPDATE passenger_trip_offers SET state='rejected',responded_at=NOW() WHERE id=$1",
            [id],
          );
          await client.query(
            'UPDATE passenger_trips SET version=version+1,updated_at=NOW() WHERE id=$1',
            [trip.id],
          );
          await this.audit(client, trip.id, actor.id, 'offer_rejected', 'searching', 'searching');
          return this.serialize(client, await this.trip(client, trip.id), actor);
        }
        const customer = (
          await client.query('SELECT status FROM app_users WHERE id=$1 FOR SHARE', [trip.client_id])
        ).rows[0];
        if (customer?.status !== 'active')
          throw new ConflictException('El cliente no está habilitado para una asignación nueva.');
        const driver = await this.driverEligibility(client, actor.id, trip.passenger_count, true);
        if (driver.vehicle_id !== offer.vehicle_id)
          throw new ConflictException('El vehículo seleccionado cambió.');
        const pin = String(randomInt(0, 1000000)).padStart(6, '0');
        const updated = (
          await client.query(
            "UPDATE passenger_trips SET state='assigned',driver_id=$2,vehicle_id=$3,assigned_at=NOW(),start_pin_cipher=$4,start_pin_hash=$5,pin_expires_at=NOW()+INTERVAL '30 minutes',version=version+1,updated_at=NOW() WHERE id=$1 RETURNING *",
            [trip.id, actor.id, offer.vehicle_id, this.cipher(pin), this.pinHash(trip.id, pin)],
          )
        ).rows[0];
        await client.query(
          "UPDATE passenger_trip_offers SET state=CASE WHEN id=$2 THEN 'accepted' ELSE 'withdrawn' END,responded_at=NOW() WHERE trip_id=$1 AND state='pending'",
          [trip.id, id],
        );
        await this.audit(client, trip.id, actor.id, 'offer_accepted', 'searching', 'assigned');
        return this.serialize(client, updated, actor);
      },
    );
  }
  private async activeDriver(
    client: PoolClient,
    actor: AuthenticatedUser,
    id: string,
    expected: string,
  ) {
    this.mobile(actor, 'driver');
    await this.lockDriver(client, actor.id);
    const trip = await this.trip(client, id, true);
    if (trip.driver_id !== actor.id)
      throw new ForbiddenException('Solo el conductor asignado puede realizar esta acción.');
    if (trip.state !== expected)
      throw new ConflictException('El viaje cambió de estado. Actualízalo antes de continuar.');
    return trip;
  }
  private async currentPosition(client: PoolClient, id: string) {
    const row = (
      await client.query('SELECT position,received_at FROM driver_presence WHERE driver_id=$1', [
        id,
      ])
    ).rows[0];
    if (
      !row?.position ||
      Date.now() - new Date(row.received_at).getTime() > this.getConfig().gpsMaxAgeSeconds * 1000
    )
      throw new ConflictException('Actualiza tu ubicación antes de registrar este hito.');
    assertFresh(row.position, Date.now(), this.getConfig().gpsMaxAgeSeconds);
    return row.position as Position;
  }
  async renewCode(actor: AuthenticatedUser, id: string, body: unknown) {
    this.mobile(actor, 'client');
    uuid(id);
    const input = parse(plainCommandInput, body);
    return this.command(actor, input.idempotencyKey, `renew-code:${id}`, input, async (client) => {
      await this.lockUsers(client, [actor.id]);
      const trip = await this.trip(client, id, true);
      if (trip.client_id !== actor.id)
        throw new ForbiddenException('Solo el cliente propietario puede renovar el código.');
      if (!['assigned', 'arrived'].includes(trip.state))
        throw new ConflictException(
          'El código solo puede renovarse antes de iniciar el viaje asignado.',
        );
      if (trip.pin_renewals >= 5)
        throw new ConflictException(
          'Se alcanzó el límite de renovaciones del código. Contacta a operaciones.',
        );
      const pin = String(randomInt(0, 1000000)).padStart(6, '0');
      const row = (
        await client.query(
          "UPDATE passenger_trips SET start_pin_cipher=$2,start_pin_hash=$3,pin_attempts=0,pin_renewals=pin_renewals+1,pin_expires_at=NOW()+INTERVAL '30 minutes',version=version+1,updated_at=NOW() WHERE id=$1 RETURNING *",
          [id, this.cipher(pin), this.pinHash(id, pin)],
        )
      ).rows[0];
      await this.audit(client, id, actor.id, 'start_code_renewed', trip.state, trip.state);
      return this.serialize(client, row, actor);
    });
  }
  async arrive(actor: AuthenticatedUser, id: string, body: unknown) {
    uuid(id);
    const input = parse(plainCommandInput, body);
    return this.command(actor, input.idempotencyKey, `arrive:${id}`, input, async (client) => {
      const trip = await this.activeDriver(client, actor, id, 'assigned');
      const position = await this.currentPosition(client, actor.id);
      assertNear(position, trip.origin, this.getConfig().arrivalRadiusMeters);
      const row = (
        await client.query(
          "UPDATE passenger_trips SET state='arrived',arrived_at=NOW(),version=version+1,updated_at=NOW() WHERE id=$1 RETURNING *",
          [id],
        )
      ).rows[0];
      await this.audit(client, id, actor.id, 'arrived', 'assigned', 'arrived', null, { position });
      return this.serialize(client, row, actor);
    });
  }
  async start(actor: AuthenticatedUser, id: string, body: unknown) {
    uuid(id);
    const input = parse(pinInput, body);
    const result = await this.command(
      actor,
      input.idempotencyKey,
      `start:${id}`,
      input,
      async (client) => {
        const trip = await this.activeDriver(client, actor, id, 'arrived');
        if (trip.pin_attempts >= 5)
          return {
            pinError:
              'Se agotaron los intentos del código. Solicita al pasajero renovar su código.',
          };
        if (!trip.pin_expires_at || new Date(trip.pin_expires_at).getTime() <= Date.now())
          return { pinError: 'El código venció. Solicita al pasajero renovar su código.' };
        if (this.pinHash(id, input.pin) !== trip.start_pin_hash) {
          await client.query(
            'UPDATE passenger_trips SET pin_attempts=pin_attempts+1,version=version+1,updated_at=NOW() WHERE id=$1',
            [id],
          );
          await this.audit(client, id, actor.id, 'start_pin_failed', 'arrived', 'arrived');
          return { pinError: 'Código incorrecto. Verifica el código con el pasajero.' };
        }
        const row = (
          await client.query(
            "UPDATE passenger_trips SET state='in_progress',started_at=NOW(),pin_consumed_at=NOW(),start_pin_cipher=NULL,start_pin_hash=NULL,version=version+1,updated_at=NOW() WHERE id=$1 RETURNING *",
            [id],
          )
        ).rows[0];
        await this.audit(client, id, actor.id, 'started', 'arrived', 'in_progress');
        return this.serialize(client, row, actor);
      },
    );
    if ('pinError' in result) throw new ConflictException(result.pinError);
    return result;
  }
  async finish(actor: AuthenticatedUser, id: string, body: unknown) {
    uuid(id);
    const input = parse(plainCommandInput, body);
    return this.command(actor, input.idempotencyKey, `finish:${id}`, input, async (client) => {
      const trip = await this.activeDriver(client, actor, id, 'in_progress');
      const position = await this.currentPosition(client, actor.id);
      assertNear(position, trip.destination, this.getConfig().arrivalRadiusMeters);
      const row = (
        await client.query(
          "UPDATE passenger_trips SET state='completed',completed_at=NOW(),completion_position=$2,version=version+1,updated_at=NOW() WHERE id=$1 RETURNING *",
          [id, position],
        )
      ).rows[0];
      await this.audit(client, id, actor.id, 'completed', 'in_progress', 'completed', null, {
        position,
      });
      return this.serialize(client, row, actor);
    });
  }
  async declareCash(actor: AuthenticatedUser, id: string, body: unknown) {
    this.mobile(actor, 'driver');
    uuid(id);
    const input = parse(cashInput, body);
    return this.command(actor, input.idempotencyKey, `cash:${id}`, input, async (client) => {
      await this.lockDriver(client, actor.id);
      const trip = await this.trip(client, id, true);
      if (trip.driver_id !== actor.id)
        throw new ForbiddenException('Solo el conductor asignado declara este cobro.');
      if (trip.state !== 'completed')
        throw new ConflictException('Registra el cobro después de finalizar el viaje.');
      const status = cashStatus(trip.amount_cents, input.receivedCents, input.reason);
      await client.query(
        'INSERT INTO passenger_cash_declarations(trip_id,actor_id,expected_cents,received_cents,status,reason) VALUES($1,$2,$3,$4,$5,$6)',
        [id, actor.id, trip.amount_cents, input.receivedCents, status, input.reason ?? null],
      );
      const row = (
        await client.query(
          'UPDATE passenger_trips SET version=version+1,updated_at=NOW() WHERE id=$1 RETURNING *',
          [id],
        )
      ).rows[0];
      await this.audit(
        client,
        id,
        actor.id,
        'cash_declared',
        'completed',
        'completed',
        input.reason ?? null,
        { expectedCents: trip.amount_cents, receivedCents: input.receivedCents, status },
      );
      return this.serialize(client, row, actor);
    });
  }
  async cancel(actor: AuthenticatedUser, id: string, body: unknown) {
    uuid(id);
    const input = parse(reasonInput, body);
    return this.command(actor, input.idempotencyKey, `cancel:${id}`, input, async (client) => {
      const initial = await this.trip(client, id);
      if (initial.driver_id)
        await this.lockDriver(client, initial.driver_id, [initial.client_id, actor.id]);
      else await this.lockUsers(client, [initial.client_id, actor.id]);
      const trip = await this.trip(client, id, true);
      if (trip.client_id !== actor.id && !this.staff(actor))
        throw new ForbiddenException('No puedes cancelar este viaje.');
      if (!['searching', 'assigned', 'arrived'].includes(trip.state))
        throw new ConflictException('No se puede cancelar un viaje iniciado o terminado.');
      const row = (
        await client.query(
          "UPDATE passenger_trips SET state='cancelled',ended_reason=$2,start_pin_hash=NULL,start_pin_cipher=NULL,version=version+1,updated_at=NOW() WHERE id=$1 RETURNING *",
          [id, input.reason],
        )
      ).rows[0];
      await client.query(
        "UPDATE passenger_trip_offers SET state='withdrawn',responded_at=NOW() WHERE trip_id=$1 AND state='pending'",
        [id],
      );
      await this.audit(client, id, actor.id, 'cancelled', trip.state, 'cancelled', input.reason);
      return this.serialize(client, row, actor);
    });
  }
}
