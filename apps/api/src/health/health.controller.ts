import { Controller, Get, HttpStatus, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DependencyProbe } from '../infrastructure/dependency-probe';
import { Public } from '../auth/auth.decorators';

const readinessSchema = {
  type: 'object' as const,
  required: ['status', 'dependencies'],
  properties: {
    status: { type: 'string' as const, enum: ['ok', 'degraded'] },
    dependencies: {
      type: 'object' as const,
      required: ['postgres', 'postgis', 'redis'],
      properties: Object.fromEntries(
        ['postgres', 'postgis', 'redis'].map((name) => [
          name,
          {
            type: 'object' as const,
            required: ['status'],
            properties: { status: { type: 'string' as const, enum: ['up', 'down'] } },
          },
        ]),
      ),
    },
  },
};

@ApiTags('Health')
@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(DependencyProbe) private readonly probe: DependencyProbe) {}

  @Get('live')
  @ApiOperation({ summary: 'Process liveness; no database or Redis connection is required' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['status', 'service'],
      properties: {
        status: { type: 'string', enum: ['ok'] },
        service: { type: 'string', enum: ['api'] },
      },
    },
  })
  live() {
    return { status: 'ok', service: 'api' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Bounded checks for PostgreSQL, PostGIS extension and Redis' })
  @ApiOkResponse({ schema: readinessSchema })
  @ApiResponse({ status: HttpStatus.SERVICE_UNAVAILABLE, schema: readinessSchema })
  async ready() {
    const readiness = await this.probe.check();
    if (readiness.status === 'degraded') throw new ServiceUnavailableException(readiness);
    return readiness;
  }
}
