import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { HcmClient } from './hcm.client';
import { BatchSyncDto, BatchSyncRecordDto } from './dto/batch-sync.dto';
import { BalanceUpdateWebhookDto } from './dto/balance-update-webhook.dto';
import { LeaveBalanceRepository } from '../balance/repositories/leave-balance.repository';
import { BalanceService } from '../balance/balance.service';
import { TimeOffRequestRepository } from '../time-off/repositories/time-off-request.repository';
import { HcmSyncLog, SyncStatus, SyncType } from '../database/entities/hcm-sync-log.entity';
import { LeaveBalance } from '../balance/entities/leave-balance.entity';
import { LeaveType } from '../common/enums/leave-type.enum';
import { RequestStatus } from '../common/enums/request-status.enum';
import { TimeOffRequest } from '../time-off/entities/time-off-request.entity';

export interface BatchSyncResult {
  syncLogId: string;
  status: SyncStatus;
  recordsReceived: number;
}

const MAX_RETRY_COUNT = 10;
const BATCH_CHUNK_SIZE = 500;
const OUT_OF_ORDER_SKEW_MS = 30_000;

@Injectable()
export class HcmSyncService {
  private readonly logger = new Logger(HcmSyncService.name);

  constructor(
    private readonly hcmClient: HcmClient,
    private readonly balanceRepo: LeaveBalanceRepository,
    private readonly balanceService: BalanceService,
    private readonly requestRepo: TimeOffRequestRepository,
    @InjectRepository(HcmSyncLog)
    private readonly syncLogRepo: Repository<HcmSyncLog>,
  ) {}

  // ── Real-time webhook ──────────────────────────────────────────────────────

  async processRealtimeWebhook(dto: BalanceUpdateWebhookDto): Promise<void> {
    // Idempotency: same eventId → no-op
    const alreadyProcessed = await this.syncLogRepo.findOneBy({ payloadHash: dto.eventId });
    if (alreadyProcessed) return;

    const existing = await this.balanceRepo.findByDimension(
      dto.employeeId,
      dto.locationId,
      dto.leaveType,
    );

    // Out-of-order guard: discard events older than lastSyncedAt minus skew tolerance
    if (existing) {
      const effectiveMs = new Date(dto.effectiveAt).getTime();
      const lastSyncedMs = new Date(existing.lastSyncedAt).getTime();
      if (effectiveMs < lastSyncedMs - OUT_OF_ORDER_SKEW_MS) {
        this.logger.warn(
          `Discarding out-of-order event ${dto.eventId}: effectiveAt=${dto.effectiveAt} lastSyncedAt=${existing.lastSyncedAt}`,
        );
        return;
      }
    }

    const isDecrease = existing !== null && dto.newBalance < existing.hcmBalance;

    // Upsert balance
    await this.balanceRepo.upsert({
      id: existing?.id ?? uuidv4(),
      employeeId: dto.employeeId,
      locationId: dto.locationId,
      leaveType: dto.leaveType as LeaveType,
      hcmBalance: dto.newBalance,
      lastSyncedAt: dto.effectiveAt,
      version: (existing?.version ?? 0) + 1,
    });

    // Warn if balance drop creates a deficit against pending requests
    if (isDecrease) {
      await this.checkDeficitAndWarn(dto.employeeId, dto.locationId, dto.leaveType, dto.newBalance);
    }

    // Mark eventId processed so duplicate deliveries are no-ops
    await this.recordSyncEvent(dto.eventId, SyncStatus.COMPLETED);
  }

  // ── Batch sync ─────────────────────────────────────────────────────────────

