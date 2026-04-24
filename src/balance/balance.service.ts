import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { LeaveBalance } from './entities/leave-balance.entity';
import { LeaveBalanceRepository } from './repositories/leave-balance.repository';
import { HcmClient } from '../hcm/hcm.client';
import { GetBalanceQueryDto } from './dto/get-balance-query.dto';
import { SyncBalanceDto } from './dto/sync-balance.dto';
import { LeaveType } from '../common/enums/leave-type.enum';
import { v4 as uuidv4 } from 'uuid';

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
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async getBalance(
    employeeId: string,
    locationId: string,
    query: GetBalanceQueryDto,
  ): Promise<EmployeeBalanceResult> {
    if (query.refresh) {
      return this.syncFromHcm({ employeeId, locationId, leaveType: query.leaveType });
    }

    const allBalances = await this.balanceRepo.findAllForEmployee(employeeId, locationId);
    const balances = query.leaveType
      ? allBalances.filter((b) => b.leaveType === query.leaveType)
      : allBalances;

    const views = await Promise.all(balances.map((b) => this.toBalanceView(b)));
    return { employeeId, locationId, balances: views };
  }

  async syncFromHcm(dto: SyncBalanceDto): Promise<EmployeeBalanceResult> {
    const leaveTypes = dto.leaveType ? [dto.leaveType] : Object.values(LeaveType);
    const results = await Promise.allSettled(
      leaveTypes.map((lt) =>
        this.hcmClient.getBalance(dto.employeeId, dto.locationId, lt).then((hcm) => ({
          hcm,
          leaveType: lt,
        })),
      ),
    );

    const now = new Date().toISOString();
    const views: BalanceView[] = [];

    for (const result of results) {
      if (result.status === 'rejected') continue;
      const { hcm, leaveType } = result.value;

      const existing = await this.balanceRepo.findByDimension(dto.employeeId, dto.locationId, leaveType);
      const balance: Partial<LeaveBalance> = {
        id: existing?.id ?? uuidv4(),
        employeeId: dto.employeeId,
        locationId: dto.locationId,
        leaveType: leaveType as LeaveType,
        hcmBalance: hcm.balance,
        lastSyncedAt: now,
        version: (existing?.version ?? 0) + 1,
      };
      await this.balanceRepo.upsert(balance);

      const pendingDays = await this.getPendingDays(dto.employeeId, dto.locationId, leaveType);
      views.push({
        leaveType,
        hcmBalance: hcm.balance,
        pendingDays,
        availableBalance: hcm.balance - pendingDays,
        lastSyncedAt: now,
        isStale: false,
      });
    }

    return { employeeId: dto.employeeId, locationId: dto.locationId, balances: views };
  }

  /**
   * Returns available = hcm_balance - pending_days.
   * Returns null when no balance row exists (first-time employee — caller skips the pre-flight check).
   */
  async computeAvailable(
    employeeId: string,
    locationId: string,
    leaveType: string,
  ): Promise<{ available: number; balance: LeaveBalance } | null> {
    const balance = await this.balanceRepo.findByDimension(employeeId, locationId, leaveType);
    if (!balance) return null;

    const pendingDays = await this.getPendingDays(employeeId, locationId, leaveType);
    return { available: balance.hcmBalance - pendingDays, balance };
  }

  isStale(balance: LeaveBalance): boolean {
    const thresholdMinutes = this.config.get<number>('BALANCE_STALE_THRESHOLD_MINUTES', 30);
    const ageMs = Date.now() - new Date(balance.lastSyncedAt).getTime();
    return ageMs / 60_000 > thresholdMinutes;
  }

  async refreshActivePendingBalances(): Promise<void> {
    // Called by the cron job to refresh balances for employees with pending requests
    const rows: { employee_id: string; location_id: string }[] = await this.dataSource.query(
      `SELECT DISTINCT employee_id, location_id FROM time_off_requests
       WHERE status IN ('PENDING', 'HCM_DEDUCT_PENDING')`,
    );
    await Promise.allSettled(
      rows.map((r) =>
        this.syncFromHcm({ employeeId: r.employee_id, locationId: r.location_id }),
      ),
    );
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async toBalanceView(balance: LeaveBalance): Promise<BalanceView> {
    const pendingDays = await this.getPendingDays(
      balance.employeeId,
      balance.locationId,
      balance.leaveType,
    );
    return {
      leaveType: balance.leaveType,
      hcmBalance: balance.hcmBalance,
      pendingDays,
      availableBalance: balance.hcmBalance - pendingDays,
      lastSyncedAt: balance.lastSyncedAt,
      isStale: this.isStale(balance),
    };
  }

  private async getPendingDays(
    employeeId: string,
    locationId: string,
    leaveType: string,
  ): Promise<number> {
    const rows: { total: string }[] = await this.dataSource.query(
      `SELECT COALESCE(SUM(days_requested), 0) AS total
       FROM time_off_requests
       WHERE employee_id = ? AND location_id = ? AND leave_type = ?
         AND status IN ('PENDING', 'HCM_DEDUCT_PENDING')`,
      [employeeId, locationId, leaveType],
    );
    return Number(rows[0]?.total ?? 0);
  }
}
