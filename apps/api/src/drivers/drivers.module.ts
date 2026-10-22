import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { DriverRepository } from './driver.repository';
import { DriverService } from './driver.service';
import {
  DriverDocumentsController,
  DriverReviewController,
  DriversController,
} from './drivers.controller';

@Module({
  imports: [AuthModule],
  controllers: [DriversController, DriverReviewController, DriverDocumentsController],
  providers: [DriverRepository, DriverService],
  exports: [DriverService],
})
export class DriversModule {}
