import { BalanceService } from '../../src/balance/balance.service';

describe('BalanceService', () => {
  let service: BalanceService;

  beforeEach(() => {
    // TODO: wire up with mocked LeaveBalanceRepository, HcmClient, ConfigService
  });

  describe('computeAvailable', () => {
    it.todo('returns hcm_balance unchanged when there are no pending requests');
    it.todo('returns hcm_balance minus pending days when PENDING requests exist');
    it.todo('returns hcm_balance minus pending days when HCM_DEDUCT_PENDING requests exist');
    it.todo('returns null when no leave_balance row exists (first-time employee)');
  });

  describe('isStale', () => {
    it.todo('returns false when lastSyncedAt is 20 minutes ago');
    it.todo('returns true when lastSyncedAt is 35 minutes ago');
    it.todo('returns true when lastSyncedAt is exactly at the threshold boundary');
  });
});
