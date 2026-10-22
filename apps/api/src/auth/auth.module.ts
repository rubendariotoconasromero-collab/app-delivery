import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '../config/config.module';
import { AdminUsersController, AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';

@Module({
  imports: [ConfigModule],
  controllers: [AuthController, AdminUsersController],
  providers: [AuthRepository, AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService, AuthRepository],
})
export class AuthModule {}
