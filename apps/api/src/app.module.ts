import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { InfoModule } from './info/info.module';
import { AuthModule } from './auth';
import { DriversModule } from './drivers/drivers.module';

@Module({ imports: [ConfigModule, AuthModule, DriversModule, InfoModule, HealthModule] })
export class AppModule {}
