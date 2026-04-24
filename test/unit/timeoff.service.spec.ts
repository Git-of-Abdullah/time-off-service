import { TimeOffService } from '../../src/time-off/time-off.service';

describe('TimeOffService', () => {
  let service: TimeOffService;

  beforeEach(() => {
    // TODO: wire up with mocked repos, BalanceService, HcmClient
  });

  describe('deriveIdempotencyKey', () => {
    it.todo('produces identical output for identical inputs');
    it.todo('produces different output for different employeeId');
    it.todo('produces different output for different date range');
  });
});
