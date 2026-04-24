import { HcmClient } from '../../src/hcm/hcm.client';

describe('HcmClient', () => {
  let client: HcmClient;

  beforeEach(() => {
    // TODO: wire up with mocked ConfigService; point baseURL at MockHcmServer
  });

  describe('retry behaviour', () => {
    it.todo('retries 3 times on 503 then throws HCM_UNAVAILABLE');
    it.todo('succeeds on the 2nd attempt when first returns 503');
    it.todo('does NOT retry on 400 — throws immediately');
    it.todo('does NOT retry on 422 — throws immediately');
    it.todo('respects Retry-After header on 429 before retrying');
  });

  describe('getBalance', () => {
    it.todo('returns HcmBalance on success');
    it.todo('throws when HCM returns 404 for unknown employee');
  });

  describe('deductBalance', () => {
    it.todo('returns HcmDeductResult with transactionId on success');
    it.todo('throws INSUFFICIENT_BALANCE error when HCM returns 422');
  });

  describe('creditBalance', () => {
    it.todo('resolves without error on success');
    it.todo('retries on 503 and eventually throws if max retries exceeded');
  });
});
