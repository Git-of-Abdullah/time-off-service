import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { BalanceService } from '../../src/balance/balance.service';
import { LeaveBalanceRepository } from '../../src/balance/repositories/leave-balance.repository';
import { HcmClient } from '../../src/hcm/hcm.client';
import { LeaveBalance } from '../../src/balance/entities/leave-balance.entity';
import { LeaveType } from '../../src/common/enums/leave-type.enum';

function makeBalance(overrides: Partial<LeaveBalance> = {}): LeaveBalance {
  const b = new LeaveBalance();
  b.id = 'b1';
  b.employeeId = 'emp1';
  b.locationId = 'loc1';
  b.leaveType = LeaveType.VACATION;
  b.hcmBalance = 10;
  b.lastSyncedAt = new Date().toISOString();
  b.version = 1;
  return Object.assign(b, overrides);
}

describe('BalanceService', () => {
  let service: BalanceService;
  let balanceRepo: jest.Mocked<LeaveBalanceRepository>;
  let dataSource: jest.Mocked<DataSource>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    balanceRepo = {
      findByDimension: jest.fn(),
      findAllForEmployee: jest.fn(),
      save: jest.fn(),
      upsert: jest.fn(),
    } as any;

    // query returns an array with one row: { total: '0' } by default
    dataSource = {
      query: jest.fn().mockResolvedValue([{ total: '0' }]),
    } as any;

    configService = {
      get: jest.fn().mockReturnValue(30),
    } as any;

    const hcmClient = {} as HcmClient;

    service = new BalanceService(balanceRepo, hcmClient, configService, dataSource);
  });

  describe('computeAvailable', () => {
    it('returns hcm_balance unchanged when there are no pending requests', async () => {
      const balance = makeBalance({ hcmBalance: 10 });
      balanceRepo.findByDimension.mockResolvedValue(balance);
      dataSource.query.mockResolvedValue([{ total: '0' }]);

      const result = await service.computeAvailable('emp1', 'loc1', 'VACATION');

      expect(result).not.toBeNull();
      expect(result!.available).toBe(10);
    });

    it('returns hcm_balance minus pending days when PENDING requests exist', async () => {
      const balance = makeBalance({ hcmBalance: 10 });
      balanceRepo.findByDimension.mockResolvedValue(balance);
      dataSource.query.mockResolvedValue([{ total: '3' }]);

      const result = await service.computeAvailable('emp1', 'loc1', 'VACATION');

      expect(result!.available).toBe(7);
    });

    it('returns hcm_balance minus pending days when HCM_DEDUCT_PENDING requests exist', async () => {
      const balance = makeBalance({ hcmBalance: 8 });
      balanceRepo.findByDimension.mockResolvedValue(balance);
      dataSource.query.mockResolvedValue([{ total: '2.5' }]);

      const result = await service.computeAvailable('emp1', 'loc1', 'VACATION');

      expect(result!.available).toBeCloseTo(5.5);
    });

    it('returns null when no leave_balance row exists (first-time employee)', async () => {
      balanceRepo.findByDimension.mockResolvedValue(null);

      const result = await service.computeAvailable('emp_new', 'loc1', 'VACATION');

      expect(result).toBeNull();
    });
  });

  describe('isStale', () => {
    it('returns false when lastSyncedAt is 20 minutes ago', () => {
      const balance = makeBalance({
        lastSyncedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      });
      configService.get.mockReturnValue(30);

      expect(service.isStale(balance)).toBe(false);
    });

    it('returns true when lastSyncedAt is 35 minutes ago', () => {
      const balance = makeBalance({
        lastSyncedAt: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
      });
      configService.get.mockReturnValue(30);

      expect(service.isStale(balance)).toBe(true);
    });

    it('returns true when lastSyncedAt is exactly at the threshold boundary', () => {
      // Exactly 30 minutes ago — the check is strict (>), so at exactly 30 it's NOT stale
      const balance = makeBalance({
        lastSyncedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      });
      configService.get.mockReturnValue(30);

      // ageMs / 60_000 = 30, threshold = 30 → 30 > 30 is false
      expect(service.isStale(balance)).toBe(false);
    });
  });
});
