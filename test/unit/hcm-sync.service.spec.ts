import { HcmSyncService } from '../../src/hcm/hcm-sync.service';

describe('HcmSyncService', () => {
  let service: HcmSyncService;

  beforeEach(() => {
    // TODO: wire up with mocked HcmClient, repos, ConfigService
  });

  describe('chunkArray (private helper)', () => {
    it.todo('splits 1500 records into 3 chunks of 500');
    it.todo('handles a list smaller than chunk size as a single chunk');
    it.todo('handles empty list as empty array of chunks');
  });

  describe('processRealtimeWebhook — stale event guard', () => {
    it.todo('discards event when effectiveAt is older than last_synced_at minus 30s skew tolerance');
    it.todo('applies event when effectiveAt is within the skew tolerance window');
  });

  describe('processBatchSync — deduplication', () => {
    it.todo('keeps last occurrence when batch contains duplicate (employeeId, locationId, leaveType)');
  });
});
