import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module';
import { TimeOffModule } from './time-off/time-off.module';
import { BalanceModule } from './balance/balance.module';
import { HcmModule } from './hcm/hcm.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    BalanceModule,
    TimeOffModule,
    HcmModule,
  ],
})
export class AppModule {}
