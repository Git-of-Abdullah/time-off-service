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
const MAX_RETRY_COUNT = 10;

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
    // Idempotency: return existing request for duplicate submissions
    const existing = await this.requestRepo.findByIdempotencyKey(idempotencyKey);
    if (existing) return { request: existing, created: false };

    // Round to nearest 0.5 as required by TRD
    const daysRequested = Math.round(dto.daysRequested * 2) / 2;

    // Overlap check — same employee/location/leaveType with active date range
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

    // Balance pre-flight — skip entirely for first-time employees (no balance row yet)
    const balanceResult = await this.balanceService.computeAvailable(
      dto.employeeId,
      dto.locationId,
      dto.leaveType,
    );
    if (balanceResult !== null) {
      if (balanceResult.available < daysRequested - EPSILON) {
        throw new UnprocessableEntityException({
          error: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient leave balance.',
          available: balanceResult.available,
          requested: daysRequested,
        });
      }
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

    const saved = await this.requestRepo.save(request);
    return { request: saved, created: true };
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

    // Re-verify balance inside a serialized SQLite transaction and reserve by setting
    // status to HCM_DEDUCT_PENDING. This is the authoritative concurrency guard.
    await this.requestRepo.getDataSource().transaction(async (manager) => {
      // Exclude this request from pending sum — its days are being "consumed" by this approval
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

      const balance = await manager
        .getRepository(LeaveBalance)
        .findOneBy({
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

      // Reserve: set HCM_DEDUCT_PENDING before leaving the transaction so no
      // concurrent approval can double-count these days
      request.status = RequestStatus.HCM_DEDUCT_PENDING;
      await manager.save(TimeOffRequest, request);
    });

    // Call HCM outside the transaction — the lock has been released
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
        // HCM reports insufficient balance — revert to PENDING so the request can be re-evaluated
        request.status = RequestStatus.PENDING;
        await this.requestRepo.save(request);
        throw new UnprocessableEntityException({
          error: 'INSUFFICIENT_BALANCE',
          message: 'HCM reported insufficient balance.',
        });
      }

      if (httpStatus === 400) {
        request.status = RequestStatus.REJECTED;
        request.managerNotes = (request.managerNotes ? request.managerNotes + ' | ' : '') + 'HCM rejected: bad request';
        await this.requestRepo.save(request);
        throw new UnprocessableEntityException({
          error: 'HCM_REJECTED',
          message: 'HCM rejected the deduction.',
        });
      }

      // Retryable HCM failure — leave as HCM_DEDUCT_PENDING for the background job
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
    const request = await this.requestRepo.findById(id);

    // Return 404 for both missing and unauthorized — prevents IDOR information leakage
    if (!request || request.employeeId !== requestingEmployeeId) {
      throw new NotFoundException({ error: 'REQUEST_NOT_FOUND', message: 'Request not found.' });
    }

    if (
      request.status !== RequestStatus.PENDING &&
      request.status !== RequestStatus.APPROVED
    ) {
      throw new ConflictException({
        error: 'INVALID_STATUS_TRANSITION',
        message: `Cannot cancel a request in status ${request.status}.`,
      });
    }

    // PENDING requests never had HCM deducted — cancel directly
    if (request.status === RequestStatus.PENDING) {
      request.status = RequestStatus.CANCELLED;
      return this.requestRepo.save(request);
    }

    // APPROVED with hcmCommitted — credit HCM
    if (request.hcmCommitted === 1) {
      try {
        await this.hcmClient.creditBalance(
          request.employeeId,
          request.locationId,
          request.leaveType,
          request.daysRequested,
          request.hcmTransactionId!,
        );
        request.status = RequestStatus.CANCELLED;
      } catch (err) {
        // HCM unavailable — queue for background retry
        this.logger.warn(`HCM credit failed for request ${id}, will retry via cron`);
        request.status = RequestStatus.CANCELLATION_CREDIT_PENDING;
      }
    } else {
      // APPROVED but hcmCommitted=0 is not a valid combination post-approval, but handle safely
      request.status = RequestStatus.CANCELLED;
    }

    return this.requestRepo.save(request);
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
