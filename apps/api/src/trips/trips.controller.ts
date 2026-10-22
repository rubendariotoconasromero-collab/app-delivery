import { Body, Controller, Get, Header, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, ExistingTripAccess, Roles } from '../auth';
import { TripService } from './trip.service';

const idempotency = { idempotencyKey: { type: 'string' as const, format: 'uuid' } };
const commandBody = () =>
  ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['idempotencyKey'],
      properties: idempotency,
    },
  });
const point = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['latitude', 'longitude', 'address'],
  properties: {
    latitude: { type: 'number' as const, minimum: -90, maximum: 90 },
    longitude: { type: 'number' as const, minimum: -180, maximum: 180 },
    address: { type: 'string' as const, minLength: 3, maxLength: 200 },
    reference: { type: 'string' as const, maxLength: 300 },
  },
};

@ApiTags('Passenger trips')
@ApiBearerAuth()
@Controller('trips')
export class TripsController {
  constructor(@Inject(TripService) private readonly trips: TripService) {}
  @Get('config') @Header('Cache-Control', 'no-store') @ExistingTripAccess() config() {
    return this.trips.getConfig();
  }
  @Post('quotes')
  @Roles('client')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['origin', 'destination', 'passengerCount'],
      properties: {
        origin: point,
        destination: point,
        passengerCount: { type: 'integer', minimum: 1, maximum: 8 },
      },
    },
  })
  async quote(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return { quote: await this.trips.createQuote(actor, body) };
  }
  @Post()
  @Roles('client')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['quoteId', 'idempotencyKey'],
      properties: { ...idempotency, quoteId: { type: 'string', format: 'uuid' } },
    },
  })
  async create(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return { trip: await this.trips.request(actor, body) };
  }
  @Get('active')
  @Header('Cache-Control', 'no-store')
  @ExistingTripAccess()
  active(@CurrentUser() actor: AuthenticatedUser, @Query('role') role: string) {
    return this.trips.active(actor, role);
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  @ExistingTripAccess()
  history(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: { role?: string; limit?: string; offset?: string },
  ) {
    return this.trips.history(actor, query);
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ExistingTripAccess()
  async get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return { trip: await this.trips.get(actor, id) };
  }
  @Post(':id/start-code')
  @Roles('client')
  @ExistingTripAccess()
  @commandBody()
  async renew(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return { trip: await this.trips.renewCode(actor, id, body) };
  }
  @Post(':id/cancel')
  @ExistingTripAccess()
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['idempotencyKey', 'reason'],
      properties: { ...idempotency, reason: { type: 'string', minLength: 3, maxLength: 1000 } },
    },
  })
  async cancel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return { trip: await this.trips.cancel(actor, id, body) };
  }
  @Post(':id/arrive')
  @Roles('driver')
  @ExistingTripAccess()
  @commandBody()
  async arrive(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return { trip: await this.trips.arrive(actor, id, body) };
  }
  @Post(':id/start')
  @Roles('driver')
  @ExistingTripAccess()
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['idempotencyKey', 'pin'],
      properties: { ...idempotency, pin: { type: 'string', pattern: '^[0-9]{6}$' } },
    },
  })
  async start(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return { trip: await this.trips.start(actor, id, body) };
  }
  @Post(':id/finish')
  @Roles('driver')
  @ExistingTripAccess()
  @commandBody()
  async finish(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return { trip: await this.trips.finish(actor, id, body) };
  }
  @Post(':id/cash')
  @Roles('driver')
  @ExistingTripAccess()
  @ApiOperation({ summary: 'Declarar efectivo recibido; la conciliación permanece pendiente.' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['idempotencyKey', 'receivedCents'],
      properties: { ...idempotency, receivedCents: { type: 'integer', minimum: 0 } },
    },
  })
  async cash(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return { trip: await this.trips.declareCash(actor, id, body) };
  }
}

@ApiTags('Passenger driver availability')
@ApiBearerAuth()
@Controller('drivers/me')
@Roles('driver')
export class TripDriverController {
  constructor(@Inject(TripService) private readonly trips: TripService) {}
  @Get('availability') @Header('Cache-Control', 'no-store') @ExistingTripAccess() availability(
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.trips.presence(actor);
  }
  @Post('location')
  @ExistingTripAccess()
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['latitude', 'longitude', 'accuracyMeters', 'capturedAt'],
      properties: {
        latitude: { type: 'number', minimum: -90, maximum: 90 },
        longitude: { type: 'number', minimum: -180, maximum: 180 },
        accuracyMeters: { type: 'number', minimum: 0, maximum: 100 },
        capturedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  location(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.trips.updatePosition(actor, body);
  }
  @Put('availability')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['online'],
      properties: { online: { type: 'boolean' } },
    },
  })
  setAvailability(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.trips.availability(actor, body);
  }
  @Get('trip-offers') @Header('Cache-Control', 'no-store') offers(
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.trips.offers(actor);
  }
  @Post('trip-offers/:id/respond')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['decision', 'idempotencyKey'],
      properties: { ...idempotency, decision: { type: 'string', enum: ['accept', 'reject'] } },
    },
  })
  async respond(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return { trip: await this.trips.respond(actor, id, body) };
  }
}

@ApiTags('Passenger trip operations')
@ApiCookieAuth()
@Controller('admin/trips')
@Roles('operator', 'admin')
export class TripAdminController {
  constructor(@Inject(TripService) private readonly trips: TripService) {}
  @Get() @Header('Cache-Control', 'no-store') list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: { state?: string; limit?: string; offset?: string },
  ) {
    return this.trips.list(actor, query);
  }
  @Get(':id') @Header('Cache-Control', 'no-store') detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.trips.detail(actor, id);
  }
  @Get(':id/candidates') @Header('Cache-Control', 'no-store') candidates(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.trips.candidates(actor, id);
  }
  @Post(':id/assign')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['driverId', 'reason', 'idempotencyKey'],
      properties: {
        ...idempotency,
        driverId: { type: 'string', format: 'uuid' },
        reason: { type: 'string', minLength: 3, maxLength: 1000 },
      },
    },
  })
  async assign(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return { trip: await this.trips.assign(actor, id, body) };
  }
}
