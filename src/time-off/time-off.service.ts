import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { TimeOffRequest } from './entities/time-off-request.entity';
import { TimeOffRequestRepository } from './repositories/time-off-request.repository';
import { BalanceService } from '../balance/balance.service';
import { HcmClient } from '../hcm/hcm.client';
import { RequestStatus } from '../common/enums/request-status.enum';
import { LeaveBalance } from '../balance/entities/leave-balance.entity';
import { SubmitTimeOffRequestDto } from './dto/submit-time-off-request.dto';
import { ApproveRequestDto } from './dto/approve-request.dto';
import { RejectRequestDto } from './dto/reject-request.dto';
import { ListRequestsQueryDto } from './dto/list-requests-query.dto';

export interface SubmitResult {
  request: TimeOffRequest;
  created: boolean;
}

export interface PaginatedRequests {
  data: TimeOffRequest[];
  pagination: { page: number; limit: number; total: number };
}

const EPSILON = 0.001;

@Injectable()
export class TimeOffService {
  private readonly logger = new Logger(TimeOffService.name);

  constructor(
    private readonly requestRepo: TimeOffRequestRepository,
    private readonly balanceService: BalanceService,
    private readonly hcmClient: HcmClient,
  ) {}

  // ── submit ─────────────────────────────────────────────────────────────────

  async submit(dto: SubmitTimeOffRequestDto, idempotencyKey: string): Promise<SubmitResult> {
    // Non-concurrent idempotency fast-path
    const existing = await this.requestRepo.findByIdempotencyKey(idempotencyKey);
    if (existing) return { request: existing, created: false };

    const daysRequested = Math.round(dto.daysRequested * 2) / 2;

    // Soft overlap check (outside transaction — acceptable pre-flight)
    const overlap = await this.requestRepo.findOverlapping(
      dto.employeeId,
      dto.locationId,
      dto.leaveType,
      dto.startDate,
      dto.endDate,
    );
    if (overlap) {
      throw new ConflictException({
        error: 'OVERLAPPING_REQUEST',
        message: 'An active request already exists for this date range.',
        conflictingRequestId: overlap.id,
      });
    }

    const request = new TimeOffRequest();
    request.id = uuidv4();
    request.idempotencyKey = idempotencyKey;
    request.employeeId = dto.employeeId;
    request.locationId = dto.locationId;
    request.leaveType = dto.leaveType;
    request.startDate = dto.startDate;
    request.endDate = dto.endDate;
    request.daysRequested = daysRequested;
    request.status = RequestStatus.PENDING;
    request.managerId = null;
    request.managerNotes = null;
    request.hcmTransactionId = null;
    request.hcmCommitted = 0;
    request.retryCount = 0;

    // Balance check + save inside a serialized transaction.
    // This is the concurrency guard: two simultaneous requests both read pending days,
    // but only one can commit; the second sees the first's days in the re-read and gets 422.
    try {
      await this.requestRepo.getDataSource().transaction(async (manager) => {
        const balanceRow = await manager
          .getRepository(LeaveBalance)
          .findOneBy({
            employeeId: dto.employeeId,
            locationId: dto.locationId,
            leaveType: dto.leaveType,
          });

        if (balanceRow) {
          const { total: pendingDays } = (await manager
            .getRepository(TimeOffRequest)
            .createQueryBuilder('r')
            .select('COALESCE(SUM(r.daysRequested), 0)', 'total')
            .where('r.employeeId = :eId', { eId: dto.employeeId })
            .andWhere('r.locationId = :lId', { lId: dto.locationId })
            .andWhere('r.leaveType = :lt', { lt: dto.leaveType })
            .andWhere("r.status IN ('PENDING', 'HCM_DEDUCT_PENDING')")
            .getRawOne()) as { total: number };

          const available = balanceRow.hcmBalance - pendingDays;
          if (available < daysRequested - EPSILON) {
            throw new UnprocessableEntityException({
              error: 'INSUFFICIENT_BALANCE',
              message: 'Insufficient leave balance.',
              available,
              requested: daysRequested,
            });
          }
        }
        // First-time employee: no balance row → skip check, allow submission

        await manager.save(TimeOffRequest, request);
      });
    } catch (err) {
      // Two identical requests raced past the fast-path idempotency check and hit
      // the UNIQUE constraint on idempotency_key. Return the winner's row.
      if (isUniqueConstraintError(err)) {
        const winner = await this.requestRepo.findByIdempotencyKey(idempotencyKey);
        if (winner) return { request: winner, created: false };
      }
      throw err;
    }

    return { request, created: true };
  }