  async processBatchSync(dto: BatchSyncDto, rawBodyHash: string): Promise<BatchSyncResult> {
    // Idempotency: same payload hash → return existing log, no re-write
    const existingLog = await this.syncLogRepo.findOneBy({ payloadHash: rawBodyHash });
    if (existingLog) {
      return {
        syncLogId: existingLog.id,
        status: existingLog.status,
        recordsReceived: existingLog.recordsTotal ?? 0,
      };
    }

    // Create sync log upfront so concurrent duplicates can detect it
    const syncLog = this.syncLogRepo.create({
      id: uuidv4(),
      syncType: SyncType.BATCH,
      payloadHash: rawBodyHash,
      status: SyncStatus.PROCESSING,
      recordsTotal: dto.records.length,
      recordsUpdated: 0,
      errorMessage: null,
      completedAt: null,
    });
    await this.syncLogRepo.save(syncLog);

    try {
      let recordsUpdated = 0;
      const warnedKeys = new Set<string>();

      for (const chunk of this.chunkArray(dto.records, BATCH_CHUNK_SIZE)) {
        // Last-occurrence-wins within each chunk (preserves cross-chunk ordering)
        for (const record of this.deduplicateRecords(chunk)) {
          const existing = await this.balanceRepo.findByDimension(
            record.employeeId,
            record.locationId,
            record.leaveType,
          );
          const isDecrease = existing !== null && record.balance < existing.hcmBalance;

          await this.balanceRepo.upsert({
            id: existing?.id ?? uuidv4(),
            employeeId: record.employeeId,
            locationId: record.locationId,
            leaveType: record.leaveType as LeaveType,
            hcmBalance: record.balance,
            lastSyncedAt: dto.generatedAt,
            version: (existing?.version ?? 0) + 1,
          });
          recordsUpdated++;

          if (isDecrease) {
            const dimKey = `${record.employeeId}::${record.locationId}::${record.leaveType}`;
            if (!warnedKeys.has(dimKey)) {
              warnedKeys.add(dimKey);
              await this.checkDeficitAndWarn(
                record.employeeId,
                record.locationId,
                record.leaveType,
                record.balance,
              );
            }
          }
        }
      }

      syncLog.status = SyncStatus.COMPLETED;
      syncLog.recordsUpdated = recordsUpdated;
      syncLog.completedAt = new Date().toISOString();
      await this.syncLogRepo.save(syncLog);
    } catch (err) {
      syncLog.status = SyncStatus.FAILED;
      syncLog.errorMessage = err instanceof Error ? err.message : String(err);
      syncLog.completedAt = new Date().toISOString();
      await this.syncLogRepo.save(syncLog);
      throw err;
    }

    return {
      syncLogId: syncLog.id,
      status: syncLog.status,
      recordsReceived: dto.records.length,
    };
  }

  // ── Background retry job ───────────────────────────────────────────────────

  @Cron('*/5 * * * *', { name: 'async-pending-retry' })
  async retryAsyncPending(): Promise<void> {
    const pending = await this.requestRepo.findAsyncPending();
    if (pending.length === 0) return;

    this.logger.log(`Retrying ${pending.length} async-pending request(s)`);

    for (const request of pending) {
      try {
        if (request.status === RequestStatus.HCM_DEDUCT_PENDING) {
          await this.retryDeduct(request);
        } else if (request.status === RequestStatus.CANCELLATION_CREDIT_PENDING) {
          await this.retryCredit(request);
        }
      } catch (err) {
        this.logger.error(`Unexpected error retrying request ${request.id}`, err);
      }
    }
  }

  // ── Stale balance refresh ──────────────────────────────────────────────────

