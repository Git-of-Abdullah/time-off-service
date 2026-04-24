import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { HcmClient } from './hcm.client';
import { BatchSyncDto } from './dto/batch-sync.dto';
import { BalanceUpdateWebhookDto } from './dto/balance-update-webhook.dto';
import { LeaveBalanceRepository } from '../balance/repositories/leave-balance.repository';
import { TimeOffRequestRepository } from '../time-off/repositories/time-off-request.repository';
import { InjectRepository } from '@nestjs/typeorm';
import { HcmSyncLog, SyncStatus } from '../database/entities/hcm-sync-log.entity';
import { Repository } from 'typeorm';

export interface BatchSyncResult {
  syncLogId: string;
  status: SyncStatus;
  recordsReceived: number;
}

@Injectable()
export class HcmSyncService {
  private readonly logger = new Logger(HcmSyncService.name);

  constructor(
    private readonly hcmClient: HcmClient,
    private readonly balanceRepo: LeaveBalanceRepository,
    private readonly requestRepo: TimeOffRequestRepository,
    @InjectRepository(HcmSyncLog)
    private readonly syncLogRepo: Repository<HcmSyncLog>,
    private readonly config: ConfigService,
  ) {}

  async processBatchSync(dto: BatchSyncDto, rawBodyHash: string): Promise<BatchSyncResult> {
    throw new Error('Not implemented');
  }

  async processRealtimeWebhook(dto: BalanceUpdateWebhookDto): Promise<void> {
    throw new Error('Not implemented');
  }

  @Cron('*/5 * * * *', { name: 'async-pending-retry' })
  async retryAsyncPending(): Promise<void> {
    throw new Error('Not implemented');
  }

  @Cron('*/15 * * * *', { name: 'stale-balance-refresh' })
  async refreshStaleBalances(): Promise<void> {
    throw new Error('Not implemented');
  }

  private chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }
}
