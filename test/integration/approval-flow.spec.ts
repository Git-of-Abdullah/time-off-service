import { INestApplication } from '@nestjs/common';
import { MockHcmServer } from '../mock-hcm/server';

describe('Approval / Rejection / Cancellation Flows', () => {
  let app: INestApplication;
  let mockHcm: MockHcmServer;

  beforeAll(async () => {
    mockHcm = new MockHcmServer(4002);
    await mockHcm.start();
    // TODO: bootstrap NestJS test app
  });

  afterAll(async () => {
    await mockHcm.stop();
    await app?.close();
  });

  beforeEach(() => mockHcm.reset());

  describe('PATCH /requests/:id/approve', () => {
    it.todo('200 APPROVED — PENDING request; HCM accepts deduction; hcm_committed=true');
    it.todo('422 HCM_BALANCE_MISMATCH — balance dropped to 0 between submission and approval; request stays PENDING');
    it.todo('202 HCM_DEDUCT_PENDING — HCM returns 503 three times during approval');
    it.todo('409 INVALID_STATE_TRANSITION — approving an already-APPROVED request');
    it.todo('409 INVALID_STATE_TRANSITION — approving a REJECTED request');
    it.todo('404 REQUEST_NOT_FOUND — ID does not exist');
  });

  describe('PATCH /requests/:id/reject', () => {
    it.todo('200 REJECTED — no HCM call is made');
    it.todo('409 INVALID_STATE_TRANSITION — rejecting an already-APPROVED request');
  });

  describe('DELETE /requests/:id (cancel)', () => {
    it.todo('200 CANCELLED — PENDING request; no HCM call made');
    it.todo('200 CANCELLED — APPROVED request with hcm_committed=true; HCM credit call is made');
    it.todo('202 CANCELLATION_CREDIT_PENDING — APPROVED + committed; HCM credit returns 503');
    it.todo('200 CANCELLED — HCM_DEDUCT_PENDING request; cancelled locally with no HCM call');
    it.todo('403 — employee attempts to cancel another employee\'s request');
  });
});
