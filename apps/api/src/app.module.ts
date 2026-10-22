import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { InfoModule } from './info/info.module';
import { AuthModule } from './auth';
import { DriversModule } from './drivers/drivers.module';
import { TripsModule } from './trips/trips.module';

@Module({
  imports: [ConfigModule, AuthModule, DriversModule, TripsModule, InfoModule, HealthModule],
})
export class AppModule {}
