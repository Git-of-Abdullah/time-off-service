import { HcmSyncService } from '../../src/hcm/hcm-sync.service';

// Expose private helper for testing via type cast
type AnyHcmSyncService = {
  chunkArray<T>(items: T[], size: number): T[][];
  deduplicateRecords(records: any[]): any[];
  processRealtimeWebhook(dto: any): Promise<void>;
};

describe('HcmSyncService', () => {
  let service: AnyHcmSyncService;
  let mockLogger: { warn: jest.Mock; log: jest.Mock; error: jest.Mock };

  beforeEach(() => {
    mockLogger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };

    const raw = new HcmSyncService(
      {} as any, // hcmClient
      {} as any, // balanceRepo
      {} as any, // balanceService
      {} as any, // requestRepo
      {} as any, // syncLogRepo
    );
    // Inject the mock logger
    (raw as any).logger = mockLogger;
    service = raw as unknown as AnyHcmSyncService;
  });

  describe('chunkArray', () => {
    it('splits 1500 records into 3 chunks of 500', () => {
      const items = Array.from({ length: 1500 }, (_, i) => i);
      const chunks = service.chunkArray(items, 500);
      expect(chunks).toHaveLength(3);
      chunks.forEach((c) => expect(c).toHaveLength(500));
    });

    it('handles a list smaller than chunk size as a single chunk', () => {
      const items = [1, 2, 3];
      const chunks = service.chunkArray(items, 500);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual([1, 2, 3]);
    });

    it('handles empty list as empty array of chunks', () => {
      const chunks = service.chunkArray([], 500);
      expect(chunks).toHaveLength(0);
    });
  });

  describe('deduplicateRecords', () => {
    it('keeps last occurrence when batch contains duplicate (employeeId, locationId, leaveType)', () => {
      const records = [
        { employeeId: 'e1', locationId: 'l1', leaveType: 'VACATION', balance: 5 },
        { employeeId: 'e1', locationId: 'l1', leaveType: 'VACATION', balance: 8 },
      ];
      const result = service.deduplicateRecords(records);
      expect(result).toHaveLength(1);
      expect(result[0].balance).toBe(8);
    });

    it('logs HCM_BATCH_DUPLICATE_RECORD when a duplicate is encountered', () => {
      const records = [
        { employeeId: 'e1', locationId: 'l1', leaveType: 'VACATION', balance: 5 },
        { employeeId: 'e1', locationId: 'l1', leaveType: 'VACATION', balance: 8 },
      ];
      service.deduplicateRecords(records);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('HCM_BATCH_DUPLICATE_RECORD'),
      );
    });

    it('preserves unique records unchanged', () => {
      const records = [
        { employeeId: 'e1', locationId: 'l1', leaveType: 'VACATION', balance: 5 },
        { employeeId: 'e2', locationId: 'l1', leaveType: 'SICK', balance: 3 },
      ];
      const result = service.deduplicateRecords(records);
      expect(result).toHaveLength(2);
    });
  });

  describe('processRealtimeWebhook — stale event guard', () => {
    it('discards event when effectiveAt is older than last_synced_at minus 30s skew tolerance', async () => {
      const now = Date.now();
      const lastSyncedAt = new Date(now).toISOString();
      // effectiveAt is 60 seconds before lastSyncedAt — outside 30s tolerance
      const effectiveAt = new Date(now - 60_000).toISOString();

      const balanceRepo = {
        findByDimension: jest.fn().mockResolvedValue({
          id: 'b1',
          hcmBalance: 10,
          lastSyncedAt,
          version: 1,
        }),
        upsert: jest.fn(),
      };

      const syncLogRepo = {
        findOneBy: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockReturnValue({}),
        save: jest.fn(),
      };

      const requestRepo = {
        findPendingDaysByDimension: jest.fn().mockResolvedValue({ total: 0 }),
      };

      const rawService = new HcmSyncService(
        {} as any,
        balanceRepo as any,
        {} as any,
        requestRepo as any,
        syncLogRepo as any,
      );
      (rawService as any).logger = mockLogger;

      await rawService.processRealtimeWebhook({
        eventId: 'evt_old',
        timestamp: Math.floor(now / 1000),
        eventType: 'BALANCE_UPDATE',
        employeeId: 'e1',
        locationId: 'l1',
        leaveType: 'VACATION',
        newBalance: 7,
        reason: 'test',
        effectiveAt,
      });

      expect(balanceRepo.upsert).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('out-of-order'));
    });

    it('applies event when effectiveAt is within the skew tolerance window', async () => {
      const now = Date.now();
      const lastSyncedAt = new Date(now).toISOString();
      // effectiveAt is only 10 seconds before — within 30s tolerance
      const effectiveAt = new Date(now - 10_000).toISOString();

      const balanceRepo = {
        findByDimension: jest.fn().mockResolvedValue({
          id: 'b1',
          hcmBalance: 10,
          lastSyncedAt,
          version: 1,
        }),
        upsert: jest.fn().mockResolvedValue(undefined),
      };

      const syncLogRepo = {
        findOneBy: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockReturnValue({}),
        save: jest.fn(),
      };

      const requestRepo = {
        findPendingDaysByDimension: jest.fn().mockResolvedValue({ total: 0 }),
      };

      const rawService = new HcmSyncService(
        {} as any,
        balanceRepo as any,
        {} as any,
        requestRepo as any,
        syncLogRepo as any,
      );
      (rawService as any).logger = mockLogger;

      await rawService.processRealtimeWebhook({
        eventId: 'evt_recent',
        timestamp: Math.floor(now / 1000),
        eventType: 'BALANCE_UPDATE',
        employeeId: 'e1',
        locationId: 'l1',
        leaveType: 'VACATION',
        newBalance: 8,
        reason: 'test',
        effectiveAt,
      });

      expect(balanceRepo.upsert).toHaveBeenCalled();
    });
  });
});
