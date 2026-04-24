import { Injectable } from '@nestjs/common';
import { TimeOffRequest } from './entities/time-off-request.entity';
import { TimeOffRequestRepository } from './repositories/time-off-request.repository';
import { BalanceService } from '../balance/balance.service';
import { HcmClient } from '../hcm/hcm.client';
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

@Injectable()
export class TimeOffService {
  constructor(
    private readonly requestRepo: TimeOffRequestRepository,
    private readonly balanceService: BalanceService,
    private readonly hcmClient: HcmClient,
  ) {}

  async submit(dto: SubmitTimeOffRequestDto, idempotencyKey: string): Promise<SubmitResult> {
    throw new Error('Not implemented');
  }

  async approve(id: string, dto: ApproveRequestDto): Promise<TimeOffRequest> {
    throw new Error('Not implemented');
  }

  async reject(id: string, dto: RejectRequestDto): Promise<TimeOffRequest> {
    throw new Error('Not implemented');
  }

  async cancel(id: string, requestingEmployeeId: string): Promise<TimeOffRequest> {
    throw new Error('Not implemented');
  }

  async findById(id: string): Promise<TimeOffRequest> {
    throw new Error('Not implemented');
  }

  async list(query: ListRequestsQueryDto): Promise<PaginatedRequests> {
    throw new Error('Not implemented');
  }

  deriveIdempotencyKey(dto: SubmitTimeOffRequestDto): string {
    throw new Error('Not implemented');
  }
}