  @Cron('*/15 * * * *', { name: 'stale-balance-refresh' })
  async refreshStaleBalances(): Promise<void> {
    await this.balanceService.refreshActivePendingBalances();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async retryDeduct(request: TimeOffRequest): Promise<void> {
    if (request.retryCount >= MAX_RETRY_COUNT) {
      request.status = RequestStatus.RETRY_EXHAUSTED;
      this.logger.error(
        `RETRY_EXHAUSTED — deduct for request ${request.id} after ${MAX_RETRY_COUNT} attempts; ops alert required`,
      );
      await this.requestRepo.save(request);
      return;
    }

    try {
      const result = await this.hcmClient.deductBalance(
        request.employeeId,
        request.locationId,
        request.leaveType,
        request.daysRequested,
        request.idempotencyKey,
      );
      request.status = RequestStatus.APPROVED;
      request.hcmCommitted = 1;
      request.hcmTransactionId = result.transactionId;
      this.logger.log(`Request ${request.id} approved via retry deduct`);
    } catch (err) {
      const httpStatus = (err as any)?.response?.status;

      if (httpStatus === 422) {
        // HCM says no balance — surface back to PENDING for re-evaluation
        request.status = RequestStatus.PENDING;
        this.logger.warn(`Request ${request.id} reverted to PENDING — HCM INSUFFICIENT_BALANCE on retry`);
      } else if (httpStatus === 400) {
        request.status = RequestStatus.REJECTED;
        this.logger.warn(`Request ${request.id} REJECTED — HCM 400 on retry`);
      } else {
        // HCM unavailable — increment and let the next cron cycle retry
        request.retryCount++;
        this.logger.warn(`Request ${request.id} deduct retry failed (attempt ${request.retryCount}/${MAX_RETRY_COUNT})`);
      }
    }

    await this.requestRepo.save(request);
  }

  private async retryCredit(request: TimeOffRequest): Promise<void> {
    if (request.retryCount >= MAX_RETRY_COUNT) {
      request.status = RequestStatus.RETRY_EXHAUSTED;
      this.logger.error(
        `RETRY_EXHAUSTED — credit for request ${request.id} after ${MAX_RETRY_COUNT} attempts; escalated to ops`,
      );
      await this.requestRepo.save(request);
      return;
    }

    try {
      await this.hcmClient.creditBalance(
        request.employeeId,
        request.locationId,
        request.leaveType,
        request.daysRequested,
        request.hcmTransactionId!,
      );
      request.status = RequestStatus.CANCELLED;
      this.logger.log(`Request ${request.id} cancelled via retry credit`);
      // Refresh local balance so the restored days are visible immediately
      try {
        const hcm = await this.hcmClient.getBalance(request.employeeId, request.locationId, request.leaveType);
        await this.balanceService.syncFromHcm({
          employeeId: request.employeeId,
          locationId: request.locationId,
          leaveType: request.leaveType,
        });
        void hcm; // balance will be pulled by syncFromHcm
      } catch (e) {
        this.logger.warn(`Balance refresh after credit failed for ${request.id}: ${e}`);
      }
    } catch (err) {
      request.retryCount++;
      this.logger.warn(`Request ${request.id} credit retry failed (attempt ${request.retryCount}/${MAX_RETRY_COUNT})`);
    }

    await this.requestRepo.save(request);
  }

  private async checkDeficitAndWarn(
    employeeId: string,
    locationId: string,
    leaveType: string,
    newBalance: number,
  ): Promise<void> {
    const { total: pendingDays } = await this.requestRepo.findPendingDaysByDimension(
      employeeId,
      locationId,
      leaveType,
    );
    if (newBalance < pendingDays) {
      this.logger.warn(
        `BALANCE_DEFICIT_WARNING: employee=${employeeId} location=${locationId} type=${leaveType} ` +
        `balance=${newBalance} pendingDays=${pendingDays}`,
      );
    }
  }

  private async recordSyncEvent(eventId: string, status: SyncStatus): Promise<void> {
    const log = this.syncLogRepo.create({
      id: uuidv4(),
      syncType: SyncType.REALTIME,
      payloadHash: eventId,
      status,
      recordsTotal: 1,
      recordsUpdated: status === SyncStatus.COMPLETED ? 1 : 0,
      errorMessage: null,
      completedAt: new Date().toISOString(),
    });
    await this.syncLogRepo.save(log);
  }

  private deduplicateRecords(records: BatchSyncRecordDto[]): BatchSyncRecordDto[] {
    const seen = new Map<string, BatchSyncRecordDto>();
    for (const r of records) {
      const key = `${r.employeeId}::${r.locationId}::${r.leaveType}`;
      if (seen.has(key)) {
        this.logger.warn(`HCM_BATCH_DUPLICATE_RECORD: ${key} — keeping last occurrence`);
      }
      seen.set(key, r);
    }
    return Array.from(seen.values());
  }

  chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }
}