  // ── approve ────────────────────────────────────────────────────────────────

  async approve(id: string, dto: ApproveRequestDto): Promise<TimeOffRequest> {
    const request = await this.requestRepo.findById(id);
    if (!request) {
      throw new NotFoundException({ error: 'REQUEST_NOT_FOUND', message: 'Request not found.' });
    }
    if (request.status !== RequestStatus.PENDING) {
      throw new ConflictException({
        error: 'INVALID_STATUS_TRANSITION',
        message: `Cannot approve a request in status ${request.status}.`,
      });
    }

    request.managerId = dto.managerId;
    request.managerNotes = dto.notes ?? null;

    // Re-verify balance and reserve inside a serialized transaction.
    // Excludes the current request from the pending sum (its days are being consumed).
    // Commits HCM_DEDUCT_PENDING before releasing the write lock so no concurrent
    // approval can double-count these days.
    await this.requestRepo.getDataSource().transaction(async (manager) => {
      const { total: otherPendingDays } = (await manager
        .getRepository(TimeOffRequest)
        .createQueryBuilder('r')
        .select('COALESCE(SUM(r.daysRequested), 0)', 'total')
        .where('r.employeeId = :eId', { eId: request.employeeId })
        .andWhere('r.locationId = :lId', { lId: request.locationId })
        .andWhere('r.leaveType = :lt', { lt: request.leaveType })
        .andWhere("r.status IN ('PENDING', 'HCM_DEDUCT_PENDING')")
        .andWhere('r.id != :id', { id })
        .getRawOne()) as { total: number };

      const balance = await manager.getRepository(LeaveBalance).findOneBy({
        employeeId: request.employeeId,
        locationId: request.locationId,
        leaveType: request.leaveType,
      });

      if (balance) {
        const available = balance.hcmBalance - otherPendingDays;
        if (available < request.daysRequested - EPSILON) {
          throw new UnprocessableEntityException({
            error: 'INSUFFICIENT_BALANCE',
            message: 'Insufficient balance to approve this request.',
            available,
            requested: request.daysRequested,
          });
        }
      }

      request.status = RequestStatus.HCM_DEDUCT_PENDING;
      await manager.save(TimeOffRequest, request);
    });

    // HCM call outside the transaction — write lock already released
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
    } catch (err) {
      const httpStatus = (err as any)?.response?.status;

      if (httpStatus === 422) {
        request.status = RequestStatus.PENDING;
        await this.requestRepo.save(request);
        throw new UnprocessableEntityException({
          error: 'INSUFFICIENT_BALANCE',
          message: 'HCM reported insufficient balance.',
        });
      }

      if (httpStatus === 400) {
        request.status = RequestStatus.REJECTED;
        request.managerNotes =
          (request.managerNotes ? request.managerNotes + ' | ' : '') + 'HCM rejected: bad request';
        await this.requestRepo.save(request);
        throw new UnprocessableEntityException({ error: 'HCM_REJECTED', message: 'HCM rejected the deduction.' });
      }

      // Retryable HCM failure — leave as HCM_DEDUCT_PENDING for cron retry
      this.logger.warn(`HCM deduct failed for request ${id}, will retry via cron`);
    }

