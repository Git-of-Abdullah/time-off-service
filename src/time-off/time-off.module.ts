import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeOffController } from './time-off.controller';
import { TimeOffService } from './time-off.service';
import { TimeOffRequestRepository } from './repositories/time-off-request.repository';
import { TimeOffRequest } from './entities/time-off-request.entity';
import { BalanceModule } from '../balance/balance.module';

@Module({
  imports: [TypeOrmModule.forFeature([TimeOffRequest]), BalanceModule],
  controllers: [TimeOffController],
  providers: [TimeOffService, TimeOffRequestRepository],
  exports: [TimeOffService, TimeOffRequestRepository],
})
export class TimeOffModule {}
