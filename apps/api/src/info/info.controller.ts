import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppConfig } from '../config/app-config';
import { Public } from '../auth/auth.decorators';

@ApiTags('Platform')
@Public()
@Controller('info')
export class InfoController {
  constructor(@Inject(AppConfig) private readonly config: AppConfig) {}

  @Get()
  @ApiOperation({ summary: 'Public platform metadata and initial market' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['name', 'environment', 'market', 'services'],
      properties: {
        name: { type: 'string', example: 'AppDelivery' },
        environment: { type: 'string', enum: ['development', 'test', 'production'] },
        market: {
          type: 'object',
          required: ['country', 'city', 'currency', 'currencySymbol', 'timeZone'],
          properties: {
            country: { type: 'string', example: 'BO' },
            city: { type: 'string', example: 'Santa Cruz de la Sierra' },
            currency: { type: 'string', example: 'BOB' },
            currencySymbol: { type: 'string', example: 'Bs' },
            timeZone: { type: 'string', example: 'America/La_Paz' },
          },
        },
        services: { type: 'array', items: { type: 'string', enum: ['passengers', 'parcels'] } },
      },
    },
  })
  getInfo() {
    const env = this.config.values;
    return {
      name: 'AppDelivery',
      environment: env.NODE_ENV,
      market: {
        country: env.MARKET_COUNTRY,
        city: env.MARKET_CITY,
        currency: env.MARKET_CURRENCY,
        currencySymbol: env.MARKET_CURRENCY_SYMBOL,
        timeZone: env.MARKET_TIME_ZONE,
      },
      services: ['passengers', 'parcels'],
    };
  }
}