    return this.requestRepo.save(request);
  }

  // ── reject ─────────────────────────────────────────────────────────────────

  async reject(id: string, dto: RejectRequestDto): Promise<TimeOffRequest> {
    const request = await this.requestRepo.findById(id);
    if (!request) {
      throw new NotFoundException({ error: 'REQUEST_NOT_FOUND', message: 'Request not found.' });
    }
    if (request.status !== RequestStatus.PENDING) {
      throw new ConflictException({
        error: 'INVALID_STATUS_TRANSITION',
        message: `Cannot reject a request in status ${request.status}.`,
      });
    }

    request.status = RequestStatus.REJECTED;
    request.managerId = dto.managerId;
    request.managerNotes = dto.notes ?? null;
    return this.requestRepo.save(request);
  }

  // ── cancel ─────────────────────────────────────────────────────────────────

  async cancel(id: string, requestingEmployeeId: string): Promise<TimeOffRequest> {
    // IDOR pre-check (outside transaction — lightweight ownership verification)
    const precheck = await this.requestRepo.findById(id);
    if (!precheck || precheck.employeeId !== requestingEmployeeId) {
      throw new NotFoundException({ error: 'REQUEST_NOT_FOUND', message: 'Request not found.' });
    }

    // Re-read status inside a transaction to guard against concurrent approve+cancel.
    // Without this, both operations read PENDING, approve commits APPROVED, then
    // cancel's save overwrites it with CANCELLED — wrong winner.
    let result!: TimeOffRequest;
    let needsHcmCredit = false;

    await this.requestRepo.getDataSource().transaction(async (manager) => {
      const fresh = await manager.getRepository(TimeOffRequest).findOneBy({ id });
      if (!fresh || fresh.employeeId !== requestingEmployeeId) {
        throw new NotFoundException({ error: 'REQUEST_NOT_FOUND', message: 'Request not found.' });
      }
      if (fresh.status !== RequestStatus.PENDING && fresh.status !== RequestStatus.APPROVED) {
        throw new ConflictException({
          error: 'INVALID_STATUS_TRANSITION',
          message: `Cannot cancel a request in status ${fresh.status}.`,
        });
      }

      if (fresh.status === RequestStatus.PENDING) {
        fresh.status = RequestStatus.CANCELLED;
      } else {
        // Stage as CANCELLATION_CREDIT_PENDING; HCM credit attempted below outside the lock
        needsHcmCredit = fresh.hcmCommitted === 1;
        fresh.status = RequestStatus.CANCELLATION_CREDIT_PENDING;
      }

      result = await manager.save(TimeOffRequest, fresh);
    });

    // HCM credit outside the lock (approved cancellations only)
    if (needsHcmCredit) {
      try {
        await this.hcmClient.creditBalance(
          result.employeeId,
          result.locationId,
          result.leaveType,
          result.daysRequested,
          result.hcmTransactionId!,
        );
        result.status = RequestStatus.CANCELLED;
        result = await this.requestRepo.save(result);
      } catch {
        // Leave as CANCELLATION_CREDIT_PENDING — cron will retry
        this.logger.warn(`HCM credit failed for request ${id}, will retry via cron`);
      }
    }

    return result;
  }

  // ── read ───────────────────────────────────────────────────────────────────

  async findById(id: string): Promise<TimeOffRequest> {
    const request = await this.requestRepo.findById(id);
    if (!request) {
      throw new NotFoundException({ error: 'REQUEST_NOT_FOUND', message: 'Request not found.' });
    }
    return request;
  }

  async list(query: ListRequestsQueryDto): Promise<PaginatedRequests> {
    const limit = query.limit ?? 20;
    const page = query.page ?? 1;
    const { data, total } = await this.requestRepo.findWithFilters(query);
    return { data, pagination: { page, limit, total } };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  deriveIdempotencyKey(dto: SubmitTimeOffRequestDto): string {
    const payload = [
      dto.employeeId,
      dto.locationId,
      dto.leaveType,
      dto.startDate,
      dto.endDate,
      String(dto.daysRequested),
    ].join('|');
    return createHash('sha256').update(payload).digest('hex');
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('UNIQUE constraint failed');
}
