import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HcmController } from './hcm.controller';
import { HcmSyncService } from './hcm-sync.service';
import { HcmClientModule } from './hcm-client.module';
import { HcmSyncLog } from '../database/entities/hcm-sync-log.entity';
import { BalanceModule } from '../balance/balance.module';
import { TimeOffModule } from '../time-off/time-off.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([HcmSyncLog]),
    HcmClientModule,
    BalanceModule,
    TimeOffModule,
  ],
  controllers: [HcmController],
  providers: [HcmSyncService],
  exports: [HcmClientModule],
})
export class HcmModule {}
