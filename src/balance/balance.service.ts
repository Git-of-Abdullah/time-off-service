import { Injectable } from '@nestjs/common';
import { LeaveBalance } from './entities/leave-balance.entity';
import { LeaveBalanceRepository } from './repositories/leave-balance.repository';
import { HcmClient } from '../hcm/hcm.client';
import { GetBalanceQueryDto } from './dto/get-balance-query.dto';
import { SyncBalanceDto } from './dto/sync-balance.dto';
import { ConfigService } from '@nestjs/config';

export interface BalanceView {
  leaveType: string;
  hcmBalance: number;
  pendingDays: number;
  availableBalance: number;
  lastSyncedAt: string;
  isStale: boolean;
}

export interface EmployeeBalanceResult {
  employeeId: string;
  locationId: string;
  balances: BalanceView[];
}

@Injectable()
export class BalanceService {
  constructor(
    private readonly balanceRepo: LeaveBalanceRepository,
    private readonly hcmClient: HcmClient,
    private readonly config: ConfigService,
  ) {}

  async getBalance(
    employeeId: string,
    locationId: string,
    query: GetBalanceQueryDto,
  ): Promise<EmployeeBalanceResult> {
    throw new Error('Not implemented');
  }

  async syncFromHcm(dto: SyncBalanceDto): Promise<EmployeeBalanceResult> {
    throw new Error('Not implemented');
  }

  /**
   * Returns available = hcm_balance - pending_days.
   * Returns null if no balance record exists (first-time employee).
   */
  async computeAvailable(
    employeeId: string,
    locationId: string,
    leaveType: string,
  ): Promise<{ available: number; balance: LeaveBalance } | null> {
    throw new Error('Not implemented');
  }

  isStale(balance: LeaveBalance): boolean {
    throw new Error('Not implemented');
  }

  /** Refreshes stale balances for employees with active pending requests. */
  async refreshActivePendingBalances(): Promise<void> {
    throw new Error('Not implemented');
  }
}
