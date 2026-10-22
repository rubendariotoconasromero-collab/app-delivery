import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, Roles } from '../auth';
import { DriverService, UploadFile } from './driver.service';

const upload = () =>
  FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 3 } });

const vehicleBody = () =>
  ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['plate', 'make', 'model', 'year', 'capacityPassengers', 'serviceTypes'],
      properties: {
        plate: {
          type: 'string',
          minLength: 3,
          maxLength: 15,
          description: 'Matrícula; se normaliza a mayúsculas.',
        },
        make: { type: 'string', minLength: 2, maxLength: 80 },
        model: { type: 'string', minLength: 1, maxLength: 80 },
        year: { type: 'integer', minimum: 1900, maximum: new Date().getUTCFullYear() + 1 },
        capacityPassengers: { type: 'integer', minimum: 1, maximum: 8 },
        serviceTypes: {
          type: 'array',
          minItems: 1,
          maxItems: 2,
          uniqueItems: true,
          items: { type: 'string', enum: ['passengers', 'parcels'] },
        },
      },
    },
  });
const reviewBody = () =>
  ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['decision', 'reason'],
      properties: {
        decision: { type: 'string', enum: ['approve', 'reject', 'suspend'] },
        reason: { type: 'string', minLength: 3, maxLength: 1000 },
      },
    },
  });

@ApiTags('Driver onboarding')
@ApiBearerAuth()
@Controller('drivers/me')
@Roles('driver')
export class DriversController {
  constructor(@Inject(DriverService) private readonly drivers: DriverService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.drivers.overview(user.id);
  }
  @Put()
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['fullName'],
      properties: { fullName: { type: 'string', minLength: 3, maxLength: 150 } },
    },
  })
  save(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.drivers.saveProfile(user, body);
  }
  @Post('submit') submit(@CurrentUser() user: AuthenticatedUser) {
    return this.drivers.submit(user);
  }
  @Post('documents')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['kind', 'file'],
      properties: {
        kind: { type: 'string', enum: ['identity_document', 'driver_license'] },
        expiresOn: { type: 'string', format: 'date' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(upload())
  document(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
    @UploadedFile() file: UploadFile | undefined,
  ) {
    return this.drivers.upload(user, body, file);
  }
  @Post('vehicles')
  @vehicleBody()
  createVehicle(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.drivers.createVehicle(user, body);
  }
  @Put('vehicles/:id')
  @vehicleBody()
  editVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.drivers.updateVehicle(user, id, body);
  }
  @Post('vehicles/:id/submit') submitVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.drivers.submit(user, id);
  }
  @Post('vehicles/:id/activate') activateVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.drivers.activate(user, id);
  }
  @Post('vehicles/:id/documents')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['kind', 'expiresOn', 'file'],
      properties: {
        kind: { type: 'string', enum: ['vehicle_registration'] },
        expiresOn: { type: 'string', format: 'date' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(upload())
  vehicleDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @UploadedFile() file: UploadFile | undefined,
  ) {
    return this.drivers.upload(user, body, file, id);
  }
}

@ApiTags('Driver review')
@ApiCookieAuth()
@Roles('admin')
@Controller('admin')
export class DriverReviewController {
  constructor(@Inject(DriverService) private readonly drivers: DriverService) {}
  @Get('drivers')
  @Header('Cache-Control', 'no-store')
  list(@Query() query: { status?: string; limit?: string; offset?: string }) {
    return this.drivers.list(query);
  }
  @Get('drivers/:id')
  @Header('Cache-Control', 'no-store')
  detail(@Param('id') id: string) {
    return this.drivers.overview(id, true);
  }
  @Post('drivers/:id/review')
  @reviewBody()
  reviewDriver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.drivers.review(user, id, body);
  }
  @Post('vehicles/:id/review')
  @reviewBody()
  reviewVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.drivers.review(user, id, body, true);
  }
}

@ApiTags('Private documents')
@ApiBearerAuth()
@ApiCookieAuth()
@Controller('documents')
export class DriverDocumentsController {
  constructor(@Inject(DriverService) private readonly drivers: DriverService) {}
  @Get(':id') async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res() response: { setHeader(name: string, value: string): void; end(data: Buffer): void },
  ) {
    const file = await this.drivers.download(user, id);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Type', file.document.mimeType);
    response.setHeader('Content-Length', String(file.data.length));
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.document.originalName)}`,
    );
    response.end(file.data);
  }
}
