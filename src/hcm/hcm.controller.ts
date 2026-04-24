import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { createHash } from 'crypto';
import { HcmSyncService } from './hcm-sync.service';
import { BatchSyncDto } from './dto/batch-sync.dto';
import { BalanceUpdateWebhookDto } from './dto/balance-update-webhook.dto';
import { HmacSignatureGuard } from '../common/guards/hmac-signature.guard';

@Controller('hcm')
@UseGuards(HmacSignatureGuard)
export class HcmController {
  constructor(private readonly hcmSyncService: HcmSyncService) {}

  @Post('batch-sync')
  @HttpCode(HttpStatus.ACCEPTED)
  batchSync(@Body() dto: BatchSyncDto, @Req() req: Request) {
    const rawBody: Buffer = (req as any).rawBody;
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    return this.hcmSyncService.processBatchSync(dto, payloadHash);
  }

  @Post('balance-update')
  @HttpCode(HttpStatus.OK)
  balanceUpdate(@Body() dto: BalanceUpdateWebhookDto) {
    return this.hcmSyncService.processRealtimeWebhook(dto).then(() => ({ acknowledged: true }));
  }
}
