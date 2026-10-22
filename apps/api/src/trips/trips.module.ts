import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { TripRepository } from './trip.repository';
import { TripRouting } from './trip.routing';
import { TripService } from './trip.service';
import { TripAdminController, TripDriverController, TripsController } from './trips.controller';

@Module({
  imports: [AuthModule],
  controllers: [TripsController, TripDriverController, TripAdminController],
  providers: [TripRepository, TripRouting, TripService],
  exports: [TripService],
})
export class TripsModule {}
