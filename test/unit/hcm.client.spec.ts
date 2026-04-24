import { ConfigService } from '@nestjs/config';
import { HcmClient } from '../../src/hcm/hcm.client';
import { MockHcmServer } from '../mock-hcm/server';

describe('HcmClient', () => {
  let client: HcmClient;
  let mockHcm: MockHcmServer;

  beforeAll(async () => {
    mockHcm = new MockHcmServer(4010);
    await mockHcm.start();
  });

  afterAll(() => mockHcm.stop());

  beforeEach(() => {
    mockHcm.reset();
    const config = {
      get: (key: string, def?: unknown) => {
        const values: Record<string, unknown> = {
          HCM_BASE_URL: 'http://localhost:4010',
          HCM_MAX_RETRIES: 3,
          HCM_TIMEOUT_MS: 2000,
        };
        return values[key] ?? def;
      },
    } as unknown as ConfigService;
    client = new HcmClient(config);
  });

  describe('retry behaviour', () => {
    it('retries 3 times on 503 then throws', async () => {
      mockHcm.seed({ employeeId: 'e1', locationId: 'l1', leaveType: 'VACATION', balance: 10 });
      mockHcm.injectError({ nextN: 4, statusCode: 503 });

      await expect(client.getBalance('e1', 'l1', 'VACATION')).rejects.toMatchObject({
        response: { status: 503 },
      });
    }, 15_000);

    it('succeeds on the 2nd attempt when first returns 503', async () => {
      mockHcm.seed({ employeeId: 'e1', locationId: 'l1', leaveType: 'VACATION', balance: 10 });
      mockHcm.injectError({ nextN: 1, statusCode: 503 });

      const result = await client.getBalance('e1', 'l1', 'VACATION');
      expect(result.balance).toBe(10);
    }, 10_000);

    it('does NOT retry on 400 — throws immediately', async () => {
      // Injecting 400 for deduct; record with insufficient balance triggers 422 by default.
      // We inject a 400 to verify no retries.
      mockHcm.seed({ employeeId: 'e1', locationId: 'l1', leaveType: 'VACATION', balance: 10 });
      mockHcm.injectError({ nextN: 1, statusCode: 400 });

      const start = Date.now();
      await expect(client.getBalance('e1', 'l1', 'VACATION')).rejects.toMatchObject({
        response: { status: 400 },
      });
      // Should fail fast — well under the retry delay (500ms)
      expect(Date.now() - start).toBeLessThan(500);
    });

    it('does NOT retry on 422 — throws immediately', async () => {
      mockHcm.seed({ employeeId: 'e1', locationId: 'l1', leaveType: 'VACATION', balance: 2 });
      mockHcm.injectError({ nextN: 1, statusCode: 422 });

      const start = Date.now();
      await expect(client.getBalance('e1', 'l1', 'VACATION')).rejects.toMatchObject({
        response: { status: 422 },
      });
      expect(Date.now() - start).toBeLessThan(500);
    });
  });

  describe('getBalance', () => {
    it('returns HcmBalance on success', async () => {
      mockHcm.seed({ employeeId: 'e2', locationId: 'l2', leaveType: 'SICK', balance: 5 });

      const result = await client.getBalance('e2', 'l2', 'SICK');
      expect(result).toMatchObject({ employeeId: 'e2', locationId: 'l2', leaveType: 'SICK', balance: 5 });
    });

    it('throws when HCM returns 404 for unknown employee', async () => {
      await expect(client.getBalance('unknown', 'loc', 'VACATION')).rejects.toMatchObject({
        response: { status: 404 },
      });
    });
  });

  describe('deductBalance', () => {
    it('returns HcmDeductResult with transactionId on success', async () => {
      mockHcm.seed({ employeeId: 'e3', locationId: 'l3', leaveType: 'VACATION', balance: 10 });

      const result = await client.deductBalance('e3', 'l3', 'VACATION', 3, 'idem-key-1');
      expect(result.transactionId).toBeDefined();
      expect(result.remainingBalance).toBe(7);
    });

    it('throws INSUFFICIENT_BALANCE error when HCM returns 422', async () => {
      mockHcm.seed({ employeeId: 'e4', locationId: 'l4', leaveType: 'VACATION', balance: 1 });

      await expect(client.deductBalance('e4', 'l4', 'VACATION', 5, 'idem-key-2')).rejects.toMatchObject({
        response: { status: 422 },
      });
    });
  });

  describe('creditBalance', () => {
    it('resolves without error on success', async () => {
      mockHcm.seed({ employeeId: 'e5', locationId: 'l5', leaveType: 'VACATION', balance: 7 });

      await expect(
        client.creditBalance('e5', 'l5', 'VACATION', 3, 'orig_txn_1'),
      ).resolves.toBeUndefined();
    });

    it('retries on 503 and eventually throws if max retries exceeded', async () => {
      mockHcm.seed({ employeeId: 'e6', locationId: 'l6', leaveType: 'SICK', balance: 5 });
      mockHcm.injectError({ nextN: 4, statusCode: 503 });

      await expect(
        client.creditBalance('e6', 'l6', 'SICK', 2, 'orig_txn_2'),
      ).rejects.toMatchObject({ response: { status: 503 } });
    }, 15_000);
  });
});
