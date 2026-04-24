import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HcmClient } from './hcm.client';

@Module({
  imports: [ConfigModule],
  providers: [HcmClient],
  exports: [HcmClient],
})
export class HcmClientModule {}
