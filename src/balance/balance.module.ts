import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BalanceController } from './balance.controller';
import { BalanceService } from './balance.service';
import { LeaveBalanceRepository } from './repositories/leave-balance.repository';
import { LeaveBalance } from './entities/leave-balance.entity';
import { HcmClientModule } from '../hcm/hcm-client.module';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([LeaveBalance]), HcmClientModule],
  controllers: [BalanceController],
  providers: [BalanceService, LeaveBalanceRepository],
  exports: [BalanceService, LeaveBalanceRepository],
})
export class BalanceModule {}
