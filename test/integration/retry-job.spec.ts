import { INestApplication } from '@nestjs/common';
import { MockHcmServer } from '../mock-hcm/server';

describe('Background Retry Job — HCM_DEDUCT_PENDING / CANCELLATION_CREDIT_PENDING', () => {
  let app: INestApplication;
  let mockHcm: MockHcmServer;

  beforeAll(async () => {
    mockHcm = new MockHcmServer(4005);
    await mockHcm.start();
    // TODO: bootstrap NestJS test app with short cron interval for testing
  });

  afterAll(async () => {
    await mockHcm.stop();
    await app?.close();
  });

  beforeEach(() => mockHcm.reset());

  describe('HCM_DEDUCT_PENDING retry', () => {
    it.todo('APPROVED — HCM recovers on next retry; status transitions HCM_DEDUCT_PENDING → APPROVED');
    it.todo('PENDING — HCM returns INSUFFICIENT_BALANCE on retry; status returns to PENDING');
    it.todo('RETRY_EXHAUSTED — HCM still unavailable after 10 retries; ops alert triggered');
    it.todo('REJECTED — HCM returns 400 on retry; status transitions to REJECTED');
  });

  describe('CANCELLATION_CREDIT_PENDING retry', () => {
    it.todo('CANCELLED — HCM credit succeeds on retry; status transitions to CANCELLED; hcm_balance refreshed');
    it.todo('RETRY_EXHAUSTED — HCM credit still fails after 10 retries; escalated to ops');
  });
});
